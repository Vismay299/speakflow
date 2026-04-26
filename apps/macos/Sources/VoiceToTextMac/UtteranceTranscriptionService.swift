import Foundation
import os.log

@MainActor
public final class UtteranceTranscriptionService: ObservableObject {
    private static let log = Logger(subsystem: "com.speakflow.shell", category: "transcription-service")

    @Published public private(set) var transcriptionState: TranscriptionState = .idle
    @Published public private(set) var recentTranscriptions: [TranscribedUtterance] = []

    private let finalBridge: UtteranceTranscriptionBridging
    private let partialBridge: UtteranceTranscriptionBridging
    private let store: TranscribedUtteranceStore
    private let cleaner: TranscriptCleaner
    private let commandParser: VoiceCommandParser
    private var queuedArtifacts: [(artifact: CapturedUtteranceArtifact, mode: DictationMode)] = []
    private var isProcessingQueue = false
    private var activeArtifactID: UUID?
    private var activePreviewArtifactID: UUID?
    private var completionWaiters: [UUID: [CheckedContinuation<Void, Never>]] = [:]

    public init(
        bridge: UtteranceTranscriptionBridging? = nil,
        partialBridge: UtteranceTranscriptionBridging? = nil,
        store: TranscribedUtteranceStore = TranscribedUtteranceStore(),
        cleaner: TranscriptCleaner = TranscriptCleaner(),
        commandParser: VoiceCommandParser = VoiceCommandParser()
    ) {
        if let bridge {
            self.finalBridge = bridge
            self.partialBridge = partialBridge ?? bridge
        } else {
            let unavailable = UnavailableTranscriptionBridge(
                message: "Local transcription dependencies are unavailable. Run `python3 -m pip install -r services/asr-worker/requirements.txt` and relaunch the app."
            )
            self.partialBridge = (try? PythonLargeV3TranscriptionBridge(modelTier: "fast")) ?? unavailable
            self.finalBridge = (try? PythonLargeV3TranscriptionBridge(modelTier: "quality")) ?? unavailable
        }
        self.store = store
        self.cleaner = cleaner
        self.commandParser = commandParser
    }

    /// Series 13: Start the persistent transcription worker (model preload).
    /// Call once at app startup to eliminate per-utterance process spawn overhead.
    public func startWorker() async {
        for persistent in persistentBridges() {
            try? await persistent.startWorker()
        }
    }

    /// Series 13: Stop the persistent transcription worker.
    public func stopWorker() {
        for persistent in persistentBridges() {
            persistent.stopWorker()
        }
    }

    /// Warmup ping — runs a silent clip through the model to keep weights
    /// resident and the GPU context warm. Called on an interval by the
    /// coordinator to counter macOS App Nap memory compression when the
    /// app has been idle.
    public func warmupPing() async {
        guard activeArtifactID == nil, !isProcessingQueue else { return }
        for persistent in persistentBridges() {
            try? await persistent.ping()
        }
    }

    public func bootstrap() {
        do {
            recentTranscriptions = try store.loadRecent(limit: 12)
        } catch {
            recentTranscriptions = []
        }
    }

    public func transcribe(_ artifact: CapturedUtteranceArtifact, mode: DictationMode) async {
        if recentTranscriptions.contains(where: { $0.id == artifact.id }) {
            return
        }

        if queuedArtifacts.contains(where: { $0.artifact.id == artifact.id }) || activeArtifactID == artifact.id {
            await waitForCompletion(of: artifact.id)
            return
        }

        queuedArtifacts.append((artifact, mode))
        await withCheckedContinuation { continuation in
            completionWaiters[artifact.id, default: []].append(continuation)
            startQueueIfNeeded()
        }
    }

    public func beginPreview(for artifactID: UUID) {
        activePreviewArtifactID = artifactID
    }

    public func endPreview(for artifactID: UUID) {
        guard activePreviewArtifactID == artifactID else { return }
        activePreviewArtifactID = nil
        if case .partial = transcriptionState {
            transcriptionState = .idle
        }
    }

    /// Series 13: Transcribe the currently-recording WAV file for partial, live text display.
    /// Does not persist the result — it's purely for real-time UI feedback while the hotkey is held.
    public func transcribePartial(_ artifact: CapturedUtteranceArtifact, mode: DictationMode) async -> String? {
        do {
            let raw = try await partialBridge.transcribe(artifact)
            // Live partial insertion must stay close to the raw transcript.
            // Applying cleaner/command transforms on unstable partials makes
            // the CLI look random because those transforms can change as the
            // model revises earlier words. Reserve cleanup and command parsing
            // for the final transcript only.
            let displayText = cleaner.suppressKnownHallucinations(in: raw.text)
            let trimmedDisplayText = displayText.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmedDisplayText.isEmpty,
               !cleaner.isKnownHallucinationPrefix(trimmedDisplayText),
               activePreviewArtifactID == artifact.id {
                transcriptionState = .partial(partialText: trimmedDisplayText)
                return trimmedDisplayText
            }
        } catch {
            // Partial transcription failures are silent — the final transcription will still run.
        }
        return nil
    }

    private func startQueueIfNeeded() {
        guard !isProcessingQueue else {
            return
        }

        Task { @MainActor [weak self] in
            await self?.processQueue()
        }
    }

    private func processQueue() async {
        guard !isProcessingQueue else {
            return
        }

        isProcessingQueue = true
        defer {
            isProcessingQueue = false
            activeArtifactID = nil
        }

        while !queuedArtifacts.isEmpty {
            let item = queuedArtifacts.removeFirst()
            let nextArtifact = item.artifact
            let mode = item.mode
            activeArtifactID = nextArtifact.id
            activePreviewArtifactID = nil
            transcriptionState = .transcribing(utteranceID: nextArtifact.id)

            do {
                let pipelineStart = Date()
                let raw = try await finalBridge.transcribe(nextArtifact)
                logLatencyMetrics(raw.latencyMetricsMs, artifact: nextArtifact)
                let cleaned = cleaner.clean(raw.text, mode: mode)
                let commandResult = commandParser.parse(cleaned)
                let finalText = commandResult.cleanedText
                let transcriptURL = try store.transcriptURL(for: nextArtifact.id)
                let transcription = TranscribedUtterance(
                    id: nextArtifact.id,
                    capturedAt: nextArtifact.createdAt,
                    transcribedAt: Date(),
                    sourceAudioURL: nextArtifact.fileURL,
                    transcriptURL: transcriptURL,
                    modelIdentifier: raw.modelIdentifier,
                    language: raw.language,
                    durationSeconds: raw.durationSeconds,
                    text: raw.text,
                    segments: raw.segments,
                    cleanedText: finalText,
                    mode: mode,
                    detectedCommands: commandResult.commands
                )
                let pipelineMs = Date().timeIntervalSince(pipelineStart) * 1000
                recentTranscriptions.removeAll { $0.id == transcription.id }
                recentTranscriptions.insert(transcription, at: 0)
                if recentTranscriptions.count > 12 {
                    recentTranscriptions = Array(recentTranscriptions.prefix(12))
                }
                transcriptionState = .transcribed(transcription)
                await Task.yield()

                do {
                    try store.persist(transcription)
                } catch {
                    Self.log.error("Transcript persistence failed after publish: \(error.localizedDescription)")
                }
                Self.log.info("Transcription pipeline completed in \(pipelineMs, format: .fixed(precision: 1))ms before persistence for utterance \(nextArtifact.id.uuidString, privacy: .public)")
            } catch {
                transcriptionState = .failed(error.localizedDescription)
            }

            finishQueuedTranscription(for: nextArtifact.id)
            activeArtifactID = nil
        }
    }

    private func waitForCompletion(of artifactID: UUID) async {
        await withCheckedContinuation { continuation in
            completionWaiters[artifactID, default: []].append(continuation)
        }
    }

    private func finishQueuedTranscription(for artifactID: UUID) {
        let waiters = completionWaiters.removeValue(forKey: artifactID) ?? []
        for waiter in waiters {
            waiter.resume()
        }
    }

    private func logLatencyMetrics(_ metrics: [String: Double]?, artifact: CapturedUtteranceArtifact) {
        guard let metrics, !metrics.isEmpty else { return }

        let original = metrics["original_duration_ms"] ?? 0
        let trimmed = metrics["trimmed_duration_ms"] ?? original
        let trimLead = metrics["trim_leading_ms"] ?? 0
        let trimTrail = metrics["trim_trailing_ms"] ?? 0
        let mlx = metrics["mlx_transcribe_ms"] ?? 0
        let total = metrics["total_worker_ms"] ?? 0
        let skipped = metrics["silence_skip"] ?? 0

        Self.log.info(
            "ASR latency utterance=\(artifact.id.uuidString, privacy: .public) original=\(original, format: .fixed(precision: 0))ms trimmed=\(trimmed, format: .fixed(precision: 0))ms lead=\(trimLead, format: .fixed(precision: 0))ms trail=\(trimTrail, format: .fixed(precision: 0))ms mlx=\(mlx, format: .fixed(precision: 0))ms total=\(total, format: .fixed(precision: 0))ms skipped=\(skipped, format: .fixed(precision: 0))"
        )
    }

    private func persistentBridges() -> [PythonLargeV3TranscriptionBridge] {
        var bridges: [PythonLargeV3TranscriptionBridge] = []
        if let partialPersistent = partialBridge as? PythonLargeV3TranscriptionBridge {
            bridges.append(partialPersistent)
        }
        if let finalPersistent = finalBridge as? PythonLargeV3TranscriptionBridge,
           !bridges.contains(where: { $0 === finalPersistent }) {
            bridges.append(finalPersistent)
        }
        return bridges
    }
}
