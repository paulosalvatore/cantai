# Dev report — TICKET-12 (telemetry baseline)

- **Branch:** `ticket/12-telemetry` · **Worktree:** `.worktrees/ticket-12` · **Port:** 3012
- **Status:** IMPLEMENTED + self-verified (build ✓, 233 unit ✓, 14 e2e ✓) — draft PR open; instrumentation one-liners deferred to the final rebase after TICKET-9 (wave rule)

## Picking up from

Fresh Dev on a fresh worktree off `main` (a4725f6, TICKET-6/7/8/11/18 merged). No prior work on this ticket.

## Exploration summary

- House driver pattern mirrored from `lib/feedback-store.ts` (memory default / Upstash by env / `server-only` / injectable `RedisLike` subset / singleton). Queue store (`lib/store*`) untouched (frozen).
- Test style: Jest `describe.each` conformance over both drivers with a `FakeRedis` (mirrors `__tests__/feedback-store.test.ts`).
- `appVersion()` chain reused from `app/api/feedback/route.ts` (`GIT_SHA` → `VERCEL_GIT_COMMIT_SHA` → `NEXT_PUBLIC_GIT_SHA` → `"dev"`).
- Wave rule confirmed: TICKET-9 owns the route surfaces concurrently → NO instrumentation lines in others' routes in this PR.

## Implementation log

- `f269ff6` — feat(telemetry): the full foundation:
  - `lib/telemetry-types.ts` — PURE: 8 typed event names, `TelemetryEvent` schema (`{event, roomId, sessionKey?, uuid?, ts, appVersion, props{small}}`), `sanitizeProps` (≤8 keys, scalars only, 64-char cap — free text impossible), day-bucket key schema (`telemetry:events:<YYYY-MM-DD>` + `telemetry:days`), `CLIENT_ALLOWED_EVENTS` beacon subset.
  - `lib/telemetry-store.ts` — `server-only`; `MemoryTelemetryStore` + `UpstashTelemetryStore` (injectable `TelemetryRedisLike`), same driver resolution as #6/#11, singleton. **No cursor/watermark contract** (PR #11 opus lesson: in-list order ≠ commit order under concurrent writes) — whole-day-range reads, best-effort ts sort, documented in the module header.
  - `lib/telemetry.ts` — `track()`: fail-open by contract (never rejects, swallow-and-count via `droppedCount()`), server-filled ts/appVersion, `TELEMETRY_DISABLED` kill switch, `createTracker(store)` for test injection.
  - `app/api/t/route.ts` — POST beacon: client-allowed subset only (data-poisoning guard), 2KB body cap, uuid regex, 202 even on store outage; validation failures 400.
  - `lib/telemetry-rollup.ts` — PURE: ISO-week math, `computeRollup` (sessions via >60min gap split, active days = retention proxy, engagement, host actions by type, search-no-submit derived per uuid within 10-min window, cap rejections, no-show skips), markdown renderer.
  - `scripts/telemetry-rollup.ts` + `npm run telemetry:rollup` — Upstash-direct or deterministic `--demo-seed`; imports pure modules only (no `server-only` under ts-node).
  - Evidence: `work/telemetry/rollups/2026-W27.md` (495 seeded events, 3 venue profiles, all four tables) — AC3.
  - Docs: `work/telemetry/README.md` (exhaustive what-is-collected) + README "Telemetry & privacy" plain-language section (anonymous, no ads, LGPD-friendly) — AC5.
  - `.env.example`: append-only telemetry section (reuses Upstash vars; documents `TELEMETRY_DISABLED`).
  - Tests: 43 new unit (4 suites) + 3 e2e (`e2e/telemetry.spec.ts`).

## Self-verification (local, Node 25)

- `npm run build` — ✓ compiled, `/api/t` registered as a dynamic route.
- `npm test` — **Test Suites: 15 passed, Tests: 233 passed** (was 190 on main; +43).
- `PORT=3012 npm run test:e2e` — **14 passed (18.6s)** (was 11; +3). Playwright managed the server; port 3012 free afterwards (verified via lsof).
- `npm run telemetry:rollup -- --week 2026-W27 --demo-seed` — ✓ wrote the sample rollup.
- Fail-open explicitly tested: store rejecting/throwing → `track()` resolves false; beacon still 202 with `append` mocked to reject (AC2).

## Rebase-time instrumentation list (final step, after TICKET-9 merges)

One-line additive `track(...)` calls (shared-file protocol; never reorder/refactor the host file):

| Event | File / branch point | Props |
|---|---|---|
| `song_queued` | `app/api/queue/route.ts` POST success (after `addEntry` true) | `kind: rawVideoId ? "search" : "paste"`, `mode` |
| `submit_rejected` | `app/api/queue/route.ts` POST cap branch (429) | `reason: "cap"` |
| `song_played` | `app/api/queue/advance/route.ts` POST (promoted entry) | — |
| `song_skipped` | `app/api/host/skip/route.ts` after `store.advance` | `reason: "host"` |
| `host_action` | `app/api/host/{skip,pause,remove,reorder}/route.ts` after auth + op | `action` (`pause` route: `pause`/`resume` from the flag) |
| `search_performed` | `app/api/search/route.ts` GET success | `results: <count>` |
| `room_created` | #9's room-creation surface | — |
| `patron_joined` | #9's join flow (server call if one exists; else the `/api/t` beacon) | — |

Route paths above are the pre-#9 locations — re-resolve them against #9's restructure at rebase time.

## Friction

None blocking. Note: `ts-node` needs `--compilerOptions '{"module":"commonjs","moduleResolution":"node"}'` because the app tsconfig uses `bundler` resolution — encoded in the npm script so nobody rediscovers it.
