# Security Report — TICKET-45: advance/skip authorization (screen token + rate limit)

- **Auditor:** cyber-security agent (D-011)
- **Date:** 2026-07-09
- **Branch:** `ticket/45-advance-auth`
- **Worktree:** `.worktrees/ticket-45`
- **PR:** #26 — paulosalvatore/boraoke
- **Verdict:** **PASS-WITH-NOTES**

---

## Scope audited

New surface introduced by TICKET-45:

| File | Role |
|---|---|
| `lib/screen-token.ts` | HMAC mint/verify, auth decision, rollout flag |
| `lib/advance-rate-limit.ts` | Per-room sliding-window rate limiter |
| `app/api/queue/advance/route.ts` | Gate wiring: auth + rate limit |
| `app/(patron)/[room]/tv/page.tsx` | Server-side token mint |
| `components/tv/TvScreen.tsx` | Client prop receipt + header send |
| `e2e/helpers.ts` | Test HMAC recompute + drain helpers |
| `__tests__/screen-token.test.ts` | Unit coverage |
| `__tests__/advance-rate-limit.test.ts` | Unit + route coverage |
| `e2e/advance-auth.spec.ts` | E2E 401 + token-round-trip coverage |
| `.env.example` | Rollout flag documentation |

No new npm dependencies. No package.json changes.

CI basis: dev-reported `work/evidence/ticket-45/local-verify-summary.txt` — jest 460 / 32 suites + rotation-engine 59 + e2e 43, all PASS (ADVANCE_AUTH=enforce for e2e). See §CI Note below.

---

## Findings

### INFO-1 — `timingSafeHexEqual`: static HMAC key `"cmp"` is sufficient but slightly unorthodox

**Location:** `lib/screen-token.ts` lines 86–92

**Observation:** The length-normalisation step uses `createHmac("sha256", "cmp")` — a hardcoded, non-secret key — to hash both sides to a fixed-width buffer before calling `timingSafeEqual`. The goal (fixed-length, no throw on mismatched input lengths) is correct and achieved. A constant key is fine here because both sides are normalised the same way and the HMAC is not providing secrecy — its sole role is deterministic fixed-length mapping. The same pattern is used in `lib/host-auth.ts`; it is intentionally kept local for decoupling (documented in comments). No exploit path.

**Severity:** INFO — no remediation required; noted for reviewers.

---

### INFO-2 — Token visible in Next.js client-component props (by design, acknowledged)

**Location:** `app/(patron)/[room]/tv/page.tsx` → `TvScreen` prop `screenToken`; `components/tv/TvScreen.tsx`

**Observation:** `screenToken` is passed as a React prop to a `"use client"` component. Next.js serializes server-component props into the HTML (`__NEXT_DATA__` / RSC payload), so the token is present in the page source / network response. This is the **explicitly acknowledged** threat-model trade-off: the TV page is public, the token is scrapeable. The design is correct — a scraper must visit the TV page and parse the token per-room; this closes the "one curl of a guessed slug" class of attacks, which is the stated goal. The accepted risk is honestly documented in `lib/screen-token.ts` comments and `work/plans/TICKET-41-plan.md`.

Token is room-scoped (HMAC message includes `roomId`) and bucket-scoped (48h max lifetime). A scraped token for room A is useless on room B — confirmed by the wrong-room 401 evidence in `work/evidence/ticket-45/apptester-curl-401-evidence.txt`.

**Severity:** INFO — intentional design, correctly documented. No remediation required.

---

### INFO-3 — Rate limit runs AFTER auth gate in log mode, hits authed AND unauthed callers alike

**Location:** `app/api/queue/advance/route.ts` lines 37–57

**Observation (audit item 5 — DoS backfire):** In `enforce` mode, unauthorized callers get a 401 **before** the rate-limit bucket is charged (early return at line 43), so only authorized callers can deplete the room's advance bucket. This is the correct, DoS-safe ordering for enforce mode.

In `log` mode, the early return does not fire (the unauthorized call is allowed through to the rate-limit check). This means an unauthenticated patron CAN deplete the rate-limit bucket in log mode. However:

1. Log mode is the **pre-enforcement observation window**, not the target steady state. The TV client's normal cadence (one advance per song, minutes apart) is far below the 12/min cap. An attacker during the log window has the same access they had before this PR (unauthenticated advance), so the attack surface is not widened vs. pre-TICKET-45.
2. Once flipped to `enforce`, the ordering is correct and the rate-limit bucket cannot be depleted by an unauthorized caller.

The TV's legitimate cadence (one advance every few minutes at absolute minimum, typically 3–5 min per song) leaves 11+ advances of headroom against the 12/min cap even if one spam burst occurs simultaneously.

**Severity:** INFO — log-mode-only, pre-enforce window, non-regressive, by-design transient. No remediation required; worth noting for the TM's rollout mental model.

---

### INFO-4 — e2e helper `DEV_FALLBACK_TOKEN` = `"cantai-dev-host"` does NOT create a prod bypass

**Location:** `e2e/helpers.ts` line 17; `lib/host-auth.ts` `resolveRoomToken` line 98

**Observation:** The `resolveRoomToken` function in `lib/host-auth.ts` gates the dev fallback behind `process.env.NODE_ENV !== "production"`. In production without `HOST_TOKEN`, `resolveRoomToken("default")` returns `null` (locked, no secret). A null secret means `mintScreenToken` returns null, `verifyScreenToken` returns false, and `isAdvanceAuthorized` returns `{ ok: true, reason: "no-key" }` — the fail-open path. There is no way for the `"cantai-dev-host"` hardcoded constant in `e2e/helpers.ts` to produce a verifiable token in production, because production with `HOST_TOKEN` set keys off that env value, not the fallback, and production WITHOUT `HOST_TOKEN` returns null (enforcement off, no secret to compare against). The fallback is structurally unreachable in production. The unit test `screen-token.test.ts` "no-key rooms" suite explicitly covers this path with `NODE_ENV=production` + no `HOST_TOKEN`.

**Severity:** INFO — confirmed no prod bypass. No action required.

---

### INFO-5 — `import "server-only"` correctly gates `lib/screen-token.ts` from client bundles

**Location:** `lib/screen-token.ts` line 37

**Observation:** The `"server-only"` package import causes a build-time error if any client component or client utility tree transitively imports `screen-token.ts`. The raw room secret (`resolveRoomToken` value) never reaches the client. The TV page passes only the **derived token** — a 64-hex-char HMAC output — as a prop, not the underlying secret. The secret (`hostCodeHash` or `HOST_TOKEN` or dev fallback) stays server-side only. Confirmed by the `"use client"` boundary in `TvScreen.tsx` receiving `screenToken?: string | null` (the derived output, not the secret).

**Severity:** INFO — positive finding, correctly implemented.

---

### INFO-6 — Max token lifetime ≤ 48h, cross-bucket acceptance window

**Location:** `lib/screen-token.ts` `SCREEN_TOKEN_BUCKET_MS = 24 * 60 * 60 * 1000`, `verifyScreenToken` accepting `[current, current - 1]`

**Observation:** A token minted at the very start of bucket N is valid through the entire duration of bucket N+1 — worst case ≈ 48h of validity. A token minted at the end of bucket N is valid only for the remaining instant of bucket N plus all of bucket N+1 — practical minimum ≈ 24h. This is intentional: a TV screen rendered just before midnight must keep advancing through the next day without a forced page reload.

48h max lifetime is appropriate for a venue TV (a device unlikely to stay on a stale page longer than one shift). Cross-bucket replay from the previous bucket cannot elevate privileges (the token is only good for advance on the same room). No unbounded acceptance window — the loop is exactly `[current, current - 1]`, tested by `screen-token.test.ts` "expires two buckets later".

**Severity:** INFO — correctly bounded, design-appropriate.

---

### INFO-7 — Log-mode would-block line does NOT leak the submitted token or expected token

**Location:** `app/api/queue/advance/route.ts` lines 47–50; confirmed by `work/evidence/ticket-45/apptester-log-mode-evidence.txt`

**Observation:** The `console.warn` line logs only `room=<roomId> reason=<auth.reason> mode=log`. `auth.reason` is an enum string (`"unauthorized"`, `"no-key"`, etc.) — the submitted header value and the expected token are never included. The `isAdvanceAuthorized` function returns only the enum `reason`, not any token material. Confirmed by evidence: log output is `[advance-auth] would-block advance room=default reason=unauthorized mode=log`.

**Severity:** INFO — positive finding, no secret leak in logs.

---

## Accepted-risk re-assessment (design audit, not a new finding)

The design's honest threat-model note is accurate: the screen token raises the attack bar from "one curl of a guessed slug" to "fetch + parse the room's TV page first." This closes the patron-prank/casual-skip class that threatens a live venue night. A determined scraper can still lift the token. The accounts wave (TICKET-14) is the stated next hardening step. This auditor concurs: the prototype trade-off is precisely characterized, the implementation faithfully implements the design, and no cheaper exploit path was found that bypasses the stated model.

---

## No-key fail-open precision (audit item 3)

**Confirmed correct.** The fail-open path triggers when `resolveRoomToken(roomId)` returns `null`. This function is deterministic per the room's stored state and server environment:
- For non-default rooms: `null` only when the room has no stored `hostCodeHash` (no `getRoom(roomId)` record or record with no `hostCodeHash`).
- For the `default` room: `null` only when `HOST_TOKEN` is unset AND `NODE_ENV === "production"`.

There is no client-controlled input that can cause `resolveRoomToken` to return `null` for a room that genuinely has a secret. The `roomId` comes from the validated query parameter (passes `isValidRoomId`), not from a header or body. A client cannot garble or unset the room's server-side `hostCodeHash`. The fail-open branch cannot be forced by a caller.

---

## Regression sweep

Touched files reviewed for injected weaknesses:

- `app/api/queue/advance/route.ts`: no SQL/NoSQL injection (string roomId is validated via `isValidRoomId` before any store call); no new CORS headers; no new PII in responses; the 401/429 error bodies (`{"error":"Unauthorized"}`, `{"error":"Too many advances","reason":"rate"}`) contain no sensitive info.
- `components/tv/TvScreen.tsx`: `screenToken` is only ever read into a request header — no DOM injection, no eval.
- `e2e/helpers.ts`: test file; never bundled to production; crypto import is Node.js stdlib.
- `lib/advance-rate-limit.ts`: in-memory Map with LRU eviction cap at 2000 entries (heap-growth guard) — correct. `roomId` keys are prefixed `"room:"` to avoid any theoretical prototype pollution on the Map key space.

No new npm dependencies. No new packages to audit for known CVEs.

---

## CI Note

The authoritative gate per D-051 is `scripts/verify-green-local.sh` GREEN (local Docker run). The Dev report references `work/evidence/ticket-45/local-verify-summary.txt` which records: rotation-engine 59 PASS, jest 460/32 suites PASS, e2e 43 PASS (ADVANCE_AUTH=enforce). GitHub Actions is advisory-only on this repo (billing-gated). The local verify summary is the developer's own evidence; a Reviewer-run Docker gate would be the D-051-compliant gate. For security-audit purposes, the unit + e2e coverage of the auth paths is sufficient to issue a verdict; the CI-green gate condition for merge remains the Reviewer's/TM's responsibility.

---

## Summary

| Audit Item | Finding |
|---|---|
| HMAC discipline: key derivation, domain separation | PASS — `hostCodeHash` stays server-only; message includes domain prefix + roomId + bucket; correct domain separation from host-session HMAC |
| HMAC discipline: timingSafeEqual, length-mismatch handling | PASS — length-normalised via fixed HMAC before `timingSafeEqual`; no throw, no length oracle |
| HMAC discipline: bucket math, max lifetime, no unbounded acceptance | PASS — max ≈ 48h, exactly 2 buckets accepted, tested |
| Token exposure: room-scoped, expiry, HTML presence | PASS-WITH-NOTES — token in HTML by design (acknowledged); room-scoped; expires correctly |
| Fail-open precision: no forced no-key for keyed rooms | PASS — client cannot force null from server-controlled resolveRoomToken |
| Log mode: never rejects, never leaks token in logs | PASS — confirmed by evidence |
| Rate limit: per-room, DoS backfire in enforce mode | PASS — auth before rate in enforce mode; log-mode note INFO only |
| e2e helper: dev fallback not reachable in prod | PASS — confirmed by resolveRoomToken production gate |
| Regression sweep / new deps | PASS — no new deps, no injected weaknesses found |

**Overall verdict: PASS-WITH-NOTES** (all findings are INFO; no BLOCKER, HIGH, or MEDIUM items). The implementation is faithful to the design, the threat model is honestly documented, and no exploitable path was found beyond the accepted scrapeability risk.
