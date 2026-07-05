# TICKET-7 — Host controls (admin page: skip / remove / reorder / pause)

- **Date:** 2026-07-05 · **Product:** cantai · **Author:** Product Owner (TICKET-19 batch)
- **Wave:** 2 (after TICKET-6 merges — consumes its store ops; never edits the store)
- **Depends on:** TICKET-6 (store interface: `removeEntry`/`reorder`/`setPaused`). Blocks: TICKET-10 (mode switcher lives on this page).
- **Sizing:** M

## Goal

A venue can actually run a night: the host gets an admin page with skip, remove (with confirm), drag/button reorder, and pause — behind a minimal host auth. Without a kill switch for a 10-minute song or a no-show, cantai is a toy.

## Design source (build exactly this)

`work/design/design-handoff.md` §5 Admin (`work/design/mockups/admin.html`): queue panel reusing the `queue-row` component, per-row "remover" ghost-danger button with confirm dialog, ⏸ Pausar / ⏭ Pular secondary buttons, right column stat cards (queue count tonight, singers, active tables — simple counters) + join-link card. The mode-switcher cards shown in the mockup are **TICKET-10's scope** — render the section as a disabled/"em breve" placeholder here so #10 fills it without layout rework.

## Host auth (minimal, this ticket's call)

- **Admin token** model: a `HOST_TOKEN` env secret; the host opens `/admin`, enters the token once, it's stored in a cookie (httpOnly via a tiny `POST /api/host/login`), and all host API routes verify it server-side. Room-code-per-session auth arrives with rooms (TICKET-9 extends this to per-room host codes — keep the check in one helper `lib/host-auth.ts` so #9 swaps the lookup, not the call sites).
- Never ship the token to the client bundle; never log it (handle-secret rules).

## Scope — in

1. `/admin` page (desktop/tablet-first per design): live queue panel (poll like the other pages), now-playing block, controls.
2. Host API routes: `POST /api/host/login`, `POST /api/host/skip`, `POST /api/host/remove`, `POST /api/host/reorder`, `POST /api/host/pause` — all token-guarded, all thin wrappers over TICKET-6 store ops.
3. Pause semantics: `/tv` respects `isPaused` — player pauses and shows a subtle "pausado" state; patron submits still accepted while paused.
4. Skip semantics: advance regardless of video position (same store `advance` the TV uses); TV picks it up on next poll.
5. Stat cards from queue data (no new storage): entries tonight, distinct singers (uuids), distinct tables.
6. e2e: login → remove an entry → reorder → pause reflected on `/tv`.

## Scope — out

Mode switcher logic (TICKET-10), per-room host codes (TICKET-9), no-show grace flow (TICKET-10, needs the engine), analytics beyond the three counters (#16).

## File ownership (parallel-dev boundaries)

- **Owns:** `app/admin/**` (new), `app/api/host/**` (new), `components/host/**` (new), `lib/host-auth.ts` (new), `e2e/host-controls.spec.ts`, `.env.example` (append `HOST_TOKEN` line only).
- **Must not touch:** `lib/store.ts` / `lib/store/**` (interface frozen by #6 — if an op is missing, flag on the PR, don't add it), `app/page.tsx`, `app/tv/**` EXCEPT the read-only pause-state consumption (one small, clearly-scoped edit — coordinate if TICKET-18 is still open on `/tv`; if so, land pause-consumption after #18 merges).
- **Env note:** `HOST_TOKEN` value set by TM/TL in Vercel + local env; generate a strong random default for dev.

## Acceptance criteria

1. `/admin` without a valid token shows only the login gate; host APIs return 401 without the cookie.
2. Remove asks for confirmation and the entry disappears from patron + TV views within one poll cycle.
3. Reorder moves an entry up/down and all views converge on the new order.
4. Pause freezes TV playback with a visible paused state; unpause resumes; submits keep working while paused.
5. Skip advances even mid-video.
6. Token never appears in client JS, page source, or logs.
7. Mode-switcher area renders as an inert placeholder (no dead controls pretending to work).
