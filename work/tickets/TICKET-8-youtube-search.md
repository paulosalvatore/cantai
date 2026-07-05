# TICKET-8 — In-app YouTube search

- **Date:** 2026-07-05 · **Product:** cantai · **Author:** Product Owner (TICKET-19 batch)
- **Wave:** 1 (no cross-deps; launch at PR #4 merge) — **NEEDS-USER: YouTube Data API key (see below)**
- **Depends on:** TICKET-1 merged. Blocks: TICKET-9 (route restructure of the patron flow lands after this to avoid `app/page.tsx` collisions).
- **Sizing:** M

## Goal

Patrons type a song name and tap a result instead of hunting for a YouTube link in another app. Paste-a-link is patron friction #1; search-and-tap is table stakes for tipsy users on phones. Paste-link stays as the fallback path (quota outage resilience — an MVP requirement per the design handoff).

## Design source (build exactly this)

`work/design/design-handoff.md` §2 Song pick (`patron-02-pick-song.html`): one input with dual behavior (free text → search results; pasted URL → resolve directly), `song-row` results (64×48 thumbnail, ellipsized title, "channel · duration" meta), selected-state, skeleton loading rows, and the explicit quota-error state: "Busca indisponível — cola o link do YouTube".

## Scope — in

1. `GET /api/search?q=` server route calling YouTube Data API v3 `search.list` (+ `videos.list` for durations), **key server-side only** (env `YOUTUBE_API_KEY`), never sent to the client.
2. Quota hygiene: debounce client-side (400ms, min 3 chars); server-side per-uuid rate limit; cache identical queries briefly (in-memory LRU is fine — this is a read cache, not state; note interplay: serverless instance caches are best-effort, acceptable).
3. Result filtering: `videoEmbeddable=true`, `type=video`, `regionCode=BR` default, safeSearch moderate.
4. Patron pick UI per design: dual-behavior input, result list with selection, CTA enabled on selection, paste-link path preserved and surfaced in the error/quota state.
5. Graceful degradation: API key absent or quota exceeded → search UI hides/disables with the fallback copy; submit-by-link keeps working (this is also the local-dev/CI mode — no key needed to pass CI).
6. Unit tests: response mapping, quota-error handling; e2e: mocked search → select → submit.

## Scope — out

Search history/suggestions, karaoke-version preference boosts ("karaoke" query hinting MAY ship as a simple appended hint if trivial — dev's call, noted in report), multi-room routing (#9), telemetry counters (#12 instruments this).

## File ownership (parallel-dev boundaries)

- **Owns:** `app/api/search/**` (new), `lib/youtube-search.ts` (new), `components/SongSearch.tsx` (new), the song-pick section of `app/page.tsx` (sole wave-1 owner of this file), `__tests__/youtube-search*`, `e2e/search*`, `.env.example` (append `YOUTUBE_API_KEY` line only).
- **Must not touch:** `lib/store.ts` / `lib/store/**`, `app/tv/**`, `app/admin/**`, `lib/youtube.ts` parser (extend via new module, don't rewrite — the parser is the fallback path and is already tested).

## Needs-user (flag for W7 round — blocks the live feature, not the build)

**TL must provision a YouTube Data API v3 key** (Google Cloud console: enable YouTube Data API v3, create API key, restrict to the API + Vercel/server referrers) and hand it to the TM for Vercel env + local `.env`. Per TICKET-0 this was anticipated; the ticket is buildable and testable WITHOUT the key (mocks + degraded mode), so dev can start now and the key gates only the live-verification step.

## Acceptance criteria

1. Typing "evidências" shows tappable results with thumbnail/title/channel/duration; tapping one and submitting queues that videoId.
2. Pasting a YouTube URL still resolves directly without hitting the search API.
3. With no `YOUTUBE_API_KEY`, the app builds, tests pass, and the UI shows the fallback copy with paste-link functional.
4. The API key appears in zero client-delivered bytes (verify the bundle) and zero logs.
5. Search requests are debounced and rate-limited (6th rapid request per uuid rejected politely).
6. Quota-exceeded response from Google renders the designed degraded state, not a crash.
