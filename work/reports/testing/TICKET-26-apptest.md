# App Tester report — TICKET-26 (anonymous identity registry)

- **PR:** #37 (draft) · **Branch:** `ticket/26-anon-identity-registry` · **Port:** 3026
- **Verdict:** **PASS**
- **Date:** 2026-07-20
- **Evidence dir:** `work/evidence/TICKET-26-apptest/`

## Scope tested

The patron JOIN FLOW end-to-end plus room creation, mapped to the ticket's 5 acceptance criteria and the orchestrator's 5 states. The identity cookie is httpOnly by design, so cookie assertions go through the server-visible response / cookie jar and negative-assert against `document.cookie` (page JS must NOT see it). Boot was a clean `next dev -p 3026`; no `run-app` skill exists in this repo (Dev used the repo's own CI conventions — noted in the dev report).

## What was tested → result

| State | What | Result |
|---|---|---|
| 1. Fresh device | `/default` load mints exactly one identity; `Set-Cookie: boraoke_identity` is **HttpOnly**, SameSite=lax, Path=/, 2yr; invisible to `document.cookie`/`cookieStore` | **PASS** (screenshot 01, evidence 03) |
| 2. Returning device | reload reuses the SAME uuid (no duplicate); join + song-submit works; own entry attributed to nickname; cookie precedence over legacy | **PASS** (screenshot 02, evidence 03) |
| 3. Legacy continuity | legacy device (stored uuid, no cookie) → server adopts uuid EXACTLY, no duplicate, join UX unchanged | **PASS** (evidence 03) |
| 4. Room creation | `/new` → "Room's live!" (QR + host code); `POST /api/rooms` 201 + httpOnly cookie applied | **PASS** (screenshot 04, evidence 03) |
| 5. Fail-open / no-block | malformed + oversized bodies → 200 (never 4xx); store-outage fail-open via `__tests__/identity.test.ts` throwing-store case (present + green) | **PASS** (evidence 03) |

## Evidence index

- `01-fresh-device-join-page.png` — fresh `/default` join page; the fire-and-forget `POST /api/identity => 200` fired; identity cookie absent from `document.cookie` (httpOnly proof).
- `02-returning-device-join-and-own-song.png` — same identity reused after reload; joined as "AppTester" and submitted a song → "✓ You're in the queue!", live queue shows my attributed entry (own-row continuity).
- `03-api-behavior-evidence.md` — full request/response log for all 5 states (mint, reuse, cookie precedence, legacy adoption, room creation, malformed/oversized tolerance) + automated-test tallies.
- `04-room-creation-success.png` — `/new` create flow succeeds end-to-end.

## Automated tests

- **Jest:** 39 suites / 571 tests passed (incl. `identity.test.ts`, `identity-store.test.ts`, extended `rooms.test.ts`).
- **Playwright e2e (`PORT=3026`):** 47 passed, 2 failed. All 3 `identity.spec.ts` tests PASS. The 2 failures are `advance-auth.spec.ts` and are an **environment artifact, not a regression** — see below.

## Defects / notes

- **Non-blocking (environment, not a code defect):** `advance-auth.spec.ts` × 2 failed because the suite requires `ADVANCE_AUTH=enforce` (set by `playwright.config.ts`'s `webServer.env`), but a plain pre-started `next dev` was reused via `reuseExistingServer`, so advance auth ran in default log-only mode (`POST /api/queue/advance` → 200 instead of the expected 401). Confirmed by inspecting the config + a live curl. Unrelated to TICKET-26; these pass when Playwright launches its own server (as in the Dev run). No identity or join-flow test failed.
- **Nit (not a regression):** a legacy uuid that is not RFC-4122-valid (variant nibble outside `[89ab]`) is treated as "no legacy" and a fresh uuid is minted. Real client `patronUuid`s are always `uuidv4()`, so this is only reachable via malformed input and it fails safe (still 200, still mints). No action needed.

## CI note

No `scripts/verify-green-local.sh` exists in the boraoke repo (confirmed by Dev). Per the CI-verified-green rule that authoritative local-Docker gate is not available here; I relied on the repo's own gate conventions (build + Jest + e2e), all green except the environment-only advance-auth artifact above. Flag for the Reviewer/TM: the local-Docker GREEN verdict cannot be produced for this product as-is.

## Friction

- Playwright MCP is sandboxed to the framework repo, so screenshots could not be written directly to the boraoke evidence dir; captured to `.playwright-mcp/…` then copied. Two of them were auto-quarantined by the framework Stop-hook backstop and recovered from `work/evidence/_quarantine/`.
- `reuseExistingServer` silently ran the e2e suite against a dev server lacking `ADVANCE_AUTH=enforce`, producing 2 misleading "failures". Worth a note in the run-app / e2e convention: run the full e2e via Playwright's own webServer, or export `ADVANCE_AUTH=enforce` when pre-starting the server for e2e.
