# Voice-to-Text Summarizer

## What This Is

Voice-to-Text Summarizer is a web-first application with a desktop companion that listens to live conversations, transcribes them with open-source local models, and generates live notes plus a final summary without relying on paid LLM APIs. It is designed first for a solo professional who wants help during calls, speakerphone conversations, and desktop meetings. Google Meet support is part of the vision, but the dependable core experience is the local/web workflow.

## Core Value

Let the user stay fully present in a call while the product captures the conversation and turns it into useful notes and a clear summary for free.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Reliable live transcription for calls and desktop meetings
- [ ] Live notes during a session plus a polished final summary at the end
- [ ] Saved session history with transcripts and summaries
- [ ] Experimental Google Meet path that does not compromise the stable core product

### Out of Scope

- Native mobile app in v1 — mobile is a later expansion once the desktop/web flow is proven
- Team collaboration and shared workspaces — first release is optimized for a solo professional
- Enterprise compliance commitments — premature for initial validation
- Paid LLM API dependency — conflicts with the project's core cost constraint

## Context

This project starts as a greenfield repository with GSD planning enabled. The product direction is local-first intelligence with a web UI and desktop companion because browser-only inference and audio capture are too limiting for the required free/open-source workflow. The first release is English-first, saves history by default, and prioritizes a concise readable recap over CRM-style structured notes. A Google Meet assistant remains a parallel experimental track because real-time Meet participation and media capture are platform-constrained.

## Constraints

- **Budget**: No paid LLM APIs in v1 — the product must rely on open-source local inference or user-owned compute
- **Architecture**: Web app plus desktop companion — browser-only execution is insufficient for reliable local inference and audio capture
- **Audience**: Solo professional first — avoid team-oriented complexity in the initial milestone
- **Language**: English first — prioritize quality and latency before expanding language support
- **Persistence**: Session history saved by default — users want summaries available after calls
- **Integration**: Google Meet support is experimental — do not block v1 launch on true bot participation

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Web UI + desktop companion | Keeps the product web-first while allowing local audio capture and local model inference | — Pending |
| Open-source local STT + local small LLM summarization | Satisfies the no-paid-API requirement | — Pending |
| Live notes and final summary in v1 | The user explicitly wants usefulness during and after the call | — Pending |
| Save transcript and summary history by default | The user wants to revisit prior sessions later | — Pending |
| Google Meet as dual-track roadmap | Keeps the vision alive without making the main product depend on a risky integration path | — Pending |

---
*Last updated: 2026-03-30 after GSD project initialization*
