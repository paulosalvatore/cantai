# TICKET-48 — Host login throttle → Upstash-backed cross-instance limiter

- **Type:** security hardening
- **Severity:** LOW/MED
- **Origin:** PR #10 M-1 recorded follow-up ("Host login throttle → edge/Upstash-backed")

## Problem

`app/api/host/login/route.ts` throttles failed host-token logins per IP via an
in-memory `Map` in `lib/host-auth.ts`. On Vercel serverless each lambda instance
keeps its OWN map, so an attacker spraying token guesses across warm instances is
NOT actually capped cross-instance — the throttle is a per-process
attack-surface reduction, not a hard global limit.

## Fix (bounded — login throttle only)

Make the login-failure throttle cross-instance by backing it with Upstash Redis
WHEN Upstash is configured, while preserving the exact prior behavior (and
zero-secret boot) when it is not.

- New reusable helper `lib/rate-limit-counter.ts`: a fixed-window per-key failure
  counter with a driver resolution mirroring `lib/store.ts`. Upstash present →
  Redis (`Redis.fromEnv()`, standard `INCR` + `EXPIRE`-on-create fixed-window
  pattern); absent → the existing in-process Map/LRU logic. Public async API:
  `isThrottled`, `registerFailure`, `resetKey`, plus a memory-only `_clearAll`
  test helper.
  - **Fail-open** on any Redis error (availability over strict throttling — a
    Redis blip must never lock out a legitimate host). Matches the codebase's
    fail-open telemetry ethos.
  - In-memory LRU cap (1000 keys) still bounds heap on the memory path.
  - Redis keys namespaced `rl:<key>`; caller passes the full key so the helper is
    generic (login passes `login:<ip>`).
- `lib/host-auth.ts` login-throttle functions delegate to the helper and become
  async (`isLoginThrottled` / `registerLoginFailure` / `resetLoginThrottle`
  return Promises). `THROTTLE_MAX_FAILURES = 10`, `THROTTLE_WINDOW_MS = 60_000`,
  and `clientIpFrom` unchanged.
- `app/api/host/login/route.ts` awaits the three throttle calls.

## Scope guard

Room-create throttle (`lib/room-create-throttle.ts`) and the search limiter are
NOT migrated here — separate follow-ups. The helper is built reusable so they can
adopt it later.

## Deploy note

Delivered as an OPEN PR, not merged — any merge auto-deploys to live boraoke.com.
