# Requirements: Voice-to-Text Summarizer

**Defined:** 2026-03-30
**Core Value:** Let the user stay fully present in a call while the product captures the conversation and turns it into useful notes and a clear summary for free.

## v1 Requirements

### Session Control

- [ ] **SESS-01**: User can start a new live capture session from the web app
- [ ] **SESS-02**: User can stop an active session from the web app
- [ ] **SESS-03**: User can see the current session state, elapsed time, and input mode during capture

### Audio Capture

- [ ] **AUD-01**: Desktop companion can capture audio for a speakerphone-style conversation
- [ ] **AUD-02**: Desktop companion can capture a desktop meeting-oriented audio source
- [ ] **AUD-03**: User can choose a capture mode before starting a session

### Transcription

- [ ] **TRNS-01**: User receives incremental transcript updates during an active session
- [ ] **TRNS-02**: Transcript segments are stored with timestamps
- [ ] **TRNS-03**: System can handle sessions of at least 60 minutes without losing transcript continuity

### Summaries

- [ ] **SUM-01**: User sees live notes generated during an active session
- [ ] **SUM-02**: User receives a final concise summary when a session ends
- [ ] **SUM-03**: Final summary includes an overview and key discussion points
- [ ] **SUM-04**: System can fall back to a simpler summarization path when local LLM performance is insufficient

### History

- [ ] **HIST-01**: Session transcript and final summary are saved by default
- [ ] **HIST-02**: User can view a list of prior sessions
- [ ] **HIST-03**: User can open a session detail view to review transcript and summary

### Settings

- [ ] **CONF-01**: User can choose English as the session language
- [ ] **CONF-02**: User can configure whether transcripts and summaries are saved
- [ ] **CONF-03**: User can view or select available local model/runtime options

### Meeting Support

- [ ] **MEET-01**: Product supports a stable meeting-helper workflow for desktop/browser meetings
- [ ] **MEET-02**: Experimental Google Meet support is isolated from the stable core workflow
- [ ] **MEET-03**: If Google Meet-specific functionality is unavailable, the user is directed to the supported fallback workflow

## v2 Requirements

### Mobile

- **MOB-01**: User can access the product through a mobile application
- **MOB-02**: Mobile app can capture and summarize calls on-device or through a paired runtime

### Collaboration

- **TEAM-01**: Multiple users can share access to meeting histories and summaries
- **TEAM-02**: Team members can collaborate on follow-ups and structured notes

### Language Expansion

- **LANG-01**: User can run sessions in multiple languages with acceptable transcript quality
- **LANG-02**: User can receive summaries localized to the session language

## Out of Scope

| Feature | Reason |
|---------|--------|
| Native Google Meet bot as a launch dependency | Too platform-constrained and risky for core v1 delivery |
| CRM integrations | Not required for the initial general-purpose recap workflow |
| Enterprise compliance tooling | Premature before product validation |
| Team collaboration features | First release is solo-user oriented |
| Mobile app implementation | Deferred until the web and desktop flow is proven |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SESS-01 | Phase 1 | Pending |
| SESS-02 | Phase 1 | Pending |
| SESS-03 | Phase 2 | Pending |
| AUD-01 | Phase 1 | Pending |
| AUD-02 | Phase 4 | Pending |
| AUD-03 | Phase 1 | Pending |
| TRNS-01 | Phase 2 | Pending |
| TRNS-02 | Phase 2 | Pending |
| TRNS-03 | Phase 2 | Pending |
| SUM-01 | Phase 3 | Pending |
| SUM-02 | Phase 3 | Pending |
| SUM-03 | Phase 3 | Pending |
| SUM-04 | Phase 3 | Pending |
| HIST-01 | Phase 3 | Pending |
| HIST-02 | Phase 3 | Pending |
| HIST-03 | Phase 3 | Pending |
| CONF-01 | Phase 1 | Pending |
| CONF-02 | Phase 3 | Pending |
| CONF-03 | Phase 1 | Pending |
| MEET-01 | Phase 4 | Pending |
| MEET-02 | Phase 5 | Pending |
| MEET-03 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0

---
*Requirements defined: 2026-03-30*
*Last updated: 2026-03-30 after GSD project initialization*
