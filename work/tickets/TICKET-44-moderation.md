# TICKET-44 — Venue-optional song moderation

**Product:** boraoke
**Status:** in progress
**Branch:** `ticket/44-moderation` · worktree `.worktrees/ticket-44` · app port `3044`
**Parallel context:** TICKET-45 runs concurrently and owns `/api/queue/advance`, the TV server page + `TvScreen` fetch layer, `lib/host-auth.ts`, and e2e drain helpers. This ticket owns `/api/queue` POST (the submission path), the admin approval UI, the patron pending-state UI, `RoomSettings.moderation` (additive), and its own store keyspace.

## TL intent (verbatim)

> "optional to enable moderation, to make sure people doesnt add wrong oriented stuff"

Venues get an **opt-in** switch that routes every patron submission through host approval before it can hit the public queue / TV. Default OFF — every existing room and the whole current flow are unchanged.

## Scope

### 1. Room setting (additive, mirrors `mode` / `language`)

- Add `RoomSettings.moderation?: boolean` in `lib/rooms.ts`. Optional + additive, exactly like `language?`. **Absent/legacy → `false`** via a `getRoomModeration(roomId)` normalizer (no migration, no write). Default OFF preserves current behavior for every existing room.
- `setRoomModeration(roomId, on)` in-place mutator mirroring `setRoomMode` / `setRoomLanguage` (reads room, `{ ...room, settings: { ...room.settings, moderation } }`, `roomBackend.update`, returns the new value or `null` when the room does not exist).
- Host toggle in admin: **"Moderação de músicas"** with a one-line explainer ("músicas entram numa fila de aprovação antes de ir pro telão"). Sits alongside the room-language card in the AdminRoom right column.
- Host-authed `POST /api/host/moderation?room=<id>` route following the `/api/host/language` convention **exactly**: `roomIdFromRequest` → `requireHost` → JSON parse → validate `moderation: boolean` → `setRoomModeration` (404 if room missing) → `track("host_action", { props: { action: "moderation_change", moderation, from } })` → `{ ok: true, moderation }`.
- The public `GET /api/queue` already returns `mode`/`paused`; add `moderation` to that payload so patron/admin/TV polls can read the room's current setting without an extra round-trip.

### 2. Submission flow when moderation is ON

- In `/api/queue` POST, after the entry passes ALL existing upstream gates (body validation, submit rate limit, `checkSubmit` caps/fairness, videoId validation) — **branch on `getRoomModeration(roomId)`**:
  - **OFF (default):** unchanged — `store.addEntry` + `relayQueue`, return `201 { entry }`.
  - **ON:** the entry does NOT enter the queue. Instead it is written to a **separate room-scoped pending list** (new `lib/pending-store.ts`, parallel keyspace — see §Design). Return `202 { entry, pending: true }` so the client can distinguish "queued" from "awaiting approval".
- **Where pending lives (critical):** a brand-new store module `lib/pending-store.ts` mirroring `lib/feedback-store.ts`'s driver-selection pattern EXACTLY (memory | upstash, injectable `PendingRedisLike`). It has its OWN keyspace (`room:<id>:pending:*`) and NEVER touches the frozen `QueueStore` queue semantics. The rotation engine (`orderQueue` / `relayQueue`) only ever sees `store.getQueue`, so an unapproved entry is invisible to fairness, caps, TV, and the public queue by construction.
  - **Caps/fairness are re-checked AT APPROVAL time, not submit time** (an entry pending for 20 min must still respect the live queue's caps when it lands). Submit-time `checkSubmit` still runs as a cheap first filter (rejects obvious over-cap spam before it can occupy a pending slot).

### 3. Admin approval UI

- New pending section on `AdminRoom` (left column, above the live queue): a **badge count** ("Aprovações · N") and one card per pending entry showing nickname / table / title-or-videoId, with **approve ✓** and **reject ✕** buttons.
- Admin polls a new host-authed `GET /api/host/pending?room=<id>` (returns the room's pending list) on the existing `POLL_INTERVAL` (3s) — same real-time-ish polling pattern the queue already uses.
- **Approve** → `POST /api/host/pending/approve` with `{ pendingId }`: host-authed, pops the entry from the pending list and runs the **normal `addEntry` + `relayQueue` flow** — so ALL existing caps/fairness apply AT APPROVAL TIME. If the live queue is now at `QUEUE_MAX` or the entry now fails `checkSubmit`, the approval is refused with a friendly reason (entry stays pending so the host can retry after the queue drains). Emits `track("host_action", { props: { action: "approve" } })`.
- **Reject** → `POST /api/host/pending/reject` with `{ pendingId }`: host-authed, marks the pending entry `rejected` (kept briefly so the patron's poll can surface the rejected state, then it ages out / is dropped). Emits `track("host_action", { props: { action: "reject" } })` AND `track("submit_rejected", { uuid, props: { reason: "moderation" } })`.

### 4. Patron pending-state UI

- After a `202 pending` submit, the patron sees their entry in their own view labelled **"aguardando aprovação do anfitrião"** — shown in the patron's queue area but visually distinct from real queue rows, and NOT counted in the public queue count.
- The patron polls their own pending entries via a public, uuid-scoped `GET /api/queue/pending?room=<id>&uuid=<patronUuid>` (only ever returns THIS uuid's own pending/rejected entries — never another patron's, never the whole list). On the existing 3s poll.
- On **reject**, the patron's view updates to a polite rejected state ("o anfitrião não aprovou esta música" — party-host voice, no scolding). On **approve**, the entry disappears from the pending area and appears in the normal live queue on the next poll.

### 5. Telemetry (reuse existing event types via props — NO new event types)

- `host_action` with `props.action` ∈ `{ "approve", "reject", "moderation_change" }` — new prop VALUES on the existing frozen `host_action` event.
- `submit_rejected` with `props.reason = "moderation"` — new reason VALUE on the existing frozen `submit_rejected` event.
- Update the docstrings in `lib/telemetry-types.ts` to note the new prop values (documentation only — the `TELEMETRY_EVENTS` union is unchanged).

### 6. Rate / abuse coherence

- The pending list is **bounded**: a per-room `PENDING_MAX` cap AND a per-uuid pending cap (a single patron can't flood the host's approval queue). Over either cap → a polite 429-style refusal drawn from the catalogs.
- The existing submit rate limits (`submitRateLimitOk` — 10/min/uuid + 60/min/IP) still apply upstream, unchanged, BEFORE the moderation branch — so moderation never widens the abuse surface.

### 7. Tests

- **Unit** (`__tests__/pending-store.test.ts`): both drivers via the conformance pattern (memory + Upstash-with-FakeRedis, mirroring `feedback-store.test.ts`) — add / list-by-room / list-by-uuid / approve-pop / reject / per-room cap / per-uuid cap / clear.
- **Unit** (`lib/rooms` moderation getter/setter; the approval→`addEntry` caps-at-approval flow).
- **e2e** (`e2e/moderation.spec.ts`): moderation ON → submit returns pending → patron sees "aguardando" → host approves → appears in queue → plays; reject → patron sees rejected state; moderation OFF → submission is unchanged (straight to queue). Runs on `PORT=3044`.
- All new user-facing strings land in all THREE catalogs (`messages/pt-BR.json` + `en.json` + `es.json`), party-host voice; the CI completeness gate enforces parity.

## Pending-store design (parallel keyspace — mirrors feedback-store)

New `lib/pending-store.ts`, structurally a sibling of `lib/feedback-store.ts`:

- `PendingEntry` = `QueueEntry` shape + `roomId`, `status: "pending" | "rejected"`, a time-sortable `pendingId`, `createdAt`.
- `interface PendingStore` (all async): `add(entry)`, `listRoom(roomId, {limit})`, `listForUuid(roomId, uuid)`, `get(roomId, pendingId)`, `take(roomId, pendingId)` (pop for approval — returns the entry & removes it, or null), `reject(roomId, pendingId)` (flip to rejected), `countRoom(roomId)`, `countUuid(roomId, uuid)`, `clear(roomId)`.
- `MemoryPendingStore` + `UpstashPendingStore(redis: PendingRedisLike)` + `createUpstashPendingStore()` + `resolveDriver()` + `pendingStore` singleton — byte-for-byte the feedback pattern.
- Keyspace: `pendingKeys = { index: (roomId) => room:<id>:pending:index, item: (roomId, id) => room:<id>:pending:item:<id> }`. Room-scoped, never collides with `room:<id>:queue` (frozen store) or `feedback:*` / `telemetry:*`.
- **The frozen `QueueStore` (`lib/store/*`) is NOT touched.** This is the whole point: the rotation engine never sees an unapproved entry.

## Files touched

**New:**
- `lib/pending-store.ts`, `lib/pending-types.ts` (caps + `PendingEntry`)
- `app/api/host/moderation/route.ts`
- `app/api/host/pending/route.ts` (GET list)
- `app/api/host/pending/approve/route.ts`, `app/api/host/pending/reject/route.ts`
- `app/api/queue/pending/route.ts` (patron GET, uuid-scoped)
- `__tests__/pending-store.test.ts`, `e2e/moderation.spec.ts`
- `components/host/ModerationToggle.tsx` (+ pending section, or inline in AdminRoom)

**Edited:**
- `lib/rooms.ts` — `RoomSettings.moderation?`, `getRoomModeration`, `setRoomModeration`
- `app/api/queue/route.ts` — moderation branch in POST; `moderation` in GET payload
- `app/(patron)/[room]/admin/AdminRoom.tsx` (+ `admin.module.css`) — toggle + pending section
- `app/(patron)/[room]/PatronRoom.tsx` — pending/rejected patron view
- `lib/telemetry-types.ts` — docstring only (new prop values)
- `messages/{pt-BR,en,es}.json` — new strings
- `__tests__/rooms.test.ts` (if present) — moderation getter/setter

## Risks / decisions

- **No TvScreen change needed** (TICKET-45's file): pending lives outside the queue, so it never reaches the TV fetch layer. Confirmed — `TvScreen` reads `/api/queue`, which only ever returns approved queue entries. Zero overlap with #45 on TV.
- **Caps at approval, not submit:** deliberate — an approved song must respect the live queue at the moment it lands, not at submit time. Submit-time `checkSubmit` stays as a cheap pre-filter.
- **Memory-driver volatility:** same honest caveat as feedback/queue — pending is durable only on Upstash; memory driver is per-process (fine for dev/CI, documented gap in prod until Upstash is provisioned).
- **Overlap with #45:** the only potential shared file is `e2e` helpers if seeding is needed — this ticket's e2e uses its own submit/approve helpers scoped to the moderation spec, so no shared-helper edit is required. Flag for sequential merge only if a shared helper edit becomes unavoidable.

## Acceptance

- Moderation OFF (default, all existing rooms): submission flow byte-identical to today; no pending UI anywhere.
- Moderation ON: submit → `202 pending`, entry NOT in public queue / not on TV / not consuming fairness; patron sees "aguardando"; host approves → normal queue entry (caps applied at approval); host rejects → patron sees polite rejected state.
- Pending list bounded (room cap + per-uuid cap), polite 429 on overflow.
- Telemetry: only existing event types, new prop values.
- All strings in 3 catalogs; CI completeness gate green.
- `scripts/verify-green-local.sh` GREEN; unit + e2e pass; build clean.
