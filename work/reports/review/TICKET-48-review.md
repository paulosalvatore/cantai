# TICKET-48 — Reviewer Report (D-022, Cyber folded in)

**Verdict: APPROVE-WITH-FOLLOWUPS** (no blockers; two optional hardening follow-ups)

Backend security-throttle change, NO UI → App Tester N/A, Cyber Security gate folded into this review.

## What I checked (verify, don't trust)

**Diff reviewed:** `git diff 80409e4..origin/ticket/48-login-throttle-upstash` — 8 files, +420/-57. Read locally from the worktree, zero GitHub API calls. Base = `merge-base(origin/main, origin/ticket/48-...)` = `80409e4`.

### 1. CI re-run independently (in the worktree)
- `npm test` → **467 passed / 467 total, 33 suites** (matches Dev report; the `[advance-auth] would-block` console.warn lines are expected log-only telemetry from an unrelated route). Observed, not trusted.
- `npm run build` → **exit 0**, "Compiled successfully". Observed.
- Note: `scripts/verify-green-local.sh` (framework md-doctor + shell-tests gate) does not exist in the cantai product repo — that gate is framework-only. The authoritative product CI is `.github/workflows/ci.yml` = jest + build, which I re-ran GREEN above.

### 2. Correctness
- **Callers of the async trio** — grepped the whole repo. Only caller outside `lib/host-auth.ts` is `app/api/host/login/route.ts`, and all three calls (`isLoginThrottled`, `registerLoginFailure`, `resetLoginThrottle`) are correctly `await`ed (lines 41, 66, 69). The throttle check stays BEFORE body-parse (cheap rejection). `_clearLoginThrottle` is still sync (delegates to sync `_clearAll`), so `host-api.test.ts` needs no change — confirmed.
- **Memory-path byte-equivalence** — compared `memIsThrottled`/`memRegisterFailure`/`memResetKey` in `rate-limit-counter.ts` against the prior in-`host-auth.ts` implementation at base `80409e4`. Identical: same `{count, windowStart}` bucket, same fixed-window anchor (`Date.now() - windowStart >= windowMs`), same 1000-key cap, same insertion-order (Map) eviction with the `delete`-then-`set` re-insert trick, same `>= max` gate. Behavior is byte-equivalent when Upstash is absent (dev/CI/zero-secret boot). ✔
- **Driver resolution** faithfully mirrors `lib/store.ts`: `STORE_DRIVER` explicit (`upstash`/`memory`) wins, else auto on `UPSTASH_REDIS_REST_URL` presence. Redis client is lazily built via `Redis.fromEnv()` (same construction as `lib/store/upstash.ts`), so the memory path never touches Upstash and the module imports with zero secrets. ✔
- **Redis fixed-window** — `INCR rl:<key>`; `EXPIRE` only when `count === 1` (window anchored at first failure, key self-expires, no cleanup pass). `isThrottled` GETs (absent → 0 → not throttled). `resetKey` DELs. `Math.max(1, ceil(windowMs/1000))` guards sub-second windows getting a ≥1s TTL. ✔
- **Tests** — `rate-limit-counter.test.ts` covers the max gate, reset, window expiry, fixed-vs-sliding anchoring, LRU cap, and key independence. `host-auth.test.ts` updated to `await` the now-async trio. Meaningful coverage of the memory path (the one CI exercises); Redis path is documented as integration/manual (acceptable — no live Upstash in CI).

### 3. Security lens (folded Cyber)
- **Fail-open on Redis error** — CORRECT and acceptable. Every Redis call is try/catch-wrapped; on throw `isThrottled`→false, `registerFailure`→no-op. The throttle is defense-in-depth only; the PRIMARY auth (`verifyHostToken`: HMAC-derived session value + `timingSafeHexEqual` constant-time compare + prod-locked default when `HOST_TOKEN` unset) is **untouched** by this diff (verified `host-auth.ts` lines 118–158 unchanged in substance). A Redis outage removes the online-guessing *cap* but never weakens the token check itself. Availability-over-strict-throttle is the right call for a venue-host login.
- **INCR+EXPIRE non-atomicity** — the two-round-trip window fails TOWARD over-throttling (a crash between INCR→1 and EXPIRE leaves a TTL-less counter that over-throttles ONE ip until the next successful login `resetKey` DELs it). Direction confirmed correct (fails safe, not open), bounded to a single IP, self-heals on success. A Lua `EVAL` (INCR + conditional PEXPIRE atomically, mirroring `store/upstash.ts`'s MERGE_SCRIPT) would close it — **optional follow-up, NOT a blocker** (low likelihood; bounded impact; already fails safe).
- **Key namespacing** — `rl:login:<ip>`. `rl:` prefix is collision-free with `room:*`/queue keys (verified prefix distinct). The only user-influenced key component is the IP from `clientIpFrom` (XFF first-hop / x-real-ip / "unknown") — no unsanitized body/query input reaches a Redis key. Room ids that DO reach keys elsewhere are gated by `isValidRoomId` (`roomIdFromRequest` returns null → 400 before any key use). Key growth is bounded: Redis path by per-key TTL, memory path by the 1000-key LRU cap.
- **No new leak/DoS** — token is never logged nor returned (route comment + code confirm); no secret/PII added; no new DoS surface (throttle check is cheap and pre-body-parse). `clientIpFrom` XFF-spoofing trust model is unchanged from before this ticket (same platform-proxy trust); spoofed-XFF rotation yields separate counters bounded by TTL/LRU as before — not a regression.

### 4. Scope / deploy-safety
- Footprint is exactly the 7 scoped files + the `work/events/2026-07.jsonl` auto-commit line: `lib/rate-limit-counter.ts` (new), `lib/host-auth.ts`, `app/api/host/login/route.ts`, `__tests__/rate-limit-counter.test.ts` (new), `__tests__/host-auth.test.ts`, `work/tickets/TICKET-48-...md` (new), `work/reports/dev/TICKET-48-dev-report.md`.
- Touches NONE of the open-PR-owned files (moderation / tv / rotation / advance-rate-limit) — grep confirmed empty. No collision risk.

## Follow-ups to record on the board (non-blocking)
1. **(optional, hardening)** Convert the Redis `registerFailure` to a single Lua `EVAL` (INCR + conditional PEXPIRE) to eliminate the TTL-less-counter race that can over-throttle one IP after a mid-operation crash. Mirror `lib/store/upstash.ts`'s MERGE_SCRIPT pattern.
2. **(optional, deferred by design)** Adopt `lib/rate-limit-counter.ts` for the still-in-memory `lib/room-create-throttle.ts` and the search limiter (Dev built the helper reusable for exactly this).

## Coherence
Dev report matches the diff exactly (files, Redis pattern, fail-open direction, follow-ups). No divergence between plan and implementation.
