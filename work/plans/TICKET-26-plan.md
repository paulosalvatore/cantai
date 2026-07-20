# Plan — TICKET-26 (anon identity registry)

**Self-gate note:** proceeding without an external plan-gate approval per the orchestrator's explicit instruction for this run. Re-read once before coding (done).

## Approach

Follow the existing "own module, own keyspace, mirror the driver-selection pattern" convention (`lib/feedback-store.ts`, `lib/telemetry-store.ts`) rather than touching the frozen `lib/store/types.ts` `QueueStore` interface. Two new lib files + one new API route + small edits to two existing files.

### 1. `lib/identity-store.ts` (new) — the pure storage driver

- `IdentityRecord`: `{ uuid, createdAt, lastSeenAt, userAgentClass, accountId?: string | null }`.
  - Explicit zero-PII invariant comment (mirrors `lib/store/types.ts` comment style): no name/email/phone/IP/fingerprint, `userAgentClass` is a coarse enum bucket, never the raw UA string.
  - `accountId` reserved nullable/optional now so TICKET-28 can set it via a link write — documented in the comment, not implemented further.
- `UserAgentClass = "mobile" | "desktop" | "bot" | "unknown"`.
- `identityKeys = { item: (uuid) => \`identity:${uuid}\`, rooms: (uuid) => \`identity:${uuid}:rooms\` }`.
- `IdentityStore` interface: `get(uuid)`, `touch(uuid, userAgentClass, now?)` (upsert: create on first touch, else update `lastSeenAt`/`userAgentClass`, `createdAt` untouched), `addRoom(uuid, roomId)`, `listRooms(uuid)`, `clear()` (test/reset helper).
- `MemoryIdentityStore` — `Map<uuid, IdentityRecord>` + `Map<uuid, Set<roomId>>`.
- `UpstashIdentityStore` over an injectable `IdentityRedisLike` (`get`/`set`/`sadd`/`smembers`/`del` subset) — item via `get`/`set`, rooms index via `sadd`/`smembers` (naturally idempotent, unordered — matches the ticket's "list of room ids" requirement).
- `resolveDriver()` / `createIdentityStore()` / exported `identityStore` singleton — same `STORE_DRIVER` env precedence as `lib/store.ts`.

### 2. `lib/identity.ts` (new) — request-level policy (Next-specific)

Kept separate from the pure driver so the driver stays framework-agnostic and easy to unit-test, mirroring `lib/telemetry.ts`'s `createTracker(store)` factory pattern for testability.

- `IDENTITY_COOKIE = "boraoke_identity"`, `identityCookieOptions()` (httpOnly, sameSite lax, secure-in-prod, `path: "/"`, long `maxAge` — a durable identity, not a session, ~2 years).
- `classifyUserAgent(ua: string | null): UserAgentClass` — coarse regex bucketing (bot/mobile/desktop/unknown) off the `user-agent` header; never stores the raw string.
- `isValidUuid` via the `uuid` package's `validate()` (already a dependency).
- `createIdentityResolver(store: IdentityStore)` → `resolveIdentity(req, legacyUuid?)`:
  1. existing identity cookie whose uuid has a store record → touch it (repeat-load reuse, acceptance #1).
  2. else a valid caller-supplied legacy uuid → touch it (creates if absent under that exact uuid — continuity/adoption, acceptance #2, no duplicate).
  3. else mint a fresh uuid v4 → touch (creates fresh record, acceptance #1 first-touch).
  - Wrapped in try/catch: on any store failure, returns `{ uuid: candidate, ok: false }` WITHOUT throwing — fail-open (acceptance #4). Caller must skip `Set-Cookie` when `ok` is false so the client keeps its local-only uuid and the next page load retries registration.
- `applyIdentityCookie(res, uuid)` helper.
- Default singleton export bound to the real `identityStore`, used by the two routes below; tests exercise `createIdentityResolver` with an injected throwing store to prove fail-open without touching the real singleton.

### 3. `app/api/identity/route.ts` (new)

`POST` — body `{ legacyUuid?: string }` (small body-size cap, malformed JSON tolerated as "no legacy uuid"). Calls `resolveIdentity(req, legacyUuid)`, returns `{ uuid, registered }` (`registered` mirrors `ok`), sets the cookie only when `ok`. Called from `PatronRoom.tsx` on mount.

### 4. `app/api/rooms/route.ts` (edit)

- Accept optional `patronUuid` in the POST body (continuity — the creating device's existing local uuid, if any).
- Resolve identity the same way (`resolveIdentity(req, patronUuid)`) before creating the room.
- Pass `identity.uuid` into `createRoom(name, identity.uuid)` so the room record persists `creatorUuid`.
- On success, best-effort `identityStore.addRoom(identity.uuid, created.room.id)` (swallow errors — fail-open, never blocks room creation) when `identity.ok`.
- Apply the identity cookie to the response when `identity.ok`.

### 5. `lib/rooms.ts` (edit)

- `Room.creatorUuid?: string` — optional so every existing legacy room (and every existing test/e2e call site that doesn't pass one) stays valid with no migration.
- `createRoom(name: string, creatorUuid?: string)` — stores it on the `Room` record when provided. `PublicRoom` (the client-safe view) does NOT include `creatorUuid` — it's server-side bookkeeping only, not exposed to patrons.

### 6. `app/(patron)/[room]/PatronRoom.tsx` (edit)

- After the existing boot effect resolves/mints `patronUuid` into `localStorage`, fire `POST /api/identity` with `{ legacyUuid: id }` — fire-and-forget (not awaited before the rest of boot continues; failure is silently ignored — the join flow never depends on this call, satisfying fail-open by construction). On success, if the server-returned `uuid` differs from the local one (should essentially never happen given cookie/legacy precedence, but defensive), overwrite `localStorage["cantai_patron_uuid"]` and state so future submissions use the canonical uuid.

### 7. `app/new/page.tsx` (edit, small)

- Read `localStorage["cantai_patron_uuid"]` (if present — same key `PatronRoom.tsx` uses) and send it as `patronUuid` in the `POST /api/rooms` body, for creator-continuity when the host previously visited a room page on the same device. Optional field — server works fine without it (mints/reuses via cookie).

## Files touched

- `lib/identity-store.ts` (new)
- `lib/identity.ts` (new)
- `app/api/identity/route.ts` (new)
- `app/api/rooms/route.ts` (edit)
- `lib/rooms.ts` (edit — add optional `creatorUuid`)
- `app/(patron)/[room]/PatronRoom.tsx` (edit — call the new endpoint)
- `app/new/page.tsx` (edit — send optional legacy uuid)
- `__tests__/identity-store.test.ts` (new — driver contract suite, both drivers)
- `__tests__/identity.test.ts` (new — `resolveIdentity` policy: mint/reuse/adopt/fail-open)
- `__tests__/rooms.test.ts` (edit — assert `creatorUuid` persists when passed)
- `e2e/` — extend an existing patron-flow spec (or add a small new one) covering: fresh device gets identity cookie set, repeat visit reuses it, own-row highlighting still works.

## Risks

- **Cookie visibility in Playwright/CI**: httpOnly cookies aren't readable via `document.cookie` in the browser context, but Playwright's `context.cookies()` API can read them server-side — used for e2e assertions instead of page JS.
- **Race between cookie-mint and client-side patronUuid**: mitigated by making `identity:{uuid}` `touch()` idempotent/upsert and by having the client always keep working off its own local uuid regardless of the registration call's outcome (fail-open by construction, not by exception-catching alone).
- **Upstash driver is untested against real Upstash** (no creds in this environment) — covered via the injected-FakeRedis contract-test pattern already used by every other store in this repo; consistent with house convention, not a regression.
- **`node_modules` was missing in the worktree** — resolved via `npm ci` before starting; noted in the dev report.

## Test strategy

- Unit (Jest): `identity-store.test.ts` (both drivers, contract suite: first-touch mint, repeat-touch reuse/lastSeenAt update, addRoom/listRooms, zero-PII field shape) + `identity.test.ts` (`resolveIdentity`: cookie-reuse, legacy-uuid adoption, fresh mint, fail-open on a throwing injected store).
- `rooms.test.ts` extension: `createRoom(name, uuid)` persists `creatorUuid`; omitted `creatorUuid` still works (back-compat).
- Playwright e2e: fresh browser context → visit a room → `context.cookies()` contains `boraoke_identity` (httpOnly) → reload → same cookie value persists → own-row highlighting (existing `patronUuid`-keyed behavior) still passes.
- `npm run build`, `npm test`, targeted `npm run test:e2e` (at minimum the new/extended spec plus `submit-song.spec.ts`/`rooms.spec.ts` since those exercise the touched routes) as the self-verify gate, output pasted verbatim into the dev report per the CI-verified-green contract (no `verify-green-local.sh` in this repo, per bootstrap notes).
