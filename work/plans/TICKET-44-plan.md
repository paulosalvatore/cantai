# TICKET-44 — Implementation Plan: venue-optional song moderation

**Status:** awaiting plan gate (APPROVED-BY: _pending_)
**Branch:** `ticket/44-moderation` · worktree `.worktrees/ticket-44` · port `3044`

## Approach

Opt-in host moderation. When ON, a patron submission — after passing every existing upstream gate — is diverted into a **parallel pending keyspace** instead of the queue. The host approves/rejects from admin; approve runs the normal `addEntry` + `relayQueue` flow (caps applied AT approval time); reject surfaces a polite state to the patron. When OFF (default, and every existing room), nothing changes.

The design rests on ONE architectural decision that also eliminates all overlap with TICKET-45: **pending entries never enter the frozen `QueueStore`.** They live in a new `lib/pending-store.ts` that mirrors `lib/feedback-store.ts` byte-for-byte (memory | upstash driver selection, injectable `PendingRedisLike`, index+item keyspace). Because the rotation engine, the public `GET /api/queue`, and `TvScreen` all read only `store.getQueue`, an unapproved entry is invisible to fairness, caps, TV, and the public queue *by construction* — no filtering, no TvScreen edit.

## Files

**New:**
- `lib/pending-types.ts` — `PendingEntry` (QueueEntry + `roomId`, `pendingId`, `status`, `createdAt`), `PENDING_ROOM_MAX`, `PENDING_UUID_MAX`, `generatePendingId` (time-sortable, copied from `generateFeedbackId`).
- `lib/pending-store.ts` — `PendingStore` iface + `MemoryPendingStore` + `UpstashPendingStore` + `PendingRedisLike` + `createUpstashPendingStore` + `pendingStore` singleton. Keyspace `room:<id>:pending:{index,item:<id>}`.
- `app/api/host/moderation/route.ts` — POST, mirrors `/api/host/language`.
- `app/api/host/pending/route.ts` — GET (host-authed) room pending list.
- `app/api/host/pending/approve/route.ts` — POST `{ pendingId }` → take + addEntry + relay (caps at approval).
- `app/api/host/pending/reject/route.ts` — POST `{ pendingId }` → mark rejected.
- `app/api/queue/pending/route.ts` — GET (public, uuid-scoped) patron's own pending/rejected entries.
- `components/host/ModerationToggle.tsx` — the labelled switch + explainer.
- `components/host/PendingApprovals.tsx` — badge + approve/reject cards.
- `__tests__/pending-store.test.ts` — both-driver conformance (mirrors `feedback-store.test.ts`).
- `e2e/moderation.spec.ts` — ON approve/reject + OFF unchanged.

**Edited:**
- `lib/rooms.ts` — `RoomSettings.moderation?: boolean`; `getRoomModeration` (normalize absent→false); `setRoomModeration` (mirror `setRoomLanguage`).
- `app/api/queue/route.ts` — moderation branch in POST (after all existing gates); add `moderation` to GET payload.
- `app/(patron)/[room]/admin/AdminRoom.tsx` + `admin.module.css` — mount toggle + pending section; poll `/api/host/pending`.
- `app/(patron)/[room]/PatronRoom.tsx` — pending/rejected patron area; poll `/api/queue/pending`.
- `lib/telemetry-types.ts` — docstring only: new `host_action` action values (`approve`/`reject`/`moderation_change`) + `submit_rejected` reason `moderation`.
- `messages/{pt-BR,en,es}.json` — new `Admin` + `Patron` + `Errors` strings (pt-BR authored first, party-host voice).
- `__tests__/rooms.test.ts` (if present) — moderation getter/setter + approval caps.

## Endpoint contracts

| Method | Route | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/api/host/moderation?room=` | host | `{ moderation: boolean }` | `{ ok, moderation }` |
| GET | `/api/host/pending?room=` | host | — | `{ items: PendingEntry[] }` |
| POST | `/api/host/pending/approve?room=` | host | `{ pendingId }` | `{ ok }` / 409 caps-at-approval |
| POST | `/api/host/pending/reject?room=` | host | `{ pendingId }` | `{ ok }` |
| GET | `/api/queue/pending?room=&uuid=` | public (uuid-scoped) | — | `{ items: PendingEntry[] }` (this uuid only) |
| POST | `/api/queue` (existing) | public | (unchanged) | `201 {entry}` OFF · `202 {entry,pending:true}` ON |

## Submission branch (in `/api/queue` POST)

After `checkSubmit` passes and BEFORE `store.addEntry`:
```
if (await getRoomModeration(roomId)) {
  // per-room + per-uuid pending caps → 429 catalog copy on overflow
  await pendingStore.add(pendingEntryFrom(entry, roomId));
  return 202 { entry, pending: true };
}
// else: existing addEntry + relayQueue + song_queued → 201
```
`song_queued` is emitted only on actual queue entry (i.e. OFF path, or at approval time) so telemetry counts real plays, not pending.

## Test strategy

- **Unit — pending store conformance** (both drivers via `describe.each`, FakeRedis for upstash): add / listRoom / listForUuid (isolation: uuid A never sees uuid B) / take (pop) / reject / countRoom+countUuid caps / clear. ~12–16 cases × 2 drivers.
- **Unit — rooms moderation**: default false; set true/false idempotent; 404 on missing room.
- **Unit — approval caps**: approve when queue at `QUEUE_MAX` → refused, entry stays pending; approve when `checkSubmit` now fails → refused.
- **e2e (`PORT=3044`)**: (a) moderation ON: submit→202, patron sees "aguardando", host approves, entry appears in queue + advances/plays; (b) reject → patron sees polite rejected copy; (c) moderation OFF → submit goes straight to queue (regression guard).

## Risks

- **Caps at approval vs submit** — chosen: re-check at approval (live-queue-correct). Submit-time `checkSubmit` stays as a cheap pre-filter. Documented in ticket.
- **Memory-driver volatility** — same honest caveat as feedback/queue: durable only on Upstash. Fine for dev/CI.
- **i18n parity gate** — every new string in all 3 catalogs or CI red. Author pt-BR first, translate en/es in the same commit.
- **No TvScreen / advance / host-auth edits** — confirmed no overlap with TICKET-45. Only theoretical shared surface is e2e helpers; this spec ships self-contained helpers, so no shared-helper edit.

## Needs user input

None. Default-OFF is unambiguous; all copy is party-host voice per house standard.
