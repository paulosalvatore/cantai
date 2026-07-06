# Review Report — TICKET-1: Walking Skeleton (Karaoke Prototype Core)

- **Ticket:** TICKET-1 (`work/tickets/TICKET-1-walking-skeleton.md`)
- **PR:** paulosalvatore/cantai #4 (`ticket/1-walking-skeleton`)
- **Reviewer:** Reviewer agent (sonnet pass)
- **Date:** 2026-07-05
- **Verdict:** REQUEST-CHANGES — one blocking item (CI node-version mismatch), two nits

---

## Evidence Consulted

| Artifact | Location | Relied on |
|---|---|---|
| Ticket spec | `work/tickets/TICKET-1-walking-skeleton.md` | Acceptance criteria |
| Dev report | `work/reports/dev/TICKET-1.md` | Implementation log, self-verification, security fix log |
| App Tester report | `work/reports/testing/TICKET-1-app-test.md` | Functional PASS, 20 evidence screenshots |
| Security report | `work/reports/security/TICKET-1-security.md` | 4 MEDIUMs, PASS-WITH-NOTES |
| Evidence screenshots | `work/evidence/ticket-1/` | 20 screenshots covering patron, TV, two-patron multi-context |
| CI status | `gh pr checks 4` | Vercel FAIL (TICKET-2 scope), no GitHub Actions run (bootstrap limitation — expected) |
| Full diff | `git diff <base>..<origin/ticket/1-walking-skeleton>` | Local diff read, 48 files |
| Build | Reviewer ran `npm ci && npm run build` | Clean, 7 routes |
| Unit tests | Reviewer ran `npm test -- --verbose` | 39/39 pass |
| E2E | Reviewer ran `npm run test:e2e` | 1/1 pass (1.4s) |

---

## Build / Test Results (Reviewer-Verified)

```
npm ci          → success (no errors, audit noise only)
npm run build   → ✓ Compiled successfully (next 15.5.20), 7 routes
npm test        → 39 passed, 39 total (3 suites: api-queue, queue, youtube) — 0.275s
npm run test:e2e → 1 passed (5.4s) [chromium] › patron submits a song and it appears in the queue
```

All claims in the dev report match what the reviewer ran. The 39 unit tests (was 25 pre-security-fixes) and the 1 Playwright e2e all pass independently.

---

## Acceptance Criteria Assessment

| Criterion | Met? | Evidence |
|---|---|---|
| `npm run dev` on :3040 → `/` and `/tv` work end-to-end | ✅ | App Tester PASS + 20 screenshots |
| Patron joins with nickname, submits YouTube URL, sees queue | ✅ | Screenshots 01–09, 10–11 (two-patron cross-context) |
| YouTube URL parser accepts full/short/shorts/embed/live formats | ✅ | 16 unit tests in `__tests__/youtube.test.ts`; parser verified correct |
| Venue screen `/tv` plays queue via official IFrame API | ✅ | Screenshot 19 (official embed URL with `enablejsapi`); auto-advance on ENDED |
| API routes: GET/POST `/api/queue`, POST `/api/queue/advance` | ✅ | API sanity checks in App Tester; 11 API validation unit tests |
| Input validation (post-security fixes) | ✅ | See Security section below |
| Unit tests + 1 Playwright e2e green | ✅ | Reviewer-verified: 39 + 1 |
| CI workflow replaces stub | ✅ (partial) | Workflow is real; **but node-version bug — see BLOCKING ITEM #1** |
| README: port, run instructions, limitations | ✅ | README complete; **nit: missing Node 22+ requirement** |
| Dev report current | ✅ | Report reflects final state including security commit 78f546d |
| Restart-loses-state documented | ✅ | Documented in `lib/store.ts` header + README + footer on patron page |

---

## Security MEDIUMs — Genuinely Fixed?

**MEDIUM #1 — Direct videoId bypass.** Fixed. The `resolvedVideoId` is now validated against `VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/` regardless of which path (direct `videoId` field or `youtubeUrl` parser) produced it. Both paths must pass the regex or get a 400. Confirmed by unit test `"rejects a direct videoId that is not 11 chars"` (and two more invalid-chars, URL-as-videoId tests). **GENUINELY FIXED.**

**MEDIUM #2 — No field length caps.** Fixed. `nickname ≤ 30`, `title ≤ 120`, `table ≤ 10`, `patronUuid` strict UUID regex, body capped at 4096 bytes. Client-side `maxLength` attributes on patron page inputs match server limits. Unit tests cover boundary (30-char nickname → 201) and over-limit → 400. **GENUINELY FIXED.**

**MEDIUM #3 — Unbounded queue depth.** Fixed. `QUEUE_MAX = 200` exported from `lib/store.ts`. `addToQueue` returns `false` when full. API returns 429 with clear message. Unit test fills queue to QUEUE_MAX, asserts next addition → 429. Post-advance acceptance also tested. **GENUINELY FIXED.**

**MEDIUM #4 — Next.js CVEs.** Fixed. Bumped `next` to `^15.5.20` in `package.json`; build verifies clean on that version. Remaining `npm audit` noise is a transitive `postcss` inside Next itself; no non-breaking fix exists. Accepted and documented. **GENUINELY FIXED.**

---

## Code Quality Assessment

### lib/youtube.ts — URL parser

Correct for all ticket-scoped formats. The `isValidVideoId` helper is private (unexported), which means `route.ts` duplicates the regex as `VIDEO_ID_RE`. Functionally equivalent and tests cover both paths. Minor inconsistency worth a future cleanup but not blocking.

For `youtu.be` URLs: `url.pathname.slice(1).split("?")[0]` is defensive but technically redundant (the URL API puts query params in `url.search`, not `pathname`). Harmless.

Raw-ID path: `/^[A-Za-z0-9_-]{11}$/` — correct. Test covers exact-11 ✓, <11 → null ✓, >11 → null ✓.

### lib/store.ts — In-memory queue

Module-level `let queue: QueueEntry[]` — the correct Next.js prototype pattern for shared in-memory state. `clearQueue()` is test-only and documented. Restart-loses-state limitation is prominently documented in the JSDoc header. `addToQueue` now returns `boolean` (false = full), consistent with the API.

### app/api/queue/route.ts — POST handler

Body is read via `req.text()` before parse, enabling the 4 KB cap check. JSON.parse error → 400. All field validations occur before `addToQueue`. Queue-full check occurs last (after validation), so invalid requests get 400 rather than consuming a queue slot — correct ordering.

One subtle point: if a caller sends `{videoId: "https://youtu.be/dQw4w9WgXcQ", ...}` (a URL as a `videoId` field), the code takes the direct path, sets `resolvedVideoId` to the full URL string, which then fails the 11-char regex → 400. Expected behavior.

### app/tv/page.tsx — YouTube IFrame player

Uses only the official YouTube IFrame Player API (`https://www.youtube.com/iframe_api`). No media proxying. The `currentVideoIdRef` guard prevents double-load when both the `onStateChange` handler and the `useEffect` queue-change path are triggered. The App Tester noted a test-environment double-advance (ENDED fires in headless); this is a test artifact, not a production bug. `playVideo` is cast via `unknown` because the local `YTPlayer` interface doesn't declare it (only `loadVideoById`, `stopVideo`, `destroy`) — a deliberate simplification, acceptable for prototype.

### app/page.tsx — Patron page

localStorage access guarded with `typeof window !== "undefined"` — correct for SSR. UUID generated and persisted per session. 3-second poll for live queue. `parsedVideoId` computed from YouTube URL in real-time; submit button disabled unless a valid ID is parsed. Error paths covered (network error, server error, no-videoId).

### e2e/submit-song.spec.ts

The pre-test cleanup (`POST /api/queue/advance`) only removes one item — if prior test state has multiple items queued, the cleanup is incomplete. This is fragile for future multi-e2e expansion, but passes in the current single-test suite (the test then adds its own item and verifies it appears). Acceptable for now.

### .github/workflows/ci.yml — CI CORRECTNESS (BLOCKING — see below)

---

## Blocking Items

### BLOCKING #1 — CI node-version mismatch (CI will fail post-merge)

**File:** `.github/workflows/ci.yml`, line 16

**Problem:** The CI workflow specifies `node-version: "20"` but:

1. The Playwright e2e step sets `NODE_OPTIONS: "--localstorage-file=/tmp/cantai-ls.json"` for the step environment.
2. The `playwright.config.ts` `webServer.env` also passes `NODE_OPTIONS: "--localstorage-file=/tmp/cantai-ls.json"` to the dev-server subprocess.
3. The `--localstorage-file` flag was introduced in **Node.js v22.4.0**. On Node 20, it is an unrecognized option.

When `NODE_OPTIONS` contains an unrecognized flag, Node.js exits with "bad option: --localstorage-file" (exit code 9). This means the Playwright e2e step would fail on every CI run post-merge because `npm run test:e2e` itself (which is a Node.js program invocation) would reject the flag before any tests run.

The CI yml comment even says: "Node.js 22+ localStorage global needs a file path to be functional during Next.js SSR" — the author correctly identified the Node 22+ requirement but forgot to update the `node-version` field.

**Fix (one line):**
```yaml
node-version: "22"   # was "20" — --localstorage-file requires Node 22+
```

**Why blocking:** The ticket explicitly scoped CI setup. The reviewer assessment must confirm CI will work post-merge. With `node-version: "20"`, every PR post-merge will fail its e2e CI step, defeating the CI gate entirely.

---

## Nits (non-blocking)

### NIT-1 — README missing Node 22+ requirement

The README has thorough run instructions but does not mention that Node 22+ is required (due to `--localstorage-file`). Developers on Node 20 or Node 18 LTS would find `npm run dev` fails with an opaque Node error. Adding one line ("Requires Node.js 22 or later") would prevent confusion. `@types/node: "^22.0.0"` in devDependencies already signals this, but it should be in the README too.

### NIT-2 — `isValidVideoId` is private, leading to a duplicated regex

`lib/youtube.ts` defines `isValidVideoId` as an unexported function. `app/api/queue/route.ts` independently defines `VIDEO_ID_RE` with the same pattern. If the pattern ever changes, both must be updated in sync. Minor and low-risk at prototype scale; exporting `isValidVideoId` from `lib/youtube.ts` and importing it in the API route would be the clean fix.

---

## Scope Discipline

No scope creep. The PR contains exactly what the ticket specified: Next.js app, patron page, TV page, API routes, unit tests, Playwright e2e, CI workflow, README, and run-app skill update. No unrequested features added.

---

## CI Status (S1)

- **GitHub Actions:** Did not run — expected bootstrap limitation (workflow file must exist on `main` before GitHub triggers it on a PR). Not a gate blocker for this first PR.
- **Vercel:** Failing — explicitly out of TICKET-1 scope (deploy = TICKET-2).
- **Required checks:** None currently passing/failing through GitHub Actions. Post-merge CI correctness is blocked by the node-version issue above.

---

## Dev Report Currency (F23)

Dev report reflects the post-security-fix state (references commit 78f546d, shows 39 tests, lists all 4 MEDIUMs fixed). Current. No discrepancy with the diff.

---

## Summary

The implementation is functionally sound and complete. All 4 security MEDIUMs are genuinely closed with tests. The App Tester PASS is backed by 20 evidence screenshots covering all AC flows. The reviewer independently confirmed build + 39 unit tests + 1 e2e all green.

The single blocking issue is a one-line CI fix: `node-version: "20"` → `"22"`. Once fixed, CI is ready to enforce build + test + e2e on all subsequent PRs. The two nits (README Node version, duplicated regex) can be fixed in the same commit or deferred.

**Verdict: REQUEST-CHANGES — fix node-version in ci.yml, then re-review.**

---

## Delta Re-Review — commit 7f866f1 (2026-07-05, replacement Reviewer)

Scope: `git show 7f866f1` only (fix commit for the REQUEST-CHANGES items above) + independent unit-suite run. Prior gates unchanged and on record (App Tester PASS, Security PASS-WITH-NOTES with all 4 MEDIUMs verified fixed, prior review otherwise clean).

| Item | Verified | Evidence |
|---|---|---|
| BLOCKER #1 — ci.yml node-version "20" → "22" | ✅ Fixed | `.github/workflows/ci.yml` line 16 now `node-version: "22"`. Single job / single `setup-node` step, so **every** step (npm ci, build, unit tests, Playwright e2e with `NODE_OPTIONS: --localstorage-file`) runs on Node 22. Grepped the repo for other Node pins: no `.nvmrc`, no `engines` in project `package.json`, no other workflow — nothing still assumes Node 20. |
| NIT-1 — README Node requirement | ✅ Fixed | README "Running locally" section now states "Requires Node.js 22 or later." |
| NIT-2 — duplicated video-ID regex | ✅ Fixed | `isValidVideoId` exported from `lib/youtube.ts` (regex unchanged: `/^[A-Za-z0-9_-]{11}$/`), imported in `app/api/queue/route.ts`; local `VIDEO_ID_RE` removed. Validation call site (`!resolvedVideoId || !isValidVideoId(resolvedVideoId)`) is behavior-identical to the previous regex test. |

**Reviewer-run verification (worktree, commit 702f279 tip = 7f866f1 + event-log auto-commit):**

```
npm test → Test Suites: 3 passed, 3 total; Tests: 39 passed, 39 total (api-queue, queue, youtube)
```

**CI status (S1):** no required checks exist on `main` (private repo without branch protection — GitHub API 403 "Upgrade to Pro"). Vercel deploy check fails but is non-required and explicitly out of TICKET-1 scope (deploy = TICKET-2, recorded above). GitHub Actions still cannot trigger until the workflow lands on `main` (bootstrap limitation, recorded above). No required check pending or failing.

Nothing else changed in 7f866f1 beyond the three items + a dev-report update (implementation-log entry for this fix — current per F23).

**Verdict: APPROVE.** All REQUEST-CHANGES items resolved and independently verified; delta is minimal and sound.

---

## Opus Merge-Counting Second Pass (D-022) — 2026-07-05

- **Reviewer:** Reviewer agent (opus judgment pass)
- **Tip reviewed:** `origin/ticket/1-walking-skeleton` @ `2e2c816` (base `4a55484`)
- **Context of this pass:** the Tech Manager's spawn instruction is explicit — **this merge triggers the FIRST PUBLIC Vercel deploy of the product.** That reframes the Vercel check the sonnet pass scoped away (line 153: "Vercel: Failing — out of TICKET-1 scope, deploy = TICKET-2"). If merging this PR is the act that publicly deploys, a red Vercel check is not out-of-scope noise — it is the deploy failing.

### Reviewer-run verification (this pass)

```
npm test        → Test Suites: 3 passed, 3 total; Tests: 39 passed, 39 total
rm -rf .next && npm run build → ✓ Compiled successfully (next 15.5.20), 7 routes, clean
```

Build and unit suite independently reconfirmed green on the current tip. E2E not re-run this pass (prior gate + prior reviewer ran it green; unchanged since).

### Judgment axis 1 — is this the RIGHT foundation for the armed wave? ✅ YES

Cross-read `TICKET-6-persistence.md` (frozen store interface) on `main`. The skeleton is **compatible-by-design**, not by luck:

- TICKET-6 *explicitly owns* `lib/store.ts` + `app/api/queue/**` and plans "mechanical async-await updates" — the sync→async swap (`addToQueue`→`addEntry`, `advanceQueue`→`advance`, add `roomId`) is scoped INTO wave-1, not something the skeleton must pre-empt.
- TICKET-6 explicitly preserves TICKET-1's `QueueEntry` shape ("keep TICKET-1's `QueueEntry` plus reserve `graceRequeue?`"), and mandates `lib/store.ts` stay the single import point. The skeleton's `app/page.tsx` / `app/tv/page.tsx` import only the `QueueEntry`/`Mode` *types* from `@/lib/store` — which survives the swap since TICKET-6 keeps re-exporting from that path (and is on TICKET-6's must-not-touch list, so those components won't be edited).
- The skeleton bakes in nothing the wave must undo. The store is the one seam that changes, and it was authored knowing this skeleton's exact shape. Good foundation.

### Judgment axis 2 — adversarial pass over the public-deploy surface

**FINDING A (BLOCKING for a deploy merge) — Vercel deploy is failing on a project misconfig, and this merge deploys.**
`npx vercel inspect dpl_26hgLVCVAWfZYiJUnnuzb2ovGXcb --logs`: the Next.js build compiles cleanly on Vercel too, then fails at the end with:
> `Error: No Output Directory named "public" found after the Build completed. Configure the Output Directory in your Project Settings.`
This is not a code defect — it is the Vercel **project's Framework Preset not set to Next.js** (it is treating the app as a static "Other" project and looking for a `public/` output dir). The production deploy will fail identically. Merging now, for a PR whose stated purpose is the first public deploy, produces a broken public deploy. There is no `vercel.json` in the repo to override the setting.
**Cheap, durable fix (recommended):** add a one-file `vercel.json` with `{ "framework": "nextjs" }` at repo root — this pins Next.js detection independent of dashboard drift and turns the check green. **Alternative:** TM sets Framework Preset = Next.js on `paulosalvatores-projects/cantai` in the Vercel dashboard (creds-means-execute) and re-triggers the preview to confirm green. Either way, the preview deploy must be verified green before the merge that deploys.

**FINDING B (cheap honesty fix, pre-public) — the in-memory limitation note understates the serverless reality.**
On Vercel serverless, the module-level `let queue` in `lib/store.ts` is **per-lambda-instance**, not merely "resets on restart." Two concurrent patrons (or a patron + the TV) can be routed to different lambda instances and see *different, diverging queues at the same time* — submits landing on one instance are invisible to polls served by another. TICKET-6 itself names this ("TWO patrons can hit two instances and see different queues"). The patron footer currently says only *"Prototype — queue resets on server restart"* (`app/page.tsx:311`) and the README/store JSDoc say the same. For a FIRST PUBLIC session that is misleading — a user will see songs vanish/reappear and think it's broken. **Requested (prototype-proportionate):** reword the footer + README limitation note to be honest about the multi-instance behavior for the deployed prototype (e.g. "Early prototype — the queue is not yet shared across servers; it may look inconsistent between phones until persistence lands"). This is a cheap pre-merge mitigation, not a blocker on its own, but it should ride with the deploy fix given the public exposure.

### Judgment axis 3 — correctness / robustness (would it embarrass a first public user?)

- **Double-advance race (App Tester LOW) — accept, note.** `advanceQueue()` is an unconditional `shift()`; both the `onStateChange` ENDED handler and the manual Skip button call `POST /api/queue/advance`. A near-simultaneous ENDED + Skip drops two entries. Low probability with a single host at one TV, self-corrects on next poll, no data loss beyond one skipped song. Acceptable for the prototype; TICKET-7 host controls is the natural home for a guarded advance.
- **Unauthenticated `/api/queue/advance` — known gap, note.** Anyone who can reach the deployment can skip the current song (no host auth). Consistent with the security PASS-WITH-NOTES posture and deferred to TICKET-7 (host controls). Fine for early access; worth the TM knowing the public URL exposes an open skip.
- **localStorage-disabled browser (NIT).** In a browser with localStorage blocked (private mode / sandbox), the boot effect returns early leaving `patronUuid = ""`; the nickname gate can still be passed (in-memory), but submit then fails the server's strict `UUID_RE` with `"patronUuid must be a valid UUID"` — an opaque error for the user. Edge case, minority of first users; a NIT for a later pass (fall back to an in-memory uuid when ls is null).
- **Polling / player lifecycle — sound.** 3s poll with interval cleanup on unmount, errors swallowed with retry-next-tick; `currentVideoIdRef` guard correctly prevents double `loadVideoById` between the queue-change effect and the ENDED handler. No leak or thrash observed in the build/route output.

### Merge-time mechanical note (not a code change) — the PR is CONFLICTING

GitHub reports `CONFLICTING`. `git merge-tree` shows the ONLY conflict is `work/events/2026-07.jsonl` (both branches appended to the auto-committed event log). It is a union-merge — the TM resolves it mechanically at merge time (keep both sides' lines). Not a code finding; flagged so the TM expects it.

### Verdict

**REQUEST-CHANGES** (opus, merge-counting).

The skeleton itself is the right foundation, is cleanly built, and its gates are sound — I would APPROVE the *code* as a walking skeleton. But the merge-counting APPROVE means "TM merges **and deploys**," and I will not issue it while the deploy this merge triggers is red for a project-config reason, on the product's first public exposure. Concrete, prototype-proportionate items:

1. **(Blocking)** Make the Vercel deploy green — add `vercel.json` `{ "framework": "nextjs" }` (recommended, durable) or fix the dashboard Framework Preset — and verify the preview deploy goes green before merge.
2. **(Ride-along, pre-public)** Reword the queue-limitation note (patron footer + README + store JSDoc) to be honest about per-instance divergence on serverless, not just "resets on restart."
3. **(TM merge-time)** Resolve the `work/events/2026-07.jsonl` append conflict (union) — mechanical, expected.

Notes 3–6 above (double-advance, open advance endpoint, localStorage-disabled NIT) are acceptable-and-documented for an early-access prototype — recorded, not blocking. Re-review will confirm items 1–2 and the green preview deploy, then flip to APPROVE.

---

## Opus Delta Re-Review — tip `3c80c27` (2026-07-05, same opus Reviewer)

Delta reviewed: `2e2c816..origin/ticket/1-walking-skeleton` (commits `22f04bb` fix, `3735b74` merge-from-main, `e05f064` tsconfig, `3ad8b44` dev-report; code delta outside `work/` = `vercel.json` +3, `README.md`/`app/page.tsx`/`lib/store.ts` wording, `tsconfig.json` +1 exclude, plus `packages/rotation-engine/**` arriving via the main merge).

### Requested items — all verified fixed

| Item | Verified | Evidence |
|---|---|---|
| 1. Vercel deploy green | ✅ | `vercel.json` = `{"framework":"nextjs"}` on the branch; `gh pr checks 4`: **Vercel → pass, "Deployment has completed"** (was FAILURE / missing-public-dir). |
| 2. Honest divergence wording | ✅ | Patron footer (`app/page.tsx:311`): "Early-access prototype — queues may reset or differ between devices until persistent storage ships". `lib/store.ts` JSDoc now states per-lambda-instance copies, diverging queues, silent drops on recycle. README limitation updated in `22f04bb`. Accurate and user-honest. |
| 3. Conflict resolved | ✅ | Dev merged `origin/main` (`3735b74`), union on `work/events/2026-07.jsonl`; PR now **MERGEABLE**. Bare-git merge was used because the sanctioned script cannot conclude a merge — deliberate, documented in the dev report; acceptable as the recorded exception. |

### New change assessed — tsconfig `"packages"` exclude (`e05f064`): SOUND

The main merge brought `packages/rotation-engine/**` (own `package.json` + own `tsconfig.json`) into the tree; the app's root tsconfig `include: **/*.ts` then swept the package's sources into Next's type-check and broke the build (`allowImportingTsExtensions` mismatch). Excluding `packages` from the **app** tsconfig is the correct boundary — the rotation engine is a standalone package with its own compile/test config, not part of the Next.js app build, and later tickets consume it as a package, not via the app include glob. Verified empirically: `next build` clean on the tip with the package present.

### Reviewer-run verification on exact tip `3c80c27`

```
npm test          → 3 suites, 39/39 pass
rm -rf .next && npm run build → ✓ Compiled successfully (next 15.5.20), 7 routes, clean
npm run test:e2e  → 1/1 pass [chromium] patron submits a song and it appears in the queue
gh pr checks 4    → Vercel: pass ("Deployment has completed"); build-and-test: fail (see below)
```

### The CI question (S1) — ruling: recorded exception, does NOT block merge

New fact: the main merge unblocked GitHub Actions (a CONFLICTING PR never builds a merge ref, so CI had silently never run — itself a lesson worth keeping). The first-ever run (`28759906430`) now dies in 3s with **zero steps executed**: annotation verbatim — *"The job was not started because recent account payments have failed or your spending limit needs to be increased."* Verified firsthand via `gh run view` + jobs API (`steps: []`).

Ruling and reasoning:

1. **S1's letter:** S1 forbids approving on a *pending* required check and treats a *failing* required check as REQUEST-CHANGES. Neither applies cleanly: this repo has **no required checks** (no branch protection — private repo, GitHub 403 "Upgrade to Pro", recorded in the sonnet pass), and the check is neither pending nor a test failure — the runner never started.
2. **S1's intent:** the rule exists so a Reviewer never approves on *unverified claims* of green (the historical incident: approval while `test` was pending, later went red). Here the signal S1 protects is present in a stronger form than CI would provide: **I ran the full suite myself on the exact merge-candidate SHA** (39/39 unit + 1/1 e2e + clean build), independently reproducing the Dev's and sonnet Reviewer's runs. The billing failure carries **zero information about the code** — it would paint every PR on this account red, including an empty diff.
3. **Fail-closed proportionality:** failing closed on an account-billing outage blocks every merge on every repo of the account indefinitely, on a signal no code change can turn green. That converts a needs-user infrastructure item into a fleet-wide deadlock — not what S1 buys us.

**Exception conditions (recorded, binding):**
- The billing item is escalated `[needs-user]` to the TL (already posted) — account-level, not repo-fixable.
- Once billing is restored, the TM must verify the **first post-merge CI run on `main` goes green** (the workflow has never executed end-to-end on GitHub runners; my local runs de-risk it, but the first real run is the confirmation). Any failure there is a fast-follow fix, not a rollback.
- This exception covers **this billing failure only** — it does not generalize to red CI of any other cause.

### Verdict

**APPROVE** (opus, merge-counting, D-022). All three REQUEST-CHANGES items independently verified fixed; Vercel preview deploy GREEN ("Deployment has completed"); PR MERGEABLE; build + 39/39 unit + 1/1 e2e reviewer-run green on exact tip `3c80c27`; tsconfig packages-exclude sound; CI billing failure ruled a recorded repo-external exception with the conditions above. TM may merge and deploy.
