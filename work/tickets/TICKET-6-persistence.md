# TICKET-6 — Durable persistence (store swap under lib/store.ts)

- **Date:** 2026-07-05 · **Product:** cantai · **Author:** Product Owner (TICKET-19 batch)
- **Wave:** 1 (no cross-deps; launch at PR #4 merge)
- **Depends on:** TICKET-1 merged (owns the current `lib/store.ts`). Blocks: TICKET-7, 9, 11, 12.
- **Sizing:** S-M

## Goal

Queue state survives serverless invocations and deploys. The skeleton's module-level in-memory array dies per Vercel lambda instance — TWO patrons can hit two instances and see different queues. Nothing real ships until state is shared and durable.

## Recommended choice (PO call, rationale recorded)

**Upstash Redis via the Vercel Marketplace integration** (what "Vercel KV" is today — Vercel retired first-party KV in favor of Marketplace Upstash).

- Queue state is small, hot, and list/hash-shaped — Redis native; free tier (10k cmds/day) covers early access comfortably at our polling volume if reads are batched per request.
- Postgres/Neon is the wrong shape now: schema/migrations overhead for what is a rotating list + a few counters, and we'd still want Redis-ish latency for 3-second polling. Revisit Postgres at venue accounts (#14) when relational data (venues, billing) actually exists — the interface below makes that swap cheap.
- SDK: `@upstash/redis` (HTTP-based, serverless-safe, no connection pooling issues).

## Scope — in

1. Define an async store interface and keep `lib/store.ts` the single import point (implementation swaps behind it):
   - `getQueue(roomId)`, `addEntry(roomId, entry)`, `removeEntry(roomId, entryId)`, `advance(roomId)`, `nowPlaying(roomId)`, `reorder(roomId, entryId, newIndex)`, `setPaused(roomId, paused)` / `isPaused(roomId)`, `clear(roomId)` (test helper).
   - All ops **room-scoped** (`roomId` param; single hardcoded `"default"` room until TICKET-9 — the key-schema is room-ready NOW so #9 doesn't touch this file).
   - The reorder/pause/remove ops ship here even though their UI is TICKET-7 — the interface freezes in this ticket so wave-2 tickets never edit `lib/store.ts`.
   - Entry shape: keep TICKET-1's `QueueEntry` plus reserve `graceRequeue?: boolean` (rotation spec field; consumed in TICKET-10).
2. Upstash implementation + a fallback in-memory implementation (same interface) selected by env — local dev and CI run without creds (`STORE_DRIVER=memory` default when `UPSTASH_REDIS_REST_URL` is absent).
3. Mechanical async-await updates in `app/api/queue/route.ts` and `app/api/queue/advance/route.ts` (store calls become awaited; no behavior change).
4. `.env.example` entries + README persistence section (replacing the "resets on restart" limitation note).
5. Unit tests run against the memory driver; Upstash driver gets a thin integration test skipped when creds are absent.

## Scope — out

Rooms UI (#9), host controls UI (#7), feedback/telemetry storage modules (#11/#12 build their own modules on the same client), rotation ordering (#10), migrations/Postgres.

## File ownership (parallel-dev boundaries)

- **Owns:** `lib/store.ts`, `lib/store/` (new dir: `memory.ts`, `upstash.ts`, `types.ts`), `app/api/queue/**` (async edits only), `__tests__/store*`, `package.json`/lockfile (add `@upstash/redis`), `.env.example`, README persistence section.
- **Must not touch:** `app/page.tsx`, `app/tv/**`, `app/layout.tsx`, `lib/youtube.ts`, `packages/rotation-engine/**`, `work/design/**`.

## Needs-user / needs-TM

Provision the Upstash Redis database via the Vercel Marketplace on the connected project (`paulosalvatores-projects/cantai`) and pull `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` into Vercel env + local `.env`. Account-level action — TL creds or TM with access (memory: creds provided = execute; escalate only if the dashboard blocks).

## Acceptance criteria

1. Two parallel `next dev`/lambda instances (or two `curl` sessions against the deployed app) see the same queue after a submit — no per-instance state.
2. Queue survives a redeploy/server restart with `STORE_DRIVER=upstash`.
3. With no Upstash creds, the app boots and all existing tests pass on the memory driver (CI stays green with zero secrets).
4. `removeEntry`, `reorder`, `setPaused` work through the interface (unit-tested), even though no UI calls them yet.
5. All store ops are room-scoped in the key schema (`room:default:*`); no key is global-unscoped.
6. No store import anywhere except via `lib/store.ts`.
