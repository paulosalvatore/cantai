# TICKET-9 Security Report — multi-room + QR join + table capture

**PR:** #13 · branch `ticket/9-rooms-qr`
**Date:** 2026-07-06
**Agent:** Cyber Security (D-011)
**Verdict:** **FAIL**

---

## Scope Audited

- `lib/rooms.ts` — room model, slug/host-code generation, persistence
- `lib/host-auth.ts` — token resolution, session derivation, per-room cookies, login throttle
- `app/api/rooms/route.ts` — unauthenticated room creation / public room lookup
- `app/api/queue/route.ts` — queue GET/POST (unauthenticated patron submission)
- `app/api/queue/advance/route.ts` — queue advance (TV auto-advance)
- `app/api/host/{login,session,pause,remove,reorder,skip}/route.ts` — host API routes
- `app/new/page.tsx` — /new create flow (host-code shown once)
- `app/(patron)/[room]/{page,admin,tv}` — per-room patron, admin, TV pages
- `app/tv/page.tsx`, `app/admin/page.tsx` — legacy redirects
- `components/QrCode.tsx` — QR generation (client-side data-URL)

Cross-room isolation, cookie design, host-code entropy, rate limiting, injection surfaces, redirects, npm audit delta, and full unit suite run.

---

## Unit Suite

`npm test` → **220 passed / 14 suites** (confirmed locally). Matches dev report.

---

## CI Status

`build-and-test` was **pending** at audit time. Per S1, a final PASS cannot be issued until CI is terminal-green. However, the verdict below is already FAIL due to a HIGH finding; CI state does not change that.

---

## Findings

### HIGH-1 — No rate limiting on POST /api/rooms (unauthenticated room creation flood)

**File:** `app/api/rooms/route.ts:30–68`

The room creation endpoint is fully unauthenticated and carries no rate limit, no per-IP cap, and no global room-count ceiling. An attacker can send an unbounded stream of POST requests — each creates a `room:<id>:meta` key in Redis plus a host-code record — exhausting the Upstash free-tier key budget or incurring cost on a paid plan. Additionally, while the 4-char random slug suffix makes exact squatting very hard (32^4 ≈ 1M possibilities per name), bulk creation of rooms under many common venue names is feasible at zero cost to the attacker.

**Remediation:** Apply a per-IP rate limit on POST /api/rooms using the same in-process throttle pattern already established in `lib/host-auth.ts` (or the same standalone limiter as TICKET-8's search limiter). A reasonable starting limit: 5 room creations per IP per hour. Optionally add a global `MAX_ROOMS` ceiling on the backend (countable with a Redis INCR key) so a determined attacker rotating IPs still has a hard cap.

---

### MEDIUM-1 — Login throttle keyed per-IP only; rotating rooms multiplies the effective attempt budget

**File:** `lib/host-auth.ts:178–220` (`loginFailures` Map, `isLoginThrottled`/`registerLoginFailure`)

The throttle Map key is the client IP string only. An attacker against a high-value room gets 10 attempts per 60-second window against room A, then 10 more against room B (different `?room=` param, same IP), then room C — the budget resets per room, not per IP globally. Against a venue with a short 8-char Crockford-base32 hostCode (40 bits), 10 guesses per room is practically no barrier.

The dev report explicitly acknowledges this: "a global (Upstash-backed) login throttle at #14." That is the correct long-term fix. This finding is MEDIUM rather than HIGH because: (a) it is documented and ticketed, and (b) the 40-bit host-code space makes brute force computationally expensive even without rate limiting.

**Remediation (for #14):** Key the throttle map as `${ip}:${roomId}` to tighten the per-room budget, AND add a global IP bucket (separate key, larger window) so rotating rooms doesn't reset the global counter. An Upstash-backed global counter survives serverless instance boundaries.

---

### MEDIUM-2 — hostCode stored plaintext in Redis

**File:** `lib/rooms.ts:174–183` (`createRoom`)

The `hostCode` field is written to Redis as a plaintext string (`room:<id>:meta`). If Upstash credentials are compromised (e.g., a leaked `.env` or a supply-chain hit on the Upstash SDK), all room host codes are immediately readable with no further cracking effort — one credential leak = full takeover of every room.

Mitigating factors: rooms are lightweight (no PII, no financial data) and the hostCode is the only secret, so the blast radius is limited to queue control. The design is also explicitly temporary (accounts arrive at #14, replacing hostCodes).

**Remediation:** Before #14, hash the hostCode before storage (e.g., `crypto.createHash("sha256").update(code).digest("hex")`; bcrypt/scrypt is overkill for a short-lived prototype but would be correct long-term). `verifyHostToken` already has the plaintext on the submitted side, so comparing `hash(submitted) === storedHash` requires only a one-line change.

---

### LOW-1 — Cookie accumulation on multi-room host devices

**File:** `lib/host-auth.ts:56–58` (`hostCookieName`)

A browser hosting N rooms accumulates N `cantai_host_<roomId>` cookies (scoped to path `/api/host`). Modern browser cookie-jar limits are 180+ per domain in Chrome and 150 in Firefox — reaching those thresholds would require a device hosting 170+ rooms, far outside the expected use case. The cookies are httpOnly and path-scoped, so this is not an attack surface: an external actor cannot force cookie accumulation on a legitimate host's device.

**Remediation:** No immediate action required. If multi-room devices become common, migrate to a single `cantai_host` cookie holding a JSON map `{ [roomId]: sessionValue }` or use a server-side session store.

---

## Cross-Room Isolation Audit (PASS)

**Cookie naming:** `hostCookieName(roomId)` produces distinct names per room (`cantai_host_<roomId>`). `requireHost` reads only the cookie named for the `roomId` extracted from `?room=`. Cookie for room A cannot satisfy the auth check for room B (different cookie name, would be absent). Verified in `lib/host-auth.ts:236–239`.

**Parameter tampering:** All host routes call `roomIdFromRequest(req)` to resolve the room from the query param, then call `requireHost(req, roomId)` which reads the cookie named for that same roomId. An attacker with a valid session for room A sending `?room=B` would need the `cantai_host_B` cookie — which they don't have. Access is correctly denied.

**HMAC derivation:** `sessionValue(token)` is derived from the room's own `hostCode` (the token argument). Since each room's hostCode is independently generated (~40 bits), session values are room-specific. Room A's session value cannot authenticate room B. Verified in `lib/host-auth.ts:102–104`.

**roomId charset injection:** `isValidRoomId` (`^[a-z0-9-]{1,64}$`) is enforced before every store call. The regex excludes `:` (Redis key separator), `/`, `*`, and all other characters that could escape the `room:<id>:*` key namespace. Verified in `lib/rooms.ts:52–55`.

**Default-room legacy paths:** `/tv?room=<bad>` falls back to `default`; `/admin` redirects to `/default/admin`. Both validate the room param with `isValidRoomId` before using it. No cross-room pollution possible via legacy paths.

---

## Additional Checks (PASS / INFO)

**Host-code entropy:** 8-char Crockford base32 = 32^8 = 2^40 ≈ 1.1 trillion. `randomBytes` mod 32 has no bias (256 = 8×32). Strong enough for a prototype; #14 should rotate to proper auth.

**Slug generation entropy:** 4-char suffix = 32^4 ≈ 1M per slug base — sufficient to prevent deterministic slug squatting.

**Shown-once semantics:** hostCode is returned in the `POST /api/rooms` 201 response only. `GET /api/rooms` returns `PublicRoom` (no `hostCode` field). `getPublicRoom` in `lib/rooms.ts:151–159` explicitly strips it. No other endpoint leaks it. Verified.

**QR URL content:** QR encodes `${origin}/${roomId}` (join URL only). Host code is never in the QR. Verified in `components/QrCode.tsx` and all call sites.

**Open redirects:** `/tv` and `/admin` legacy redirects use `next/navigation`'s `redirect()` to hardcoded internal paths. No user-controlled redirect target. Clean.

**XSS / CSRF:** No HTML interpolation of user input server-side. All input goes into Redis store, not rendered as markup. Next.js/React escape by default. No CSRF risk on state-mutating routes (host routes verify the per-room session cookie; patron queue POST is intentionally public).

**X-Forwarded-For trust (INFO):** `clientIpFrom` uses the first XFF hop, which can be spoofed by the client if not behind a trusted proxy. On Vercel the platform overwrites XFF so this is safe in the current deployment. A self-hosted deploy behind nginx without `real_ip` would be vulnerable to throttle bypass. Not blocking; worth a comment in the code.

**POST /api/queue/advance — unauthenticated (INFO / pre-existing):** This endpoint has been unauthenticated since before TICKET-9 (the TV calls it on video end). TICKET-9 adds the `?room=` param but does not change the auth posture. No new attack surface introduced. Logged for future #14 consideration (the TV could authenticate via a read-only TV token).

**npm audit:** 2 moderate vulnerabilities — `postcss < 8.5.10` (GHSA-qx2v-qp2m-jg93, CSS XSS in build output) and `next 9.3.4-canary.0–16.3.0-canary.5` (depends on vulnerable postcss). Both are pre-existing, not introduced by this PR. The `qrcode` and `@types/qrcode` packages added in this PR show no vulnerabilities. Fix requires a breaking Next.js downgrade to 9.3.3, which is not appropriate. Track separately.

---

## Verdict

**FAIL**

Blocked on **HIGH-1** (no rate limiting on unauthenticated room creation). MEDIUM-1 and MEDIUM-2 are noted and must be tracked as follow-up tickets (#14 is the right vehicle for MEDIUM-1; MEDIUM-2 should be its own small ticket before production traffic scales). FAIL is the D-011 verdict; no merge until HIGH-1 is addressed.

**Required to unblock:**
- Add per-IP rate limiting to `POST /api/rooms` (HIGH-1).

**Recommended follow-ups (do not block merge once HIGH-1 is fixed):**
- Global login throttle across rooms, Upstash-backed (#14 scope, MEDIUM-1).
- Hash hostCode at rest before storing in Redis (MEDIUM-2, file a ticket).
