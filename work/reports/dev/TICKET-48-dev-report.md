# TICKET-48 — Dev Report

**Status:** Implemented. Tests GREEN (467/467), `next build` exit 0. Delivered as an OPEN PR (NOT merged — merge auto-deploys to live boraoke.com).

## What changed & why

The host-login failure throttle (`lib/host-auth.ts`, used by `POST /api/host/login`) was an in-memory `Map` per process. On Vercel each lambda instance keeps its own map, so an attacker spraying host-token guesses across warm instances was not actually rate-limited cross-instance — the recorded PR #10 M-1 follow-up. This ticket makes the throttle cross-instance by backing it with Upstash Redis when Upstash is configured, preserving byte-identical behavior (and zero-secret boot) when it is not.

## Files (footprint exactly as scoped)

- **`lib/rate-limit-counter.ts`** (NEW) — reusable fixed-window per-key failure counter. Driver resolution mirrors `lib/store.ts`: Upstash present → Redis (`Redis.fromEnv()`, same construction as `lib/store/upstash.ts`); absent → the existing in-process Map/LRU logic. Public async API: `isThrottled(key, {max, windowMs})`, `registerFailure(key, {max, windowMs})`, `resetKey(key)`, and memory-only `_clearAll()` test helper. Redis keys namespaced `rl:<key>`; caller passes the full key (login passes `login:<ip>`), keeping the helper generic for the room-create/search follow-ups.
- **`lib/host-auth.ts`** — the three login-throttle functions now delegate to the helper and are async (`isLoginThrottled`/`registerLoginFailure`/`resetLoginThrottle` return Promises). `THROTTLE_MAX_FAILURES = 10`, `THROTTLE_WINDOW_MS = 60_000`, and `clientIpFrom` unchanged. `_clearLoginThrottle` retained (delegates to `_clearAll`, memory-only).
- **`app/api/host/login/route.ts`** — awaits the three throttle calls. Throttle check stays before body-parse.
- **`__tests__/rate-limit-counter.test.ts`** (NEW) — memory-path unit tests: max-failures gate, reset, window expiry, window-anchoring (fixed not sliding), LRU cap, key independence.
- **`__tests__/host-auth.test.ts`** — updated the throttle-helper tests to `await` the now-async functions.
- **`work/tickets/TICKET-48-login-throttle-upstash.md`** (NEW) — ticket spec.

`__tests__/host-api.test.ts` needed no change — it only imports `_clearLoginThrottle` (still sync).

## Redis pattern & key decisions

- **Fixed-window via INCR + EXPIRE-on-create:** `registerFailure` does `INCR rl:<key>` and, only when the counter is newly created (INCR returns 1), `EXPIRE rl:<key> ceil(windowMs/1000)`. INCR is atomic per key, so concurrent failures from different instances all land on ONE counter. The EXPIRE anchors the window at the first failure and the key self-expires (no cleanup pass). `isThrottled` reads with GET (absent → 0 → not throttled). `resetKey` DELs.
- **Fail-open on any Redis error:** every Redis call is wrapped in try/catch — on throw, `isThrottled` returns `false` and `registerFailure` no-ops. Availability over strict throttling: a blipped Redis must never lock out a legitimate host. Matches the codebase's fail-open telemetry ethos.
- **Memory path unchanged:** identical Map/LRU logic (1000-key cap, insertion-order eviction, per-window bucket) as the prior in-`host-auth` implementation, so dev/CI and zero-secret boot are byte-behavior unchanged. CI runs memory mode (no Upstash env), so the tested path is the one CI exercises — mirrors how the existing throttle tests avoid a real Redis.

## Verification

- `npm test` → **467 passed / 467 total**, 33 suites (baseline ~460). The `[advance-auth] would-block` console.warn lines in output are expected log-only telemetry from an unrelated route, not failures.
- `npm run build` → **exit 0**, "Compiled successfully".
- Did NOT run e2e (no UI change).

## Residual / follow-ups

- The **room-create throttle** (`lib/room-create-throttle.ts`) and the **search limiter** remain in-memory per-process — deliberately out of scope here. `lib/rate-limit-counter.ts` was built reusable so those tickets can adopt it (pass their own key + `{max, windowMs}`).

## Risks / edge-cases for a security reviewer

- **Fail-open behavior:** on a Redis outage the login throttle silently disappears (returns not-throttled). This is the intended availability tradeoff, but a reviewer should confirm it is acceptable that a sustained Redis outage removes the online-guessing cap. The HMAC/timing-safe token comparison and the LOCKED-in-production default remain intact regardless — the throttle is defense-in-depth, not the primary auth control.
- **INCR + EXPIRE atomicity / race window:** INCR and EXPIRE are two separate round-trips (not one MULTI). If a process crashes between `INCR`→1 and `EXPIRE`, the counter would have no TTL and persist until a later `resetKey` (successful login) or manual eviction — a stuck counter could over-throttle one IP indefinitely. This is the well-known cost of the two-command fixed-window pattern over the stateless REST transport (no atomic INCR-with-TTL without a Lua EVAL). Low likelihood; the impact is a single IP being throttled longer than intended (fails safe toward MORE throttling, not less), and a successful login clears it. A Lua EVAL variant (INCR + conditional PEXPIRE in one script, mirroring `store/upstash.ts`'s MERGE_SCRIPT) would close it if the reviewer deems it warranted — noted as a possible hardening follow-up rather than a blocker.
- **Key namespacing:** `rl:` prefix is collision-free with the queue (`room:<id>:queue`) and room (`room:<id>:meta`) keys. Login key is `login:<ip>` → full Redis key `rl:login:<ip>`.
- **`clientIpFrom` spoofing:** unchanged from prior behavior — trusts the platform proxy's first `x-forwarded-for` hop. An attacker rotating spoofed XFF values gets separate counters; the memory-path LRU cap (1000 keys) bounds heap, and the Redis path relies on per-key TTL to bound key growth. Same trust model as before this ticket.
