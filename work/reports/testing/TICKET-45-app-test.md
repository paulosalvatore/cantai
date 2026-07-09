# TICKET-45 App Test Report — advance/skip authorization

- **Verdict:** PASS
- **PR:** paulosalvatore/boraoke#26 · branch `ticket/45-advance-auth`
- **Worktree:** `.worktrees/ticket-45`
- **Tester:** App Tester agent (D-011)
- **Date:** 2026-07-09

---

## Summary

All acceptance criteria verified. ENFORCE mode correctly gates unauthorized advances with 401; LOG mode records the would-block line and lets calls through. The TV screen token is minted and sent on every advance. The rate-limit backstop trips at exactly the per-room cap (12/min). Full test suites pass: 460 jest / 32 suites, 59 engine, 43 e2e (all in enforce mode).

---

## Pre-flight checks

- Branch: `ticket/45-advance-auth` ✓
- Working tree: clean (nothing to commit) ✓
- Dev report status: IMPLEMENTED + self-verified GREEN ✓

---

## Test suite results

### Unit tests (jest)

```
Test Suites: 32 passed, 32 total
Tests:       460 passed, 460 total
Time: 1.658s
```

New suites verified individually:
- `__tests__/screen-token.test.ts` — 17 tests: mint/verify, bucket rollover, wrong-room rejection, no-key fail-open, log-vs-enforce mode, host-session acceptance, unauthorized rejection — all PASS
- `__tests__/advance-rate-limit.test.ts` — per-room cap, room independence, window slide, route-level 429 — all PASS

### Rotation engine

```
tests 59 pass 59 fail 0
```

### E2E (Playwright, ADVANCE_AUTH=enforce)

```
43 passed (1.8m)
```

Including all 4 new `advance-auth.spec.ts` tests:
1. Bare advance → 401 ✓
2. Stale/wrong screen token → 401 ✓
3. Valid screen token → 200 ✓
4. Helper token round-trip sanity → 200 ✓

---

## Manual test results (ENFORCE mode, port 3145)

### 1. TV flow end-to-end

- Created room via `/new` → room `karaokebar45` (host code: `bbp6j6p8`) ✓
- Submitted 2 songs to default room (API) — `nowPlaying: Never Gonna Give You Up`, `items: 2` ✓
- Navigated to `/default/tv` — TV polled queue, displayed hero `Never Gonna Give You Up` / singer `Alice` ✓
- TV skip button click → advance call intercepted with `X-Boraoke-Screen: 644cd827...` → HTTP 200 → TV advanced to `Song Two` / `Bob` ✓
- Second skip confirmed advance chain working ✓
- Evidence: `apptester-03-tv-first-song-playing.png`, `apptester-04-tv-second-song-after-advance.png`, `apptester-tv-advance-headers.txt`

### 2. Patron-context bare advance is DEAD (enforce mode)

All three sub-tests return **401**:

| Test | Request | Result |
|------|---------|--------|
| No header | `POST /api/queue/advance` (bare) | `{"error":"Unauthorized"}` 401 ✓ |
| Garbage header | `X-Boraoke-Screen: deadbeef...` | `{"error":"Unauthorized"}` 401 ✓ |
| Wrong-room token | Token minted for `otherroom` submitted to `default` | `{"error":"Unauthorized"}` 401 ✓ |

Evidence: `apptester-curl-401-evidence.txt`

### 3. Host paths still work

- Admin page (`/default/admin`) login with dev-fallback token: `{"ok":true}` ✓
- Admin skip button uses `/api/host/skip` (host session cookie, path-scoped to `/api/host`) — not `/api/queue/advance` ✓
- Queue cleared after admin skip click ✓
- Evidence: `apptester-05-admin-skip-button.png`

Note on host-session advance path: `isAdvanceAuthorized` includes a `requireHost` branch (tested via unit tests at the function level — `screen-token.test.ts:150`). In the browser this path is unreachable because the session cookie is httpOnly and path-scoped to `/api/host` — by design, the admin uses `/api/host/skip` instead. This is correct per the design; the unit test covers the code path.

### 4. Rate-limit backstop

- 14 authed advances (valid screen token, ADVANCE_AUTH=enforce):
  - Requests 1–12: HTTP 200 ✓
  - Request 13: HTTP 429 `{"error":"Too many advances","reason":"rate"}` ✓
  - Request 14+: HTTP 429 ✓ (window still active)
- Evidence: `apptester-rate-limit-evidence.txt`

### 5. Legacy /default room (HOST_TOKEN key path)

- Default room in dev mode uses `DEV_FALLBACK_TOKEN = "cantai-dev-host"` as the room secret ✓
- Token minted from `HMAC-SHA256("cantai-dev-host", "boraoke-screen-v1|default|<bucket>")` — valid advances succeed ✓
- The entire e2e suite uses the default room with enforce mode and all 43 tests pass ✓

### 6. LOG mode

- Started server with `ADVANCE_AUTH=log` on port 3145
- Bare `POST /api/queue/advance` → **HTTP 200** (not rejected) ✓
- Server log immediately showed: `[advance-auth] would-block advance room=default reason=unauthorized mode=log` ✓
- TV flow was not affected ✓
- Evidence: `apptester-log-mode-evidence.txt`

---

## Evidence index

| File | What it proves |
|------|----------------|
| `apptester-01-room-created.png` | Room creation via /new — room slug + host code visible |
| `apptester-02-tv-page-default-room.png` | TV page idle state (no queue) — screen loads cleanly |
| `apptester-03-tv-first-song-playing.png` | TV showing "Never Gonna Give You Up" / Alice as now-playing |
| `apptester-04-tv-second-song-after-advance.png` | TV advanced to "Song Two" / Bob after authed skip |
| `apptester-05-admin-skip-button.png` | Admin page with Skip song button — host is logged in |
| `apptester-curl-401-evidence.txt` | Patron bare/garbage/wrong-room advances → 401 in enforce mode |
| `apptester-rate-limit-evidence.txt` | Rate limit trips at request 13 (cap=12), returns 429 |
| `apptester-tv-advance-headers.txt` | TV advance calls carry `X-Boraoke-Screen` header (fetch interceptor proof) |
| `apptester-log-mode-evidence.txt` | LOG mode: bare advance → 200, server emits would-block line |
| `local-verify-summary.txt` | Dev's local verify: build + 460 jest + 43 e2e + 59 engine all GREEN |

---

## Defects found

None. All acceptance criteria pass.

---

## Friction

- Playwright `browser_take_screenshot` is restricted to the framework repo's allowed roots — screenshots landed in the quarantine (`work/evidence/_quarantine/`) and required manual copy to the product worktree. The `capture-screenshots` skill's capture path would avoid this by serving and capturing within the product worktree directly.
- Rate-limit state is in-process (not shared across server restarts). Testing recovery requires waiting 60s or restarting the server; tested via server restart.
- The `host-session` path in `isAdvanceAuthorized` is unit-tested but not reachable via browser in manual testing (cookie path scoping). This is by design, not a defect — and the unit tests cover it.

---

## Verdict

**[app-tester] PASS** — TICKET-45 advance/skip authorization (screen token + rate limit) fully verified. All 3 test suites green (460+59+43). ENFORCE mode gates unauthorized advances with 401, TV carries screen token, rate limit trips at cap, LOG mode is non-breaking. Ready to merge.
