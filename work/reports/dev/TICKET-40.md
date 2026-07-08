# TICKET-40 — Dev Report: patron search UX

Status: IMPLEMENTED — draft PR open, running local verification (unit green, build green, e2e pending)
Branch: `ticket/40-search-ux` · Worktree: `.worktrees/ticket-40` · App/e2e port: 3040
Repo: paulosalvatore/boraoke

## Scope delivered
1. **Select → jump to add-to-queue CTA** — after a result is picked or a pasted link resolves, the patron is scrolled to and the "Add to queue" button is focused (no auto-submit).
2. **Mode-aware search keyword** — sing mode appends `karaoke` to the query client-side; listen/dance searches raw; mode-switch re-runs the search; already-typed karaoke not doubled; pasted links never touched.
3. **Tests** — 15 unit tests for the augmentation logic; 2 new e2e tests (focus-jump + sing-mode karaoke query at the API-call level).

## Design decisions
- **Client-side query augmentation (vs server-side).** New `lib/search-query.ts#augmentQuery(query, mode)` runs in `SongSearch.runSearch` BEFORE calling `/api/search`. Rationale: the existing cache/rate-limit layer is keyed on the query string, so the augmented text becomes the cache key naturally — sing and listen searches for the same raw words land on distinct, coherent cache entries with ZERO server changes. Server-side would have forced the cache key to also include mode/keyword (cross-mode cache poisoning risk). Documented in the module header.
- **Mode switch after results shown → re-run the search.** `runSearch` now depends on `mode`, so changing the mode select recreates the callback and re-fires the debounced search effect with the newly-augmented query. Cheapest honest behavior: results always match the active mode (no stale-results flag needed).
- **Focus jump timing.** `onSongChosen` fires from `SongSearch` on both pick and paste-resolve; the parent defers the scroll+focus one `requestAnimationFrame` so the CTA (which only enables once `parsedVideoId` is set) has re-rendered. Uses `scrollIntoView({ block: "center", behavior: "smooth" })` (centers the CTA above the mobile keyboard fold) + `.focus({ preventScroll: true })` (no competing second scroll). Never auto-submits.
- **Already-contains-karaoke check is whole-word, case-insensitive** (`/\bkaraoke\b/i`). "karaokestar" still gets augmented (substring, not the word); the accented Portuguese "karaokê" is NOT treated as already-present (distinct string) — acceptable, the keyword we inject is the ASCII "karaoke" that YouTube search matches.

## Files touched
- `lib/search-query.ts` (new) — `augmentQuery`, `containsKaraoke`.
- `components/SongSearch.tsx` — new `mode` + `onSongChosen` props; augment query in `runSearch`; fire `onSongChosen` on pick + paste-resolve.
- `app/(patron)/[room]/PatronRoom.tsx` — pass `mode`/`onSongChosen`; `submitBtnRef`; `handleSongChosen` scroll+focus.
- `__tests__/search-query.test.ts` (new) — 15 unit tests.
- `e2e/search.spec.ts` — +2 e2e tests.
- `work/tickets/TICKET-40-search-ux.md` (new).

## Self-verification
- Unit: `npx jest` → **369 passed / 369 total, 25 suites** (baseline 354 + 15 new). SHA of impl commit recorded below.
- Build: `npx next build` → success (lint + typecheck + compile green).
- E2E: PORT=3040, pending — output appended below.
- `tsc --noEmit` shows pre-existing errors in `__tests__/*.test.ts` (jest globals not in app tsconfig) — NOT introduced here; the Next build (proper tsconfig) is green.

## Implementation log
- (SHA appended by commit skill) impl + tests + ticket + report.
