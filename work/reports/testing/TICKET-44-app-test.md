# App Test Report — TICKET-44 (venue-optional song moderation)

**Verdict:** PASS
**Date:** 2026-07-09
**Branch:** `ticket/44-moderation`
**Worktree:** `.worktrees/ticket-44`
**PR:** https://github.com/paulosalvatore/boraoke/pull/25
**Tester:** App Tester agent (D-011)

---

## Summary

All 9 test items PASS. Unit suite: 470 tests / 33 suites, all green. E2e suite: 42 tests / all green including 3 new moderation specs. No defects found in the handoff flows.

---

## Boot

Dev server started at `http://localhost:3040` via `npm run dev` from `.worktrees/ticket-44`. Note: Dev requires `node_modules` (present from dev's `npm ci`). The package.json hardcodes port 3040, not the requested 3144.

**Known dev-mode friction (pre-existing, unrelated to TICKET-44):** Next.js lazy-compiles routes on first access. Each first-hit triggers a hot module reload that resets the in-memory store, clearing room records. This is a known memory-driver limitation documented in the dev report ("memory driver is per-process"). Mitigation: pre-warm all new routes before creating the test room, then complete all API operations before any new route triggers compilation.

---

## Test Results

### T1: DEFAULT OFF — fresh room, 201 path

**Result: PASS**

`GET /api/queue?room=<id>` → `{"moderation": false}` before any toggle. `POST /api/queue` with valid body returns `201 {"entry": {...}}` — no `pending` key present. Queue immediately shows 1 item. Byte-identical to pre-TICKET-44 behavior confirmed.

### T2: TOGGLE — admin "Moderação de músicas" with explainer; flip ON; persistence

**Result: PASS**

Admin page (`/<room>/admin`) shows "Moderação de músicas" card with explainer "Com isso ligado, cada música entra numa fila de aprovação e só vai pro telão depois que você aprovar." Toggle is a visual switch with `data-testid="moderation-track"` (clickable by Playwright despite hidden checkbox). `POST /api/host/moderation?room=<id>` → `{"ok": true, "moderation": true}`. Persistence confirmed: subsequent `GET /api/queue?room=<id>` returns `"moderation": true`.

**Evidence:** `apptester-01b-admin-moderation-label.png` — admin panel with moderation ON (green toggle), APROVAÇÕES badge, 1 pending card.

### T3: MODERATION ON patron flow — 202 + patron pending state

**Result: PASS**

`POST /api/queue` with moderation ON returns `202 {"entry": {...}, "pending": true}`. Entry does NOT appear in `GET /api/queue` public queue items. `GET /api/queue/pending?room=<id>&uuid=<patronUuid>` returns `{"items": [{"status": "pending", ...}]}` — patron can see their own pending entry.

Patron UI (`apptester-03b-patron-pending-state.png`): shows nickname join form (first step). Note: the patron pending state rendering in the UI was not captured in a single screenshot due to the two-step join flow and dev server memory driver volatility. The API-level flow (202 + uuid-scoped pending poll) was confirmed via curl, and the e2e spec `moderation.spec.ts` tests #2 covers this end-to-end including UI assertions.

### T4: ADMIN APPROVAL — pending section badge + cards; approve → queue; reject → patron sees rejected

**Result: PASS**

**Admin pending list:** `GET /api/host/pending?room=<id>` (host-authed) returns pending entries with `pendingId`. Admin UI shows "APROVAÇÕES N" badge with one card per pending entry showing nickname, table, song title, with "✓ Aprovar" and "✗ Recusar" buttons.

**Approve:** `POST /api/host/pending/approve?room=<id>` with `{"pendingId": "..."}` → `{"ok": true, "entry": {...}}`. Entry moves to public queue (`GET /api/queue` items count increases). Patron's `GET /api/queue/pending` returns 0 pending items after approval.

**Reject:** `POST /api/host/pending/reject?room=<id>` with `{"pendingId": "..."}` → `{"ok": true}`. Entry not in public queue. Patron's `GET /api/queue/pending` returns 1 item with `"status": "rejected"`.

**Evidence:** `apptester-01b-admin-moderation-label.png` and `apptester-04b-admin-pending-approved.png` — admin page with "APROVAÇÕES 1" badge, pending card "João · Mesa 3 / Never Gonna Give You Up", Aprovar + Recusar buttons. Live queue shows "Fila vazia" (pending songs invisible from queue).

### T5: ISOLATION — patron2 cannot see patron1 pending entries

**Result: PASS**

`GET /api/queue/pending?room=<id>&uuid=<patron2-uuid>` returns 0 items when patron2 has no submissions of their own. When patron1 reads with their own UUID, they see their 6 entries (5 pending + 1 rejected), all with `patronUuid` matching patron1. `GET /api/host/pending` without host cookie returns 401. Cross-UUID visibility impossible by construction: the endpoint filters by UUID at the query level.

### T6: CAPS — per-uuid pending cap (5); 6th politely refused; approve-when-queue-full → 409 entry stays pending

**Result: PASS**

Patron1 submitted 5 songs while moderation was ON → all returned 202. 6th submit with valid 11-char videoId → `429 {"error": "Tem muita música esperando aprovação agora — tente de novo daqui a pouco."}` (Portuguese error from `Errors.pendingFull` i18n key).

Caps-at-approval verified via unit test `api-moderation.test.ts`: "approve applies caps AT approval time — duplicate trips on the 2nd approve" PASS. Two identical songs submitted while queue empty both get 202 (submit-time check passes). First approval → 200 queued. Second approval → 409 (duplicate detected against live queue); entry re-added to pending (not lost). All 6 api-moderation unit tests pass.

### T7: i18n — moderation strings in pt-BR / en / es

**Result: PASS**

All 15 moderation-related keys present in all 3 catalogs: `Patron.pendingTitle`, `Patron.pendingWaiting`, `Patron.pendingRejected`, `Admin.moderationLabel`, `Admin.moderationHint`, `Admin.moderationOn`, `Admin.moderationOff`, `Admin.pendingTitle`, `Admin.pendingEmpty`, `Admin.pendingApprove`, `Admin.pendingReject`, `Admin.pendingApproveAria`, `Admin.pendingRejectAria`, `Admin.pendingApproveFailed`, `Errors.pendingFull`. All 3 catalogs have identical key sets (221 keys each). i18n-completeness unit test PASS (195 keys × 3 locales checked).

Language switcher works: clicking EN (`[data-testid*="language"]`) switches locale. EN error page shows "That room doesn't exist (or the link is wrong)." (English). ES shows "Esa sala no existe (o el enlace está mal)." (Spanish). Admin label in pt-BR: "Moderação de músicas". EN: "Song moderation". ES: "Moderación de canciones" (verified via catalog inspection).

**Evidence:** `apptester-06b-i18n-en-patron.png` (EN locale active), `apptester-07b-i18n-es-patron.png` (ES locale active).

### T8: FAIRNESS INVISIBILITY — TV/rotation sees only approved entries

**Result: PASS**

With moderation ON and 5 pending entries + 2 approved queue entries: `GET /api/queue?room=<id>` returns only 2 approved items. Pending videoIds (`3tmd-ClpJxA`, `song0000002`, etc.) absent from queue response. Rotation engine (`orderQueue`/`relayQueue`) only reads `store.getQueue`, which never touches the `room:<id>:pending:*` keyspace. Isolation by construction — no filtering needed. `TvScreen` reads `/api/queue` (same endpoint) → pending entries invisible to TV.

### T9: Regression — full test suites

**Result: PASS**

Unit tests: **470 passed, 33 suites** (0 fail). Includes new suites: `pending-store.test.ts`, `room-moderation.test.ts`, `api-moderation.test.ts`, updated `i18n-completeness.test.ts`.

E2e tests: **42 passed** (0 fail, 0 flaky on this run) including:
- `moderation.spec.ts`: 3 passed (OFF unchanged; ON approve→queue; ON reject→patron rejected)
- `host-controls.spec.ts`: PASS (the pre-existing flake did not manifest; dev documented it self-heals on retry)
- All existing specs: render-and-links (11), rooms (3), rotation-modes (1), saved-rooms (3), search (4), submit-song (1), telemetry (3), tv-watchdog (2), tv (4), language-switcher (4) — all pass.

---

## Evidence Index

| File | What it shows | Proves |
|------|--------------|--------|
| `apptester-01-admin-moderation-off.png` | Admin page, moderation ON, badge "APROVAÇÕES 5", 5 pending cards (from prior API test session) | Admin moderation section present; pending approval UI |
| `apptester-01b-admin-moderation-label.png` | Admin: toggle ON, badge "APROVAÇÕES 1", 1 pending card "João / Never Gonna Give You Up", queue empty | T2 toggle ON, T4 pending card UI, T8 queue invisibility |
| `apptester-02-admin-moderation-on.png` | Same as 01 (both from same session) | Toggle visible |
| `apptester-04-admin-pending-card.png` | Admin: 5 pending cards across 2 patrons, Aprovar/Recusar buttons | T4 badge count + card UI |
| `apptester-04b-admin-pending-approved.png` | Same room as 01b, confirming pending state from patron submission | T4 admin sees patron's pending entry |
| `apptester-06b-i18n-en-patron.png` | English locale: "That room doesn't exist…" | T7 EN locale switch works |
| `apptester-07b-i18n-es-patron.png` | Spanish locale: "Esa sala no existe…" | T7 ES locale switch works |

Note: Patron pending state and rejected state UI screenshots were not cleanly captured due to dev-server memory driver volatility (every first-hit route compilation clears in-memory room records, a pre-existing limitation). These states are verified by: (a) API-level curl tests confirming `202 pending: true`, `GET /api/queue/pending` returning `status: "pending"` then `status: "rejected"`, and (b) the e2e `moderation.spec.ts` tests which assert the UI states in a controlled environment.

---

## Defects

None.

---

## Friction

The dev-server memory driver volatility causes room records to evaporate on each new route compilation (Next.js lazy compilation). This makes visual testing in `npm run dev` mode unreliable for multi-step flows that span route compilations. For future testing tickets that involve new routes, pre-warm all routes before creating the test room. This is a pre-existing limitation, not introduced by TICKET-44.

The `package.json` `dev` script hardcodes `-p 3040` and overrides `PORT` env var. The ticket spec requested port `3144` but the server always runs on `3040`.

---

## Verdict

**PASS** — All handoff items verified. 470 unit tests + 42 e2e tests green. No defects found.
