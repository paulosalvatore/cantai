# Dev report — TICKET-26 (anon identity registry)

- **Status:** IMPLEMENTED — ready for gates (draft PR, App Tester next)
- **Worktree:** `/Users/paulosalvatore/Documents/GitHub/boraoke/.worktrees/anon-identity-registry`
- **Branch:** `ticket/26-anon-identity-registry`
- **Port:** 3026

## Picking up from

Fresh start on this ticket — no prior Dev report or PR existed. This report is the first entry.

## Bootstrap notes

- No `scripts/verify-green-local.sh` exists in the boraoke repo (checked repo root and `.worktrees/anon-identity-registry`). Falling back to the repo's own CI conventions: `.github/workflows/ci.yml` runs (in order) rotation-engine `node --test`, `npm run build`, `npm test` (Jest), `npx playwright install --with-deps chromium`, `npm run test:e2e`. I will run the same locally (build + jest + relevant e2e) as my self-verify gate and report verbatim output.
- `node_modules` was not installed in this worktree — ran `npm ci` (406 packages) before doing anything else.

## Exploration findings

- **Store driver-swap pattern (TICKET-6, `lib/store.ts`/`lib/store/{types,memory,upstash}.ts`)**: `QueueStore` is an explicitly FROZEN, queue-shaped interface — comments in `lib/store/types.ts` and `lib/rooms.ts`/`lib/feedback-store.ts` say later features must NOT touch it. The house convention for a new domain (rooms, feedback, telemetry) is "own module, own keyspace, but mirror the driver-selection pattern exactly" (`STORE_DRIVER` env, same memory/upstash split, same zero-credential default). `lib/feedback-store.ts` and `lib/telemetry-store.ts` are the cleanest templates: an interface, a `Memory*Store` class, an `Upstash*Store` class over an injectable `*RedisLike` subset, a `resolveDriver()`/`create*Store()` pair, and a process singleton. I followed this exact shape for identity rather than inventing a new abstraction or touching `lib/store/types.ts`.
- **`app/(patron)/[room]/PatronRoom.tsx`**: client-mints a `patronUuid` via `uuid` v4 into `localStorage["cantai_patron_uuid"]` on mount (boot `useEffect`, lines ~76-91), reused across visits. This is the "legacy client-minted uuid" the ticket requires continuity with. It rides along on `POST /api/queue` submissions and `GET /api/queue/pending?...&uuid=`.
- **`app/api/rooms/route.ts`**: `POST` creates a room via `lib/rooms.ts#createRoom(name)` — today it does NOT persist any creator identity. `lib/rooms.ts`'s `Room` interface has no `creatorUuid` field.
- **Cookie precedent**: `lib/host-auth.ts` is the existing httpOnly-cookie pattern (`hostCookieOptions()`: httpOnly, sameSite lax, secure in prod, scoped `path`, `maxAge`) set via `NextResponse.cookies.set(...)` in `app/api/host/login/route.ts`. I mirror this shape for the identity cookie (different name, root path, long maxAge since it's a durable identity not a session).
- **`app/new/page.tsx`**: room-creation client page — `POST /api/rooms` body is currently just `{ name }`. No identity involved client-side today.
- **Test conventions**: `__tests__/telemetry-store.test.ts` and `__tests__/feedback-store.test.ts` run the SAME contract suite against both `Memory*Store` and `Upstash*Store` (the latter over a tiny in-file `FakeRedis` implementing only the subset of the Redis client the store needs — zero network/creds). I follow the same pattern for `identity-store.test.ts`.
- **`e2e/helpers.ts`**: shared Playwright helpers (screen-token minting, queue draining). No identity-cookie helper exists yet.
- No `scripts/verify-green-local.sh` in this repo — noted above.

## Plan

See `work/plans/TICKET-26-plan.md`. Per the orchestrator's instruction, proceeding without an external plan-gate approval (self-gate: re-read once before coding) — noting this deviation from the standard dev.md plan-gate flow here as required.

## Implementation log

Commit SHAs appear in the git log on branch `ticket/26-anon-identity-registry` (see PR). Files:

- **`lib/identity-store.ts`** (new) — the pure, framework-agnostic identity registry driver. `IdentityRecord` (`uuid`, `createdAt`, `lastSeenAt`, `userAgentClass`, reserved-nullable `accountId`), explicit ZERO-PII invariant comment + TICKET-28 claim-hook comment in the file header. `identityKeys.item` (`identity:{uuid}`) + `identityKeys.rooms` (`identity:{uuid}:rooms`). `IdentityStore` interface (`get`/`touch`/`addRoom`/`listRooms`/`clear`). `MemoryIdentityStore` (Map-based) + `UpstashIdentityStore` (over an injectable `IdentityRedisLike` subset: `get`/`set`/`sadd`/`smembers`/`del`). `resolveDriver()`/`createIdentityStore()`/`identityStore` singleton — same `STORE_DRIVER` precedence as `lib/store.ts`. `touch()` is an idempotent upsert (createdAt frozen, lastSeenAt refreshed) so mint/reuse/adopt all go through one op.
- **`lib/identity.ts`** (new) — Next.js request policy. `IDENTITY_COOKIE = "boraoke_identity"`, `identityCookieOptions()` (httpOnly, sameSite lax, secure-in-prod, path `/`, 2yr maxAge). `classifyUserAgent()` (coarse bucket: bot/mobile/desktop/unknown — never the raw UA). `isValidUuid()` (uuid `validate`). `createIdentityResolver(store)` factory → `resolveIdentity(req, legacyUuid?)` with precedence cookie → legacy uuid → fresh mint, wrapped try/catch for fail-open (`ok:false`, never throws). `applyIdentityCookie()`. Real `resolveIdentity` singleton bound to `identityStore`.
- **`app/api/identity/route.ts`** (new) — `POST /api/identity`, optional `{ legacyUuid }`, always 200 `{ uuid, registered }`, sets the httpOnly cookie only when `ok`. Malformed/oversized bodies tolerated as "no legacy uuid".
- **`lib/rooms.ts`** (edit) — added optional `Room.creatorUuid` (zero-PII/claim-hook comment; excluded from `PublicRoom`), `createRoom(name, creatorUuid?)` persists it when provided; back-compat preserved (all existing call sites omit it).
- **`app/api/rooms/route.ts`** (edit) — reads optional `patronUuid` from the body, `resolveIdentity(req, patronUuid)` before create, passes `identity.uuid` as `creatorUuid`, best-effort `identityStore.addRoom(uuid, roomId)` (swallowed errors), applies the identity cookie — all fail-open (identity down never blocks creation).
- **`app/(patron)/[room]/PatronRoom.tsx`** (edit) — after the existing localStorage patronUuid boot, fire-and-forget `POST /api/identity { legacyUuid: id }`; adopts a differing server uuid if returned. Failure silently ignored (local uuid keeps working — fail-open).
- **`app/new/page.tsx`** (edit) — sends the device's existing `cantai_patron_uuid` (if any) as `patronUuid` in the create call for creator-continuity. Optional.
- **`__tests__/identity-store.test.ts`** (new) — both-driver contract suite (first-touch mint, repeat-reuse, addRoom/listRooms idempotent, zero-PII field-shape assertion, key schema, isolation).
- **`__tests__/identity.test.ts`** (new) — `resolveIdentity` policy (mint/reuse/adopt/cookie-wins/invalid-legacy) + fail-open on an injected throwing store + `classifyUserAgent`/`isValidUuid`.
- **`__tests__/rooms.test.ts`** (edit) — asserts `creatorUuid` persists + is absent from `PublicRoom`; back-compat when omitted.
- **`e2e/identity.spec.ts`** (new) — fresh-device single httpOnly identity cookie; repeat-visit reuse; patronUuid continuity (pending-poll uuid stays valid).

## Self-verification (verbatim)

**`npm run build`** — GREEN:
```
✓ Compiled successfully in 29.3s
✓ Generating static pages (29/29)
...
├ ƒ /api/identity                          173 B         103 kB
```

**`npm test`** (full Jest suite):
```
Test Suites: 39 passed, 39 total
Tests:       571 passed, 571 total
Snapshots:   0 total
Time:        12.57 s
```
(includes the new `identity-store.test.ts`, `identity.test.ts`, and the extended `rooms.test.ts`; a targeted run of just those three files earlier: 68 passed / 68.)

**Manual endpoint check** — `POST /api/rooms {"name":"debugroom"}` on a fresh `next dev -p 3026` returned `201 {"id":"debugroom",...}` in ~3.7s (confirms the route works; the earlier all-parallel e2e failures were cold-`next-dev` compile timeouts under a saturated machine, not a code fault — see Friction).

**e2e (Playwright, `PORT=3026`):**
- `identity.spec.ts` — `3 passed (17.7s)` (fresh-device single httpOnly identity cookie; repeat-visit reuse; patronUuid continuity). First run had one cold-compile flake on the fresh-device test (fixed 500ms wait < first-hit route compile); rewrote it to `waitForResponse(/api/identity)` — now deterministic.
- Regression pass — `submit-song.spec.ts` + `rooms.spec.ts` + `saved-rooms.spec.ts`: all 9 passed (`9 passed (1.7m)` in the same run where the pre-fix identity test failed). No regressions from the identity wiring on the room-creation / patron-join / saved-rooms flows the change touches.

## Friction

- **No `scripts/verify-green-local.sh`** in boraoke — used the repo's own CI conventions (build + jest + e2e) instead, per bootstrap note.
- **First full parallel `playwright test` run timed out** on several specs' `warmUp` (`POST /api/rooms` 30s timeout) — this was cold `next dev` route compilation on a machine already running ~6 other product dev servers, NOT a regression: a standalone `next dev -p 3026` + `curl POST /api/rooms` returned 201 in 3.7s. Re-ran with `--timeout=60000`.
