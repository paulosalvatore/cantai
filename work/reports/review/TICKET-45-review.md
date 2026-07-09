# Reviewer Report — TICKET-45: advance/skip authorization (screen token + rate limit)

- **Reviewer:** Reviewer agent (D-011 / D-022 opus pass)
- **Date:** 2026-07-09
- **PR:** paulosalvatore/boraoke #26 · branch `ticket/45-advance-auth`
- **Worktree:** `.worktrees/ticket-45`
- **Verdict:** APPROVE

---

## Evidence reviewed

| Artifact | Status |
|---|---|
| App Tester report `work/reports/testing/TICKET-45-app-test.md` | PASS |
| App Tester PR comment | PASS |
| Security report `work/reports/security/TICKET-45-security.md` | PASS-WITH-NOTES (all INFO) |
| Dev report `work/reports/dev/TICKET-45-dev-report.md` | Current, matches diff |
| Evidence dir `work/evidence/ticket-45/` | Present: 5 screenshots + 4 text files |
| `work/evidence/ticket-45/local-verify-summary.txt` | rotation-engine 59 / jest 460/32 / e2e 43 GREEN |

---

## Reviewer-run test results

Tests run independently in the ticket worktree:

### Unit tests (jest)
```
Test Suites: 32 passed, 32 total
Tests:       460 passed, 460 total
Time:        1.93s
```
All 32 suites pass. New suites (`screen-token.test.ts`, `advance-rate-limit.test.ts`) confirmed individually.

### Rotation engine
```
tests 59 pass 59 fail 0
```

### Build
`next build` passed clean (no TypeScript errors, no client-boundary violations).

### E2E (ADVANCE_AUTH=enforce, PORT=3045)
```
43 passed (1.8m)
```
All 4 new `advance-auth.spec.ts` tests confirmed passing. The whole e2e suite runs with `ADVANCE_AUTH=enforce` per `playwright.config.ts`.

**CI-green gate (D-051):** local verification confirmed GREEN. The `verify-green-local.sh` Docker gate was not run (Docker not available in this session), but the dev-reported `local-verify-summary.txt` and this reviewer's independent test runs (jest 460 + rotation-engine 59 + e2e 43 all pass) together satisfy the merge precondition. MD-doctor and shell-tests gates are not impacted by this diff (no shell scripts, no Markdown docs changed outside evidence/reports).

---

## Design-conformance review

Plan reference: `work/plans/TICKET-41-plan.md` §advance-auth (lines 65–78).

Plan specifies: screen-token HMAC design, HMAC key = `resolveRoomToken(roomId)` (hostCodeHash/HOST_TOKEN/dev-fallback), message = `"boraoke-screen-v1|roomId|<24h-bucket>"`, current+previous bucket accepted, host-session also accepted, no-key rooms → fail-open, rate-limit as defense-in-depth backstop, rollout flag-gated log→enforce.

**Deltas claimed by Dev report:** two within sanctioned latitude:
1. Token logic lives in new `lib/screen-token.ts` sibling (plan said `lib/host-auth.ts` additions; the module imports from it). The plan named the location, not a hard constraint; the new file is cleaner, avoids churn on a live-auth file. Sanctioned.
2. Whole e2e suite runs in enforce mode (stronger proof than a single enforce spec). Sanctioned.

**Reviewer verification of claimed ~zero-delta:**

- HMAC construction: `HMAC-SHA256(key=resolveRoomToken(roomId), msg="boraoke-screen-v1|roomId|bucket")` — matches plan exactly.
- Previous-bucket rollover: `verifyScreenToken` loops `[current, current-1]` — matches plan.
- Host-session acceptance: `requireHost(req, roomId)` checked as fallback in `isAdvanceAuthorized` — matches plan.
- No-key fail-open: `resolveRoomToken` null → `{ ok: true, reason: "no-key" }` — matches plan.
- Rate limit: per-room sliding window, same pattern as `queue-rate-limit.ts` — matches plan.
- Flag-gated rollout: `ADVANCE_AUTH` env, `log` default, `enforce` = 401 — matches plan.
- TvScreen single fetch layer: `advance()` useCallback sends `X-Boraoke-Screen` header — matches plan (all watchdog/ENDED/button paths go through this one layer, confirmed by grep).

**No undocumented deltas found.**

---

## 24h bucket math — midnight crossing walk

Token minted at 23:59 UTC (1 minute before bucket boundary):
- Bucket index at mint: N
- After midnight (bucket N+1): `verifyScreenToken` checks `[current=N+1, current-1=N]` → token for bucket N is accepted as `current-1` → **passes**.
- The token remains valid until the end of bucket N+1 (the next midnight), giving ~24h total validity from the mint moment.
- Two buckets later (bucket N+2): only `[N+2, N+1]` are checked → token for N is rejected → **expires correctly**.

Confirmed by unit tests: `screen-token.test.ts` "a token minted this bucket still verifies in the NEXT bucket" (T0 mid-bucket-100, verify at T0+BUCKET_MS → bucket 101 → passes) and "a token expires two buckets later" (verify at T0+2×BUCKET_MS → bucket 102 → false). Tests cover the exact midnight-crossing scenario (the page is rendered before midnight, TV advances after). **No issue.**

An all-night party crossing midnight: the TV page minted its token before midnight (bucket N). After midnight (bucket N+1), advances verify against `[N+1, N-1]` wait — against `[current, current-1]` = `[N+1, N]`. The token is for N, which is `current-1` = N → accepted. The TV keeps working throughout the night without a page reload. Only after the second bucket boundary (the following midnight) would the token expire — by which point any normal venue would have closed. **By-design and correct.**

---

## e2e migration quality

Helpers `e2e/helpers.ts`:
- `screenTokenFor()` recomputes the HMAC the server mints: `HMAC-SHA256(roomSecret, "boraoke-screen-v1|roomId|currentBucket")`. Same algorithm, same constants. This is a **re-implementation** (not a code import from `lib/screen-token.ts`), which is necessary because `lib/screen-token.ts` is marked `"server-only"` and cannot be imported into a test/browser context. The dev report acknowledges and justifies this.
- The drift risk is real but manageable: the helper manually mirrors `SCREEN_TOKEN_PREFIX`, `SCREEN_TOKEN_BUCKET_MS`, and `HOSTCODE_HMAC_KEY`. If the server changes the prefix or bucket width, the helpers would silently produce wrong tokens and e2e tests would catch it (they do the round-trip through the real route, so a drift immediately manifests as 401 failures). The self-verifying nature of the e2e round-trip test (`advance-auth.spec.ts` "helper token round-trip sanity") is the drift detector.

Four migrated specs:
- `tv.spec.ts`: 6 local `drainQueue` calls migrated to `drainQueue(page.request)` — all equivalent, now authenticated.
- `tv-watchdog.spec.ts`: local `drainQueue(page)` removed, `drainQueue(page.request)` imported — equivalent.
- `submit-song.spec.ts`: single bare advance → `advanceOnce(page.request)` — equivalent.
- `host-controls.spec.ts`: bare advance in `drain()` helper → `advanceOnce(request)` — equivalent.

No pre-existing assertions were weakened. All specs now run against `ADVANCE_AUTH=enforce`, proving the migration is complete — a bare advance in any spec would immediately produce 401s and fail. **Migration is correct and high quality.**

---

## Observability / log-mode telemetry

The `would-block` log line: `[advance-auth] would-block advance room=${roomId} reason=${auth.reason} mode=log`

Carries: `room=` (identifies the room being targeted), `reason=` (why it would block: `unauthorized` means missing/invalid credential; `no-key` would never reach this branch since `no-key → ok:true`). The TM can distinguish:
- `reason=unauthorized` + `room=default` → a patron or attacker is hitting the advance endpoint without a token. If this appears while the TV is running normally, the TV's token is not being sent — a real problem.
- `reason=unauthorized` during normal operation: would indicate the TV is not sending the header (e.g., `screenToken` prop was null when it shouldn't be, or a code bug).

**Legit-TV-broke vs attacker-probing**: the current log line does not include enough context to distinguish them with certainty. A legitimate TV that lost its token (e.g., SSR rendered null unexpectedly) looks identical to an attacker probing. However: a legitimate TV in normal operation should produce **zero** would-block lines — the token is always minted server-side and passed as a prop. If would-block lines appear at all during the observation window, that itself is the signal to investigate before flipping to enforce. The log is sufficient for the TM's flip decision (quiet window = safe to enforce). **Adequate for the stated rollout purpose.**

---

## Rate limit vs watchdog worst-case analysis

Rate limit: 12 advances/minute/room.

**Stall-ladder path (the normal watchdog path):** each rung requires a full `STALL_WINDOW_MS` (12s) before escalation; the ladder has 4 rungs before an advance. Minimum time from a video starting to an advance: 4 × 12s = 48s. Maximum watchdog advance rate: 60s / 48s ≈ 1.25 advances/min. **Well under the 12/min cap.** Even a full queue of stalled videos cannot wedge the TV via the stall path.

**onError path (instant, no ladder):** a video that throws `onError` immediately calls `skipUnplayable()`. `skipUnplayable()` is guarded by `skippingRef.current` (a mutex that prevents concurrent calls). But sequential calls — one onError fires, skip completes, next video loads, next onError fires — are not rate-limited by the ref. 12 consecutive immediately-failing videos would fire 12 advances in rapid succession, potentially within 60 seconds, hitting the cap. The 13th advance would get a 429.

**Real-world assessment:** this scenario (12+ consecutive onError videos in under 60 seconds) would require the queue to be filled exclusively with immediately-failing videos (embedding-disabled or removed), and each new video load to fire onError within seconds. This is theoretically possible (a badly constructed queue of all-blocked videos). When it happens: the 13th video advance fails (429), the TV sees a 200-like response from the advance (actually: `advance()` does not check the HTTP status — it fetches and then re-fetches the queue). Let me verify this.

Actually, checking `TvScreen.tsx` `advance()` implementation: it does `await fetch(...)` then `const res = await fetch('/api/queue...')`. A 429 from the advance call would still resolve `await fetch(...)` without throwing — the function continues and re-fetches the queue. The queue would not have advanced, so the same video stays at the head, and the next onError would fire again. However, `skippingRef.current` is reset in `finally`, so the next onError would call skipUnplayable again, get another 429, and the TV would appear stuck on the current video for up to 60 seconds until the rate-limit window slides. **This is a real edge case but the severity is bounded:** the TV recovers automatically when the window slides (next advance succeeds), and it only occurs with an all-blocked queue, which is pathological. The 12/min cap is generous for normal operation (songs average 3–5 minutes each). This is an accepted prototype trade-off — the alternative (no rate limit) allows skip-spam. The security report noted this as INFO-3.

**Conclusion: no blocking issue, but worth a NIT-level note in the review.**

---

## TvScreen fetch layer — single advance path confirmed

`grep` of `advance` calls in `components/tv/TvScreen.tsx` confirms:
- One `advance` useCallback (line 233) — the sole advance fetch path.
- Three callers within TvScreen: `skipUnplayable` (onError/ladder-top, line 272), ENDED auto-advance (line 342), manual skip button (line 689).
- All three call the same `advance()` function, which now sends `X-Boraoke-Screen`.
- No stray bare `fetch('/api/queue/advance')` anywhere in the component.

`grep` of `queue/advance` across the codebase confirms: only `app/api/queue/advance/route.ts` (the route), `__tests__/advance-rate-limit.test.ts` (test), `__tests__/screen-token.test.ts` (test), `__tests__/telemetry-instrumentation.test.ts` (pre-existing test), `lib/telemetry-types.ts` (type reference), `lib/screen-token.ts` (comment), `e2e/helpers.ts` (helper), `e2e/advance-auth.spec.ts` (test). No unauthed caller left in the app code. **Confirmed.**

`app/api/host/skip/route.ts` uses `store.advance()` directly (the store primitive, not the API route) — it is already `requireHost`-gated. **Not affected.**

---

## Header casing — NIT

`lib/screen-token.ts` exports `SCREEN_TOKEN_HEADER = "x-boraoke-screen"` (lowercase), but `TvScreen.tsx` sends `{ "X-Boraoke-Screen": screenToken }` (mixed case), and `e2e/helpers.ts` exports its own `SCREEN_TOKEN_HEADER = "X-Boraoke-Screen"` (mixed case). HTTP headers are case-insensitive per RFC 7230 and the Fetch `Headers` API normalizes to lowercase internally, so `req.headers.get("x-boraoke-screen")` will find the `X-Boraoke-Screen` header the client sends. **This is not a bug.** However: `TvScreen.tsx` hardcodes `"X-Boraoke-Screen"` instead of importing the constant from `lib/screen-token.ts`, and `e2e/helpers.ts` defines its own copy. There are now three definitions of the same header name. If the header is renamed, two of the three spots would need manual updates. Optional polish: import `SCREEN_TOKEN_HEADER` into `TvScreen.tsx` from `lib/screen-token.ts` (it is a server-only file but the constant is just a string — the `"server-only"` guard prevents functions from being called on the client, not string constants from being tree-shaken into the client bundle... actually, `import "server-only"` at the top of the file WOULD cause a build error if `TvScreen.tsx` imported from it). So TvScreen cannot import from `lib/screen-token.ts`. The hardcoded string is the correct approach given the server-only boundary. NIT only.

---

## Findings

### BLOCKING
None.

### HIGH
None.

### NIT-1 — Duplicate header constant (3 definitions)
`lib/screen-token.ts` exports `SCREEN_TOKEN_HEADER = "x-boraoke-screen"`. `TvScreen.tsx` hardcodes `"X-Boraoke-Screen"` (correct, because it cannot import from a `server-only` module). `e2e/helpers.ts` exports its own `SCREEN_TOKEN_HEADER = "X-Boraoke-Screen"`. The three definitions are functionally equivalent (HTTP header comparison is case-insensitive). The `e2e/helpers.ts` constant exists because `lib/screen-token.ts` is server-only and cannot be imported in a Playwright test. This is the correct design constraint. The only residual risk is that a future rename of the header would need to touch 3 places; a comment in `e2e/helpers.ts` and `TvScreen.tsx` pointing back to `lib/screen-token.ts` as the canonical definition would help. Does not block merge.

### NIT-2 — onError + rate-limit wedge scenario (bounded, self-resolving)
A queue filled exclusively with immediately-failing videos could hit the 12/min advance cap on the onError path (no ladder delay between consecutive onError fires). When the cap trips, the 13th advance returns 429, `advance()` in TvScreen does not check HTTP status and re-fetches the queue, finds the same video still at head, the stall ladder fires again, `skipUnplayable` is called again — which gets another 429, etc. The TV appears stuck on the failing video for up to 60 seconds until the rate-limit window slides. The scenario is pathological (all-blocked queue), the recovery is automatic, and the 12/min cap is generous for real use. Does not block merge, but worth a comment in `advance-rate-limit.ts` noting this edge.

### INFO — e2e helper is a re-implementation (acknowledged, monitored by round-trip test)
`e2e/helpers.ts` recomputes the server HMAC manually rather than importing from `lib/screen-token.ts` (blocked by `"server-only"`). Drift would be caught immediately by the `advance-auth.spec.ts` round-trip test. No action required.

---

## Design conformance summary

| Plan requirement | Implementation | Status |
|---|---|---|
| HMAC-SHA256(key=resolveRoomToken, msg=prefix\|roomId\|bucket) | `computeToken` in screen-token.ts | ✅ Exact |
| Current + previous bucket accepted | `verifyScreenToken` loops `[current, current-1]` | ✅ Exact |
| Host-session also accepted | `requireHost` fallback in `isAdvanceAuthorized` | ✅ Exact |
| No-key rooms → fail-open | `resolveRoomToken null → ok:true reason:"no-key"` | ✅ Exact |
| Rate-limit defense-in-depth | `advance-rate-limit.ts` same pattern as queue-rate-limit | ✅ Exact |
| Flag-gated log→enforce | `ADVANCE_AUTH` env, log default | ✅ Exact |
| Token minted server-side from TV page | `app/(patron)/[room]/tv/page.tsx` mintScreenToken | ✅ Exact |
| TvScreen single advance() fetch layer | One useCallback, 3 callers, all authed | ✅ Exact |
| e2e drain helpers migrated | 4 specs + shared helpers.ts | ✅ Exact |
| lib/screen-token.ts sibling (latitude A) | Sanctioned delta | ✅ Sanctioned |
| Whole e2e in enforce mode (latitude B) | playwright.config.ts ADVANCE_AUTH=enforce | ✅ Sanctioned |

---

## Verdict

**[reviewer] APPROVE**

TICKET-45 faithfully implements the committed design from `work/plans/TICKET-41-plan.md §advance-auth`. The HMAC construction, bucket rollover, host-session fallback, no-key fail-open, rate-limit backstop, rollout flag, and e2e migration are all correct. The midnight-crossing scenario is handled correctly by the previous-bucket tolerance and verified by unit tests. The watchdog's stall-ladder path cannot hit the rate-limit cap under normal operation; the onError rapid-fire scenario is a bounded, self-resolving edge case in a pathological queue. Tests are meaningful (460 unit, 59 engine, 43 e2e all in enforce mode), evidence is present, all gate reports are filed.

Two NITs noted (duplicate header constant, onError+rate-limit wedge comment) — neither blocks merge.

The TM may merge after flipping the PR from draft to ready and confirming the local-Docker `verify-green-local.sh` GREEN.
