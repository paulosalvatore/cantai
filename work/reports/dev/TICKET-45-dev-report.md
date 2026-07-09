# TICKET-45 — Dev Report: advance/skip authorization

- **Status:** IMPLEMENTED + self-verified GREEN (build + 460 jest + 43 e2e + 59 rotation-engine). Ready for gates.
- **Branch:** `ticket/45-advance-auth` · **Worktree:** `.worktrees/ticket-45` · **App port:** 3045
- **Ticket:** `work/tickets/TICKET-45-advance-auth.md` · **Design (authoritative):** `work/plans/TICKET-41-plan.md` §advance-auth (lines 65–78)

## What was built (implements the committed design — no redesign)

1. **`lib/screen-token.ts`** (new). Stateless screen-token mint/verify:
   - `mintScreenToken(roomId, now)` → `HMAC-SHA256(key = resolveRoomToken(roomId), msg = "boraoke-screen-v1|<roomId>|<24h-bucket>")`, or `null` for a no-key room.
   - `verifyScreenToken` recomputes + `timingSafeEqual`, accepting the current AND previous 24h bucket (rollover tolerance).
   - `isAdvanceAuthorized(req, roomId)` → accepts a valid `X-Boraoke-Screen` token OR a valid host session cookie (`requireHost`, the admin skip path); `no-key` room → `ok:true` (fail-open, nothing to protect).
   - `advanceAuthMode()` reads `ADVANCE_AUTH` (`log` default → `enforce`); any unrecognized value is `log` (safe default).
   - Carries the honest threat-model note in comments (public TV page = scrapeable token; kills the casual/patron-prank class, accounts wave #14 hardens further).
2. **`lib/advance-rate-limit.ts`** (new). Per-room dual-bucket sliding-window advance throttle (12/min/room), the house pattern (`queue-rate-limit.ts` class). The defense-in-depth backstop rung against a scraped token.
3. **`app/api/queue/advance/route.ts`**. Gate added: `isAdvanceAuthorized` + `advanceAuthMode` — `enforce` returns 401, `log` emits a `[advance-auth] would-block …` warn and proceeds. Then the per-room rate limit (429 on trip). All pre-existing advance/telemetry behavior unchanged below the gate.
4. **`app/(patron)/[room]/tv/page.tsx`**. Mints `screenToken` server-side and passes it to `TvScreen`.
5. **`components/tv/TvScreen.tsx`**. New `screenToken` prop; the single `advance()` fetch layer now sends `X-Boraoke-Screen`. Because `advance()` is the sole advance path, the watchdog, ENDED auto-advance, and the manual skip button all carry the credential automatically.
6. **`.env.example`**. Documents `ADVANCE_AUTH` (log→enforce rollout + flip guidance).

## e2e migration (this is why the ticket was deferred — done properly)

- **New shared helper `e2e/helpers.ts`**: `screenTokenFor(roomId, rawHostCode?)` recomputes the same server-minted HMAC (default room → dev-fallback secret, as the specs already hardcode; created room → `hashHostCode(rawCode)`); `advanceOnce()` / `drainQueue()` attach the header. One place obtains the credential; every drain/advance goes through it.
- **Migrated 4 specs** off bare `POST /api/queue/advance`: `tv.spec.ts`, `tv-watchdog.spec.ts`, `submit-song.spec.ts`, `host-controls.spec.ts` (removed their local `drainQueue`, routed through the helper).
- **`playwright.config.ts`** now runs the WHOLE e2e suite with `ADVANCE_AUTH=enforce` — this proves the migration is complete (every authed path works) and lets the new spec assert a bare advance → 401. Production still ships `log` by default.
- **New `e2e/advance-auth.spec.ts`**: bare advance → 401; stale/wrong token → 401; valid-token advance → 200; helper-token round-trip → 200.

## Tests

- **Unit (new):** `__tests__/screen-token.test.ts` (mint/verify, 24h bucket rollover incl. expiry two-buckets-later, wrong-room rejection, no-key fail-open, log-vs-enforce mode, host-session acceptance, unauthorized rejection); `__tests__/advance-rate-limit.test.ts` (per-room cap, independence, window slide, route-level 429).
- **Pre-existing `telemetry-instrumentation.test.ts`** still green with NO migration — it runs in the jest default (`log`) mode, so bare advances pass through (the warn is expected). This confirms log-mode is non-breaking.
- **Counts:** rotation-engine 59 · jest 32 suites / 460 tests · e2e 43. All pass. Summary: `work/evidence/ticket-45/local-verify-summary.txt`.

## Rollout flip (TM action)

Ship merged with the default `ADVANCE_AUTH=log`. After a quiet observation window (check the Vercel logs for `[advance-auth] would-block advance …` lines — legitimate TV traffic should produce NONE, since the TV always sends a valid token), flip to enforce:
- Set `ADVANCE_AUTH=enforce` in the Vercel project env (Production) and redeploy.
- No code change, no migration — the env flip is the whole rollout step. Revert to `log` (or unset) instantly rolls back.

## Implementation-vs-plan deltas

~None. Two mechanical choices within the design's latitude: (a) the token/auth logic lives in a new `lib/screen-token.ts` sibling rather than inside `lib/host-auth.ts`, to avoid churn in the live-auth file (the plan named `lib/host-auth.ts additions`; the module imports from it and is functionally an addition); (b) the whole e2e suite runs in enforce mode (stronger than a single enforce spec) so the migration is continuously proven.

## Ownership boundary (parallel TICKET-44)

No file overlap. TICKET-44 owns `/api/queue` POST + admin approval UI + patron pending; TICKET-45 owns `/api/queue/advance`, the TV server page + TvScreen fetch layer, the two new `lib/` modules, and the e2e helpers. No sequential-merge conflict expected.

## Blockers

None.
