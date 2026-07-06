# Review Report — TICKET-8: In-app YouTube Search

**Reviewer:** claude (Reviewer agent, sonnet pass)
**Date:** 2026-07-05
**PR:** #8 — paulosalvatore/cantai, branch `ticket/8-youtube-search`
**Verdict:** APPROVE

---

## Evidence Consulted

| Gate | Artifact | Status |
|---|---|---|
| App Tester | `work/reports/testing/TICKET-8-app-test.md` on branch | PASS |
| App Tester screenshots | `work/evidence/ticket-8/` — 7 PNGs on branch | Present |
| Security | `work/reports/security/TICKET-8-security.md` on branch | PASS-WITH-NOTES |
| Security follow-up | PR comment + commit bf17cd7 (+10 tests, 81/81) | All 3 findings fixed |
| Dev report | `work/reports/dev/TICKET-8-dev-report.md` on branch | Current (post-sec-gate state) |
| CI | `gh pr checks 8` — Vercel pass, Vercel Preview Comments pass | Green |

---

## Tests Run (Reviewer-verified)

```
npm test (ticket-8 worktree):
  Test Suites: 5 passed, 5 total
  Tests:       81 passed, 81 total
  Time:        0.329s

npx playwright test PORT=3008 (ticket-8 worktree):
  3 passed (8.2s)
  ✓ e2e/submit-song.spec.ts › patron submits a song and it appears in the queue
  ✓ e2e/search.spec.ts › search → select a result → submit queues the picked video
  ✓ e2e/search.spec.ts › degraded search shows fallback copy but paste-link still works

npm run build:
  ✓ Compiled successfully
  Routes: ○ /, ○ /tv, ƒ /api/queue, ƒ /api/queue/advance, ƒ /api/search

Bundle safety:
  grep -rE "YOUTUBE_API_KEY|googleapis.com/youtube" .next/static → CLEAN (no matches)
```

---

## Code Review

### lib/youtube-search.ts

Quality is high. Key findings:

- **Duration formatter** (`formatISODuration`): handles hours, minutes, seconds, minutes-only, seconds-only, null/undefined/garbage correctly. `PT0S` returns "0:00" (live streams) — acceptable for MVP.
- **`mapSearchResponse`**: correctly fuses `search.list` + `videos.list` payloads in `search.list` order, drops items without `videoId` (channel results), HTML-entity-decodes titles/channelTitle.
- **`searchYouTube`**: injectable `fetchImpl` keeps tests isolated. URL construction is correct — `type=video`, `videoEmbeddable=true`, `safeSearch=moderate`, `regionCode=BR`, `maxResults=8`, key never hardcoded. `videos.list` failure is non-fatal (returns results without durations); quota error on `videos.list` also throws `YouTubeQuotaError`.
- **Typed error taxonomy**: `YouTubeQuotaError` (403 `quotaExceeded`/`dailyLimitExceeded`) and `YouTubeSearchError` (other non-OK) — the route's `catch` handles all three cases (quota, known error, runtime), mapping each to a non-throwing `degraded` response. Exhaustive.
- **LRU query cache**: `getCached` does a delete+re-set on hit to move to Map tail (correct insertion-order LRU). `setCached` evicts while `size > CACHE_MAX` (100). TTL is checked at read time; stale entries evicted on access.
- **Rate limiter (dual-bucket)**: `rateLimitOk(uuid, ip)` evaluates AND charges **both** buckets every call, even when the uuid bucket already tripped. This is the correct implementation — a rotator accumulates IP-bucket charges on every rejected attempt, preventing the rotation bypass. UUID-only mode (`ip=""`) applies only when no IP is extractable (local dev without a proxy). Sliding-window arithmetic is correct (`filter t > now - RATE_WINDOW_MS` before checking `>= max`). LRU bucket eviction mirrors the query cache pattern.

### app/api/search/route.ts

Validation order: uuid → query length → rate limit → key check → cache → API. Correct sequencing — invalid queries don't consume rate budget; malformed UUIDs don't touch server state.

`clientIp()`: first hop of `x-forwarded-for`, falls back to `x-real-ip`, falls back to `""`. Spoofability: on Vercel the edge normalizes the header (trustworthy); in bare local dev the header is absent, so `ip=""` and only the uuid bucket applies. Acceptable for this deployment context; the code comment documents the tradeoff explicitly.

Degraded contract: no key → `200 { degraded:true, reason:"no-api-key" }`; quota → `200 { degraded:true, reason:"quota" }`; any other error → `200 { degraded:true, reason:"error" }`. Never 5xx to the patron. Verified.

### components/SongSearch.tsx

State machine is correct:
- Empty → reset all state, `onSelect(null)`
- Pasted YouTube URL/ID → resolved via `parseYouTubeVideoId`, auto-selected, no API call (AC2 satisfied)
- Text < 3 chars → no results, no search, `onSelect(null)`
- Text ≥ 3 chars → debounce 400ms → `runSearch`
- Degraded API response → show fallback copy; paste-link path unaffected (local resolution)
- 429 → show pt-BR rate-limit message
- Results → tappable rows with selection state

Sequence guard (`seqRef.current`) prevents stale responses from overwriting a newer query's results. `finally` block correctly runs `setLoading(false)` even on the 429 early-return path.

A11y basics: `htmlFor`/`id` pair on label+input, `aria-label` on input, `aria-pressed` on result buttons, `role="status"` on degraded and rate-limit notices, thumbnail `alt=""` (decorative). Adequate for the MVP.

### app/page.tsx

Changes are scoped to the form section only. Queue polling (`fetchQueue`, `POLL_INTERVAL`, the `useEffect` that drives it) is untouched. `handleSelect` is a stable `useCallback` reference. `searchKey` bump on submit correctly remounts `SongSearch` and clears its input/results. Title auto-prefill from a search result only when the title field is empty — good UX hygiene.

### e2e/submit-song.spec.ts

Update is legitimate, not a weakening. Old test targeted `getByLabel("YouTube URL")` + `getByText(/Video ID:/)` — that field and copy no longer exist. New test targets `getByLabel(/Buscar música/i)` + `getByText(/Selected:/)` — same intent (paste link → confirm → submit → queue). Assertions are equivalent in strength.

---

## Rebase Surface Assessment

TICKET-6 (persistence) merged into main after this branch was cut. Files touched by TICKET-6 that overlap with TICKET-8's scope:

| File | TICKET-6 change | TICKET-8 change | Merge outcome |
|---|---|---|---|
| `app/api/queue/route.ts` | Refactored to async store API | Not touched | **Clean** — main version preserved automatically |
| `app/api/queue/advance/route.ts` | Refactored to async store API | Not touched | **Clean** — main version preserved |
| `lib/store.ts` et al. | Created async store interface | Not touched | **Clean** — main version preserved |
| `.env.example` | Created with Redis vars | Created with `YOUTUBE_API_KEY=` line | **CONFLICT** — both branches created the file |
| `work/events/2026-07.jsonl` | Appended entries | Appended entries | **CONFLICT** — trivially resolved by keeping all lines |
| `app/page.tsx` | Not touched | Modified (SongSearch integration) | **Clean** |

**Semantic conflicts:** None. The patron page's queue polling (`fetch('/api/queue')`) contracts with `{ items, nowPlaying }` — TICKET-6 changed the server implementation to async store but kept that contract. TICKET-8's page.tsx changes are purely in the form section and don't interact with the polling.

**TM action required on merge:** Resolve `.env.example` by appending TICKET-8's `YOUTUBE_API_KEY=` section to TICKET-6's content (straightforward concatenation). `work/events/2026-07.jsonl` resolves by keeping all lines from both branches.

---

## Acceptance Criteria

| AC | Status | Evidence |
|---|---|---|
| 1. Search shows tappable results (thumb/title/channel/duration); tap + submit queues videoId | PASS | e2e `search.spec.ts › search → select → submit` |
| 2. Pasting a YouTube URL resolves locally without hitting the search API | PASS | Component path (`parseYouTubeVideoId` before any fetch); e2e degraded test pastes URL when API is degraded |
| 3. No key → build passes, tests pass, fallback copy + paste-link work | PASS | `npm test` 81/81 with no key; build clean; e2e degraded test |
| 4. Key in zero client bytes / zero logs | PASS | Bundle grep clean; key read server-side only in route |
| 5. Debounced (400ms / 3-char) + rate-limited (6th rapid req/uuid → 429) | PASS | 81 unit tests (rate-limiter suite + route validation suite) |
| 6. Quota-exceeded renders degraded state, not a crash | PASS | Unit tests map 403 quotaExceeded → `YouTubeQuotaError` → degraded; e2e degraded path |

---

## Security Gate Notes

All 3 findings from Cyber Security PASS-WITH-NOTES are fixed in commit `bf17cd7`:

- **MEDIUM #1 (uuid-rotation bypass):** Dual-bucket rate limit — per-uuid (5/10s) AND per-IP (30/10s); IP bucket charged even when uuid bucket trips. Correct implementation verified in code and 10 new tests.
- **MEDIUM #2 (unbounded hits Map):** LRU cap at 2000 buckets; oldest-touched evicted first. Correct implementation mirroring the query cache pattern.
- **LOW #3 (uuid length):** Strict UUID-shape regex (36-char) before any map use; `anon` also accepted; anything else → 400. Verified in uuid validation suite.

---

## Nits (optional, non-blocking)

1. `formatISODuration("PT0S")` → "0:00". Google returns "PT0S" for live streams; the "0:00" display is slightly misleading. Acceptable for MVP; consider filtering "0:00" to "" in a future iteration.
2. `pickThumbnail` prefers `medium` (320×180) for a 64×48 display slot — correct for HiDPI/Retina but the larger image is fetched. Low impact; fine for MVP.
3. The `eslint-disable-next-line @next/next/no-img-element` on the thumbnail is expected given dynamic YouTube URLs that can't be enumerated for `next/image` optimization. Fine.

---

## Verdict

**APPROVE.**

Implementation matches the ticket and plan. All acceptance criteria met. 81/81 unit tests + 3/3 e2e pass (reviewer-verified). Build clean. Bundle safety confirmed. Security findings all addressed with test coverage. Code quality is high: rate limiter logic is correct, cache is correct, degraded contract is correct, state machine is clean.

**Merge precondition:** TM must resolve the `.env.example` merge conflict before/during the GitHub merge (append TICKET-8's `YOUTUBE_API_KEY=` section to TICKET-6's Redis-vars content). Trivial two-line fix, not a code defect.
