# TICKET-41 — TV player watchdog + embeddable-only search

- **Date:** 2026-07-08 · **Product:** boraoke · **Author:** Tech Manager (direct TL bug report: a song didn't play and the TV needed a hard refresh)
- **Depends on:** TICKET-18 merged (owns the reliability patterns that must survive). Parallel: TICKET-40 owns `components/SongSearch.tsx` + patron form + `/api/search` query augmentation — this ticket's search touch is FILTER params only, additive.
- **Sizing:** M

## Goal

The TV must NEVER require a human refresh mid-night. A bad/removed/embed-disabled video, a stalled player, or a bootstrap network blip must all self-heal: skip, recover, or recreate — automatically.

## Scope — in

### 1. Player watchdog on `/tv` (the core fix)

- **(a) Explicit `onError` handling.** IFrame API error codes 2/5/100 (bad/removed video) and 101/150 (embedding disabled) → brief pt-BR "pulando vídeo indisponível…" state → auto-advance the queue (server advance call) + telemetry via existing events only (`song_skipped` reason prop variant — NO new event types).
- **(b) Stall detection.** When state says a video SHOULD be playing, poll `getCurrentTime()`: no progress over a sane window (~10–15s; PAUSED-by-design and buffering-with-progress are benign) → escalate: seek/replay → `loadVideoById` again → destroy+recreate the player → after N failures auto-advance.
- **(c) Bootstrap resilience.** If the YT IFrame API script fails to load or the player never reaches ready (venue-wifi blip), retry creation with backoff instead of sitting dead.
- **(d) TICKET-18 reliability properties survive:** timer hygiene (exactly one outstanding timer per concern, cleared on unmount), no listener accumulation (player handlers attached once at creation), idempotent player effect. The opus review of PR #9 documented these patterns — keep them.

### 2. Embeddable-only search (the prevention)

- `/api/search`'s YouTube call: `videoEmbeddable=true` + `videoSyndicated=true` (both require `type=video` — verify present). Note: `videoEmbeddable=true` + `type=video` already shipped; this ticket adds `videoSyndicated=true` + tests locking all three.
- Paste-link entries can't be pre-filtered by search params — the watchdog's `onError` path covers them at play time. Optional pasted-id embeddability pre-check (videos.list `status`, 1 quota unit) + pt-BR patron warning: judged and documented in the plan (cost/benefit + TICKET-40 file-ownership collision).

### 3. Tests

- Unit: watchdog state machine extracted as a pure/testable module — error-code classification → actions, stall windows → escalation ladder, bootstrap backoff. Search param additions.
- e2e: simulate `onError` via the existing prototype-stub pattern (stub the YT player like the TICKET-18 fullscreen stub) asserting auto-advance fires.
- Full suite green.

## Scope — out

- Patron-facing paste-warning UI (patron form is TICKET-40's file; see plan for the deferral call).
- Host-auth on the advance endpoint (tracked separately since TICKET-1 security INFO).
- New telemetry event types (const-locked list stays as-is; only props variants).

## File ownership (parallel-dev boundaries)

- **Owns:** `app/tv/**`, `components/tv/**` (watchdog module lives here), `app/api/queue/advance/route.ts` (reason-prop addition), search FILTER params in `lib/youtube-search.ts` (additive, isolated), its unit/e2e tests, evidence.
- **Must not touch:** `components/SongSearch.tsx`, patron form, `/api/search` query augmentation (TICKET-40's lane). Overlap on the search lib noted in the PR for sequential merge.

## Acceptance criteria

1. An embed-disabled video (onError 101/150) on `/tv` shows the pt-BR skip notice and auto-advances without human action (e2e-proven via player stub).
2. Bad/removed videos (onError 2/5/100) behave identically.
3. A stalled player (no `getCurrentTime()` progress over the window while expected playing) walks the escalation ladder: replay → reload → recreate → advance; a PAUSED player or buffering-with-progress never triggers it (unit-proven).
4. If the IFrame API script fails to load or the player never reaches ready, creation retries with backoff — the TV never sits dead (unit-proven backoff schedule).
5. `/api/search` sends `videoEmbeddable=true`, `videoSyndicated=true`, `type=video` (test-locked).
6. Telemetry uses only existing event types; watchdog skips are observable (`song_skipped` reason variant).
7. TICKET-18 reliability properties intact: no timer/listener accumulation, idempotent player effect (review-checkable against the PR #9 patterns).
8. Full unit + e2e suite green; build green.
