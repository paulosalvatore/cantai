# TICKET-40 — Reviewer Report

**Verdict: APPROVE**
**Reviewer model:** claude-sonnet-4-6 (first-pass; this PR is a focused UX change — TM may record opus-skip per D-022 for this scope)
**Date:** 2026-07-08
**PR:** #21 — paulosalvatore/boraoke — `ticket/40-search-ux`
**Branch reviewed:** `origin/ticket/40-search-ux` (tip `b6fb496`)
**Diff base:** `a1129ed` (merge-base with `origin/main`)

---

## Gates verified

| Gate | Status | Evidence |
|---|---|---|
| App Tester | PASS (re-test after BUG-01 fix) | `work/reports/testing/TICKET-40-app-test.md`, PR comment #4918887473 |
| Security | TM-waived N/A-by-content | Waiver assessed below — confirmed appropriate |
| CI — `npm test` (Jest unit) | **369 passed / 369 total, 25 suites** | Reviewer ran locally |
| CI — `npm run build` | **Green** | Reviewer ran locally |
| CI — `node --test` rotation-engine | **59 passed / 0 failed** | Reviewer ran locally |
| CI — `PORT=3040 npx playwright test` (e2e) | **30 passed** | Reviewer ran locally |

Note: there is no `scripts/verify-green-local.sh` in this repo. The four gates above reproduce the full `ci.yml` suite and were all run by the reviewer directly in the worktree. GitHub Actions checks are suppressed (CONFLICTING branch state, known conflict with the events jsonl class on main — to be resolved at TM merge; all local gates are the authoritative bar per D-051 per the app-tester note and the TM's conflict waiver).

---

## What was checked

### 1. Diff read (git-local-first)
Full diff read locally from `git diff a1129ed..origin/ticket/40-search-ux`. Five core files reviewed in depth: `lib/search-query.ts`, `components/SongSearch.tsx`, `app/(patron)/[room]/PatronRoom.tsx`, `__tests__/search-query.test.ts`, `e2e/search.spec.ts`. Supporting artifacts (ticket, dev report, app-tester report, PR thread) all read and cross-checked.

### 2. Correctness — scope delivered

Both acceptance criteria are delivered:

**§1 Select → jump to CTA:** Implemented as a `useEffect([parsedVideoId])` in `PatronRoom.tsx` (lines 141–147). The dependency array is exactly `[parsedVideoId]` — correct; it fires when a song is chosen (non-null) but not on null (selection cleared, post-submit reset). Both selection sources (result pick via `handlePick` → `onSelect` → `handleSelect` → `setParsedVideoId`; paste resolve via direct `onSelect` call in the `useEffect` body of `SongSearch`) converge on `parsedVideoId` via `handleSelect`. Effect fires after React commits, so the CTA is already enabled when `.focus()` runs — this is the exact fix for BUG-01. The implementation uses `scrollIntoView({ block: "center", behavior: "smooth" })` + `.focus({ preventScroll: true })` — correct ergonomics for centering above the mobile keyboard fold without competing scrolls.

**§2 Mode-aware karaoke keyword:** `lib/search-query.ts#augmentQuery` is called in `SongSearch.runSearch` with the raw (not pasted) query. `runSearch` correctly includes `mode` in its `useCallback` dependency array, so when mode changes, the callback is recreated and the debounced search effect fires a new search with the updated augmentation. Mode switches after results are shown do re-run correctly (the `[input, runSearch]` dependency in the search effect picks up the new `runSearch`). Cache coherence is correct: the augmented string is what the `?q=` param carries, so the server's cache key (which is keyed on `q`) naturally separates sing and listen searches for the same raw term. Zero server-side changes needed and none were made.

**No auto-submit:** verified in both code and the e2e test — the CTA receives focus but no click is programmatically fired.

**Post-submit reset:** when `handleSubmit` succeeds, `setParsedVideoId(null)` is called, which triggers the effect but the null guard (`if (!parsedVideoId) return;`) fires immediately — no uninvited focus jump. Confirmed by the App Tester's re-test post-submit check (activeElement = BODY).

### 3. `lib/search-query.ts` — logic quality

The implementation is clean and well-documented. Key assessments:

**Whole-word karaoke dedupe (`/\bkaraoke\b/i`):** This is the correct pattern for ASCII "karaoke". The word boundary `\b` prevents false positives on "karaokestar" (correctly tested and verified).

**The `karaokê` accent question (this reviewer's explicit mandate):** The regex `/\bkaraoke\b/i` does NOT match the accented Portuguese spelling `karaokê`. This is a conscious, documented design decision (dev report: "the accented Portuguese 'karaokê' is NOT treated as already-present — acceptable, the keyword we inject is the ASCII 'karaoke' that YouTube search matches").

The practical outcome when a pt-BR user types `karaokê` in sing mode: `augmentQuery` returns `"karaokê karaoke"` — both the accented word and the ASCII keyword are sent to YouTube. This is actually beneficial behavior: YouTube's search will handle both spellings, maximizing recall for karaoke results. A user who types "show de karaokê" gets "show de karaokê karaoke" sent — YouTube understands both. The unit tests explicitly document this behavior (`"karaokê is different but Karaoke matches"`).

Verdict on the `karaokê` case: **the current behavior is correct and the design decision is sound**. The ASCII "karaoke" is the augmentation keyword that YouTube indexes; the accented form in a user query is not an existing karaoke marker — it's part of the search intent. The dedupe target is the injected keyword, not every spelling of the concept. The test suite explicitly documents the behavior. No change required.

**Empty/whitespace queries:** `if (!trimmed) return trimmed;` — an empty trimmed string short-circuits before augmentation. Returns `""` (the result of trimming). Tested. Correct.

**Injection safety:** `augmentQuery` only appends the hardcoded `"karaoke"` literal. The output feeds the existing `/api/search?q=` parameter, which is validated at the server with `MIN_QUERY=3`, `MAX_QUERY=100` character bounds. Pasted YouTube URLs never reach `augmentQuery` — they are resolved locally in `SongSearch` via `parseYouTubeVideoId` and flow directly to `onSelect`, bypassing `runSearch` entirely (confirmed in `SongSearch.tsx` lines 113–132).

### 4. Focus mechanism — `useEffect([parsedVideoId])`

**Dependency array correctness:** `[parsedVideoId]` is the single correct dependency. The effect reads `submitBtnRef.current` (a ref, not reactive state) and calls stable DOM methods — no other reactive values needed. No lint violations.

**Null guard:** `if (!parsedVideoId) return;` prevents focus/scroll on clear and post-submit reset. Confirmed working by the App Tester.

**Interaction with TICKET-43 (PR #22):** PR #22's `PatronRoom.tsx` change adds a `rememberJoinedRoom` call inside the boot `useEffect([roomId])` (line 76+ region). This is a different location from the `useEffect([parsedVideoId])` added here (line 141). Both branches diverge from the same merge-base `a1129ed`. The diff is spatially non-overlapping — a standard three-way merge will apply both cleanly once PR #40 merges first. PR #22's rebase must preserve `submitBtnRef` + `useEffect([parsedVideoId])` + the `mode` prop on `<SongSearch>` — these are additive and stable anchors for git's merge algorithm. No conflict risk.

### 5. Client-side augmentation decision — design assessment

The choice to augment client-side (in `SongSearch.runSearch`) over server-side is well-reasoned and correctly executed. The cache is keyed on the `q` string at the server, so sing/listen searches for the same raw text produce distinct, coherent cache entries naturally. No cross-mode poisoning risk exists. No server changes were required. The design decision is documented in the module header, the ticket, and the dev report — all consistent.

**Mode-switch re-run behavior:** when mode changes, `runSearch` is recreated (new function reference via `useCallback([patronUuid, mode])`), the `[input, runSearch]` effect detects the new `runSearch`, and schedules a new debounced search. The debounce timer fires after the full `DEBOUNCE_MS = 400ms` — no double-fire risk because the debounce clears any pending timer at the top of the effect. Correct.

### 6. E2E test quality

Two new e2e tests added in `e2e/search.spec.ts`:

**Test 1 — `select a result jumps focus to the add-to-queue CTA (TICKET-40 §1)`:** Mocks `/api/search` at the network level (`page.route`). Picks a result by role button click, then asserts `toBeFocused()` on the CTA and `not auto-submitted` (no success toast count). This is a genuine behavioral assertion — not just a visibility check.

**Test 2 — `sing mode appends 'karaoke' to the search query (TICKET-40 §2)`:** Captures ALL outgoing `?q=` values via `page.route`, asserts the last query equals `"evidencias karaoke"` in sing mode, then switches to listen-dance and polls (`expect.poll`) until the last query becomes `"evidencias"` (mode-switch re-run). This is a **network-level assertion** — it genuinely inspects what leaves the browser, not just what the UI renders. This is the correct level of verification for a client-side query augmentation.

**Degraded paste regression (expanded):** the existing degraded test now additionally asserts `toBeEnabled()` AND `toBeFocused()` on the CTA after paste — explicit regression coverage for BUG-01.

Test suite architecture is clean, tests are specific, and the named behaviors map 1:1 to the acceptance criteria.

### 7. Security waiver assessment

TM waived security review as N/A-by-content: client-side UI + client-side query augmentation, no new endpoints, no new input surfaces reaching the server beyond the existing validated search query.

Waiver is **confirmed appropriate**. The reviewer has read `/api/search/route.ts`:
- The `q` parameter is validated at the server: `MIN_QUERY=3`, `MAX_QUERY=100` characters, trimmed. Any augmented query longer than 100 chars (e.g., "a very long query... karaoke" at 101+ chars) would be rejected with a 400. In practice the 400 would degrade gracefully on the client (no results shown, not a crash). This is acceptable.
- The `uuid` parameter is validated with a strict regex before being used as a rate-limit map key.
- Dual per-uuid + per-IP rate limiting is in place and unchanged.
- The augmented query (`"evidencias karaoke"`) is a plain string appended to an existing URL parameter — no new injection surface. The server treats it identically to any other free-text query.
- No new endpoints, no new auth surfaces, no new server-side state.

The one angle identified by the TM — augmented query flowing through existing validation — confirms the validation is intact and is not bypassed by this PR. Waiver stands.

### 8. Dev report currency

Dev report (`work/reports/dev/TICKET-40.md`) reflects the implemented state accurately. The BUG-01 fix is documented with commit SHA `3b5b861`. Implementation log contains commit SHAs for all major commits. Self-verification section shows green results that match what the reviewer independently reproduced. Report is on the PR branch. Current.

One minor note: the dev report's "Files touched" list still references `onSongChosen` as a prop on `SongSearch`, which was removed in the BUG-01 fix. The dev report prose in the "Gate feedback addressed" section correctly describes the final implementation (effect on `parsedVideoId`, `onSongChosen` removed), but the earlier "Files touched" list was not updated to reflect the removal of `onSongChosen`. This is a **NIT** — the prose is self-consistent within the BUG-01 section and the diff is the canonical record.

### 9. Rebase surface honesty

The PR is marked `CONFLICTING` / `mergeStateStatus: DIRTY` due to a conflict with the events JSONL class on main. This is a known, documented issue (TM-flagged, to be resolved at merge time). All four CI gates were reproduced green locally by both Dev, App Tester, and this reviewer. The conflict does not affect the correctness of the code changes. TM handles the rebase/merge at their round.

---

## Findings

### Blocking items
None.

### Nits (non-blocking)
1. **Dev report "Files touched" list** still mentions an `onSongChosen` prop/callback that no longer exists (removed in BUG-01 fix). The BUG-01 section correctly describes the final state. Minor documentation drift — not worth a new commit, acceptable as-is.
2. **`karaokê` handling** is documented in tests and design notes as a deliberate decision. The accented case produces `"karaokê karaoke"` when sent to YouTube — which is fine behavior. Optional: a comment in `containsKaraoke` explicitly noting "accented form intentionally not matched" would make the intent self-evident to a future reader. Not blocking.

### Optional
- Consider adding a test case for `augmentQuery("karaokê", "sing")` to make the accented-form behavior explicit in the test suite, matching the prose in the test comment. Currently the behavior is only described in the comment; an assertion would be authoritative documentation. This is strictly optional.

---

## Verdict

`[reviewer] APPROVE — TICKET-40 search UX (select-to-submit jump + mode-aware karaoke keyword). All four CI gates reproduced green locally by reviewer (369 unit / build / 59 rotation-engine / 30 e2e all pass). Implementation is correct: the useEffect([parsedVideoId]) mechanism is the right fix for BUG-01 (effect runs post-commit, CTA enabled before focus fires); mode-aware augmentation is clean and well-isolated in lib/search-query.ts; cache-key coherence is correct by construction; the karaokê accent case is a sound design decision producing beneficial behavior (both spellings sent to YouTube); /api/search validation is intact and not bypassed. E2e tests use genuine network-level assertions. Security waiver confirmed appropriate. No blocking items.`

---

## Evidence relied upon

- Local diff: `git diff a1129ed..origin/ticket/40-search-ux` (all 5 core files read in full)
- Reviewer ran: `npm test` → 369/369; `npm run build` → green; `node --test` → 59/59; `PORT=3040 npx playwright test` → 30/30
- App Tester PASS report: `work/reports/testing/TICKET-40-app-test.md` (re-test section confirms BUG-01 fixed)
- App Tester re-test PR comment: #4918887473 (degraded-paste CTA enabled+focused; post-submit no-focus-steal; 30/30 e2e; 369/369 unit)
- Dev report: `work/reports/dev/TICKET-40.md` (current, matches diff)
- Ticket: `work/tickets/TICKET-40-search-ux.md`
- `/api/search/route.ts` read in full (security waiver verification)
- TICKET-43 worktree `PatronRoom.tsx` diff read (sequential-merge compatibility confirmed)
- PR #21 thread read in full (5 comments: Vercel bot, app-tester FAIL, dev fix, dev gate-request, app-tester PASS)
