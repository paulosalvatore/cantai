# TICKET-9 — Reviewer Report (multi-room + QR join + table capture)

- **PR:** #13 · branch `ticket/9-rooms-qr`
- **Date:** 2026-07-06
- **Reviewer model:** sonnet (first pass; opus-skip eligible — mechanical/structural findings only; security already audited by dedicated Cyber Security gate)
- **Tip reviewed:** `a2236ed66f0c4f389a310fa6e9d068316151216c`
- **Verdict:** **[reviewer] APPROVE**

---

## Pre-condition checks (S1 / S2)

| Gate | Status |
|------|--------|
| CI `build-and-test` | PASS (1m59s, terminal at review time) |
| Vercel Preview | PASS |
| App Tester | PASS (13 evidence shots, `work/reports/testing/TICKET-9-app-test.md`) |
| Security | PASS-WITH-NOTES (`work/reports/security/TICKET-9-security.md`; HIGH-1 + MEDIUM-2 resolved, MEDIUM-3 follow-up to #14) |

All gates are terminal-green before this APPROVE is issued (S1 satisfied).

---

## Tests verified by Reviewer (own run)

```
npm ci     ✓  (clean install, 2 pre-existing moderate npm audit advisories — not introduced by this PR)
npm test   ✓  233 passed / 15 suites / 0 snapshots  (0.64s)
npm run build  ✓  18 routes compiled, zero type errors in app code
```

Build route table (confirmed 18, matches dev report claim):
```
/          /[room]     /[room]/admin   /[room]/tv
/admin     /new        /tv
/api/feedback  /api/host/login  /api/host/pause  /api/host/remove
/api/host/reorder  /api/host/session  /api/host/skip
/api/queue  /api/queue/advance  /api/rooms  /api/search
```

E2e was not re-run locally (Playwright dev-server isolation caveat documented by Dev; the App Tester already ran 14/14 with warm-up, and the unit suite covers the same invariants at the route level).

---

## Architecture — multi-room refactor (pass)

### Route structure

`app/(patron)/[room]/{page,tv/page,admin/page}` uses a Next.js route group (no URL segment). The three static siblings — `/admin`, `/tv`, `/new` — take priority in App Router over the dynamic `[room]` catch-all. Verified no route collision is possible because `slugify()` always appends a 4-char Crockford base32 suffix; no generated slug can ever equal exactly "api", "new", "tv", or "admin". The legacy `/tv` and `/admin` redirect correctly.

### Reserved-slug gap (NIT — does not block)

The landing-page join-by-code input (`app/page.tsx`) does not call `isValidRoomId` before navigating; `router.push(`/${encodeURIComponent(room)}`)` is unchecked. A user typing "new" (or "api", "tv") would land on the create page or a 404 — not a "room not found" message. This is a cosmetic inconsistency: no real room can ever have these IDs (slugify prevents it), so no patron is misdirected in practice. Recommend adding an `isValidRoomId` guard before `router.push` in a follow-up.

### TV/admin server components — missing upfront roomId validation (NIT — does not block)

`[room]/page.tsx` (patron) correctly validates with `isValidRoomId` and returns a friendly `<RoomNotFound />`. `[room]/tv/page.tsx` and `[room]/admin/page.tsx` do NOT validate upfront — they call `getPublicRoom(room)` (which validates internally and returns null) and silently render an idle TV or login form for an invalid roomId. Not a security issue (every API route validates independently), but inconsistent with the patron page. Recommend adding the same guard in a follow-up for UX parity.

---

## Room meta store — driver fidelity (pass)

`lib/rooms.ts` introduces a clean `RoomBackend` interface with two implementations:
- `MemoryRoomBackend`: `Map<string, Room>`, `size` as counter.
- `UpstashRoomBackend`: `redis.set(roomKey(id), room)` + monotonic `redis.incr(ROOMS_COUNT_KEY)`.

Both driver-selection logic and Redis constructor mirror `lib/store.ts` exactly — same env vars, same fail path. `roomKey(id)` = `room:<id>:meta` sits alongside the existing `room:<id>:queue` / `room:<id>:paused` keys in the same namespace. The only deliberate exception outside `lib/store*` that talks to Upstash directly — documented clearly in the module header.

**isValidRoomId enforcement**: Grep-verified exhaustively across all API routes:
- `app/api/rooms/route.ts`: direct `isValidRoomId` on GET; throttle + `createRoom` on POST (which checks internally).
- `app/api/queue/route.ts`: local `resolveRoomId` helper calls `isValidRoomId`.
- `app/api/queue/advance/route.ts`: direct `isValidRoomId` check.
- All `app/api/host/*` routes: `roomIdFromRequest(req)` which calls `isValidRoomId`.
- `getRoom(id)` itself also validates — belt-and-suspenders at the store layer.

No route reaches a Redis key with an unvalidated roomId. ✓

**Monotonic rooms:count counter**: `UpstashRoomBackend.create()` does `set` then `incr` — not atomic, but the security report correctly identifies this as bounded and acceptable: any overshoot is ≤ concurrency width, and the ceiling is conservative (over-counts if rooms are ever deleted, which none are yet). ✓

---

## Host-auth evolution (pass)

`resolveRoomToken` is now async and correctly follows the documented precedence:
1. Per-room `hostCodeHash` from the room store (non-default rooms only).
2. Env `HOST_TOKEN` (default room only).
3. Dev fallback (non-production, `NODE_ENV !== "production"`).
4. `null` — locked.

An unknown non-default room returns `null` immediately — correctly locked regardless of any env token. The per-room cookie name (`cantai_host_<roomId>`) isolates sessions at the cookie jar level; a session minted for room A cannot satisfy the auth check for room B (different cookie name, would be absent). Verified in the App Tester isolation evidence (`apptester-13-host-isolation-denied.png`).

**Pass-the-hash rejection**: `verifyHostToken` hashes the submitted raw code before comparison for non-default rooms. Submitting the stored hash gets double-hashed and fails. Test-covered at `__tests__/host-auth.test.ts:80–81` (the test reads "expects false" for `verifyHostToken(room.id, hashHostCode(hostCode))`). ✓

**Session derivation from hash**: `sessionValue(token)` = `HMAC(token, "cantai-host-session-v1")` where `token` = the stored `hostCodeHash`. The HMAC key `"cantai-hostcode-v1"` and the session message are both public source (public repo). Security already flagged this as MEDIUM-3 (session forgery if Upstash credentials are leaked); it is recorded for #14 and not blocking.

---

## QR generation (pass)

`components/QrCode.tsx` is a client component using `qrcode` npm → `QRCode.toDataURL()` → `<img src="data:...">`. Client-side is correct for TV and admin (both already fully client-rendered), and for `/new` (same). Join URL is constructed from `window.location.origin + "/" + roomId` in a `useEffect` to avoid SSR hydration mismatch. On Vercel, `window.location.origin` is the deployment origin — correct. QR encodes exactly the patron join path; host code is never included in any QR. Confirmed in the App Tester evidence: `apptester-06-room-a-tv-playing-qr.png` shows `localhost:3040/bar-do-ze-qbst` in the QR caption. ✓

---

## Patron/TV/admin refactors — TICKET-18 regression (pass)

Wake lock: all four lifecycle pieces preserved intact in `TvScreen.tsx` — `acquire()`, `disposed` guard, `visibilitychange` re-acquire, `sentinel.release()` on unmount. Chrome auto-hide timer also intact. The only structural change to `TvScreen` is the addition of `roomId` and `venueName` props and the room-scoped `roomQuery` / `joinUrl` derivation. No timer, wake-lock, or YT player logic was altered. ✓

FeedbackWidget exclusion extended correctly: `path === "/tv" || path.startsWith("/tv/") || path.endsWith("/tv")` covers `/tv`, `/tv/*`, and `/<room>/tv`. The App Tester confirmed the widget is absent on the TV page (`apptester-06-room-a-tv-playing-qr.png` shows no feedback pill). ✓

---

## Test quality (pass)

15 suites, 233 tests. The new security-specific coverage:
- `room-create-throttle.test.ts` — limit at 3, window expiry (fake timers), LRU eviction at 1000 IPs. Adversarial ✓
- `api-rooms.test.ts` — 429 at per-IP limit, per-IP isolation (different IP not throttled), explicit ROOM_CREATE_LIMIT, 400s don't consume budget, 503 at ceiling (ROOM_MAX=0). Adversarial ✓
- `rooms.test.ts` — hash-at-rest (JSON.stringify does not contain raw hostCode), ceiling, getPublicRoom strips hash. ✓
- `host-auth.test.ts` — pass-the-hash rejection, cross-room session isolation, LOCKS on unknown non-default room ignoring global env token. Adversarial ✓
- `api-queue-rooms.test.ts` — queue isolation across rooms, injection-character rejection (colon in roomId = 400). Adversarial ✓

E2e `rooms.spec.ts` — warm-up pattern correctly pre-compiles all routes before seeding data (in-memory singleton caveat documented). Tests: two-room isolation + TV shows correct room + table metadata; landing join-by-code navigation; unknown room shows user-friendly error. Meaningful coverage. ✓

---

## Scope / TICKET-12 rebase surface

TICKET-12 telemetry ("one-liner `track()` calls" per the plan) touches these routes. The routes are structurally unchanged from the callers' perspective — same handler signatures, same `?room=` param convention — so telemetry's planned one-liners should apply cleanly. No concern.

---

## Dev-report currency (S2)

Dev report (`work/reports/dev/TICKET-9.md`) is on the PR branch and reflects the final implemented state including the security-gate fixes. One discrepancy: the plan document says "No .env.example change" but the security fixes added `ROOM_CREATE_LIMIT` / `ROOM_MAX` to `.env.example` — the dev report correctly notes this. The plan is a record-only document; the discrepancy is cosmetic. NIT.

---

## Blocking items

None.

---

## Nits (non-blocking)

1. **TV/admin server components omit upfront `isValidRoomId` guard** — the patron page has it; TV and admin don't. An invalid roomId silently renders an idle/login page instead of the friendly "room not found" message. File a follow-up to add the guard for UX parity.
2. **Landing join-by-code skips `isValidRoomId` before `router.push`** — cosmetic. No real room has a reserved-word ID. File a follow-up.
3. **Plan says "No .env.example change"** — it was updated (ROOM_CREATE_LIMIT / ROOM_MAX appended). Plan is a record-only doc; no action needed.

---

## Evidence relied on

- `work/reports/testing/TICKET-9-app-test.md` — App Tester PASS, all 6 ACs verified, isolation proven API+UI level.
- `work/reports/security/TICKET-9-security.md` — Security PASS-WITH-NOTES (HIGH-1 + MEDIUM-2 resolved, MEDIUM-3 follow-up #14).
- `work/evidence/ticket-9/` — 8 dev screenshots + 13 App Tester screenshots (isolation, QR content, host auth, mobile).
- Local test run: 233/233 unit, 15 suites, 18 routes built.
- Code reads: `lib/rooms.ts`, `lib/host-auth.ts`, `lib/room-create-throttle.ts`, `app/api/rooms/route.ts`, `app/api/queue/route.ts`, `app/api/queue/advance/route.ts`, `app/api/host/login/route.ts`, `app/(patron)/[room]/page.tsx`, `app/(patron)/[room]/tv/page.tsx`, `app/(patron)/[room]/admin/page.tsx`, `components/QrCode.tsx`, `components/tv/TvScreen.tsx`, `components/FeedbackWidget.tsx`.
- All `__tests__/*.test.ts` and `e2e/rooms.spec.ts` read in full.

---

## Summary

This is the largest PR of the wave and it ships cleanly. Multi-tenancy is correctly isolated at the store, cookie, and route layer. The parallel `lib/rooms.ts` store keeps the frozen TICKET-6 contract untouched. `isValidRoomId` is enforced before every Redis key interpolation. Host auth per-room is correct; pass-the-hash rejected; session cross-room isolation verified. QR generation is client-correct. Security HIGH-1 and MEDIUM-2 are genuinely resolved; MEDIUM-3 is a known, documented residual for #14. Tests are adversarial and meaningful. All gates terminal-green.

Two cosmetic nits (missing upfront roomId validation on TV/admin server components; unguarded router.push on landing) are filed above and should become small follow-up tickets — they do not affect correctness or security.

**[reviewer] APPROVE — multi-room + QR join + table capture (PR #13). CI green, 233/233, 18 routes, App Tester PASS (isolation proven), Security PASS-WITH-NOTES (HIGH-1 + MEDIUM-2 resolved, MEDIUM-3 → #14). Two cosmetic nits, non-blocking.**
