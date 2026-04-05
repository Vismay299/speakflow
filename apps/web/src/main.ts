import type {
  CaptureMode,
  FinalSummary,
  ExperimentalGoogleMeetResponse,
  ExperimentalGoogleMeetState,
  MeetingHelperResponse,
  MeetingSurface,
  MeetingSupportStatus,
  SessionError,
  SessionRecord,
  SessionStartResponse,
  SessionStatusResponse,
  SessionStopResponse,
  RuntimeId,
  RuntimeConfigResponse,
  LiveNotesResponse,
  TranscriptResponse,
  TranscriptIngestRequest,
  TranscriptIngestResponse,
  SummaryResponse,
  StartSessionRequest,
  StopSessionRequest,
  UpdateRuntimeConfigRequest,
  UpdateRuntimeConfigResponse,
  UpdateMeetingHelperRequest,
  UpdateMeetingHelperResponse,
  UpdateExperimentalGoogleMeetRequest,
  UpdateExperimentalGoogleMeetResponse
} from "@voice/shared";
import { BRIDGE_COMMANDS, CAPTURE_MODES, DEFAULT_LANGUAGE, DEFAULT_RUNTIME_CONFIG, MEETING_SURFACES } from "@voice/shared";
import type {
  HostedAudioChunkRecord,
  HostedAudioChunkUploadResponse,
  HostedHistoryDetailResponse,
  HostedHistoryListEntry,
  HostedHistoryListResponse,
  HostedHistorySourceFilter,
  HostedHistoryStatusFilter,
  HostedNotesResponse,
  HostedNotesState,
  HostedSessionCreateRequest,
  HostedSessionCreateResponse as HostedSessionCreateResponseType,
  HostedSessionRecord as HostedSessionRecordType,
  HostedSessionStopRequest,
  HostedSummaryResponse,
  HostedSummaryState,
  HostedTranscriptResponse,
  HostedTranscriptSegmentRecord,
  HostedTranscriptState
} from "@voice/shared/hosted";
import { HOSTED_REQUEST_HEADERS, HOSTED_REQUEST_QUERY_PARAMS, HOSTED_WEB_ENV_KEYS } from "@voice/shared/hosted";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");
const companionBaseUrl = "http://localhost:4545";
const hostedApiBaseUrl = import.meta.env.VITE_HOSTED_API_BASE_URL ?? "http://localhost:8080";
const hostedApiUserId =
  (import.meta.env[HOSTED_WEB_ENV_KEYS.userId] as string | undefined)?.trim() || "demo-user";
type HostedApiAvailability = "unknown" | "online" | "offline";
let hostedApiAvailability: HostedApiAvailability = "unknown";

if (!app) {
  throw new Error("App root not found");
}

app.innerHTML = `
  <main class="shell">
    <section class="hero">
      <p class="eyebrow">Voice-to-Text Summarizer</p>
      <h1>Capture the call. Keep the conversation. Get the summary.</h1>
      <p class="lede">
        Web-first control surface for a local desktop companion that turns live conversations into transcripts and summaries.
      </p>
      <div class="pill-row">
        <span>TypeScript</span>
        <span>Local bridge</span>
        <span>Open-source models</span>
      </div>
    </section>

    <section class="grid">
      <article class="card">
        <h2>Runtime Config</h2>
        <p>Choose a local runtime and keep English as the default launch language.</p>
        <div class="status">
          <strong>Current runtime</strong>
          <span id="selected-runtime">Checking companion...</span>
        </div>
        <div class="status">
          <strong>Available runtimes</strong>
          <span id="runtime-options">Loading options...</span>
        </div>
        <div class="status">
          <strong>Default language</strong>
          <span id="default-language">en</span>
        </div>
        <label class="config-field">
          <span>Local runtime</span>
          <select id="runtime-id">
            <option value="">Loading...</option>
          </select>
        </label>
        <div class="button-row">
          <button id="save-runtime" type="button">Save runtime config</button>
        </div>
      </article>

      <article class="card">
        <h2>Session Controls</h2>
        <p>Start and stop a local capture session for microphone, system audio, or meeting-helper input.</p>
        <form class="session-form" id="session-form">
          <label>
            <span>Capture mode</span>
            <select id="capture-mode">
              ${CAPTURE_MODES.map((mode) => `<option value="${mode}">${mode}</option>`).join("")}
            </select>
          </label>

          <label>
            <span>Language</span>
            <input id="language" type="text" value="${DEFAULT_LANGUAGE}" readonly />
          </label>

          <label class="checkbox-row">
            <input id="save-transcript" type="checkbox" checked />
            <span>Save transcript</span>
          </label>

          <label class="checkbox-row">
            <input id="save-summary" type="checkbox" checked />
            <span>Save summary</span>
          </label>

          <div class="button-row">
            <button id="start-session" type="submit">Start session</button>
            <button id="stop-session" type="button" class="secondary">Stop session</button>
          </div>
        </form>
        <div class="status">
          <strong>Session status</strong>
          <span id="session-status">Checking companion...</span>
        </div>
        <div class="status">
          <strong>Selected mode</strong>
          <span id="selected-mode">speakerphone</span>
        </div>
        <div class="status">
          <strong>Elapsed time</strong>
          <span id="elapsed-time">00:00</span>
        </div>
        <div class="status">
          <strong>Local capture</strong>
          <span id="mic-status">Waiting to start</span>
        </div>
      </article>

      <article class="card hosted-audio-card">
        <h2>Capture</h2>
        <p class="transcript-note">
          Sessions are created on the local API and upload raw MediaRecorder chunks sequentially with retry.
        </p>
        <div class="transcript-metrics" aria-live="polite">
          <div class="metric">
            <strong>Status</strong>
            <span id="hosted-audio-status">Idle</span>
          </div>
          <div class="metric">
            <strong>Queue</strong>
            <span id="hosted-audio-queue">0 pending</span>
          </div>
          <div class="metric">
            <strong>Uploaded</strong>
            <span id="hosted-audio-upload-count">0 chunks</span>
          </div>
          <div class="metric">
            <strong>Storage</strong>
            <span id="hosted-audio-storage">Awaiting session</span>
          </div>
        </div>
        <div class="status">
          <strong>Last chunk</strong>
          <span id="hosted-audio-last-chunk">None uploaded yet.</span>
        </div>
        <ol id="hosted-audio-chunk-list" class="transcript-list">
          <li class="transcript-empty">No captured audio chunks yet.</li>
        </ol>
      </article>

      <article class="card meeting-card">
        <h2>Meeting Helper</h2>
        <p class="transcript-note">
          Use this route for browser or desktop meetings. Hosted system-audio and meeting-helper capture now use the same display-audio pipeline, while Google Meet remains a lab-only boundary.
        </p>
        <div class="transcript-metrics" aria-live="polite">
          <div class="metric">
            <strong>Route</strong>
            <span id="meeting-route">Desktop meeting</span>
          </div>
          <div class="metric">
            <strong>Status</strong>
            <span id="meeting-status">Loading...</span>
          </div>
          <div class="metric">
            <strong>Fallback</strong>
            <span id="meeting-fallback-status">None</span>
          </div>
          <div class="metric">
            <strong>Active</strong>
            <span id="meeting-active">No</span>
          </div>
        </div>
        <label class="config-field">
          <span>Meeting surface</span>
          <select id="meeting-surface">
            <option value="desktop-meeting">Desktop meeting</option>
            <option value="browser-meeting">Browser meeting</option>
            <option value="google-meet">Google Meet</option>
          </select>
        </label>
        <ul id="meeting-guidance" class="meeting-guidance">
          <li>Loading meeting helper support...</li>
        </ul>
        <div class="button-row">
          <button id="apply-meeting-helper" type="button">Apply meeting helper</button>
          <button id="meeting-fallback-button" type="button" class="secondary">Use browser fallback</button>
        </div>
      </article>

      <article class="card experimental-card">
        <h2>Experimental Google Meet</h2>
        <p class="transcript-note">
          Lab-only boundary for prototyping Google Meet routing metadata and guardrails. It does not join Meet as a bot or hidden participant.
        </p>
        <div class="transcript-metrics" aria-live="polite">
          <div class="metric">
            <strong>Flag</strong>
            <span id="experimental-google-meet-flag">Loading...</span>
          </div>
          <div class="metric">
            <strong>Boundary</strong>
            <span id="experimental-google-meet-status">Loading...</span>
          </div>
          <div class="metric">
            <strong>Availability</strong>
            <span id="experimental-google-meet-availability">Checking...</span>
          </div>
          <div class="metric">
            <strong>Active</strong>
            <span id="experimental-google-meet-active">No</span>
          </div>
        </div>
        <label class="checkbox-row">
          <input id="experimental-google-meet-enabled" type="checkbox" />
          <span>Enable lab boundary</span>
        </label>
        <div class="button-row">
          <button id="save-experimental-google-meet" type="button">Save lab state</button>
          <button id="refresh-experimental-google-meet" type="button" class="secondary">Refresh</button>
        </div>
        <p id="experimental-google-meet-error" class="transcript-note">Waiting for experimental state...</p>
        <ul id="experimental-google-meet-notes" class="meeting-guidance">
          <li>Loading experimental notes...</li>
        </ul>
      </article>

      <article class="card">
        <h2>Current Session</h2>
        <p id="session-summary">No active session yet.</p>
        <code id="session-json">Waiting for companion state...</code>
      </article>

      <article class="card transcript-card">
        <h2>Final Transcript</h2>
        <p class="transcript-note">
          Uploaded session audio is merged and transcribed after capture ends. The transcript shown here is the authoritative final pass.
        </p>
        <div class="transcript-metrics" aria-live="polite">
          <div class="metric">
            <strong>Transcript state</strong>
            <span id="transcript-status">Idle</span>
          </div>
          <div class="metric">
            <strong>Chunks</strong>
            <span id="transcript-chunks">0</span>
          </div>
          <div class="metric">
            <strong>Revision</strong>
            <span id="transcript-revision">0</span>
          </div>
          <div class="metric">
            <strong>Last update</strong>
            <span id="transcript-updated">Never</span>
          </div>
        </div>
        <ol id="transcript-list" class="transcript-list">
          <li class="transcript-empty">No transcript chunks yet.</li>
        </ol>
      </article>

      <article class="card notes-card" aria-hidden="true">
        <h2>Notes</h2>
        <p class="transcript-note">
          Live notes are deprecated in this build. The product now focuses on final transcript and final summary only.
        </p>
        <div class="transcript-metrics" aria-live="polite">
          <div class="metric">
            <strong>Status</strong>
            <span id="notes-status">Deprecated</span>
          </div>
          <div class="metric">
            <strong>Notes</strong>
            <span id="notes-count">0</span>
          </div>
          <div class="metric">
            <strong>Revision</strong>
            <span id="notes-revision">0</span>
          </div>
          <div class="metric">
            <strong>Last update</strong>
            <span id="notes-updated">Never</span>
          </div>
        </div>
        <ol id="notes-list" class="transcript-list">
          <li class="transcript-empty">Live notes have been removed.</li>
        </ol>
      </article>

      <article class="card summary-card">
        <h2>Final Summary</h2>
        <p class="transcript-note">
          The summary appears after the session stops and is generated from the full transcript.
        </p>
        <div class="status">
          <strong>Summary state</strong>
          <span id="summary-status">Waiting for session to complete</span>
        </div>
        <div class="summary-body">
          <p id="summary-overview">No summary yet.</p>
          <ul id="summary-points">
            <li>Stop the session to generate a summary.</li>
          </ul>
          <h3 class="summary-subheading">Follow-ups</h3>
          <ul id="summary-follow-ups">
            <li>No follow-ups yet.</li>
          </ul>
        </div>
      </article>

      <article class="card history-card">
        <h2>Session History</h2>
        <p class="transcript-note">
          Session history is loaded from the API so transcripts, summaries, follow-ups, and action items can be reviewed from database-backed state.
        </p>
        <div class="transcript-metrics" aria-live="polite">
          <div class="metric">
            <strong>Sessions</strong>
            <span id="history-count">0</span>
          </div>
          <div class="metric">
            <strong>Selection</strong>
            <span id="history-status">None selected</span>
          </div>
          <div class="metric">
            <strong>Storage</strong>
            <span>Supabase + API</span>
          </div>
          <div class="metric">
            <strong>State</strong>
            <span>Local-first primary</span>
          </div>
        </div>
        <div class="history-filters">
          <label class="config-field">
            <span>Source</span>
            <select id="history-source-filter">
              <option value="all">All sources</option>
              <option value="microphone">Microphone</option>
              <option value="system-audio">System audio</option>
              <option value="meeting-helper">Meeting helper</option>
            </select>
          </label>
          <label class="config-field">
            <span>Status</span>
            <select id="history-status-filter">
              <option value="all">All statuses</option>
              <option value="recording">Recording</option>
              <option value="processing">Processing</option>
              <option value="complete">Complete</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <label class="config-field">
            <span>Search</span>
            <input id="history-query" type="text" placeholder="Session id or summary" />
          </label>
        </div>
        <div class="history-layout">
          <ol id="history-list" class="history-list">
            <li class="transcript-empty">No sessions yet.</li>
          </ol>
          <div id="history-detail" class="history-detail">
            Select a completed session to inspect its transcript, notes, and summary.
          </div>
        </div>
      </article>

      <article class="card">
        <h2>Roadmap Context</h2>
        <ul>
          <li>Series 5 ships hosted transcript streaming over SSE.</li>
          <li>Series 6 adds final summaries and extracted follow-ups.</li>
          <li>Series 7 backs history and review with Postgres.</li>
          <li>Series 8 adds hosted system-audio and meeting-helper capture through browser display audio.</li>
        </ul>
      </article>

      <article class="card">
        <h2>Bridge Contract</h2>
        <p>Commands shared with the companion:</p>
        <code>${BRIDGE_COMMANDS.join(", ")}</code>
      </article>
    </section>
  </main>
`;

const sessionForm = document.querySelector<HTMLFormElement>("#session-form");
const runtimeSelect = document.querySelector<HTMLSelectElement>("#runtime-id");
const captureModeInput = document.querySelector<HTMLSelectElement>("#capture-mode");
const saveTranscriptInput = document.querySelector<HTMLInputElement>("#save-transcript");
const saveSummaryInput = document.querySelector<HTMLInputElement>("#save-summary");
const saveRuntimeButton = document.querySelector<HTMLButtonElement>("#save-runtime");
const sessionStatusLabel = document.querySelector<HTMLElement>("#session-status");
const selectedRuntimeLabel = document.querySelector<HTMLElement>("#selected-runtime");
const runtimeOptionsLabel = document.querySelector<HTMLElement>("#runtime-options");
const defaultLanguageLabel = document.querySelector<HTMLElement>("#default-language");
const selectedModeLabel = document.querySelector<HTMLElement>("#selected-mode");
const elapsedTimeLabel = document.querySelector<HTMLElement>("#elapsed-time");
const micStatusLabel = document.querySelector<HTMLElement>("#mic-status");
const sessionSummaryLabel = document.querySelector<HTMLElement>("#session-summary");
const sessionJsonOutput = document.querySelector<HTMLElement>("#session-json");
const transcriptStatusLabel = document.querySelector<HTMLElement>("#transcript-status");
const transcriptChunkCountLabel = document.querySelector<HTMLElement>("#transcript-chunks");
const transcriptRevisionLabel = document.querySelector<HTMLElement>("#transcript-revision");
const transcriptUpdatedLabel = document.querySelector<HTMLElement>("#transcript-updated");
const transcriptList = document.querySelector<HTMLOListElement>("#transcript-list");
const hostedAudioStatusLabel = document.querySelector<HTMLElement>("#hosted-audio-status");
const hostedAudioQueueLabel = document.querySelector<HTMLElement>("#hosted-audio-queue");
const hostedAudioUploadCountLabel = document.querySelector<HTMLElement>("#hosted-audio-upload-count");
const hostedAudioStorageLabel = document.querySelector<HTMLElement>("#hosted-audio-storage");
const hostedAudioLastChunkLabel = document.querySelector<HTMLElement>("#hosted-audio-last-chunk");
const hostedAudioChunkList = document.querySelector<HTMLOListElement>("#hosted-audio-chunk-list");
const notesStatusLabel = document.querySelector<HTMLElement>("#notes-status");
const notesCountLabel = document.querySelector<HTMLElement>("#notes-count");
const notesRevisionLabel = document.querySelector<HTMLElement>("#notes-revision");
const notesUpdatedLabel = document.querySelector<HTMLElement>("#notes-updated");
const notesList = document.querySelector<HTMLOListElement>("#notes-list");
const meetingRouteLabel = document.querySelector<HTMLElement>("#meeting-route");
const meetingStatusLabel = document.querySelector<HTMLElement>("#meeting-status");
const meetingFallbackStatusLabel = document.querySelector<HTMLElement>("#meeting-fallback-status");
const meetingActiveLabel = document.querySelector<HTMLElement>("#meeting-active");
const meetingSurfaceSelect = document.querySelector<HTMLSelectElement>("#meeting-surface");
const meetingGuidanceList = document.querySelector<HTMLUListElement>("#meeting-guidance");
const applyMeetingHelperButton = document.querySelector<HTMLButtonElement>("#apply-meeting-helper");
const meetingFallbackButton = document.querySelector<HTMLButtonElement>("#meeting-fallback-button");
const experimentalGoogleMeetFlagLabel = document.querySelector<HTMLElement>("#experimental-google-meet-flag");
const experimentalGoogleMeetStatusLabel = document.querySelector<HTMLElement>("#experimental-google-meet-status");
const experimentalGoogleMeetAvailabilityLabel = document.querySelector<HTMLElement>("#experimental-google-meet-availability");
const experimentalGoogleMeetActiveLabel = document.querySelector<HTMLElement>("#experimental-google-meet-active");
const experimentalGoogleMeetEnabledInput = document.querySelector<HTMLInputElement>("#experimental-google-meet-enabled");
const saveExperimentalGoogleMeetButton = document.querySelector<HTMLButtonElement>("#save-experimental-google-meet");
const refreshExperimentalGoogleMeetButton = document.querySelector<HTMLButtonElement>("#refresh-experimental-google-meet");
const experimentalGoogleMeetError = document.querySelector<HTMLElement>("#experimental-google-meet-error");
const experimentalGoogleMeetNotes = document.querySelector<HTMLUListElement>("#experimental-google-meet-notes");
const summaryStatusLabel = document.querySelector<HTMLElement>("#summary-status");
const summaryOverviewLabel = document.querySelector<HTMLElement>("#summary-overview");
const summaryPointsList = document.querySelector<HTMLUListElement>("#summary-points");
const summaryFollowUpsList = document.querySelector<HTMLUListElement>("#summary-follow-ups");
const historyCountLabel = document.querySelector<HTMLElement>("#history-count");
const historyStatusLabel = document.querySelector<HTMLElement>("#history-status");
const historySourceFilterInput = document.querySelector<HTMLSelectElement>("#history-source-filter");
const historyStatusFilterInput = document.querySelector<HTMLSelectElement>("#history-status-filter");
const historyQueryInput = document.querySelector<HTMLInputElement>("#history-query");
const historyList = document.querySelector<HTMLOListElement>("#history-list");
const historyDetail = document.querySelector<HTMLElement>("#history-detail");
const stopSessionButton = document.querySelector<HTMLButtonElement>("#stop-session");
const startSessionButton = document.querySelector<HTMLButtonElement>("#start-session");

if (
  !sessionForm ||
  !runtimeSelect ||
  !captureModeInput ||
  !saveTranscriptInput ||
  !saveSummaryInput ||
  !saveRuntimeButton ||
  !sessionStatusLabel ||
  !selectedRuntimeLabel ||
  !runtimeOptionsLabel ||
  !defaultLanguageLabel ||
  !selectedModeLabel ||
  !elapsedTimeLabel ||
  !micStatusLabel ||
  !sessionSummaryLabel ||
  !sessionJsonOutput ||
  !transcriptStatusLabel ||
  !transcriptChunkCountLabel ||
  !transcriptRevisionLabel ||
  !transcriptUpdatedLabel ||
  !transcriptList ||
  !hostedAudioStatusLabel ||
  !hostedAudioQueueLabel ||
  !hostedAudioUploadCountLabel ||
  !hostedAudioStorageLabel ||
  !hostedAudioLastChunkLabel ||
  !hostedAudioChunkList ||
  !notesStatusLabel ||
  !notesCountLabel ||
  !notesRevisionLabel ||
  !notesUpdatedLabel ||
  !notesList ||
  !meetingRouteLabel ||
  !meetingStatusLabel ||
  !meetingFallbackStatusLabel ||
  !meetingActiveLabel ||
  !meetingSurfaceSelect ||
  !meetingGuidanceList ||
  !applyMeetingHelperButton ||
  !meetingFallbackButton ||
  !experimentalGoogleMeetFlagLabel ||
  !experimentalGoogleMeetStatusLabel ||
  !experimentalGoogleMeetAvailabilityLabel ||
  !experimentalGoogleMeetActiveLabel ||
  !experimentalGoogleMeetEnabledInput ||
  !saveExperimentalGoogleMeetButton ||
  !refreshExperimentalGoogleMeetButton ||
  !experimentalGoogleMeetError ||
  !experimentalGoogleMeetNotes ||
  !summaryStatusLabel ||
  !summaryOverviewLabel ||
  !summaryPointsList ||
  !summaryFollowUpsList ||
  !historyCountLabel ||
  !historyStatusLabel ||
  !historySourceFilterInput ||
  !historyStatusFilterInput ||
  !historyQueryInput ||
  !historyList ||
  !historyDetail ||
  !stopSessionButton ||
  !startSessionButton
) {
  throw new Error("Session controls failed to initialize");
}

const statusLabel = sessionStatusLabel;
const runtimeSelectEl = runtimeSelect;
const saveTranscriptEl = saveTranscriptInput;
const saveSummaryEl = saveSummaryInput;
const saveRuntimeEl = saveRuntimeButton;
const selectedRuntimeDisplay = selectedRuntimeLabel;
const runtimeOptionsDisplay = runtimeOptionsLabel;
const defaultLanguageDisplay = defaultLanguageLabel;
const selectedModeDisplay = selectedModeLabel;
const elapsedLabel = elapsedTimeLabel;
const micStatus = micStatusLabel;
const summaryLabel = sessionSummaryLabel;
const sessionJson = sessionJsonOutput;
const transcriptStatus = transcriptStatusLabel;
const transcriptChunkCount = transcriptChunkCountLabel;
const transcriptRevisionDisplay = transcriptRevisionLabel;
const transcriptUpdated = transcriptUpdatedLabel;
const transcriptListEl = transcriptList;
const hostedAudioStatus = hostedAudioStatusLabel;
const hostedAudioQueue = hostedAudioQueueLabel;
const hostedAudioUploadCount = hostedAudioUploadCountLabel;
const hostedAudioStorage = hostedAudioStorageLabel;
const hostedAudioLastChunk = hostedAudioLastChunkLabel;
const hostedAudioList = hostedAudioChunkList;
const notesStatus = notesStatusLabel;
const notesCount = notesCountLabel;
const notesRevisionDisplay = notesRevisionLabel;
const notesUpdated = notesUpdatedLabel;
const notesListEl = notesList;
const meetingRoute = meetingRouteLabel;
const meetingStatus = meetingStatusLabel;
const meetingFallbackStatus = meetingFallbackStatusLabel;
const meetingActive = meetingActiveLabel;
const meetingSurface = meetingSurfaceSelect;
const meetingGuidance = meetingGuidanceList;
const applyMeetingHelper = applyMeetingHelperButton;
const meetingFallback = meetingFallbackButton;
const experimentalGoogleMeetFlag = experimentalGoogleMeetFlagLabel;
const experimentalGoogleMeetStatus = experimentalGoogleMeetStatusLabel;
const experimentalGoogleMeetAvailability = experimentalGoogleMeetAvailabilityLabel;
const experimentalGoogleMeetActive = experimentalGoogleMeetActiveLabel;
const experimentalGoogleMeetEnabled = experimentalGoogleMeetEnabledInput;
const saveExperimentalGoogleMeetButtonEl = saveExperimentalGoogleMeetButton;
const refreshExperimentalGoogleMeetButtonEl = refreshExperimentalGoogleMeetButton;
const experimentalGoogleMeetErrorLabel = experimentalGoogleMeetError;
const experimentalGoogleMeetNotesList = experimentalGoogleMeetNotes;
const summaryStatus = summaryStatusLabel;
const summaryOverview = summaryOverviewLabel;
const summaryPoints = summaryPointsList;
const summaryFollowUps = summaryFollowUpsList;
const historyCount = historyCountLabel;
const historyStatus = historyStatusLabel;
const historySourceFilter = historySourceFilterInput;
const historyStatusFilter = historyStatusFilterInput;
const historyQuery = historyQueryInput;
const historyListEl = historyList;
const historyDetailEl = historyDetail;
const stopButton = stopSessionButton;
const startButton = startSessionButton;

let currentSession: SessionRecord | null = null;
let transcriptSegments: TranscriptResponse["transcript"]["segments"] = [];
let transcriptRevision = 0;
let notesRevision = 0;
let hostedNotesRevision = 0;
let hostedSummaryRevision = 0;
let transcriptTimerId: number | null = null;
let notesTimerId: number | null = null;
let elapsedTimerId: number | null = null;
let historyFilterTimerId: number | null = null;
let historyDetailRequestToken = 0;
let elapsedSeconds = 0;
let selectedMode: CaptureMode = CAPTURE_MODES[0];
let selectedRuntimeId: RuntimeId = DEFAULT_RUNTIME_CONFIG.runtimeId;
let defaultLanguage = DEFAULT_LANGUAGE;
let runtimeOptions: RuntimeConfigResponse["config"]["options"] = [];
let currentSummary: FinalSummary | null = null;
let selectedArchiveSessionId: string | null = null;
let hostedHistoryEntries: HostedHistoryListEntry[] = [];
let hostedHistoryFilters: {
  sourceType: HostedHistorySourceFilter;
  status: HostedHistoryStatusFilter;
  query: string;
} = {
  sourceType: "all",
  status: "all",
  query: ""
};
let meetingHelperState: MeetingHelperResponse["meetingHelper"] | null = null;
let selectedMeetingSurface: MeetingSurface = "desktop-meeting";
let hostedSession: HostedSessionRecordType | null = null;
let hostedTranscriptSegments: HostedTranscriptSegmentRecord[] = [];
let hostedTranscriptLastSequenceNumber = -1;
let hostedTranscriptConnectionState: HostedTranscriptConnectionState = "idle";
let hostedTranscriptEventSource: EventSource | null = null;
let hostedUploadQueue: HostedAudioUploadJob[] = [];
let hostedUploadInFlight = false;
let hostedUploadErrorCount = 0;
let hostedUploadRetryTimerId: number | null = null;
let hostedCaptureStream: MediaStream | null = null;
let hostedMediaRecorder: MediaRecorder | null = null;
let hostedUploadStartedAtMs = 0;
let hostedUploadLastChunkEndAtMs = 0;
let hostedUploadNextChunkIndex = 0;
let hostedUploadedChunkCount = 0;
let hostedUploadStatus = "Idle";
let hostedCaptureActive = false;
let hostedCaptureStopPromise: Promise<HostedSessionRecordType | null> | null = null;
let hostedRecorderMimeType = "audio/webm";
let hostedFatalUploadErrorMessage: string | null = null;
let browserSpeechRecognition: BrowserSpeechRecognition | null = null;
let browserSpeechRecognitionSessionId: string | null = null;
let browserSpeechRecognitionNextResultIndex = 0;
let browserSpeechRecognitionCursorMs = 0;
let browserSpeechRecognitionRestartTimerId: number | null = null;
let browserSpeechRecognitionStatus = "Waiting to start";
let browserSpeechRecognitionShouldRestart = false;
let browserSpeechRecognitionStopping = false;
let browserSpeechRecognitionStopResolve: (() => void) | null = null;
const pendingTranscriptAppendPromises = new Set<Promise<unknown>>();

interface BrowserSpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface BrowserSpeechRecognitionResult extends ArrayLike<BrowserSpeechRecognitionAlternative> {
  isFinal: boolean;
  length: number;
  [index: number]: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionResultList extends ArrayLike<BrowserSpeechRecognitionResult> {
  length: number;
  [index: number]: BrowserSpeechRecognitionResult;
}

interface BrowserSpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: BrowserSpeechRecognitionResultList;
}

interface BrowserSpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface BrowserSpeechRecognitionWindow extends Window {
  SpeechRecognition?: new () => BrowserSpeechRecognition;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
}

interface HostedAudioUploadJob {
  chunkIndex: number;
  blob: Blob;
  startedAt: string;
  endedAt: string;
  attempts: number;
}

interface HostedSessionStopResponse {
  session: HostedSessionRecordType;
  audioChunkCount: number;
  repositoryBackend: string;
}

type TranscriptRenderableSegment = {
  speakerLabel?: string | null;
  startMs: number;
  endMs: number;
  text: string;
};

type HostedTranscriptConnectionState = "idle" | "connecting" | "open" | "reconnecting" | "closed" | "error";

function formatElapsedTime(seconds: number) {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remainingSeconds = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

function syncElapsedTime(session: SessionRecord | null) {
  if (!session || session.status !== "recording") {
    elapsedSeconds = session?.endedAt
      ? Math.max(0, Math.floor((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000))
      : 0;
    elapsedLabel.textContent = formatElapsedTime(elapsedSeconds);
    return;
  }

  elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000));
  elapsedLabel.textContent = formatElapsedTime(elapsedSeconds);
}

function stopElapsedTimer() {
  if (elapsedTimerId !== null) {
    window.clearInterval(elapsedTimerId);
    elapsedTimerId = null;
  }
}

function startElapsedTimer() {
  stopElapsedTimer();
  elapsedTimerId = window.setInterval(() => {
    if (!currentSession || currentSession.status !== "recording") {
      stopElapsedTimer();
      return;
    }

    syncElapsedTime(currentSession);
  }, 1000);
}

function renderSession(session: SessionRecord | null) {
  currentSession = session;

  if (!session) {
    statusLabel.textContent = "Idle";
    selectedModeDisplay.textContent = selectedMode;
    summaryLabel.textContent = "No active session yet.";
    sessionJson.textContent = "Waiting for companion state...";
    syncElapsedTime(null);
    stopElapsedTimer();
    stopButton.disabled = true;
    startButton.disabled = false;
    setMicStatus("Waiting to start");
    return;
  }

  statusLabel.textContent = `${session.status} • ${session.sourceType}`;
  selectedModeDisplay.textContent = session.sourceType;
  const meetingRoute = session.meetingSurface ? ` using ${formatMeetingSurface(session.meetingSurface)}` : "";
  summaryLabel.textContent = `Session ${session.id} started at ${new Date(session.startedAt).toLocaleTimeString()}.${meetingRoute}`;
  sessionJson.textContent = JSON.stringify(session, null, 2);
  syncElapsedTime(session);
  if (session.status === "recording") {
    startElapsedTimer();
  } else {
    stopElapsedTimer();
  }
  startButton.disabled = session.status === "recording";
  stopButton.disabled = session.status !== "recording";
}

function renderError(message: string) {
  statusLabel.textContent =
    hostedApiAvailability === "offline" || message.includes("Hosted API is offline")
      ? "Hosted API offline"
      : "Error";
  summaryLabel.textContent = message;
  elapsedLabel.textContent = formatElapsedTime(elapsedSeconds);
}

function buildHostedApiOfflineMessage(baseUrl = hostedApiBaseUrl) {
  return `Hosted API is offline at ${baseUrl}. Start npm run dev:api and retry.`;
}

function renderHostedApiOfflineState(message = buildHostedApiOfflineMessage()) {
  hostedApiAvailability = "offline";
  statusLabel.textContent = "Hosted API offline";
  summaryLabel.textContent = message;
  sessionJson.textContent = "The web UI is running, but it could not reach the hosted API.";
  elapsedLabel.textContent = formatElapsedTime(elapsedSeconds);
  startButton.disabled = true;
  stopButton.disabled = true;
  setMicStatus("Hosted API unavailable.");
}

function renderHostedApiReadyState() {
  hostedApiAvailability = "online";
  if (currentSession) {
    return;
  }

  statusLabel.textContent = "Hosted capture ready.";
  summaryLabel.textContent = "Hosted API connected. Ready to start a session.";
  sessionJson.textContent = "Hosted path does not depend on the legacy companion.";
  startButton.disabled = false;
  stopButton.disabled = true;
}

function formatRelativeTimestamp(isoTimestamp: string | null) {
  if (!isoTimestamp) {
    return "Never";
  }

  const elapsedMs = Date.now() - new Date(isoTimestamp).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return "Just now";
  }

  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  if (elapsedSeconds < 5) {
    return "Just now";
  }
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  return new Date(isoTimestamp).toLocaleTimeString();
}

function readHostedMetadataString(session: HostedSessionRecordType, key: string) {
  const value = session.metadata[key];
  return typeof value === "string" ? value : null;
}

function parseHostedMeetingSurface(value: string | null) {
  if (!value) {
    return null;
  }

  return (MEETING_SURFACES as readonly string[]).includes(value) ? (value as MeetingSurface) : null;
}

function formatMeetingSurface(surface: MeetingSurface) {
  switch (surface) {
    case "desktop-meeting":
      return "Desktop meeting";
    case "browser-meeting":
      return "Browser meeting";
    case "google-meet":
      return "Google Meet";
  }
}

function formatMeetingSupportStatus(status: MeetingSupportStatus) {
  switch (status) {
    case "supported":
      return "Supported";
    case "fallback":
      return "Fallback";
    case "experimental":
      return "Experimental";
    case "unsupported":
      return "Unsupported";
  }
}

function formatExperimentalGoogleMeetStatus(status: ExperimentalGoogleMeetState["status"]) {
  switch (status) {
    case "blocked":
      return "Blocked";
    case "disabled":
      return "Disabled";
    case "prototype":
      return "Prototype enabled";
  }
}

function setMicStatus(message: string) {
  browserSpeechRecognitionStatus = message;
  micStatus.textContent = message;
}

function setHostedAudioStatus(message: string) {
  hostedUploadStatus = message;
  hostedAudioStatus.textContent = message;
}

function syncHostedElapsedTime(session: HostedSessionRecordType) {
  const startedAtMs = new Date(session.startedAt ?? session.createdAt).getTime();
  const endedAtMs = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
  elapsedSeconds = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000));
  elapsedLabel.textContent = formatElapsedTime(elapsedSeconds);
}

function createMirrorSessionFromHosted(session: HostedSessionRecordType): SessionRecord {
  const requestedMeetingSurface =
    session.sourceType === "meeting-helper"
      ? parseHostedMeetingSurface(readHostedMetadataString(session, "meetingSurface"))
      : null;
  const captureStrategy = readHostedMetadataString(session, "captureStrategy");
  const sourceType: CaptureMode = session.sourceType === "microphone" ? "speakerphone" : session.sourceType;
  return {
    id: session.id,
    sourceType,
    runtimeId: selectedRuntimeId,
    status:
      session.status === "complete"
        ? "complete"
        : session.status === "failed"
          ? "error"
          : session.status === "processing"
            ? "paused"
            : "recording",
    startedAt: session.startedAt ?? session.createdAt,
    endedAt: session.endedAt ?? undefined,
    language: defaultLanguage,
    saveTranscript: saveTranscriptEl.checked,
    saveSummary: saveSummaryEl.checked,
    meetingRequestedSurface: session.sourceType === "meeting-helper" ? requestedMeetingSurface ?? undefined : undefined,
    meetingSurface: session.sourceType === "meeting-helper" ? requestedMeetingSurface ?? undefined : undefined,
    meetingSupportStatus: session.sourceType === "meeting-helper" ? "supported" : undefined,
    meetingFallbackMessage:
      session.sourceType !== "meeting-helper"
        ? null
        : captureStrategy === "display-media-audio"
          ? "Browser display audio is being used for hosted capture."
          : null
  };
}

function renderHostedSessionState(session: HostedSessionRecordType | null) {
  hostedSession = session;

  if (!session) {
    renderSession(null);
    sessionJson.textContent = "Waiting for hosted session...";
    closeHostedTranscriptStream();
    return;
  }

  renderSession(createMirrorSessionFromHosted(session));
  if (session.sourceType === "meeting-helper") {
    const requestedSurface = parseHostedMeetingSurface(readHostedMetadataString(session, "meetingSurface"));
    meetingRoute.textContent = requestedSurface ? `${formatMeetingSurface(requestedSurface)} • hosted capture` : "Hosted display capture";
    meetingStatus.textContent =
      session.status === "failed"
        ? "Failed"
        : session.status === "complete"
          ? "Complete"
          : "Active";
    meetingFallbackStatus.textContent =
      readHostedMetadataString(session, "captureStrategy") === "display-media-audio"
        ? "Browser display audio"
        : "Microphone";
    meetingActive.textContent =
      session.status === "starting" || session.status === "recording" || session.status === "processing"
        ? `Yes • ${session.id}`
        : "No";
  } else if (session.sourceType === "system-audio") {
    meetingRoute.textContent = "System audio";
    meetingStatus.textContent =
      session.status === "failed"
        ? "Failed"
        : session.status === "complete"
          ? "Complete"
          : "Active";
    meetingFallbackStatus.textContent = "Meeting helper not in use.";
    meetingActive.textContent = "No";
  }
  statusLabel.textContent = `${session.status} • ${session.sourceType}`;
  summaryLabel.textContent =
    session.status === "processing"
      ? `Hosted session ${session.id} is processing queued chunks from the API stream.`
      : session.status === "complete"
        ? `Hosted session ${session.id} completed at ${session.endedAt ? new Date(session.endedAt).toLocaleTimeString() : "unknown time"}.`
        : session.status === "failed"
          ? `Hosted session ${session.id} failed${session.endedAt ? ` at ${new Date(session.endedAt).toLocaleTimeString()}` : ""}.`
          : `Hosted session ${session.id} started at ${new Date(session.startedAt ?? session.createdAt).toLocaleTimeString()}.`;
  if (session.status === "processing" || session.status === "complete" || session.status === "failed") {
    stopElapsedTimer();
  }
  syncHostedElapsedTime(session);
  stopButton.disabled = session.status !== "recording";
  startButton.disabled = session.status === "starting" || session.status === "recording" || session.status === "processing";
  sessionJson.textContent = JSON.stringify(
    {
      transport: "hosted-api",
      apiBaseUrl: hostedApiBaseUrl,
      session
    },
    null,
    2
  );
  if (session.status === "processing") {
    setMicStatus("Hosted session is processing. Waiting for the transcript stream to finalize.");
  } else if (session.status === "complete") {
    setMicStatus("Hosted session complete. Waiting for the final summary if it is still generating.");
  } else if (session.status === "failed") {
    setMicStatus(readHostedMetadataString(session, "errorMessage") ?? "Hosted session failed.");
  }
}

function renderHostedRoadmapPlaceholders() {
  selectedRuntimeDisplay.textContent = "Hosted workers planned";
  runtimeOptionsDisplay.textContent = "Hosted transcript streaming runs through faster-whisper large-v3, with final summary generation layered on top.";
  defaultLanguageDisplay.textContent = DEFAULT_LANGUAGE.toUpperCase();
  runtimeSelectEl.disabled = true;
  saveRuntimeEl.disabled = true;

  meetingRoute.textContent = "Hosted display capture";
  meetingStatus.textContent = "Supported";
  meetingFallbackStatus.textContent = "Google Meet remains lab-only.";
  meetingActive.textContent = "No";
  meetingGuidance.innerHTML = `
    <li>Hosted microphone, system-audio, and meeting-helper sessions all use the same upload, transcript, and summary pipeline.</li>
    <li>System audio and meeting-helper capture use browser display audio, not a hidden Meet bot.</li>
  `;
  applyMeetingHelper.disabled = false;
  meetingFallback.disabled = false;
  meetingSurface.disabled = false;

  experimentalGoogleMeetFlag.textContent = "Deferred";
  experimentalGoogleMeetStatus.textContent = "Not in MVP";
  experimentalGoogleMeetAvailability.textContent = "Unavailable";
  experimentalGoogleMeetActive.textContent = "No";
  experimentalGoogleMeetEnabled.checked = false;
  experimentalGoogleMeetEnabled.disabled = true;
  saveExperimentalGoogleMeetButtonEl.disabled = true;
  refreshExperimentalGoogleMeetButtonEl.disabled = true;
  experimentalGoogleMeetErrorLabel.textContent =
    "Experimental Google Meet work stays out of the hosted MVP until after microphone ingestion, ASR, and summaries are stable.";
  experimentalGoogleMeetNotesList.innerHTML = `
    <li>Series 8 adds browser display-audio capture for system-audio and meeting-helper sessions.</li>
    <li>Google Meet bot work stays out of the hosted path and remains a separate lab boundary.</li>
  `;

  renderTranscriptState("Hosted transcript streaming is ready from the API.", []);
  renderSummaryState("Final summary will appear after the hosted session finishes processing.", null);

  historyCount.textContent = "0";
  historyStatus.textContent = "Hosted history loading...";
  historyListEl.innerHTML = '<li class="transcript-empty">Loading hosted session history…</li>';
  historyDetailEl.innerHTML =
    "<p>Hosted sessions now flow through audio capture, ASR, summaries, and database-backed review screens.</p>";
}

function formatByteSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function resetHostedAudioUi() {
  hostedUploadQueue = [];
  hostedUploadInFlight = false;
  hostedUploadErrorCount = 0;
  hostedUploadNextChunkIndex = 0;
  hostedUploadStartedAtMs = 0;
  hostedUploadLastChunkEndAtMs = 0;
  hostedUploadedChunkCount = 0;
  hostedCaptureActive = false;
  hostedFatalUploadErrorMessage = null;
  hostedAudioQueue.textContent = "0 pending";
  hostedAudioUploadCount.textContent = "0 chunks";
  hostedAudioStorage.textContent = "Awaiting session";
  hostedAudioLastChunk.textContent = "None uploaded yet.";
  hostedAudioList.innerHTML = '<li class="transcript-empty">No hosted audio chunks yet.</li>';
  setHostedAudioStatus("Idle");
}

function renderHostedAudioChunkList(chunks: readonly HostedAudioChunkRecord[]) {
  hostedAudioList.innerHTML = "";

  if (chunks.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "transcript-empty";
    emptyItem.textContent = "No hosted audio chunks yet.";
    hostedAudioList.appendChild(emptyItem);
    return;
  }

  for (const chunk of chunks) {
    const item = document.createElement("li");
    item.className = "transcript-item";
    item.innerHTML = `
      <div class="transcript-meta">
        <strong>Chunk ${chunk.chunkIndex.toString().padStart(3, "0")}</strong>
        <span>${new Date(chunk.createdAt).toLocaleTimeString()}</span>
      </div>
      <p>${chunk.objectPath}</p>
    `;
    hostedAudioList.appendChild(item);
  }
}

async function refreshHostedAudioChunks(sessionId: string) {
  const payload = await requestJsonFromBase<{
    sessionId: string;
    repositoryBackend: string;
    audioChunks: HostedAudioChunkRecord[];
  }>(hostedApiBaseUrl, `/sessions/${encodeURIComponent(sessionId)}/audio-chunks`);

  hostedAudioUploadCount.textContent = `${payload.audioChunks.length} chunk${payload.audioChunks.length === 1 ? "" : "s"}`;
  hostedAudioQueue.textContent = `${hostedUploadQueue.length}${hostedUploadInFlight ? " queued, 1 uploading" : " pending"}`;
  if (payload.audioChunks.length === 0) {
    hostedAudioStorage.textContent =
      payload.repositoryBackend === "postgres" ? "Cloud SQL metadata + object storage" : "Dev filesystem mirror";
  }
  hostedAudioLastChunk.textContent =
    payload.audioChunks.at(-1) !== undefined
      ? `${payload.audioChunks.at(-1)?.objectPath} • ${formatByteSize(Number(payload.audioChunks.at(-1)?.metadata.byteLength ?? 0))}`
      : "None uploaded yet.";
  renderHostedAudioChunkList(payload.audioChunks);
}

function buildHostedTranscriptStreamUrl(sessionId: string, sinceSequenceNumber?: number | null) {
  const url = new URL(`/sessions/${encodeURIComponent(sessionId)}/stream`, hostedApiBaseUrl);
  if (hostedApiUserId) {
    url.searchParams.set(HOSTED_REQUEST_QUERY_PARAMS.userId, hostedApiUserId);
  }
  if (sinceSequenceNumber !== undefined && sinceSequenceNumber !== null && sinceSequenceNumber >= 0) {
    url.searchParams.set("sinceSequenceNumber", String(sinceSequenceNumber));
  }
  return url.toString();
}

function closeHostedTranscriptStream() {
  hostedTranscriptEventSource?.close();
  hostedTranscriptEventSource = null;

  if (hostedTranscriptConnectionState !== "closed") {
    hostedTranscriptConnectionState = "closed";
  }
}

function setHostedTranscriptConnectionState(state: HostedTranscriptConnectionState, message: string) {
  hostedTranscriptConnectionState = state;
  transcriptStatus.textContent = message;
}

function snapshotHostedTranscriptFromResponse(payload: HostedTranscriptResponse) {
  hostedSession = payload.session ?? hostedSession;
  if (payload.session) {
    renderHostedSessionState(payload.session);
  }

  renderHostedTranscriptSnapshot(
    payload.transcript.segmentCount === 0
      ? "Hosted transcript stream is waiting for the first ASR segment."
      : "Hosted transcript hydrated from server truth.",
    payload.transcript
  );
}

async function hydrateHostedTranscript(sessionId: string) {
  setHostedTranscriptConnectionState("connecting", "Hydrating hosted transcript from server truth...");
  const payload = await requestJsonFromBase<HostedTranscriptResponse>(hostedApiBaseUrl, `/sessions/${encodeURIComponent(sessionId)}/transcript`);
  snapshotHostedTranscriptFromResponse(payload);
}

async function hydrateHostedNotes(sessionId: string) {
  const payload = await requestJsonFromBase<HostedNotesResponse>(
    hostedApiBaseUrl,
    `/sessions/${encodeURIComponent(sessionId)}/notes`
  );
  renderHostedNotesState(
    payload.notes.noteCount === 0
      ? "Hosted notes are deprecated in this build."
      : `Hosted notes hydrated from server truth • revision ${payload.notes.revision}`,
    payload.notes
  );
}

async function hydrateHostedSummary(sessionId: string) {
  const payload = await requestJsonFromBase<HostedSummaryResponse>(
    hostedApiBaseUrl,
    `/sessions/${encodeURIComponent(sessionId)}/summary`
  );
  renderHostedSummaryState(
    payload.summary.isReady
      ? `Hosted final summary ready • revision ${payload.summary.revision}`
      : "Waiting for the hosted summary worker to finish.",
    payload.summary
  );
}

function openHostedTranscriptStream(sessionId: string) {
  closeHostedTranscriptStream();
  const sinceSequenceNumber = hostedTranscriptLastSequenceNumber >= 0 ? hostedTranscriptLastSequenceNumber : null;
  setHostedTranscriptConnectionState("connecting", "Connecting to the hosted transcript stream...");
  const eventSource = new EventSource(buildHostedTranscriptStreamUrl(sessionId, sinceSequenceNumber));
  hostedTranscriptEventSource = eventSource;

  eventSource.onopen = () => {
    if (hostedTranscriptEventSource !== eventSource) {
      return;
    }

    setHostedTranscriptConnectionState("open", "Connected to the hosted transcript stream.");
  };

  eventSource.addEventListener("session.status", (event) => {
    if (hostedTranscriptEventSource !== eventSource) {
      return;
    }

    const payload = JSON.parse((event as MessageEvent<string>).data) as { session: HostedSessionRecordType };
    renderHostedSessionState(payload.session);

    if (payload.session.status === "processing") {
      setHostedTranscriptConnectionState("open", "Hosted session is processing. Waiting for ASR to drain queued chunks...");
      return;
    }

    if (payload.session.status === "complete") {
      setHostedTranscriptConnectionState("open", "Hosted transcript finalized. Waiting for the summary worker...");
      return;
    }

    if (payload.session.status === "failed") {
      setHostedTranscriptConnectionState("closed", "Hosted transcript stream ended after failure.");
      closeHostedTranscriptStream();
      return;
    }

    setHostedTranscriptConnectionState("open", "Hosted transcript stream is live.");
  });

  eventSource.addEventListener("transcript.segment", (event) => {
    if (hostedTranscriptEventSource !== eventSource) {
      return;
    }

    const payload = JSON.parse((event as MessageEvent<string>).data) as {
      segment: HostedTranscriptSegmentRecord;
      transcript: HostedTranscriptState;
    };
    appendHostedTranscriptSegment(payload.segment, payload.transcript);
    setHostedTranscriptConnectionState(
      payload.transcript.isActive ? "open" : "open",
      payload.transcript.isActive
        ? `Hosted transcript stream live • ${payload.transcript.segmentCount} segment${payload.transcript.segmentCount === 1 ? "" : "s"}`
        : `Hosted transcript processing • ${payload.transcript.segmentCount} segment${payload.transcript.segmentCount === 1 ? "" : "s"}`
    );
  });

  eventSource.addEventListener("summary.ready", (event) => {
    if (hostedTranscriptEventSource !== eventSource) {
      return;
    }

    const payload = JSON.parse((event as MessageEvent<string>).data) as {
      summary: HostedSummaryState;
    };
    renderHostedSummaryState(
      payload.summary.isReady
        ? `Hosted final summary ready • revision ${payload.summary.revision}`
        : "Waiting for the hosted summary worker to finish.",
      payload.summary
    );

    if (payload.summary.isReady && hostedSession?.status === "complete") {
      void refreshArchive().catch(() => {
        // Keep the live summary path independent from history refresh failures.
      });
      setHostedTranscriptConnectionState("closed", "Hosted transcript and summary finalized.");
      closeHostedTranscriptStream();
    }
  });

  eventSource.addEventListener("error", (event) => {
    if (hostedTranscriptEventSource !== eventSource) {
      return;
    }

    const payload = event instanceof MessageEvent ? JSON.parse(event.data) as { message: string } : null;
    if (payload?.message) {
      setHostedTranscriptConnectionState("error", payload.message);
      renderError(payload.message);
      closeHostedTranscriptStream();
      return;
    }

    if (hostedTranscriptConnectionState !== "closed") {
      setHostedTranscriptConnectionState("reconnecting", "Reconnecting to the hosted transcript stream...");
    }
  });
}

function getHostedRecorderConstructor() {
  return window.MediaRecorder ?? null;
}

function resolveHostedRecorderMimeType() {
  const constructor = getHostedRecorderConstructor();
  if (!constructor?.isTypeSupported) {
    return "";
  }

  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((candidate) => constructor.isTypeSupported(candidate)) ?? "";
}

function supportsHostedMicrophoneCapture() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(getHostedRecorderConstructor());
}

function supportsHostedDisplayCapture() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia) && Boolean(getHostedRecorderConstructor());
}

function resolveHostedSourceType(mode: CaptureMode): HostedSessionRecordType["sourceType"] {
  return mode === "speakerphone" ? "microphone" : mode;
}

function supportsHostedCapture(sourceType: HostedSessionRecordType["sourceType"]) {
  return sourceType === "microphone" ? supportsHostedMicrophoneCapture() : supportsHostedDisplayCapture();
}

function formatHostedCaptureSource(sourceType: HostedSessionRecordType["sourceType"]) {
  switch (sourceType) {
    case "microphone":
      return "microphone";
    case "system-audio":
      return "system audio";
    case "meeting-helper":
      return "meeting helper";
  }
}

function buildHostedSessionCreateRequest(sourceType: HostedSessionRecordType["sourceType"]): HostedSessionCreateRequest {
  const metadata: NonNullable<HostedSessionCreateRequest["metadata"]> = {
    captureStrategy: sourceType === "microphone" ? "microphone" : "display-media-audio"
  };

  if (sourceType === "meeting-helper") {
    metadata.meetingSurface = selectedMeetingSurface;
  }

  return {
    sourceType,
    captureStrategy: sourceType === "microphone" ? "microphone" : "display-media-audio",
    meetingSurface: sourceType === "meeting-helper" ? selectedMeetingSurface : null,
    metadata
  };
}

async function acquireHostedCaptureStream(sourceType: HostedSessionRecordType["sourceType"]) {
  if (sourceType === "microphone") {
    setHostedAudioStatus("Requesting microphone access...");
    const sourceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return {
      sourceStream,
      recorderStream: sourceStream,
      startMessage: "Capturing microphone audio...",
      readyMessage: "Hosted microphone capture is live. Transcript segments stream from the API."
    };
  }

  setHostedAudioStatus("Requesting display audio access...");
  const sourceStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  const audioTracks = sourceStream.getAudioTracks();
  if (audioTracks.length === 0) {
    sourceStream.getTracks().forEach((track) => track.stop());
    throw new Error("Display capture did not include any audio tracks. Choose a tab or screen share that includes audio.");
  }

  return {
    sourceStream,
    recorderStream: new MediaStream(audioTracks),
    startMessage: `Capturing ${formatHostedCaptureSource(sourceType)}...`,
    readyMessage: `Hosted ${formatHostedCaptureSource(sourceType)} is live. Transcript segments stream from the API.`
  };
}

function stopHostedUploadRetryTimer() {
  if (hostedUploadRetryTimerId !== null) {
    window.clearTimeout(hostedUploadRetryTimerId);
    hostedUploadRetryTimerId = null;
  }
}

async function stopHostedCaptureStream() {
  if (hostedMediaRecorder && hostedMediaRecorder.state !== "inactive") {
    const recorder = hostedMediaRecorder;
    await new Promise<void>((resolve) => {
      const previousOnStop = recorder.onstop;
      recorder.onstop = () => {
        previousOnStop?.call(recorder, new Event("stop"));
        resolve();
      };
      try {
        recorder.requestData();
        recorder.stop();
      } catch {
        resolve();
      }
    });
  }

  hostedMediaRecorder = null;

  if (hostedCaptureStream) {
    hostedCaptureStream.getTracks().forEach((track) => track.stop());
    hostedCaptureStream = null;
  }
}

async function createHostedSession(request: HostedSessionCreateRequest) {
  return requestJsonFromBase<HostedSessionCreateResponseType>(hostedApiBaseUrl, "/sessions", {
    method: "POST",
    body: JSON.stringify(request)
  });
}

async function stopHostedSession(sessionId: string, request?: HostedSessionStopRequest) {
  return requestJsonFromBase<HostedSessionStopResponse>(hostedApiBaseUrl, `/sessions/${encodeURIComponent(sessionId)}/stop`, {
    method: "POST",
    body: request ? JSON.stringify(request) : undefined
  });
}

function updateHostedAudioQueueUi() {
  hostedAudioQueue.textContent = `${hostedUploadQueue.length}${hostedUploadInFlight ? " pending, 1 uploading" : " pending"}`;
}

async function handleHostedCaptureStopUi(
  stoppedHostedSession: HostedSessionRecordType | null,
  endedExternally = false
) {
  if (stoppedHostedSession?.status === "failed") {
    renderTranscriptState("Hosted capture failed before transcription could begin.", []);
    renderSummaryState(
      readHostedMetadataString(stoppedHostedSession, "errorMessage") ?? "Hosted session failed before summarization.",
      null
    );
  } else {
    renderHostedCaptureCompletionPlaceholders();
    if (stoppedHostedSession) {
      void hydrateHostedSummary(stoppedHostedSession.id).catch(() => {
        // Ignore hydration race conditions while the summary worker is still running.
      });
    }
  }

  selectedArchiveSessionId = null;
  stopTranscriptPolling();
  stopBrowserSpeechRecognition();
  void refreshArchive();
  setMicStatus(
    stoppedHostedSession?.status === "failed"
      ? endedExternally
        ? "Hosted capture ended unexpectedly and the session failed."
        : "Hosted capture failed. Fix the upload path before retrying."
      : stoppedHostedSession?.status === "processing"
        ? endedExternally
          ? "Hosted share ended. The transcript stream is finalizing queued chunks."
          : "Hosted capture stopped. The transcript stream is still finalizing queued chunks."
        : endedExternally
          ? "Hosted share ended. Transcript streaming is handled by the hosted API."
          : "Hosted capture stopped. Transcript streaming is handled by the hosted API."
  );
}

async function handleHostedCaptureEndedExternally(sourceType: HostedSessionRecordType["sourceType"]) {
  if (!hostedCaptureActive || !hostedSession || hostedCaptureStopPromise) {
    return;
  }

  setHostedAudioStatus(`${formatHostedCaptureSource(sourceType)} share ended. Finalizing hosted session...`);

  try {
    const stoppedHostedSession = await stopHostedCapture();
    await handleHostedCaptureStopUi(stoppedHostedSession, true);
  } catch (error) {
    renderError(error instanceof Error ? error.message : "Unable to finalize hosted session after share ended.");
  }
}

function queueHostedAudioChunk(blob: Blob, startedAtMs: number, endedAtMs: number) {
  const chunkIndex = hostedUploadNextChunkIndex++;
  const job: HostedAudioUploadJob = {
    chunkIndex,
    blob,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    attempts: 0
  };
  hostedUploadQueue.push(job);
  updateHostedAudioQueueUi();
  setHostedAudioStatus(`Queued chunk ${String(chunkIndex).padStart(3, "0")} for upload.`);
  void processHostedUploadQueue();
}

async function uploadHostedAudioChunk(sessionId: string, job: HostedAudioUploadJob) {
  const response = await fetchHostedApi(hostedApiBaseUrl, `/sessions/${encodeURIComponent(sessionId)}/audio-chunks`, {
    method: "POST",
    headers: createHostedApiHeaders({
      "content-type": job.blob.type || hostedRecorderMimeType || "audio/webm",
      "x-audio-chunk-index": String(job.chunkIndex),
      "x-audio-chunk-started-at": job.startedAt,
      "x-audio-chunk-ended-at": job.endedAt
    }),
    body: job.blob
  });

  const payload = (await response.json()) as HostedAudioChunkUploadResponse & { audioChunkCount?: number } | SessionError;
  if (!response.ok) {
    throw new Error((payload as SessionError).message ?? "Unable to upload audio chunk");
  }

  return payload as HostedAudioChunkUploadResponse & { audioChunkCount?: number };
}

async function processHostedUploadQueue() {
  if (hostedUploadInFlight || !hostedSession) {
    return;
  }

  const nextJob = hostedUploadQueue.shift();
  updateHostedAudioQueueUi();

  if (!nextJob) {
    setHostedAudioStatus(hostedCaptureActive ? "Awaiting new audio chunks." : "All queued audio chunks uploaded.");
    return;
  }

  hostedUploadInFlight = true;
  updateHostedAudioQueueUi();
  setHostedAudioStatus(`Uploading chunk ${String(nextJob.chunkIndex).padStart(3, "0")}...`);

  try {
    const response = await uploadHostedAudioChunk(hostedSession.id, nextJob);
    const storageLabel = `${response.storageMode} • ${formatByteSize(response.storedBytes)}`;
    hostedAudioStorage.textContent = storageLabel;
    hostedAudioLastChunk.textContent = `${response.chunk.objectPath} • ${storageLabel}`;
    hostedUploadedChunkCount = Math.max(hostedUploadedChunkCount, nextJob.chunkIndex + 1);
    hostedAudioUploadCount.textContent = `${hostedUploadedChunkCount} chunk${hostedUploadedChunkCount === 1 ? "" : "s"}`;
    await refreshHostedAudioChunks(hostedSession.id);
    setHostedAudioStatus(`Chunk ${String(nextJob.chunkIndex).padStart(3, "0")} uploaded.`);
    hostedUploadErrorCount = 0;
  } catch (error) {
    nextJob.attempts += 1;
    hostedUploadErrorCount += 1;
    if (nextJob.attempts < 3) {
      const retryDelayMs = Math.min(5000, 500 * 2 ** (nextJob.attempts - 1));
      setHostedAudioStatus(`Retrying chunk ${String(nextJob.chunkIndex).padStart(3, "0")} in ${Math.round(retryDelayMs / 1000)}s.`);
      hostedUploadRetryTimerId = window.setTimeout(() => {
        hostedUploadRetryTimerId = null;
        hostedUploadQueue.unshift(nextJob);
        hostedUploadInFlight = false;
        updateHostedAudioQueueUi();
        void processHostedUploadQueue();
      }, retryDelayMs);
      return;
    }

    hostedFatalUploadErrorMessage = `Chunk ${String(nextJob.chunkIndex).padStart(3, "0")} failed after ${nextJob.attempts} attempts.`;
    setHostedAudioStatus(hostedFatalUploadErrorMessage);
    hostedAudioLastChunk.textContent = hostedFatalUploadErrorMessage;
    renderError(
      `${hostedFatalUploadErrorMessage} Stop the session to mark it failed and retry capture.`
    );
  } finally {
    hostedUploadInFlight = false;
    updateHostedAudioQueueUi();
    if (hostedUploadQueue.length > 0 && hostedUploadRetryTimerId === null) {
      void processHostedUploadQueue();
    }
  }
}

async function startHostedCapture(sourceType: HostedSessionRecordType["sourceType"]) {
  if (hostedCaptureActive) {
    return;
  }

  if (!supportsHostedCapture(sourceType)) {
    throw new Error(sourceType === "microphone" ? "This browser does not support microphone capture." : "This browser does not support display-audio capture.");
  }

  stopHostedUploadRetryTimer();
  resetHostedAudioUi();
  try {
    await ensureHostedApiAvailable();
    const capture = await acquireHostedCaptureStream(sourceType);
    hostedCaptureStream = capture.sourceStream;
    for (const track of capture.sourceStream.getTracks()) {
      track.addEventListener("ended", () => {
        void handleHostedCaptureEndedExternally(sourceType);
      });
    }

    setHostedAudioStatus("Creating hosted session...");
    const hostedSessionResponse = await createHostedSession(buildHostedSessionCreateRequest(sourceType));
    hostedSession = hostedSessionResponse.session;
    renderHostedSessionState(hostedSessionResponse.session);
    hostedCaptureActive = true;
    stopTranscriptPolling();
    renderHostedCapturePlaceholders();
    await hydrateHostedTranscript(hostedSession.id);
    await hydrateHostedSummary(hostedSession.id);
    openHostedTranscriptStream(hostedSession.id);
    hostedUploadStartedAtMs = Date.now();
    hostedUploadLastChunkEndAtMs = hostedUploadStartedAtMs;
    hostedAudioStorage.textContent = "Awaiting first upload";
    hostedAudioLastChunk.textContent = "Capture ready.";
    hostedAudioQueue.textContent = "0 pending";
    hostedAudioUploadCount.textContent = "0 chunks";
    setHostedAudioStatus(capture.readyMessage);

    const Recorder = getHostedRecorderConstructor();
    if (!Recorder) {
      throw new Error("MediaRecorder is not available in this browser.");
    }

    hostedRecorderMimeType = resolveHostedRecorderMimeType() || "audio/webm";
    const recorder = hostedRecorderMimeType ? new Recorder(capture.recorderStream, { mimeType: hostedRecorderMimeType }) : new Recorder(capture.recorderStream);
    hostedMediaRecorder = recorder;

    recorder.ondataavailable = (event) => {
      if (!hostedCaptureActive || !hostedSession) {
        return;
      }

      if (!event.data || event.data.size === 0) {
        return;
      }

      const now = Date.now();
      const startedAtMs = hostedUploadLastChunkEndAtMs || hostedUploadStartedAtMs;
      const endedAtMs = Math.max(now, startedAtMs + 250);
      hostedUploadLastChunkEndAtMs = endedAtMs;
      queueHostedAudioChunk(event.data, startedAtMs, endedAtMs);
    };

    recorder.onerror = (event) => {
      setHostedAudioStatus(`Recorder error: ${event.error ?? "unknown error"}`);
    };

    recorder.onstart = () => {
      setHostedAudioStatus(capture.startMessage);
      hostedAudioStorage.textContent = "Awaiting first upload";
    };

    recorder.start(5000);
    void refreshHostedAudioChunks(hostedSession.id).catch(() => {
      setHostedAudioStatus("Capture started. Waiting for chunk list refresh.");
    });
  } catch (error) {
    hostedCaptureActive = false;
    await stopHostedCaptureStream();
    let failedHostedSession: HostedSessionRecordType | null = null;
    if (hostedSession) {
      const errorMessage = error instanceof Error ? error.message : "Unable to start MediaRecorder.";
      const response = await stopHostedSession(hostedSession.id, {
        status: "failed",
        errorMessage
      }).catch(() => {
        // If cleanup fails, the session is still visible in the hosted API for debugging.
        return null;
      });
      failedHostedSession = response?.session ?? null;
      hostedSession = failedHostedSession;
    }

    if (failedHostedSession) {
      renderHostedSessionState(failedHostedSession);
      renderTranscriptState("Hosted capture failed before transcription could begin.", []);
      renderSummaryState(
        readHostedMetadataString(failedHostedSession, "errorMessage") ?? "Hosted session failed before summarization.",
        null
      );
      setMicStatus("Hosted capture failed before recording could start.");
    } else {
      renderSession(null);
    }
    throw error instanceof Error ? error : new Error("Unable to start MediaRecorder.");
  }
}

async function stopHostedCapture() {
  if (hostedCaptureStopPromise) {
    return hostedCaptureStopPromise;
  }

  hostedCaptureStopPromise = (async () => {
    await stopHostedCaptureStream();

    if (hostedUploadInFlight || hostedUploadQueue.length > 0 || hostedUploadRetryTimerId !== null) {
      setHostedAudioStatus("Waiting for queued uploads to finish...");
      while (hostedUploadInFlight || hostedUploadQueue.length > 0 || hostedUploadRetryTimerId !== null) {
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      }
    }

    if (hostedSession) {
      const response = await stopHostedSession(hostedSession.id, {
        status: hostedFatalUploadErrorMessage ? "failed" : "complete",
        errorMessage: hostedFatalUploadErrorMessage
      });
      hostedSession = response.session;
      renderHostedSessionState(response.session);
      await refreshHostedAudioChunks(hostedSession.id).catch(() => {
        // Keep the stop flow resilient if the final refresh fails.
      });
      hostedCaptureActive = false;
      if (response.session.status === "failed") {
        closeHostedTranscriptStream();
      }
      setHostedAudioStatus(
        response.session.status === "failed"
          ? "Hosted capture failed."
          : response.session.status === "processing"
            ? "Hosted capture stopped. The transcript stream is still processing queued chunks."
            : "Hosted capture stopped. Waiting for the final summary stream to finish."
      );
      return response.session;
    }

    hostedCaptureActive = false;
    setHostedAudioStatus("Hosted capture stopped.");
    return null;
  })();

  try {
    return await hostedCaptureStopPromise;
  } finally {
    hostedCaptureStopPromise = null;
  }
}

function getBrowserSpeechRecognitionConstructor() {
  const speechWindow = window as BrowserSpeechRecognitionWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function supportsBrowserSpeechRecognition() {
  return getBrowserSpeechRecognitionConstructor() !== null;
}

function normalizeTranscriptText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function estimateTranscriptSegmentDurationMs(text: string) {
  const wordCount = normalizeTranscriptText(text)
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1200, Math.min(6000, wordCount * 350));
}

function shortenTranscriptText(text: string, maxLength = 120) {
  const normalized = normalizeTranscriptText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function updateTranscriptMetrics(transcript: Pick<TranscriptResponse["transcript"], "segmentCount" | "revision" | "updatedAt"> | HostedTranscriptState) {
  transcriptChunkCount.textContent = String(transcript.segmentCount);
  transcriptRevisionDisplay.textContent = String(transcript.revision);
  transcriptUpdated.textContent = formatRelativeTimestamp(transcript.updatedAt);
}

function updateNotesMetrics(notes: LiveNotesResponse["notes"]) {
  notesCount.textContent = String(notes.noteCount);
  notesRevisionDisplay.textContent = String(notes.revision);
  notesUpdated.textContent = formatRelativeTimestamp(notes.updatedAt);
}

function renderTranscriptState(message: string, segments: readonly TranscriptRenderableSegment[], latest = true) {
  transcriptStatus.textContent = message;
  transcriptListEl.querySelector(".transcript-empty")?.remove();

  if (segments.length === 0 && transcriptListEl.children.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "transcript-empty";
    emptyItem.textContent = "No transcript chunks yet.";
    transcriptListEl.appendChild(emptyItem);
    return;
  }

  if (segments.length === 0) {
    return;
  }

  const existingLatest = transcriptListEl.querySelector(".transcript-item--latest");
  existingLatest?.classList.remove("transcript-item--latest");

  segments.forEach((segment, index) => {
    const item = document.createElement("li");
    const timeLabel = `${Math.floor(segment.startMs / 1000)}s-${Math.floor(segment.endMs / 1000)}s`;
    item.className = "transcript-item";
    item.innerHTML = `
      <div class="transcript-meta">
        <strong>${segment.speakerLabel ?? "Speaker"}</strong>
        <span>${timeLabel}</span>
      </div>
      <p>${segment.text}</p>
    `;
    if (latest && index === segments.length - 1) {
      item.classList.add("transcript-item--latest");
    }
    transcriptListEl.appendChild(item);
  });

  const latestItem = transcriptListEl.querySelector(".transcript-item--latest");
  latestItem?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function renderRuntimeConfig(config: RuntimeConfigResponse["config"]) {
  runtimeOptions = config.options;
  selectedRuntimeId = config.current.runtimeId;
  defaultLanguage = config.current.language;

  runtimeSelectEl.innerHTML = runtimeOptions
    .map((runtime) => `<option value="${runtime.id}">${runtime.name}</option>`)
    .join("");
  runtimeSelectEl.value = selectedRuntimeId;
  const runtimeName = runtimeOptions.find((runtime) => runtime.id === selectedRuntimeId)?.name ?? selectedRuntimeId;
  selectedRuntimeDisplay.textContent = `${runtimeName} (current)`;
  runtimeOptionsDisplay.textContent = runtimeOptions
    .map((runtime) => `${runtime.name}: ${runtime.description}`)
    .join(" • ");
  defaultLanguageDisplay.textContent = config.defaults.language.toUpperCase();
  saveTranscriptEl.checked = config.current.saveTranscript;
  saveSummaryEl.checked = config.current.saveSummary;
  runtimeSelectEl.disabled = false;
  saveRuntimeEl.disabled = false;
}

function renderMeetingHelper(state: MeetingHelperResponse["meetingHelper"]) {
  meetingHelperState = state;
  selectedMeetingSurface = state.selectedSurface;
  meetingSurface.value = state.selectedSurface;
  meetingRoute.textContent = `${formatMeetingSurface(state.effectiveSurface)}${state.selectedSurface !== state.effectiveSurface ? " (fallback applied)" : ""}`;
  meetingStatus.textContent = formatMeetingSupportStatus(state.supportStatus);
  meetingFallbackStatus.textContent = state.fallbackMessage ?? "None";
  meetingActive.textContent = state.activeSessionId ? `Yes • ${state.activeSessionId}` : "No";

  meetingGuidance.innerHTML = "";
  const selectedOption = state.options.find((option) => option.surface === state.selectedSurface) ?? state.options[0];
  if (selectedOption) {
    const heading = document.createElement("li");
    heading.textContent = selectedOption.description;
    meetingGuidance.appendChild(heading);

    for (const item of selectedOption.fallbackGuidance) {
      const li = document.createElement("li");
      li.textContent = item;
      meetingGuidance.appendChild(li);
    }
  }

  if (state.fallbackMessage) {
    const li = document.createElement("li");
    li.textContent = state.fallbackMessage;
    meetingGuidance.appendChild(li);
  }
}

function renderExperimentalGoogleMeet(state: ExperimentalGoogleMeetState) {
  experimentalGoogleMeetFlag.textContent = state.featureFlag;
  experimentalGoogleMeetStatus.textContent = formatExperimentalGoogleMeetStatus(state.status);
  experimentalGoogleMeetAvailability.textContent = state.available ? "Available in lab mode" : "Unavailable";
  experimentalGoogleMeetActive.textContent = state.activeSessionId ? `Yes • ${state.activeSessionId}` : "No";
  experimentalGoogleMeetEnabled.checked = state.enabled;
  experimentalGoogleMeetEnabled.disabled = !state.available;
  saveExperimentalGoogleMeetButtonEl.disabled = !state.available;
  refreshExperimentalGoogleMeetButtonEl.disabled = false;

  experimentalGoogleMeetNotesList.innerHTML = "";
  for (const note of state.notes) {
    const item = document.createElement("li");
    item.textContent = note;
    experimentalGoogleMeetNotesList.appendChild(item);
  }

  if (!state.available) {
    experimentalGoogleMeetErrorLabel.textContent = "Lab mode is blocked until the companion starts with VOICE_TO_TEXT_EXPERIMENTAL_GOOGLE_MEET=1.";
    return;
  }

  experimentalGoogleMeetErrorLabel.textContent = state.enabled
    ? "The prototype boundary is enabled, but it still does not join Google Meet as a bot."
    : "The prototype boundary is disabled. Enable it only for lab testing.";
}

function renderNotesState(message: string, notes: LiveNotesResponse["notes"]) {
  notesStatus.textContent = message;
  notesListEl.innerHTML = "";
  const emptyItem = document.createElement("li");
  emptyItem.className = "transcript-empty";
  emptyItem.textContent = "Live notes are deprecated in this build.";
  notesListEl.appendChild(emptyItem);
}

function renderSummaryState(message: string, summary: FinalSummary | null) {
  summaryStatus.textContent = message;

  if (!summary) {
    summaryOverview.textContent = "No summary yet.";
    summaryPoints.innerHTML = "<li>Stop the session to generate a summary.</li>";
    summaryFollowUps.innerHTML = "<li>No follow-ups yet.</li>";
    return;
  }

  summaryOverview.textContent = summary.overview;
  summaryPoints.innerHTML = "";
  summary.keyPoints.forEach((point) => {
    const item = document.createElement("li");
    item.textContent = point;
    summaryPoints.appendChild(item);
  });

  summaryFollowUps.innerHTML = "";
  if (summary.followUps.length === 0) {
    summaryFollowUps.innerHTML = "<li>No follow-ups detected.</li>";
    return;
  }

  summary.followUps.forEach((followUp) => {
    const item = document.createElement("li");
    item.textContent = followUp;
    summaryFollowUps.appendChild(item);
  });
}

function mapHostedNotesState(notes: HostedNotesState): LiveNotesResponse["notes"] {
  return {
    sessionId: notes.sessionId,
    revision: notes.revision,
    updatedAt: notes.updatedAt,
    noteCount: notes.noteCount,
    isSimulated: notes.isSimulated,
    isActive: notes.isActive,
    notes: notes.notes.map((note) => ({
      id: note.id,
      sessionId: note.sessionId,
      text: note.text,
      createdAt: note.createdAt,
      derivedFromSegmentIds: [...note.sourceSegmentIds]
    }))
  };
}

function mapHostedSummaryState(summary: HostedSummaryState): FinalSummary | null {
  if (!summary.summary) {
    return null;
  }

  return {
    sessionId: summary.summary.sessionId,
    overview: summary.summary.overview,
    keyPoints: [...summary.summary.keyPoints],
    followUps:
      summary.summary.followUps.length > 0
        ? [...summary.summary.followUps]
        : summary.actionItems.map((actionItem) => actionItem.text),
    generatedAt: summary.summary.generatedAt,
    modelInfo: summary.summary.modelInfo
  };
}

function renderHostedNotesState(message: string, notes: HostedNotesState) {
  hostedNotesRevision = notes.revision;
  const mappedNotes = mapHostedNotesState(notes);
  notesRevision = mappedNotes.revision;
  updateNotesMetrics(mappedNotes);
  renderNotesState(message, mappedNotes);
}

function renderHostedSummaryState(message: string, summary: HostedSummaryState) {
  hostedSummaryRevision = summary.revision;
  const mappedSummary = mapHostedSummaryState(summary);
  currentSummary = mappedSummary;
  renderSummaryState(message, mappedSummary);
}

function mapHostedTranscriptSegmentsForDisplay(segments: readonly HostedTranscriptSegmentRecord[]): TranscriptRenderableSegment[] {
  return segments.map((segment) => ({
    speakerLabel: segment.speakerLabel,
    startMs: segment.startMs,
    endMs: segment.endMs,
    text: segment.text
  }));
}

function renderHostedTranscriptSnapshot(message: string, transcript: HostedTranscriptState) {
  hostedTranscriptSegments = [...transcript.segments];
  hostedTranscriptLastSequenceNumber = transcript.lastSequenceNumber ?? -1;
  transcriptListEl.innerHTML = "";
  updateTranscriptMetrics(transcript);
  renderTranscriptState(message, mapHostedTranscriptSegmentsForDisplay(hostedTranscriptSegments), true);
}

function appendHostedTranscriptSegment(segment: HostedTranscriptSegmentRecord, transcript: HostedTranscriptState) {
  if (segment.sequenceNumber <= hostedTranscriptLastSequenceNumber) {
    return;
  }

  hostedTranscriptSegments = [...hostedTranscriptSegments, segment];
  hostedTranscriptLastSequenceNumber = segment.sequenceNumber;
  updateTranscriptMetrics(transcript);
  renderTranscriptState(
    transcript.isActive
      ? "Hosted transcript is live from the API stream."
      : "Hosted transcript is finalizing from the API stream.",
    mapHostedTranscriptSegmentsForDisplay([segment]),
    true
  );
}

function renderHostedCapturePlaceholders() {
  renderHostedTranscriptSnapshot("Connecting to the hosted transcript stream...", {
    sessionId: hostedSession?.id ?? null,
    revision: 0,
    updatedAt: hostedSession?.updatedAt ?? hostedSession?.createdAt ?? null,
    startedAt: hostedSession?.startedAt ?? hostedSession?.createdAt ?? null,
    lastSegmentAt: null,
    segmentCount: 0,
    lastSequenceNumber: null,
    isSimulated: false,
    isActive: true,
    segments: []
  });
  renderNotesState("Waiting for transcription pipeline.", {
    sessionId: null,
    revision: 0,
    updatedAt: null,
    noteCount: 0,
    isSimulated: false,
    isActive: false,
    notes: []
  });
  renderSummaryState("Waiting for transcription and summarization.", null);
}

function renderHostedCaptureCompletionPlaceholders() {
  const hostedTranscriptIsFinalized = hostedSession?.status === "complete";
  renderHostedTranscriptSnapshot(
    hostedTranscriptIsFinalized ? "Hosted transcript finalized from the API stream." : "Hosted transcript is finalizing in the API stream.",
    {
    sessionId: hostedSession?.id ?? null,
    revision: hostedTranscriptSegments.length,
    updatedAt: hostedSession?.updatedAt ?? hostedSession?.endedAt ?? null,
    startedAt: hostedSession?.startedAt ?? hostedSession?.createdAt ?? null,
    lastSegmentAt: hostedTranscriptSegments.at(-1)?.createdAt ?? hostedSession?.endedAt ?? null,
    segmentCount: hostedTranscriptSegments.length,
    lastSequenceNumber: hostedTranscriptLastSequenceNumber >= 0 ? hostedTranscriptLastSequenceNumber : null,
    isSimulated: false,
    isActive: false,
    segments: hostedTranscriptSegments
    }
  );
  if (currentSummary) {
    renderSummaryState(
      hostedTranscriptIsFinalized
        ? `Hosted final summary ready • revision ${hostedSummaryRevision}`
        : "Hosted final summary is still waiting for processing to finish.",
      currentSummary
    );
    return;
  }
  summaryStatus.textContent = hostedTranscriptIsFinalized
    ? "Hosted transcript finalized. Waiting for summary generation."
    : "Hosted session is still finalizing. Final summary will appear after processing.";
}

function renderArchiveDetail(detail: HostedHistoryDetailResponse | null) {
  if (!detail?.session) {
    historyStatus.textContent = "None selected";
    historyDetailEl.innerHTML = "<p>Select a session to inspect its transcript, summary, and action items.</p>";
    return;
  }

  const { session, transcript, summary } = detail;
  const summaryValue = summary.summary;
  historyStatus.textContent = session.id;
  historyDetailEl.innerHTML = `
    <div class="history-detail-stack">
      <div class="history-detail-header">
        <div>
          <p class="history-eyebrow">Session</p>
          <h3>${escapeHtml(session.sourceType)} • ${escapeHtml(session.id)}</h3>
        </div>
        <span class="history-badge">${escapeHtml(session.status)}</span>
      </div>
      <div class="history-detail-grid">
        <div><strong>Started</strong><span>${session.startedAt ? new Date(session.startedAt).toLocaleString() : "Unknown"}</span></div>
        <div><strong>Completed</strong><span>${session.endedAt ? new Date(session.endedAt).toLocaleString() : "In progress"}</span></div>
        <div><strong>Transcript segments</strong><span>${transcript.segmentCount}</span></div>
        <div><strong>Transcript source</strong><span>Authoritative final pass</span></div>
        <div><strong>Action items</strong><span>${summary.actionItemCount}</span></div>
        <div><strong>Summary model</strong><span>${escapeHtml(summaryValue?.modelInfo ?? "Pending")}</span></div>
      </div>
      <div class="history-summary">
        <h4>Summary</h4>
        <p>${escapeHtml(summaryValue?.overview ?? "No final summary stored yet.")}</p>
        <ul>
          ${
            summaryValue?.keyPoints.length
              ? summaryValue.keyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")
              : "<li>No summary points stored yet.</li>"
          }
        </ul>
      </div>
      <div class="history-summary">
        <h4>Follow-ups</h4>
        <ul>
          ${
            summaryValue?.followUps.length
              ? summaryValue.followUps.map((point) => `<li>${escapeHtml(point)}</li>`).join("")
              : "<li>No follow-ups detected.</li>"
          }
        </ul>
      </div>
      <div class="history-summary">
        <h4>Action items</h4>
        <ul>
          ${
            summary.actionItems.length
              ? summary.actionItems
                  .map((actionItem) => `<li>${escapeHtml(actionItem.text)} <strong>(${escapeHtml(actionItem.status)})</strong></li>`)
                  .join("")
              : "<li>No action items stored.</li>"
          }
        </ul>
      </div>
      <div class="history-summary">
        <h4>Transcript review</h4>
        <ol class="transcript-list">
          ${
            transcript.segments.length
              ? transcript.segments
                  .map(
                    (segment) =>
                      `<li class="transcript-item"><div class="transcript-meta"><strong>${escapeHtml(segment.speakerLabel ?? "Speaker")}</strong><span>${Math.floor(segment.startMs / 1000)}s-${Math.floor(segment.endMs / 1000)}s</span></div><p>${escapeHtml(segment.text)}</p></li>`
                  )
                  .join("")
              : '<li class="transcript-empty">No transcript stored yet.</li>'
          }
        </ol>
      </div>
    </div>
  `;
}

function renderArchiveList(entries: HostedHistoryListEntry[]) {
  historyCount.textContent = String(entries.length);
  historyListEl.innerHTML = "";

  if (entries.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "transcript-empty";
    emptyItem.textContent = "No sessions match the current filters.";
    historyListEl.appendChild(emptyItem);
    renderArchiveDetail(null);
    return;
  }

  for (const entry of entries) {
    const item = document.createElement("li");
    item.className = "history-item";
    if (entry.session.id === selectedArchiveSessionId) {
      item.classList.add("history-item--selected");
    }
    item.innerHTML = `
      <button type="button" class="history-button">
        <strong>${escapeHtml(entry.session.sourceType)}</strong>
        <span>${entry.session.startedAt ? new Date(entry.session.startedAt).toLocaleString() : "Unknown start"}</span>
        <small>
          ${entry.transcriptSegmentCount} transcript segments • ${entry.actionItemCount} action items
        </small>
        <small>${escapeHtml(shortenTranscriptText(entry.summaryOverview ?? "No summary yet.", 96))}</small>
      </button>
    `;
    const button = item.querySelector("button");
    button?.addEventListener("click", () => {
      selectedArchiveSessionId = entry.session.id;
      void refreshArchiveSelection(entry.session.id);
      renderArchiveList(hostedHistoryEntries);
    });
    historyListEl.appendChild(item);
  }
}

function stopBrowserSpeechRecognition() {
  if (browserSpeechRecognitionRestartTimerId !== null) {
    window.clearTimeout(browserSpeechRecognitionRestartTimerId);
    browserSpeechRecognitionRestartTimerId = null;
  }

  if (!browserSpeechRecognition) {
    return;
  }

  const recognition = browserSpeechRecognition;
  browserSpeechRecognition = null;
  browserSpeechRecognitionSessionId = null;
  browserSpeechRecognitionNextResultIndex = 0;
  browserSpeechRecognitionCursorMs = 0;
  browserSpeechRecognitionShouldRestart = false;
  browserSpeechRecognitionStopping = false;
  browserSpeechRecognitionStopResolve?.();
  browserSpeechRecognitionStopResolve = null;

  try {
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.abort();
  } catch {
    // Ignore stop/abort errors from browsers that reject when recognition already ended.
  }
}

async function flushBrowserSpeechRecognition() {
  if (!browserSpeechRecognition) {
    return;
  }

  browserSpeechRecognitionShouldRestart = false;
  browserSpeechRecognitionStopping = true;
  setMicStatus("Finishing microphone transcription...");

  await new Promise<void>((resolve) => {
    browserSpeechRecognitionStopResolve = resolve;

    try {
      browserSpeechRecognition?.stop();
    } catch {
      browserSpeechRecognitionStopResolve = null;
      resolve();
    }
  });

  if (pendingTranscriptAppendPromises.size > 0) {
    await Promise.allSettled(Array.from(pendingTranscriptAppendPromises));
  }
}

async function appendBrowserTranscriptSegments(sessionId: string, segments: TranscriptIngestRequest["segments"]) {
  const payload: TranscriptIngestRequest = {
    sessionId,
    segments
  };

  const response = await requestJson<TranscriptIngestResponse>("/transcript/append", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  const transcript = response.transcript;
  const summary = response.summary;
  const incomingSegments = transcript.segments.slice(transcriptSegments.length);

  if (incomingSegments.length > 0) {
    transcriptSegments = [...transcriptSegments, ...incomingSegments];
    renderTranscriptState(
      `${transcript.isActive ? "Live transcript" : "Transcript paused"}${transcript.isSimulated ? " (simulated)" : ""} • revision ${transcript.revision}`,
      incomingSegments,
      true
    );
  }

  transcriptRevision = transcript.revision;
  updateTranscriptMetrics(transcript);

  if (summary.isReady && summary.summary) {
    currentSummary = summary.summary;
    renderSummaryState(
      `${summary.isSimulated ? "Simulated summary" : "Live summary"} ready • revision ${summary.revision}`,
      summary.summary
    );
  }
}

function startBrowserSpeechRecognition(session: SessionRecord) {
  stopBrowserSpeechRecognition();

  const SpeechRecognition = getBrowserSpeechRecognitionConstructor();
  if (!SpeechRecognition) {
    setMicStatus("Browser speech recognition is not available in this browser.");
    renderError("This browser does not support live microphone transcription.");
    return;
  }

  if (session.sourceType !== "speakerphone") {
    setMicStatus("Browser speech recognition is only active for legacy speakerphone sessions.");
    return;
  }

  const recognition = new SpeechRecognition();
  browserSpeechRecognition = recognition;
  browserSpeechRecognitionSessionId = session.id;
  browserSpeechRecognitionNextResultIndex = 0;
  browserSpeechRecognitionCursorMs = 0;
  browserSpeechRecognitionShouldRestart = true;
  browserSpeechRecognitionStopping = false;

  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.lang = "en-US";

  recognition.onresult = (event) => {
    if (!currentSession || currentSession.id !== session.id || currentSession.status !== "recording") {
      return;
    }

    const appendedSegments: Array<{ text: string; startMs?: number; endMs?: number; confidence?: number; speakerLabel?: string }> = [];

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (!result.isFinal || index < browserSpeechRecognitionNextResultIndex) {
        continue;
      }

      const alternative = result[0];
      const text = normalizeTranscriptText(alternative?.transcript ?? "");
      if (!text) {
        browserSpeechRecognitionNextResultIndex = index + 1;
        continue;
      }

      const estimatedDurationMs = estimateTranscriptSegmentDurationMs(text);
      const sessionElapsedMs = Math.max(0, Date.now() - new Date(session.startedAt).getTime());
      const endMs = Math.max(browserSpeechRecognitionCursorMs + 150, sessionElapsedMs);
      const startMs = Math.max(browserSpeechRecognitionCursorMs + 150, endMs - estimatedDurationMs);
      browserSpeechRecognitionCursorMs = Math.max(browserSpeechRecognitionCursorMs, endMs);
      appendedSegments.push({
        text,
        startMs,
        endMs,
        confidence: alternative?.confidence,
        speakerLabel: "Speaker 1"
      });
      browserSpeechRecognitionNextResultIndex = index + 1;
    }

    if (appendedSegments.length === 0) {
      return;
    }

    setMicStatus(`Submitting ${appendedSegments.length} transcript segment${appendedSegments.length === 1 ? "" : "s"}...`);
    const appendPromise = appendBrowserTranscriptSegments(session.id, appendedSegments)
      .then(() => {
        setMicStatus("Listening for speech...");
      })
      .catch((error) => {
        setMicStatus(error instanceof Error ? error.message : "Unable to append transcript segment.");
      })
      .finally(() => {
        pendingTranscriptAppendPromises.delete(appendPromise);
      });
    pendingTranscriptAppendPromises.add(appendPromise);
  };

  recognition.onerror = (event) => {
    if (!currentSession || currentSession.id !== session.id || currentSession.status !== "recording") {
      return;
    }

    const message = event.message ? `${event.error}: ${event.message}` : event.error;
    setMicStatus(message);
    if (event.error !== "no-speech" && event.error !== "aborted") {
      renderError(`Hosted transcription error: ${message}`);
    }
  };

  recognition.onend = () => {
    if (browserSpeechRecognitionStopping) {
      browserSpeechRecognitionStopping = false;
      browserSpeechRecognitionStopResolve?.();
      browserSpeechRecognitionStopResolve = null;
      setMicStatus("Browser speech recognition stopped.");
      return;
    }

    if (!currentSession || currentSession.id !== session.id || currentSession.status !== "recording") {
      setMicStatus("Browser speech recognition stopped.");
      return;
    }

    if (!browserSpeechRecognitionShouldRestart) {
      setMicStatus("Browser speech recognition stopped.");
      return;
    }

    if (browserSpeechRecognitionRestartTimerId !== null) {
      window.clearTimeout(browserSpeechRecognitionRestartTimerId);
    }

    browserSpeechRecognitionRestartTimerId = window.setTimeout(() => {
      if (!currentSession || currentSession.id !== session.id || currentSession.status !== "recording") {
        return;
      }

      try {
        browserSpeechRecognitionNextResultIndex = 0;
        recognition.start();
        setMicStatus("Listening for speech...");
      } catch (error) {
        setMicStatus(error instanceof Error ? error.message : "Unable to restart speech recognition.");
      }
    }, 300);
  };

  try {
    recognition.start();
    setMicStatus("Listening for speech...");
  } catch (error) {
    setMicStatus(error instanceof Error ? error.message : "Unable to start speech recognition.");
    renderError(error instanceof Error ? error.message : "Unable to start speech recognition.");
    stopBrowserSpeechRecognition();
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${companionBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json"
    }
  });

  const data = (await response.json()) as T | SessionError;

  if (!response.ok) {
    throw new Error((data as SessionError).message ?? "Request failed");
  }

  return data as T;
}

function createHostedApiHeaders(headers?: HeadersInit) {
  const mergedHeaders = new Headers(headers ?? undefined);
  if (hostedApiUserId) {
    mergedHeaders.set(HOSTED_REQUEST_HEADERS.userId, hostedApiUserId);
  }
  return mergedHeaders;
}

function normalizeHostedApiRequestError(error: unknown, baseUrl: string) {
  if (
    error instanceof TypeError ||
    (error instanceof Error && /failed to fetch|networkerror|load failed/i.test(error.message))
  ) {
    return new Error(buildHostedApiOfflineMessage(baseUrl));
  }

  return error instanceof Error ? error : new Error(buildHostedApiOfflineMessage(baseUrl));
}

async function fetchHostedApi(baseUrl: string, path: string, init?: RequestInit) {
  try {
    const response = await fetch(`${baseUrl}${path}`, init);
    if (baseUrl === hostedApiBaseUrl) {
      hostedApiAvailability = "online";
    }
    return response;
  } catch (error) {
    const normalizedError = normalizeHostedApiRequestError(error, baseUrl);
    if (baseUrl === hostedApiBaseUrl) {
      renderHostedApiOfflineState(normalizedError.message);
    }
    throw normalizedError;
  }
}

async function requestJsonFromBase<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetchHostedApi(baseUrl, path, {
    ...init,
    headers: createHostedApiHeaders({
      "content-type": "application/json",
      ...(init?.headers ?? {})
    })
  });

  const data = (await response.json()) as T | SessionError;

  if (!response.ok) {
    throw new Error((data as SessionError).message ?? "Request failed");
  }

  return data as T;
}

async function ensureHostedApiAvailable() {
  const response = await fetchHostedApi(hostedApiBaseUrl, "/health", {
    headers: createHostedApiHeaders()
  });

  if (!response.ok) {
    const message = `Hosted API health check failed with status ${response.status}. Start npm run dev:api and retry.`;
    renderHostedApiOfflineState(message);
    throw new Error(message);
  }

  renderHostedApiReadyState();
}

async function refreshHostedApiAvailability() {
  try {
    await ensureHostedApiAvailable();
  } catch (error) {
    console.warn(error);
  }
}

async function refreshSession() {
  try {
    const payload = await requestJson<SessionStatusResponse>("/session");
    renderSession(payload.session);
  } catch (error) {
    summaryLabel.textContent = "Hosted capture is ready. Legacy companion state is unavailable.";
    sessionJson.textContent = "Hosted path does not depend on the legacy companion.";
    console.warn(error);
  }
}

async function refreshRuntimeConfig() {
  try {
    const payload = await requestJson<RuntimeConfigResponse>("/config");
    renderRuntimeConfig(payload.config);
  } catch (error) {
    selectedRuntimeDisplay.textContent = selectedRuntimeId;
    runtimeOptionsDisplay.textContent = "Hosted capture is ready.";
    defaultLanguageDisplay.textContent = DEFAULT_LANGUAGE.toUpperCase();
    console.warn(error);
  }
}

async function refreshMeetingHelper() {
  try {
    const payload = await requestJson<MeetingHelperResponse>("/meeting-helper");
    renderMeetingHelper(payload.meetingHelper);
  } catch (error) {
    meetingStatus.textContent = "Hosted capture available.";
    meetingFallbackStatus.textContent = "Legacy companion unavailable.";
    console.warn(error);
  }
}

async function refreshExperimentalGoogleMeet() {
  try {
    const payload = await requestJson<ExperimentalGoogleMeetResponse>("/experimental/google-meet");
    renderExperimentalGoogleMeet(payload.experimentalGoogleMeet);
  } catch (error) {
    experimentalGoogleMeetErrorLabel.textContent = "Legacy companion unavailable; hosted capture remains available.";
    console.warn(error);
  }
}

function initializeHostedOnlyDefaults() {
  statusLabel.textContent = "Checking hosted API...";
  summaryLabel.textContent = "Waiting for hosted API availability.";
  sessionJson.textContent = "Hosted path does not depend on the legacy companion.";

  selectedRuntimeDisplay.textContent = selectedRuntimeId;
  runtimeOptionsDisplay.textContent = "Hosted capture is ready.";
  defaultLanguageDisplay.textContent = DEFAULT_LANGUAGE.toUpperCase();
  runtimeSelectEl.disabled = true;
  saveRuntimeEl.disabled = true;

  meetingStatus.textContent = "Hosted capture available.";
  meetingFallbackStatus.textContent = "Legacy companion unavailable.";
  meetingActive.textContent = "No";
  meetingGuidance.innerHTML = `
    <li>Hosted microphone, system-audio, and meeting-helper sessions use the same local upload, transcript, and summary pipeline.</li>
    <li>Legacy companion meeting controls are disabled in this build.</li>
  `;
  meetingSurface.disabled = true;
  applyMeetingHelper.disabled = true;
  meetingFallback.disabled = true;

  experimentalGoogleMeetFlag.textContent = "Deferred";
  experimentalGoogleMeetStatus.textContent = "Not in MVP";
  experimentalGoogleMeetAvailability.textContent = "Unavailable";
  experimentalGoogleMeetActive.textContent = "No";
  experimentalGoogleMeetEnabled.checked = false;
  experimentalGoogleMeetEnabled.disabled = true;
  saveExperimentalGoogleMeetButtonEl.disabled = true;
  refreshExperimentalGoogleMeetButtonEl.disabled = true;
  experimentalGoogleMeetErrorLabel.textContent = "Legacy companion unavailable; hosted capture remains available.";
  experimentalGoogleMeetNotesList.innerHTML = `
    <li>Series 8 adds browser display-audio capture for system-audio and meeting-helper sessions.</li>
    <li>Google Meet bot work stays out of the local-first MVP.</li>
  `;
}

async function saveMeetingHelperSelection(surface = selectedMeetingSurface) {
  const payload: UpdateMeetingHelperRequest = { surface };

  try {
    const response = await requestJson<UpdateMeetingHelperResponse>("/meeting-helper", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    renderMeetingHelper(response.meetingHelper);
  } catch (error) {
    renderError(error instanceof Error ? error.message : "Unable to save meeting helper");
  }
}

async function saveExperimentalGoogleMeetSelection(enabled = experimentalGoogleMeetEnabled.checked) {
  const payload: UpdateExperimentalGoogleMeetRequest = { enabled };

  try {
    const response = await requestJson<UpdateExperimentalGoogleMeetResponse>("/experimental/google-meet", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    renderExperimentalGoogleMeet(response.experimentalGoogleMeet);
    void refreshMeetingHelper();
  } catch (error) {
    experimentalGoogleMeetErrorLabel.textContent = error instanceof Error ? error.message : "Unable to save experimental Google Meet state";
  }
}

async function refreshTranscript() {
  if (hostedSession) {
    return;
  }

  try {
    const payload = await requestJson<TranscriptResponse>(`/transcript?sinceSegmentCount=${transcriptSegments.length}`);
    if (payload.transcript.revision !== transcriptRevision) {
      const incomingSegments = payload.transcript.segments;
      if (incomingSegments.length > 0) {
        transcriptSegments = [...transcriptSegments, ...incomingSegments];
      }
      transcriptRevision = payload.transcript.revision;
      updateTranscriptMetrics(payload.transcript);
      renderTranscriptState(
        `${payload.transcript.isActive ? "Simulated streaming transcript" : "Transcript paused"}${payload.transcript.isSimulated ? " (simulated)" : ""} • revision ${payload.transcript.revision}`,
        incomingSegments,
        incomingSegments.length > 0
      );
    } else {
      updateTranscriptMetrics(payload.transcript);
      if (currentSession?.status === "recording") {
        transcriptStatus.textContent = `Polling transcript stream... revision ${transcriptRevision}`;
      }
    }
  } catch (error) {
    transcriptStatus.textContent = "Hosted audio capture ready.";
    transcriptListEl.innerHTML = '<li class="transcript-empty">Hosted audio capture is active or ready.</li>';
    console.warn(error);
  }
}

async function refreshLiveNotes() {
  notesStatus.textContent = "Live notes are deprecated in this build.";
  notesListEl.innerHTML = '<li class="transcript-empty">Live notes have been removed.</li>';
}

async function refreshSummary() {
  if (hostedSession?.id) {
    try {
      await hydrateHostedSummary(hostedSession.id);
    } catch (error) {
      renderSummaryState("Waiting for the hosted summary worker to finish.", null);
      console.warn(error);
    }
    return;
  }

  if (hostedCaptureActive) {
    renderSummaryState("Waiting for transcription and summarization.", null);
    return;
  }

  try {
    const payload = await requestJson<SummaryResponse>("/summary");
    if (payload.summary.isReady && payload.summary.summary) {
      currentSummary = payload.summary.summary;
      renderSummaryState(
        `${payload.summary.isSimulated ? "Simulated summary" : "Final summary"} ready • revision ${payload.summary.revision}`,
        payload.summary.summary
      );
      return;
    }

    currentSummary = null;
    renderSummaryState("Waiting for session to complete", null);
  } catch (error) {
    summaryStatus.textContent = "Hosted audio capture ready.";
    summaryOverview.textContent = "Waiting for transcription and summarization.";
    summaryPoints.innerHTML = "<li>Transcript generation is next.</li>";
    console.warn(error);
  }
}

function syncHostedHistoryFiltersFromInputs() {
  hostedHistoryFilters = {
    sourceType: historySourceFilter.value as HostedHistorySourceFilter,
    status: historyStatusFilter.value as HostedHistoryStatusFilter,
    query: historyQuery.value.trim()
  };
}

async function refreshArchive() {
  try {
    syncHostedHistoryFiltersFromInputs();
    const searchParams = new URLSearchParams();
    if (hostedHistoryFilters.sourceType !== "all") {
      searchParams.set("sourceType", hostedHistoryFilters.sourceType);
    }
    if (hostedHistoryFilters.status !== "all") {
      searchParams.set("status", hostedHistoryFilters.status);
    }
    if (hostedHistoryFilters.query) {
      searchParams.set("query", hostedHistoryFilters.query);
    }
    const querySuffix = searchParams.toString() ? `?${searchParams.toString()}` : "";
    const payload = await requestJsonFromBase<HostedHistoryListResponse>(hostedApiBaseUrl, `/history/sessions${querySuffix}`);
    hostedHistoryEntries = [...payload.sessions];

    if (!selectedArchiveSessionId && hostedHistoryEntries.length > 0) {
      selectedArchiveSessionId = hostedHistoryEntries[0].session.id;
    } else if (selectedArchiveSessionId && !hostedHistoryEntries.some((entry) => entry.session.id === selectedArchiveSessionId)) {
      selectedArchiveSessionId = hostedHistoryEntries[0]?.session.id ?? null;
    }

    renderArchiveList(hostedHistoryEntries);

    if (selectedArchiveSessionId) {
      await refreshArchiveSelection(selectedArchiveSessionId);
    } else {
      historyDetailRequestToken += 1;
      renderArchiveDetail(null);
    }
  } catch (error) {
    historyCount.textContent = "0";
    historyStatus.textContent = "None selected";
    historyListEl.innerHTML = '<li class="transcript-empty">Hosted history is unavailable right now.</li>';
    historyDetailEl.innerHTML = "<p>Unable to load hosted history from the API.</p>";
    console.warn(error);
  }
}

async function refreshArchiveSelection(sessionId: string) {
  const requestToken = historyDetailRequestToken + 1;
  historyDetailRequestToken = requestToken;

  try {
    const payload = await requestJsonFromBase<HostedHistoryDetailResponse>(
      hostedApiBaseUrl,
      `/history/sessions/${encodeURIComponent(sessionId)}`
    );
    if (historyDetailRequestToken !== requestToken || selectedArchiveSessionId !== sessionId) {
      return;
    }

    renderArchiveDetail(payload);
  } catch (error) {
    if (historyDetailRequestToken !== requestToken || selectedArchiveSessionId !== sessionId) {
      return;
    }

    historyStatus.textContent = sessionId;
    historyDetailEl.innerHTML = `<p>${escapeHtml(error instanceof Error ? error.message : "Unable to load hosted session detail.")}</p>`;
  }
}

function stopTranscriptPolling() {
  if (transcriptTimerId !== null) {
    window.clearInterval(transcriptTimerId);
    transcriptTimerId = null;
  }
}

function stopNotesPolling() {
  if (notesTimerId !== null) {
    window.clearInterval(notesTimerId);
    notesTimerId = null;
  }
}

function startTranscriptPolling() {
  stopTranscriptPolling();
  transcriptTimerId = window.setInterval(() => {
    if (currentSession?.status === "recording") {
      void refreshTranscript();
      return;
    }

    stopTranscriptPolling();
  }, 1500);
}

function startNotesPolling() {
  stopNotesPolling();
  notesTimerId = window.setInterval(() => {
    if (currentSession?.status === "recording") {
      void refreshLiveNotes();
      return;
    }

    stopNotesPolling();
  }, 1700);
}

sessionForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const requestedMode = captureModeInput.value as CaptureMode;
    selectedMode = requestedMode;
    const hostedSourceType = resolveHostedSourceType(requestedMode);

    if (!supportsHostedCapture(hostedSourceType)) {
      setMicStatus(
        requestedMode === "speakerphone"
          ? "MediaRecorder microphone capture is not supported in this browser."
          : "Display-audio capture is not supported in this browser."
      );
      renderError(
        requestedMode === "speakerphone"
          ? "This browser does not support hosted microphone capture."
          : "This browser does not support hosted display-audio capture."
      );
      return;
    }

    stopBrowserSpeechRecognition();
    transcriptRevision = 0;
    transcriptSegments = [];
    notesRevision = 0;
    hostedNotesRevision = 0;
    hostedSummaryRevision = 0;
    currentSummary = null;
    transcriptChunkCount.textContent = "0";
    transcriptRevisionDisplay.textContent = "0";
    transcriptUpdated.textContent = "Never";
    transcriptListEl.innerHTML = "";
    notesCount.textContent = "0";
    notesRevisionDisplay.textContent = "0";
    notesUpdated.textContent = "Never";
    notesListEl.innerHTML = "";
    stopTranscriptPolling();
    stopNotesPolling();
    await startHostedCapture(hostedSourceType);
    setMicStatus(`Hosted ${formatHostedCaptureSource(hostedSourceType)} is live. Transcript segments stream from the API.`);
  } catch (error) {
    if (hostedSession?.status === "failed" && currentSession?.id === hostedSession.id) {
      return;
    }
    renderError(error instanceof Error ? error.message : "Unable to start session");
  }
});

stopButton.addEventListener("click", async () => {
  if (!currentSession) {
    renderError("No active session to stop.");
    return;
  }

  const payload: StopSessionRequest = {
    sessionId: currentSession.id
  };

  try {
    const isHostedSession = Boolean(hostedSession && currentSession.id === hostedSession.id);

    if (isHostedSession) {
      const stoppedHostedSession = await stopHostedCapture();
      await handleHostedCaptureStopUi(stoppedHostedSession);
    } else {
      await flushBrowserSpeechRecognition();
      const response = await requestJson<SessionStopResponse>("/session/stop", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      renderSession(response.session);
      selectedArchiveSessionId = response.session.id;
      stopTranscriptPolling();
      stopNotesPolling();
      stopBrowserSpeechRecognition();
      void refreshMeetingHelper();
      void refreshExperimentalGoogleMeet();
      void refreshTranscript();
      void refreshLiveNotes();
      void refreshSummary();
      void refreshArchive();
      setMicStatus("Browser speech recognition stopped.");
    }
  } catch (error) {
    renderError(error instanceof Error ? error.message : "Unable to stop session");
  }
});

captureModeInput.addEventListener("change", () => {
  selectedMode = captureModeInput.value as CaptureMode;
  selectedModeDisplay.textContent = selectedMode;
  if (selectedMode !== "speakerphone") {
    setMicStatus("Hosted capture supports microphone, system audio, and meeting-helper sessions.");
  } else if (!currentSession) {
    setMicStatus("Waiting to start");
  }
});

runtimeSelectEl.addEventListener("change", () => {
  selectedRuntimeId = runtimeSelectEl.value as RuntimeId;
  selectedRuntimeDisplay.textContent = selectedRuntimeId || "unknown";
});

meetingSurface.addEventListener("change", () => {
  selectedMeetingSurface = meetingSurface.value as MeetingSurface;
  void saveMeetingHelperSelection(selectedMeetingSurface);
});

applyMeetingHelper.addEventListener("click", () => {
  void saveMeetingHelperSelection(selectedMeetingSurface);
});

meetingFallback.addEventListener("click", () => {
  selectedMeetingSurface = "browser-meeting";
  meetingSurface.value = selectedMeetingSurface;
  void saveMeetingHelperSelection(selectedMeetingSurface);
});

historySourceFilter.addEventListener("change", () => {
  void refreshArchive();
});

historyStatusFilter.addEventListener("change", () => {
  void refreshArchive();
});

historyQuery.addEventListener("input", () => {
  if (historyFilterTimerId !== null) {
    window.clearTimeout(historyFilterTimerId);
  }

  historyFilterTimerId = window.setTimeout(() => {
    historyFilterTimerId = null;
    void refreshArchive();
  }, 250);
});

saveExperimentalGoogleMeetButtonEl.addEventListener("click", () => {
  void saveExperimentalGoogleMeetSelection(experimentalGoogleMeetEnabled.checked);
});

refreshExperimentalGoogleMeetButtonEl.addEventListener("click", () => {
  void refreshExperimentalGoogleMeet();
});

saveRuntimeEl.addEventListener("click", async () => {
  const payload: UpdateRuntimeConfigRequest = {
    runtimeId: selectedRuntimeId as UpdateRuntimeConfigRequest["runtimeId"],
    language: DEFAULT_LANGUAGE,
    saveTranscript: saveTranscriptEl.checked,
    saveSummary: saveSummaryEl.checked
  };

  try {
    const response = await requestJson<UpdateRuntimeConfigResponse>("/config", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    renderRuntimeConfig(response.config);
  } catch (error) {
    renderError(error instanceof Error ? error.message : "Unable to save runtime config");
  }
});

selectedMode = captureModeInput.value as CaptureMode;
startButton.disabled = false;
runtimeSelectEl.disabled = true;
saveRuntimeEl.disabled = true;
syncElapsedTime(null);
resetHostedAudioUi();
renderHostedRoadmapPlaceholders();
initializeHostedOnlyDefaults();
void refreshHostedApiAvailability();
void refreshArchive();
