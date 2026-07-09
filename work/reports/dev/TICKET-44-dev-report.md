# Dev Report — TICKET-44 (venue-optional song moderation)

**Status:** IMPLEMENTING (exploration + plan done, worktree live)
**Branch:** `ticket/44-moderation` · worktree `.worktrees/ticket-44` · port `3044`
**PR:** _pending first commit_

## Picking up from

Fresh start. Pulled latest `origin/main` (i18n / trilingual catalogs already merged). Created worktree `.worktrees/ticket-44`, branch `ticket/44-moderation`, upstream `origin/ticket/44-moderation` (verified), port 3044 free. Emitted `worktree_created`.

## Exploration (done)

Read the queue/host/store/i18n/telemetry/test areas directly + one Explore fan-out. Key findings:

- **Setting pattern to mirror:** `RoomSettings` in `lib/rooms.ts`; `mode` + optional `language?`. `getRoomMode`/`setRoomMode` + `getRoomLanguage`/`setRoomLanguage` are the exact template for `getRoomModeration`/`setRoomModeration` (in-place `roomBackend.update`, normalize absent→default, 404-via-null on missing room).
- **Host endpoint template:** `/api/host/language/route.ts` — `roomIdFromRequest` → `requireHost` → JSON → validate → setter → `track("host_action", …)` → `{ ok, … }`.
- **Parallel-keyspace pattern:** `lib/feedback-store.ts` is the model — memory+upstash drivers, injectable `FeedbackRedisLike`, `feedback:{index,item,rl}` keyspace, `feedbackStore` singleton, both-driver conformance test with a `FakeRedis`. Pending store mirrors this exactly under `room:<id>:pending:*`.
- **Frozen queue = clean isolation:** `QueueStore` (`lib/store/types.ts`) is frozen; rotation (`orderQueue`/`relayQueue`), public `GET /api/queue`, and `TvScreen` all read ONLY `store.getQueue`. So pending entries in a separate keyspace are invisible to fairness/caps/TV/public-queue **by construction** — no filtering, and **no TvScreen edit** (→ zero overlap with TICKET-45).
- **Submit path:** `/api/queue` POST gates in order: size → JSON → field validation → `submitRateLimitOk` (429 `submit_rejected{reason:rate}`) → `checkSubmit` caps (409) → `addEntry` cap (429) → `relayQueue` → `song_queued` 201. Moderation branch inserts after `checkSubmit`, before `addEntry`.
- **Telemetry frozen union:** `host_action` + `submit_rejected` already exist — I only add new prop VALUES (`action:approve|reject|moderation_change`, `reason:moderation`), no new event types (docstring update only).
- **UI:** `AdminRoom.tsx` (3s poll, optimistic host actions, language card = toggle template) + `PatronRoom.tsx` (3s poll, submit handler). e2e: `warmUp`/`drain`/`seed` helpers, dev token `cantai-dev-host`, `PORT` override.

## Plan

`work/plans/TICKET-44-plan.md` — full file list, endpoint contract table, submission branch, test strategy. No user input needed (default-OFF, additive, unambiguous).

## Implementation log

_(SHAs appended as commits land.)_

## Self-verification

_(build + unit + e2e + verify-green-local output pasted here before any gate request.)_

## Friction

_(none yet.)_
