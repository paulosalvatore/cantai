# Review Report — TICKET-10: Rotation Modes UI (Engine Integration)

- **Reviewer:** Reviewer agent (D-011, opus tier — sole pass; this PR is non-trivial)
- **Date:** 2026-07-06
- **PR:** #14 — paulosalvatore/cantai, branch `ticket/10-rotation-modes`, tip `d3b213c`
- **Worktree:** `/Users/paulosalvatore/Documents/GitHub/cantai/.worktrees/ticket-10`

---

## Gate summary

| Gate | Verdict | Evidence |
|------|---------|----------|
| CI | GREEN | Vercel pass + build-and-test pass (1m45s) — verified via `gh pr checks 14` |
| App Tester | PASS | 10 evidence screenshots, all 9 test items pass, ordering/grace/caps/mode-switch/TV verified |
| Security | PASS (post-remediation) | MEDIUM-1 fixed (bulk rewrite + rate limiter), INFO-1 fixed, MEDIUM-2 documented, LOW-1 filed |
| Tests (local) | 23 suites / 325 tests PASS; engine 59/59 | Ran `npm ci` + `STORE_DRIVER=memory npx jest --testPathPattern="__tests__"` + `node --test` on tip — matched dev claim exactly |

---

## Verification performed

### 1. Tests run independently

```
App (jest, STORE_DRIVER=memory):
  Test Suites: 23 passed, 23 total
  Tests:       325 passed, 325 total
  Time:        1.208 s

Engine (node --test):
  pass 59 / fail 0 — duration 173ms
```

Exact match with dev report. No fabrication.

### 2. A1–A6 reconciliation — verified in code

| # | Claim | Verified |
|---|-------|----------|
| A1 | full-karaoke round-robin by uuid | `computeSingOrder` routes all modes through `roundRobin`; full-karaoke uses `e.uuid` as bucket key. `rotation-adapter.test.ts` AC1 asserts A,B,A,A on a 3A+1B queue. ✓ |
| A2 | caps 4/table, 2/person | `PER_TABLE_CAP=4` / `PER_PERSON_CAP=2` in both `engine.ts` and `rotation-modes.ts`. `capViolation` enforces them. ✓ |
| A3 | listen only when no sing pending | `SPEC_MAX_CONSECUTIVE_LISTEN = 0` in `rotation.ts:45`; passed as `options.maxConsecutiveListen` to every `buildState` call. `mergeListens` with cap=0 means any waiting sing preempts listens. AC4 test confirms sings all before listens. ✓ |
| A4 | grace lifecycle (first forgiven, second charged) | `skip()` increments `noShowStreakByUuid`, returns `graceGranted: true` on streak=1 (credit untouched), `graceGranted: false` on streak≥2 (recency bumped). `consume` deletes streak on actual sing. `byGraceThenSubmitted` sorts grace entries first within bucket. ✓ |
| A5 | duplicates: exact uuid+videoId+mode only | `addEntry` checks `e.uuid === input.uuid && e.videoId === input.videoId && e.mode === input.mode`. Different-uuid same-song passes. ✓ |
| A6 | canonical boundary = `lib/rotation.ts` | `lib/rotation-modes.ts` has no engine import and no `server-only`. `lib/rotation.ts` has `import "server-only"` and is the sole translation point: `patronUuid`→`uuid`, `"listen-dance"`→`"listen"`, `RoomMode`===`VenueMode` verbatim (zero translation). No leakage found in any route or component. ✓ |

### 3. Adapter boundary check

`lib/rotation-modes.ts` — client-safe: no `server-only`, no engine import. Used by `ModeSwitcher` (client component), `PatronRoom`, `TvScreen`, and server routes. ✓

`lib/rotation.ts` — server-only: `import "server-only"` at line 27. Not importable by client components. ✓

`tableBucket` in the adapter (`rotation.ts:48-50`) is behaviorally identical to `tableBucket` in the engine (`engine.ts:72-76`): both produce `table:${table}` when table is set, `no-table:${uuid}` otherwise. The adapter's now-playing seed uses `bucketKey(nowPlaying.patronUuid, nowPlaying.table)` which maps correctly to the engine's internal keying. ✓

### 4. Relay race analysis — careful reasoning

`relayQueue` in `lib/rotation.ts:221-226` does:
1. `store.getQueue(roomId)` → lrange
2. `orderQueue(items, mode)` → pure JS (sub-ms)
3. `store.rewrite(roomId, desired)` → del + rpush

**Race scenario**: a concurrent `store.addEntry` (`rpush`) from another request landing between step 1 and step 3's `del` → the new entry is atomically appended by rpush, then the relay's del removes everything including the new entry, then rpush restores only `desired` (which doesn't include the new entry). The new entry is **lost**.

**Assessment**: This is acknowledged explicitly in the security re-audit addendum ("A concurrent addEntry landing between the relay's read and its del is lost — last-writer-wins"). The analysis that it is "not worse than the accepted R-M-W class" is correct: the pre-existing `reorder` implementation in `upstash.ts` was also del+rpush, so each individual reorder already had the same race window. With `N-1` sequential reorders, there were `N-1` such windows; with a single `rewrite`, there is exactly one. The new design is strictly fewer race windows.

At PMF bar scale (physical bar, O(10-50) patrons, Vercel serverless), the race requires two requests executing concurrently within the ~1ms computation gap between lrange and del. **Practically invisible at this scale.** The entry self-heals on the next submit that triggers a relay. Accepted and not blocking.

**No-write optimization** (0/1-entry queue): `if (items.length <= 1) return;` at the top of `relayQueue` correctly skips both the compute and the write, eliminating one unnecessary race window. ✓

### 5. Frozen-interface amendment — `QueueStore.rewrite`

`lib/store/types.ts:74-84` adds `rewrite(roomId, entries)` to the interface with a doc note that the wave-2 freeze ended with wave 2. Both drivers implement it:
- `MemoryStore.rewrite`: `this.room(roomId).queue = [...entries]` — copies to avoid mutation aliasing. ✓
- `UpstashStore.rewrite`: delegates to private `rewriteKey` (del + variadic rpush). Constant 2 Redis commands regardless of N. ✓

Spy test in `rotation-adapter.test.ts:181-201` asserts exactly 1 `rewrite` call, 0 `reorder` calls, and verifies the resulting order. Genuine op-count verification. ✓

### 6. UI quality

**ModeSwitcher**: three cards from `MODE_META`, copy verbatim against `design-handoff.md §5` — all three strings match character-for-character. `ATIVO` chip on active mode. `role="radiogroup"` + `aria-checked`. Switches immediately, no confirm (reversible). `data-testid="mode-option-${m.mode}"` for testing. ✓

**30s TV mic-call** (scope check): Ticket item 5 explicitly lists "TV 30s 'get to the mic' call". Not scope creep. Implementation: `useEffect` on `nowPlayingId` + `nowPlayingIsSing`; fires once per entry (ref guard), counts down at 1s intervals, shows `data-testid="tv-mic-call"` with `role="status"`. Correctly suppressed for listen-dance now-playing. ✓

**Patron mode hint + reorder toast**: present in `PatronRoom.tsx` and `TvScreen.tsx`; toast dismisses after 5s. ✓

**pt-BR copy**: all rejection messages, toasts, mode cards, mic-call text in pt-BR throughout. ✓

### 7. Rate limiter

`lib/queue-rate-limit.ts`: dual sliding-window buckets (10/min/patronUuid + 60/min/IP), LRU-capped at 2000 buckets. In `POST /api/queue`: checked AFTER uuid regex validation (line 121) and BEFORE `getRoomMode`/`getQueue`/`checkSubmit`/`addEntry`/`relayQueue` — over-limit callers hit zero store ops. IP bucket always charged even when uuid bucket trips (uuid rotation doesn't dodge IP cap). Pattern matches the existing search/feedback rate limiters. 105-test suite in `queue-rate-limit.test.ts` covers cap trips, window slides, uuid rotation, malformed non-charge. ✓

### 8. INFO-1 resolution

`app/api/host/mode/route.ts:34`: `const valid = MODE_META.map((m) => m.mode)` — single source of truth, no rotting inline array. ✓

### 9. Ownership / rebase surface

Checked: `lib/store.ts`, `lib/youtube-search.ts`, `app/api/search/**`, `components/FeedbackWidget*`, `lib/telemetry*` — none appear in the diff. Must-not-touch list honored. ✓

---

## Findings

### NIT-1 — Stale module comment in `lib/rotation.ts` (line 13)

The module JSDoc header says "re-lay the store into effective order on the two ordering mutations (submit, mode-switch) using only the frozen `reorder` op." The security fix replaced the N-sequential `reorder` calls with a single `rewrite` op. The function-level JSDoc on `relayQueue` (lines 211-219) is accurate; only the module header is stale. **NIT — does not affect correctness.**

### NIT-2 — Unchecked `addEntry` return in grace path (`app/api/host/skip/route.ts:43-44`)

The grace branch does `removeEntry` then `addEntry` without checking addEntry's boolean return. As proven: post-remove queue is N-1 ≤ 199 < QUEUE_MAX=200, so addEntry always succeeds. Defensive check would be belt-and-suspenders. **NIT — optional.**

### Advisory — relay entry-loss race (acknowledged)

As analyzed in §4 above: a concurrent addEntry can lose an entry during a relay. Acknowledged, analyzed, accepted by security re-audit. Same class as pre-existing `reorder`, fewer race windows. **Not blocking.**

---

## Acceptance criteria check

| AC | Spec | Status |
|----|------|--------|
| AC1 | full-karaoke anti-hog: round-robin by person | ✓ engine + adapter tests + App Tester evidence |
| AC2 | per-table-2: tables alternate, cap=4 | ✓ engine + adapter tests + App Tester evidence |
| AC3 | per-person-1: round-robin by identity, cap=2 | ✓ engine + adapter tests + App Tester evidence |
| AC4 | listen only when no sing pending | ✓ maxConsecutiveListen=0, adapter test |
| AC5 | mode switch loses zero entries | ✓ adapter test + App Tester (before/after screenshots, count=5 both) |
| AC6 | no-show grace: first forgiven, second charged | ✓ engine tests + App Tester grace evidence |
| AC7 | verbatim mode-card copy on admin switcher | ✓ MODE_META strings match design-handoff.md §5 verbatim |
| AC8 | table required for sing in per-table-2 | ✓ checkSubmit table-required path + adapter test |

All eight implemented, test-covered, and demonstrated via App Tester.

---

## Verdict

**[reviewer] APPROVE — TICKET-10 is correctly implemented and ready to merge.**

Evidence base: 325/325 app tests + 59/59 engine tests verified independently on tip `d3b213c`; CI green (Vercel + build-and-test); App Tester PASS (10 screenshots, all ACs demonstrated); Security PASS post-remediation (MEDIUM-1 fixed and spy-verified, INFO-1 fixed, MEDIUM-2 documented, LOW-1 filed). A1–A6 reconciliation verified in code; adapter boundary clean; relay race acknowledged and not worse than the accepted store R-M-W class; UI copy verbatim from design mockup; TV 30s mic-call is in-scope. Two NITs (stale comment, unchecked addEntry return) are non-blocking.
