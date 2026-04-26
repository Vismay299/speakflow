import Combine
import Foundation
import os.log
import VoiceToTextMac

@MainActor
final class DictationCoordinator {
    private static let log = Logger(subsystem: "com.speakflow.shell", category: "coordinator")
    private let shellState: ShellState
    private let permissionsManager: PermissionsManager
    private let hotkeyMonitor: HotkeyMonitor
    private let captureManager: UtteranceCaptureManager
    private let transcriptionService: UtteranceTranscriptionService
    private let insertionEngine: TextInsertionEngine
    private let snippetStore: SnippetStore

    private var cancellables: Set<AnyCancellable> = []
    private var bootstrapped = false
    private var lastTranscription: TranscribedUtterance?
    private var lastInsertionResult: InsertionResult?
    private var partialTranscriptionTask: Task<Void, Never>?
    private var pendingLiveInsertionTextByArtifactID: [UUID: String] = [:]

    /// Activity token that prevents macOS App Nap from throttling us + compressing
    /// the worker's 800MB of model weights while the menu-bar app sits idle.
    /// Retained for the lifetime of the coordinator.
    private var appNapActivity: NSObjectProtocol?

    /// Fires every 90s to run a silent clip through the worker, keeping model
    /// pages hot and the Metal GPU context warm.
    private var warmupTimer: Timer?

    init(
        shellState: ShellState,
        permissionsManager: PermissionsManager,
        hotkeyMonitor: HotkeyMonitor,
        captureManager: UtteranceCaptureManager,
        transcriptionService: UtteranceTranscriptionService,
        insertionEngine: TextInsertionEngine,
        snippetStore: SnippetStore
    ) {
        self.shellState = shellState
        self.permissionsManager = permissionsManager
        self.hotkeyMonitor = hotkeyMonitor
        self.captureManager = captureManager
        self.transcriptionService = transcriptionService
        self.insertionEngine = insertionEngine
        self.snippetStore = snippetStore
        bind()
    }

    func bootstrapIfNeeded() {
        guard !bootstrapped else {
            return
        }

        bootstrapped = true
        permissionsManager.refreshStates()
        hotkeyMonitor.startMonitoring()
        shellState.refreshCaptureState(captureManager.captureState)
        transcriptionService.bootstrap()
        shellState.refreshTranscriptionState(transcriptionService.transcriptionState)
        shellState.recentTranscribedUtterances = transcriptionService.recentTranscriptions

        // Bootstrap snippet store and load snippets.
        try? snippetStore.bootstrap()
        shellState.snippetStore = snippetStore

        // Fix #5: Wire resend callback so the UI actually reinserts text.
        shellState.onResendSnippet = { [weak self] text in
            guard let self else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.shellState.refreshInsertionState(.detectingTarget)
                let result = await self.insertionEngine.insertText(text)
                self.shellState.refreshInsertionState(
                    result.success ? .inserted(result) : .failed(result.errorMessage ?? "Resend failed")
                )
            }
        }

        loadSnippets()

        // Series 12: Auto-prompt for permissions on first launch.
        if shellState.shouldShowOnboarding {
            shellState.requestPermissionsOnboarding(permissionsManager: permissionsManager)
        }

        // Series 13: Start the persistent transcription worker in the background.
        // Model preload happens here so the first dictation doesn't pay startup cost.
        Task {
            await transcriptionService.startWorker()
        }

        // Hold an App Nap assertion so macOS doesn't throttle us or compress
        // the worker's model weights during idle periods. Without this, the
        // first dictation after a few minutes idle takes several seconds
        // because the OS has paged/compressed the 800MB of MLX weights.
        appNapActivity = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiatedAllowingIdleSystemSleep, .latencyCritical],
            reason: "SpeakFlow dictation must respond instantly at any time"
        )

        // Periodic warmup: run a silent clip through the worker every 90s.
        // Complements the App Nap assertion by actively touching model pages
        // and the Metal context so neither can go cold under memory pressure.
        // Use an unscheduled Timer added only in .common mode so the timer
        // still fires during UI tracking (menu open, scroll) without being
        // registered into multiple run loop modes.
        let timer = Timer(timeInterval: 90, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.transcriptionService.warmupPing()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        warmupTimer = timer

        syncShellState()
    }

    private func loadSnippets() {
        if let snippets = try? snippetStore.loadRecent(limit: 50) {
            shellState.sqliteSnippets = snippets
        }
    }

    private func bind() {
        permissionsManager.$microphoneState
            .sink { [weak self] _ in
                self?.syncShellState()
            }
            .store(in: &cancellables)

        permissionsManager.$accessibilityState
            .sink { [weak self] _ in
                self?.syncShellState()
            }
            .store(in: &cancellables)

        hotkeyMonitor.$isMonitoring
            .sink { [weak self] isMonitoring in
                guard let self else { return }
                self.syncShellState()
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    await self.handleMonitoringChanged(isMonitoring)
                }
            }
            .store(in: &cancellables)

        hotkeyMonitor.$isPushToTalkPressed
            .removeDuplicates()
            .sink { [weak self] isPressed in
                guard let self else { return }
                self.syncShellState()
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    await self.handlePushToTalkChange(isPressed)
                }
            }
            .store(in: &cancellables)

        captureManager.$captureState
            .sink { [weak self] captureState in
                guard let self else { return }
                self.shellState.refreshCaptureState(captureState)
                if case .captured(let artifact) = captureState {
                    let mode = self.shellState.selectedMode
                    Task { @MainActor [weak self] in
                        guard let self else { return }
                        await self.transcriptionService.transcribe(artifact, mode: mode)
                    }
                }
            }
            .store(in: &cancellables)

        transcriptionService.$transcriptionState
            .sink { [weak self] transcriptionState in
                self?.shellState.refreshTranscriptionState(transcriptionState)
            }
            .store(in: &cancellables)

        transcriptionService.$recentTranscriptions
            .sink { [weak self] transcriptions in
                self?.shellState.recentTranscribedUtterances = transcriptions
            }
            .store(in: &cancellables)

        // Auto-insert when transcription completes.
        transcriptionService.$transcriptionState
            .sink { [weak self] state in
                guard let self else { return }
                if case .transcribed(let transcription) = state {
                    self.lastTranscription = transcription
                    if self.shellState.autoInsertEnabled {
                        Task { @MainActor [weak self] in
                            guard let self else { return }
                            let textToInsert = transcription.displayText
                            let mode = transcription.mode ?? .terminal
                            let hasPendingLivePreview = self.pendingLiveInsertionTextByArtifactID[transcription.id] != nil
                            if textToInsert.isEmpty && !hasPendingLivePreview { return }

                            self.shellState.refreshInsertionState(.detectingTarget)
                            let result = await self.insertFinalTranscript(
                                transcription: transcription,
                                finalText: textToInsert,
                                mode: mode
                            )
                            self.lastInsertionResult = result
                            self.shellState.refreshInsertionState(
                                result.success ? .inserted(result) : .failed(result.errorMessage ?? "Insertion failed")
                            )

                            // Save to snippet store after insertion.
                            self.saveSnippet(transcription, insertionResult: result)
                        }
                    } else {
                        // Even without auto-insert, save the snippet.
                        self.saveSnippet(transcription, insertionResult: nil)
                    }
                }
            }
            .store(in: &cancellables)
    }

    private func saveSnippet(_ transcription: TranscribedUtterance, insertionResult: InsertionResult?) {
        let commands = transcription.detectedCommands.map { $0.rawValue }
        let record = SnippetRecord(
            id: transcription.id,
            rawText: transcription.text,
            cleanedText: transcription.cleanedText,
            mode: (transcription.mode ?? .terminal).rawValue,
            detectedCommands: commands,
            targetAppName: insertionResult?.targetAppName,
            insertionSuccess: insertionResult?.success,
            createdAt: transcription.capturedAt,
            updatedAt: Date()
        )
        do {
            try snippetStore.insert(record)
        } catch {
            Self.log.error("Failed to save snippet: \(error.localizedDescription)")
        }
        loadSnippets()
    }

    private func syncShellState() {
        shellState.refreshIntegrationState(
            microphoneState: permissionsManager.microphoneState,
            accessibilityState: permissionsManager.accessibilityState,
            allRequiredGranted: permissionsManager.allRequiredGranted,
            isMonitoringHotkey: hotkeyMonitor.isMonitoring,
            isPushToTalkPressed: hotkeyMonitor.isPushToTalkPressed,
            hotkeyDisplayName: hotkeyMonitor.hotkeyDisplayName
        )
    }

    private func handlePushToTalkChange(_ isPressed: Bool) async {
        guard permissionsManager.allRequiredGranted, hotkeyMonitor.isMonitoring else {
            return
        }

        if isPressed {
            await captureManager.startCapture()
            if case .recording(let utteranceID) = captureManager.captureState {
                transcriptionService.beginPreview(for: utteranceID)
                startPartialTranscriptionLoop(for: utteranceID)
            }
        } else {
            stopPartialTranscriptionLoop()
            if case .recording(let utteranceID) = captureManager.captureState {
                transcriptionService.endPreview(for: utteranceID)
            }
            await captureManager.stopCapture()
        }
    }

    private func handleMonitoringChanged(_ isMonitoring: Bool) async {
        guard !isMonitoring else {
            return
        }

        stopPartialTranscriptionLoop()
        if case .recording(let utteranceID) = captureManager.captureState {
            transcriptionService.endPreview(for: utteranceID)
            await captureManager.stopCapture()
        }
    }

    private func startPartialTranscriptionLoop(for artifactID: UUID) {
        partialTranscriptionTask?.cancel()

        partialTranscriptionTask = Task { @MainActor [weak self] in
            guard let self else { return }

            var lastObservedSizeBytes: Int64 = 0
            var lastPreviewText = ""

            while !Task.isCancelled {
                guard case .recording(let currentArtifactID) = self.captureManager.captureState,
                      currentArtifactID == artifactID else {
                    break
                }

                guard let snapshot = self.captureManager.currentArtifactSnapshot() else {
                    try? await Task.sleep(nanoseconds: 250_000_000)
                    continue
                }

                let hasEnoughAudio = snapshot.durationSeconds >= 0.45
                let hasNewAudio = snapshot.fileSizeBytes > lastObservedSizeBytes
                guard hasEnoughAudio, hasNewAudio else {
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    continue
                }

                lastObservedSizeBytes = snapshot.fileSizeBytes

                if let partialText = await self.transcriptionService.transcribePartial(snapshot, mode: self.shellState.selectedMode),
                   partialText != lastPreviewText {
                    lastPreviewText = partialText
                    await self.applyLivePreviewInsertionIfNeeded(
                        text: partialText,
                        artifactID: artifactID,
                        mode: self.shellState.selectedMode
                    )
                }

                try? await Task.sleep(nanoseconds: 350_000_000)
            }
        }
    }

    private func stopPartialTranscriptionLoop() {
        partialTranscriptionTask?.cancel()
        partialTranscriptionTask = nil
    }

    private func applyLivePreviewInsertionIfNeeded(text: String, artifactID: UUID, mode: DictationMode) async {
        guard shellState.autoInsertEnabled, mode == .terminal else { return }

        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        if let insertedPreviewText = pendingLiveInsertionTextByArtifactID[artifactID] {
            guard trimmed.hasPrefix(insertedPreviewText) else {
                return
            }

            let delta = String(trimmed.dropFirst(insertedPreviewText.count))
            guard !delta.isEmpty else { return }

            let result = await insertionEngine.insertLiveTextFragment(delta)
            if result.success {
                pendingLiveInsertionTextByArtifactID[artifactID] = trimmed
                lastInsertionResult = result
                shellState.refreshInsertionState(.inserted(result))
            } else {
                shellState.refreshInsertionState(.failed(result.errorMessage ?? "Live preview insertion failed"))
            }
            return
        }

        let result = await insertionEngine.insertLiveTextFragment(trimmed)
        if result.success {
            pendingLiveInsertionTextByArtifactID[artifactID] = trimmed
            lastInsertionResult = result
            shellState.refreshInsertionState(.inserted(result))
        } else {
            shellState.refreshInsertionState(.failed(result.errorMessage ?? "Live preview insertion failed"))
        }
    }

    private func insertFinalTranscript(
        transcription: TranscribedUtterance,
        finalText: String,
        mode: DictationMode
    ) async -> InsertionResult {
        guard shellState.autoInsertEnabled else {
            return InsertionResult(
                success: false,
                strategy: .notAvailable,
                targetAppBundleId: nil,
                targetAppName: nil,
                errorMessage: "Auto-insert is disabled.",
                insertedTextPreview: finalText
            )
        }

        if let insertedPreviewText = pendingLiveInsertionTextByArtifactID.removeValue(forKey: transcription.id),
           mode == .terminal {
            return await insertionEngine.reconcileLiveText(
                previousText: insertedPreviewText,
                finalText: finalText
            )
        }

        return await insertionEngine.insertText(finalText)
    }
}
