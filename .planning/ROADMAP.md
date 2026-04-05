# Master Execution Roadmap: Voice-to-Text Summarizer

> Status: Planning reset for local-first rebuild
>
> Last updated: 2026-04-04

Voice-to-Text Summarizer is now planned as a local-first, production-oriented AI application: a web-first product that captures conversation audio on the user's machine, prioritizes a highly accurate final transcript over realtime note-taking, generates one post-call summary from the finished transcript, and stores everything locally instead of depending on cloud infrastructure or prototype-only session state.

The current repository is still useful, but it is not the target system. It contains a web UI scaffold, a local companion prototype, a local JSON archive, browser speech recognition experiments, and meeting-helper proof-of-concept flows. Those artifacts are legacy baseline code, not proof that the final local-first AI architecture is already built.

Source of truth:
- `ROADMAP.md` is the main planning and session continuity document.
- `PROJECT.md` remains background context and original project framing.
- `STATE.md` is secondary and can lag behind this file.

## Vision

Build a fast, accurate conversation intelligence product that lets a user stay focused during a call while the system captures the audio locally, transcribes it with production-grade open-weight speech models, produces an authoritative final transcript plus a clear final summary after the call, and makes the entire session reviewable later from a Supabase-backed application with local audio artifacts.

## Product Goal

The MVP succeeds when all of the following are true:
- A user can start a session from the web app and capture microphone audio reliably.
- Audio is captured and processed locally on the user's machine.
- The backend produces an accurate final transcript after the session ends using the real recorded audio, not placeholder content.
- The system generates one final summary from the completed transcript; live notes are not required for MVP.
- Completed sessions are persisted in Supabase Postgres and raw audio is stored locally.
- A user can reopen past sessions and review transcript and summary without relying on local JSON files.
- The architecture is ready for mobile and future meeting capture expansion without a full redesign.

## Current Truth

- The repo currently contains a TypeScript monorepo with `apps/web`, `apps/companion`, and `packages/shared`.
- The current web UI is a useful shell for session control and transcript/history presentation.
- The local companion server is prototype scaffolding, not the final production backend.
- Local JSON persistence under `.voice-to-text-summarizer/` is temporary scaffolding and must not be treated as product storage.
- Browser `SpeechRecognition` / `webkitSpeechRecognition` is temporary scaffolding and must not be treated as the final transcription backend.
- The old runtime selector from the prototype era still exists in some UI surfaces, but the local ASR worker now runs real `faster-whisper` inference and the browser speech recognition path is no longer the target architecture.
- The local ASR worker now processes stored session audio from the local filesystem or Supabase-backed artifact store and persists transcript segments plus model-run metrics.
- The repo still contains live-note and rolling-summary logic from the previous product direction, but live notes are no longer part of the target MVP.
- The ASR plan now standardizes on `large-v3` only; there is no planned `large-v3-turbo` fallback in the MVP architecture.
- Meeting-helper and experimental Google Meet flows are exploratory UI/prototype work and are not real production capture paths.
- Existing code may be reused selectively for UI, shared types, and session concepts, but the roadmap assumes a local-first rebuild of the backend path.

## Target Architecture

Locked defaults for the local-first rebuild:

| Layer | Default Choice | Notes |
| --- | --- | --- |
| Frontend | Web app first | Keep the web product as the main operator surface for MVP. |
| Web client stack | Existing TypeScript/Vite frontend | Reuse the current client shell instead of adding framework churn in MVP. |
| Backend API | Local service on the user's machine | CPU service responsible for sessions, uploads, history reads, and realtime stream orchestration. |
| Transcription backend | `faster-whisper` | Primary ASR runtime for local transcription. |
| Default ASR model | `large-v3` | Accuracy-first default for the authoritative final transcript. |
| Summarization LLM | `Qwen2.5-7B-Instruct` | Default local summary/action extraction model. |
| Stronger later summary model | `Mistral Small 3.1 24B` | Upgrade path if summary quality needs more headroom. |
| LLM serving runtime | `Ollama` or direct local runtime | Keep the summary model local and simple to run. |
| Database | Supabase Postgres | System of record for sessions, transcript segments, summaries, and jobs. |
| Object storage | Local filesystem | Durable raw audio and generated artifact storage. |
| Hosting target | Local machine | No GCP or paid cloud services required for MVP. |
| Queue/event transport | Local polling / in-process jobs | Keep the first working loop simple and local. |
| Realtime delivery | SSE or local callbacks | Used for recording/processing/final-status updates and optional provisional transcript UX. |
| Persistence rule | Local database plus filesystem | No JSON archive as product storage. |
| Desktop companion role | Optional local helper | Future helper for system-audio capture, but not required for the first local MVP. |

Non-goals for the local MVP:
- No reliance on local JSON archives as durable product storage.
- No reliance on browser speech recognition as the core ASR path.
- No live notes in the MVP product.
- No Google Meet bot or hidden participant workflow in MVP.
- No cloud infrastructure required in the first local milestone.

## Core Systems

### 1. Web Client
- Starts and stops sessions.
- Captures microphone audio with `MediaRecorder`.
- Sends chunked audio to the local backend.
- Subscribes to status updates over SSE or local events.
- Renders session status, transcript, summary, and history.

### 2. API Service
- Runs as the main local application backend on the user's machine.
- Creates sessions and returns upload/session metadata to the client.
- Accepts audio chunk uploads and records chunk metadata.
- Records transcript and summary work in Supabase Postgres or filesystem-backed store.
- Serves session history, session detail, and SSE feeds.

### 3. Audio Storage Layer
- Stores raw audio chunks on the local filesystem.
- Keeps ordered chunk metadata in Supabase Postgres.
- Supports later reprocessing and debugging without losing raw source data.

### 4. Audio Preparation Layer
- Merges recorded chunks into a session-level audio artifact after the call ends.
- Normalizes audio format for consistent ASR input.
- Runs VAD / speech-presence filtering before the final transcription pass.
- Preserves the original raw chunks for debugging and future reprocessing.

### 5. ASR Worker
- Runs `faster-whisper` with `large-v3` for the authoritative final transcript.
- Polls the local store for sessions ready for final transcription.
- Resolves merged session audio from the local filesystem.
- Produces timestamped transcript segments from the finished recording.
- Writes transcript segments and model-run metadata to Supabase Postgres.

### 6. Summary Worker
- Runs `Qwen2.5-7B-Instruct` via a local runtime such as `Ollama`.
- Runs only after the final transcript is complete.
- Writes one final summary plus action items/decisions to Supabase Postgres.

### 7. Persistence Layer
- Supabase Postgres stores all structured session state.
- The filesystem stores all audio blobs and exportable artifacts.
- No product feature should depend on JSON files in the repo or local filesystem.

### 8. Realtime Delivery Layer
- API exposes SSE streams keyed by session ID.
- Recording/processing/final-result updates are emitted as the session moves through the pipeline.
- Any live transcript shown during capture is explicitly provisional; the final transcript from the post-call pass is authoritative.
- Client reconnects cleanly without losing the canonical timeline because the source of truth is in Supabase Postgres.

## Data Model

### `users`
- The account/operator using the system.
- MVP can start single-user, but the schema should still allow future multi-user expansion.

### `sessions`
- One row per conversation session.
- Stores session ID, user ID, source type, status, start/end timestamps, and top-level model configuration.

### `audio_chunks`
- One row per uploaded chunk.
- Stores session ID, chunk sequence number, storage path, duration, uploaded timestamp, and processing status.

### `transcript_segments`
- One row per finalized transcript segment.
- Stores session ID, source audio reference, sequence number, text, start/end offsets, confidence, and ASR metadata.

### `session_summaries`
- Final summary plus structured summary sections.
- Stores overview, key points, optional follow-ups, generation timestamp, and summary model metadata.

### `action_items`
- Structured follow-up tasks extracted from transcript/summary.
- Stores session ID, text, status, and provenance.

### `model_runs`
- Audit trail for ASR and summary jobs.
- Stores session ID, model name, runtime, latency, status, and error details.

### `session_events`
- Operational event log for upload, transcription, summary, retry, and failure events.
- Supports debugging and live feed fan-out.

## End-to-End Pipeline

1. User opens the web app and starts a new session.
2. API creates a `session` record in Postgres and returns session metadata to the client.
3. Web client captures microphone or supported display audio using `MediaRecorder`.
4. Client emits chunked audio during the conversation and uploads it to the local backend.
5. Backend stores each chunk in the local filesystem and records a matching `audio_chunks` row in Supabase Postgres.
6. When the session ends, the backend marks capture complete and assembles a session-level merged audio artifact.
7. Audio preparation normalizes the merged recording and applies VAD / speech filtering before final ASR.
8. ASR worker runs `faster-whisper large-v3` on the finished session audio and writes the authoritative transcript to `transcript_segments`.
9. Summary worker runs once on the final transcript and writes the final summary plus extracted action items to Supabase Postgres.
10. API streams processing-state and final-summary readiness to the client.
11. User reopens the session later and the web app reconstructs the final transcript and summary from Supabase Postgres plus filesystem-backed artifacts.

## Execution Series

### Series 1: Platform Foundation

**Goal**
- Establish the local service layout and runtime baseline for the real product.

**Why it exists**
- The current repo only contains prototype app shells and local scaffolding. The local-first rebuild needs clear service boundaries before implementation starts.

**Depends on**
- Nothing. This is the first execution series.

**What gets built**
- Repo structure for a local-first system:
  - `apps/web`
  - `apps/api`
  - `services/asr-worker`
  - `services/summary-worker`
  - `packages/shared`
- Shared environment strategy with `.env.example`.
- Local runtime packaging and startup scripts for the app, API, and workers.
- Clear service contracts between client, API, and workers.

**Definition of done**
- Service boundaries are locked and reflected in the repo.
- Every major runtime has a defined responsibility and deployment target.
- No remaining ambiguity about whether the local-first architecture is the primary path.

**What it deliberately does not cover**
- Actual database schema.
- Actual audio capture implementation.
- Actual model inference logic.

### Series 2: Data and Persistence

**Goal**
- Replace ad hoc local file storage assumptions with a real persistence model.

**Why it exists**
- Durable storage is required before transcript and summary pipelines can be trusted.

**Depends on**
- Series 1.

**What gets built**
- PostgreSQL schema for users, sessions, audio chunks, transcript segments, summaries, action items, model runs, and session events.
- Migration strategy and first migration set.
- Local filesystem layout:
  - raw chunk objects
  - merged session audio
  - optional exported transcripts/summaries
- API persistence logic for session creation and audio chunk metadata.

**Definition of done**
- A session can be created and stored in Postgres.
- Audio chunks can be registered and resolved to local filesystem paths.
- History data no longer depends conceptually on local JSON.

**What it deliberately does not cover**
- Transcription inference.
- Summary generation.
- Realtime client delivery.

### Series 3: Audio Ingestion

**Goal**
- Capture real microphone audio in the browser and push it into the local backend.

**Why it exists**
- A real AI pipeline starts with real audio ingestion, not browser speech recognition text.

**Depends on**
- Series 1 and Series 2.

**What gets built**
- Web client microphone capture using `MediaRecorder`.
- Session-linked chunk upload flow to API.
- Chunk sequencing, overlap strategy, and upload retries.
- Clear client states:
  - recording
  - uploading
  - retrying
  - paused/error
- Server-side validation of chunk ordering and upload completeness.

**Definition of done**
- Starting a session results in real audio chunks landing in local storage.
- The client can recover from transient upload failures.
- Every uploaded chunk can be traced to one session row.

**What it deliberately does not cover**
- System-audio capture.
- Meeting-platform capture.
- Final transcript generation.

### Series 4: Transcription Service

**Goal**
- Turn stored audio into an accurate final transcript using local Whisper inference.

**Why it exists**
- This is the core intelligence layer for the product and replaces all fake transcript behavior.

**Depends on**
- Series 1, Series 2, and Series 3.

**What gets built**
- Python ASR worker using `faster-whisper`.
- Default model: `large-v3`.
- Session-level merged audio resolution from the local filesystem.
- Audio normalization and VAD before the authoritative final pass.
- Final transcript persistence in Supabase Postgres.
- Model-run metrics:
  - latency
  - session duration
  - model used
  - error status

**Definition of done**
- Finished sessions produce timestamped final transcript segments in Supabase Postgres.
- The system no longer depends on browser speech recognition for the real transcript path.
- Latency and failure data are captured for tuning.
- The final transcript comes from the post-call full-session pass, not only from provisional chunk-level inference.

**What it deliberately does not cover**
- Final summary generation.
- Search and history UX polish.
- System-audio capture.

### Series 5: Processing Status and Transcript UX

**Goal**
- Make the transcript and processing lifecycle understandable in the product.

**Why it exists**
- Users need to know what the system is doing while the recording is being uploaded, transcribed, and summarized.

**Depends on**
- Series 4.

**What gets built**
- SSE or local event feed from API to client.
- UI handling for recording, uploading, transcribing, summarizing, completed, and failed states.
- Optional provisional transcript rendering where helpful, clearly marked as non-authoritative.
- Final transcript hydration from canonical server data.

**Definition of done**
- User can tell whether the system is still recording, transcribing, summarizing, or done.
- Reconnecting the client reconstructs the latest server truth.
- The final transcript is clearly presented as the authoritative output.

**What it deliberately does not cover**
- Summary generation.
- Meeting integrations.
- Mobile support.

### Series 6: Final Summary and Action Extraction

**Goal**
- Generate a clear final summary from actual transcript data after the conversation ends.

**Why it exists**
- A transcript alone is not the final product; users want condensed understanding and follow-up extraction after the call.

**Depends on**
- Series 4 and Series 5.

**What gets built**
- Summary worker using `Qwen2.5-7B-Instruct` via a local runtime such as `Ollama`.
- Final summary generation only after the final transcript is ready.
- Action item and decision extraction.
- Summary persistence in Supabase Postgres.

**Definition of done**
- Final summaries are generated from real transcript data.
- Action items are stored as structured records, not only free text.
- Live notes are not required anywhere in the product flow.

**What it deliberately does not cover**
- Search/retrieval UX.
- Stronger alternate summary models.
- Meeting capture expansion.

### Series 7: History and Retrieval

**Goal**
- Make completed sessions useful after the meeting ends.

**Why it exists**
- Durable review is a core product promise and requires a real retrieval experience.

**Depends on**
- Series 2, Series 4, Series 5, and Series 6.

**What gets built**
- Session history list backed by Supabase Postgres.
- Session detail pages showing transcript, summary, and action items.
- Filters by date, status, and source type.
- Basic search foundation across sessions and summaries.

**Definition of done**
- User can reopen a completed session and review everything from Supabase Postgres.
- No session review flow depends on local filesystem artifacts.
- History UX works for growing session counts.

**What it deliberately does not cover**
- Semantic/vector retrieval.
- Team collaboration.
- Mobile-specific UX.

### Series 8: Meeting Capture Expansion

**Goal**
- Extend beyond plain microphone capture into harder real-world meeting inputs.

**Why it exists**
- The product vision includes desktop/browser meeting use cases, but they should not block the core local MVP.

**Depends on**
- Series 3 through Series 7.

**What gets built**
- System-audio capture strategy evaluation and first implementation path.
- Browser meeting capture workflow.
- Meeting source labeling in session records.
- Compatibility matrix for supported meeting surfaces.
- Future Google Meet work remains explicitly separate from MVP-critical flows.

**Definition of done**
- At least one non-microphone meeting path is real and documented.
- Meeting-origin sessions still reuse the same local transcript/summary pipeline.
- Unsupported meeting flows fail clearly with user-facing guidance.

**What it deliberately does not cover**
- Full Google Meet bot participation.
- Multi-platform perfection across all OS/browser combinations.

### Series 9: Production Hardening

**Goal**
- Make the local product reliable, observable, and safe to operate.

**Why it exists**
- MVP capability is not enough without operational discipline.

**Depends on**
- Series 1 through Series 8 as needed.

**What gets built**
- Authentication and session ownership controls.
- Logging, metrics, and alerting.
- Queue retry policy and dead-letter handling.
- Failure recovery for audio upload, transcription, and summary jobs.
- Cost/performance measurement and model tuning.

**Definition of done**
- The system can be monitored and debugged in production.
- Critical flows have retries and visible failure states.
- Cost and latency characteristics are measurable.

**What it deliberately does not cover**
- Native mobile clients.
- Team collaboration workflows.

### Series 10: Mobile Readiness

**Goal**
- Ensure the backend and product model support future mobile clients cleanly.

**Why it exists**
- Mobile is a later product expansion, but the architecture should be ready before that work begins.

**Depends on**
- Series 1 through Series 9.

**What gets built**
- Backend contracts that do not assume desktop-only behavior.
- Session and upload flows that can be reused from mobile.
- Cross-device session continuity assumptions.
- Mobile-specific backlog and constraints documentation.

**Definition of done**
- The backend can support a future mobile client without redesigning the session pipeline.
- Mobile work can start from existing contracts rather than reopening architecture decisions.

**What it deliberately does not cover**
- Shipping the native mobile app itself.
- Full mobile UX implementation.

## Immediate GSD Phase Queue

These are the next GSD-sized executable phases for the accuracy-first reset. Each one is intentionally small enough to be planned and executed in focused sessions.

### Phase 4.1: Session Audio Assembly
- Goal: assemble uploaded chunks into one authoritative session-audio artifact after capture ends.
- Why now: final-pass ASR quality depends on having one clean source file instead of only chunk-local inference.
- Definition of done: each completed session has a merged audio artifact that can be resolved from storage for reprocessing.

### Phase 4.2: Audio Normalization and VAD
- Goal: normalize merged audio and apply speech filtering before final ASR.
- Why now: this is the cheapest path to better transcript quality without changing the product surface.
- Definition of done: the final ASR pipeline consumes normalized, speech-focused audio and records preprocessing metadata.

### Phase 4.3: Authoritative Final ASR Pass
- Goal: run `faster-whisper` with `large-v3` on the merged session audio and persist the authoritative final transcript.
- Why now: transcript accuracy is the primary product requirement.
- Definition of done: the transcript shown to users comes from the post-call final pass, not only from provisional chunk handling.

### Phase 5.1: Processing-State UX Simplification
- Goal: simplify the UI to recording, uploading, transcribing, summarizing, completed, and failed states.
- Why now: once the transcript becomes post-call authoritative, the product should stop implying live note-taking behavior.
- Definition of done: the UI clearly communicates pipeline state and, if any provisional transcript remains, it is labeled as non-authoritative.

### Phase 6.1: Final-Summary-Only Worker Reset
- Goal: remove live-note requirements from the language pipeline and generate only a final summary plus action items after transcription completes.
- Why now: this matches the new product scope and reduces complexity in the summary layer.
- Definition of done: no required product flow depends on `session_notes`; the summary worker runs only after the final transcript is ready.

### Phase 9.1: Accuracy Benchmark and Quality Gate
- Goal: define and run the first repeatable quality benchmark across speakerphone, microphone, and display-audio capture paths.
- Why now: we need a disciplined way to know whether transcript quality is actually improving.
- Definition of done: we have a small benchmark set, a review rubric for transcript/summary quality, and a baseline result for future tuning.

## Current Focus

Active line: Planning reset toward an accuracy-first pipeline: full-session final transcription, no live notes, and final-summary-only output.

## Next Up

1. Plan Phase `4.1` for session-audio assembly.
2. Plan Phase `4.2` for normalization and VAD after the audio-assembly contract is clear.
3. Plan Phase `4.3` for the authoritative final ASR pass on merged audio.
4. Plan Phase `6.1` to remove live notes from the required worker flow and generate final summary only.
5. Plan Phase `9.1` for the first transcript-quality benchmark and acceptance gate.

## Blockers / Open Risks

- Speakerphone capture is intrinsically weaker than direct browser/system audio, so input quality remains a hard ceiling on transcription quality.
- Final transcript quality will depend on session-audio merging, normalization, VAD, and GPU service tuning.
- System-audio and browser meeting capture remain materially harder than microphone capture and should not be allowed to derail MVP.
- Browser `getDisplayMedia` audio capture is not universal across OS/browser combinations, so the new Series 8 path must be treated as supported-where-available, not guaranteed everywhere.
- Summary quality may require prompt iteration or a stronger model if `Qwen2.5-7B-Instruct` underperforms on noisy transcripts.
- The current repo still contains prototype flows that can confuse future sessions if this roadmap is not treated as the primary source of truth.

## Decisions Locked

- 2026-03-31: `ROADMAP.md` is the master planning and session continuity document.
- 2026-03-31: The product is now planned as a local-first rebuild, not as a cloud-first-only architecture.
- 2026-03-31: The current repo is prototype scaffolding, not proof that the target production backend exists.
- 2026-03-31: Use Supabase Postgres for structured data and the filesystem for audio/artifacts; do not use JSON archives as product storage.
- 2026-03-31: Use `faster-whisper` as the primary ASR runtime.
- 2026-03-31: Use `large-v3` as the ASR model for the accuracy-first MVP.
- 2026-03-31: Use `Qwen2.5-7B-Instruct` as the default summary/action extraction model.
- 2026-03-31: Use a local LLM runtime as the summary-serving path.
- 2026-03-31: Use SSE as the default realtime transcript/note delivery path for MVP.
- 2026-03-31: Defer desktop companion and system-audio capture to later expansion instead of making them MVP-critical.
- 2026-03-31: Series 1 is complete with local service scaffolds, shared contracts, and a baseline app/runtime split.
- 2026-04-01: Series 2 is complete with a canonical local schema, filesystem object layout, async API persistence seam, and a database-backed repository path.
- 2026-04-01: Series 3 is complete with microphone capture, sequential chunk upload, local object storage, and a session stop path.
- 2026-04-01: Series 4 is complete with a real Python `faster-whisper` worker, local polling, transcript persistence, and model-run latency/error capture.
- 2026-04-01: Series 5 is complete with transcript/status hydration, SSE session streaming, reconnect-safe transcript fan-out, and explicit processing/finalizing UX in the web app.
- 2026-04-01: Series 6 is complete with a real summary worker, persisted summary/action items, summary-aware SSE events, and web UI hydration from server truth.
- 2026-04-01: Series 7 is complete with history list/detail contracts, API-backed review routes, source/status/query filter foundations, and a web history panel that now reads database-backed session state instead of relying on the local archive shape.
- 2026-04-01: Series 8 first slice is complete with browser display-audio capture for `system-audio` and `meeting-helper` sessions, session metadata that distinguishes capture strategy from meeting routing, and external share-end finalization so the pipeline does not hang in `recording`.
- 2026-04-04: Accuracy is now prioritized over realtime. The authoritative transcript should come from a post-call final pass on the merged session audio.
- 2026-04-04: Live notes are removed from the target MVP. The required language output is the final summary only.
- 2026-04-04: `large-v3` is the only planned ASR model for the authoritative final transcript.
- 2026-04-04: The summary worker should run after the final transcript completes, not as a rolling live-note system.
- 2026-04-04: Direct browser/system audio is the preferred quality path; speakerphone remains supported but is expected to be weaker.

## Session Restart Notes

- Start every future session by reading this file first, not `STATE.md`.
- Treat any browser speech recognition path and local JSON archive code as temporary scaffolding unless explicitly noted otherwise here.
- Series 1 is done; do not reopen service-boundary debates unless a later requirement forces a real architecture change.
- Series 2 is done; do not fork the schema again or reintroduce duplicate migration baselines.
- Series 3 is done; do not reopen the microphone upload path unless a bug fix or refinement is required.
- Series 4 needs a planning reset toward merged-audio, post-call final transcription even though the current worker path exists.
- Series 5, Series 6, and Series 7 should now be interpreted as transcript/status, final-summary, and history work rather than a commitment to live notes.
- Series 8 has a real first slice now: browser display-audio capture for `system-audio` and `meeting-helper` exists, but it is constrained by browser/OS support and still needs documentation plus follow-through.
- When this file is updated in future sessions, keep `Current Focus` to one active line and keep `Decisions Locked` append-only.
