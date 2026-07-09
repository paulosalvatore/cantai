# TICKET-45 — Advance/skip authorization (screen token + rate limit)

- **Product:** boraoke · **Branch:** `ticket/45-advance-auth` · **Worktree:** `.worktrees/ticket-45` · **App port:** 3045
- **Origin:** TL-directed ("skip should only be from tv… confirm the session code"), deferred from TICKET-41 **with a complete design**. This ticket **implements that design** — it does not redesign it.
- **Authoritative design:** `work/plans/TICKET-41-plan.md` §Advance-auth (lines 65–78) + §Honest threat note. That section is the spec; this ticket references it verbatim.

## Problem

`POST /api/queue/advance` is unauthenticated (TICKET-1 security INFO, accepted-for-prototype). Any patron who reads the room QR knows the slug and can `curl` it to skip the current singer. The TL directive: skips should originate only from the TV screen (or an authenticated host), and the caller must prove it holds the room's session material.

## Design (implementing `work/plans/TICKET-41-plan.md` §advance-auth — option 2 + 3 combined)

1. **Screen token (stateless HMAC).** The `/[room]/tv` server component already resolves the room server-side. It additionally mints a stateless token:
   `HMAC-SHA256(key = server-only room secret, msg = "boraoke-screen-v1|<roomId>|<24h-bucket>")`
   where the room secret is `resolveRoomToken(roomId)` (the room's `hostCodeHash`; the legacy `default` room keys off env `HOST_TOKEN`, then the dev fallback). The token is passed to `TvScreen` as a prop and sent on every advance call as the `X-Boraoke-Screen` header.
2. **Verification.** `POST /api/queue/advance` recomputes the token and compares with `timingSafeEqual`, **accepting the current AND previous 24h bucket** (so a TV page open across a bucket boundary keeps working). It **also** accepts a valid host session cookie (the admin skip path — `/api/host/skip` already gates on `requireHost`, but a direct authed advance stays valid too).
3. **No-key rooms = enforcement off.** When `resolveRoomToken(roomId)` is `null` (production room with nothing configured), there is no secret to mint/verify against → advance auth is not enforced for that room (fail-open; nothing to protect the skip against yet).
4. **Per-room advance rate limit (defense-in-depth backstop).** House dual-bucket sliding-window pattern (same class as `queue-rate-limit.ts`): a per-room advance throttle blunts skip-spam even where the token is scraped. This is the backstop rung, not the primary gate.
5. **Rollout: flag-gated log-only → enforce.** `ADVANCE_AUTH` env flag: `log` (DEFAULT) records a would-block observation and lets the call through; `enforce` returns `401` on a missing/invalid credential. Ship with `log` default; the TM flips to `enforce` via env after a quiet observation window (see the dev report's rollout section).

### Honest threat-model note (kept in code comments, per the plan)

`/[room]/tv` is a **public** page, so a determined attacker can scrape the screen token from its HTML/props. The screen token raises the bar from "one curl of a guessed slug" to "fetch + parse the TV page for this specific room" — which **kills the casual/patron-prank skip class**, the class that actually threatens a venue night. It does not stop a targeted scraper; the accounts wave (#14) hardens further. This is a deliberate, documented prototype trade-off.

## Ownership boundary (parallel TICKET-44 moderation)

TICKET-44 owns `/api/queue` POST, admin approval UI, patron pending states. **This ticket owns** `/api/queue/advance`, the TV server page + `TvScreen` fetch layer, `lib/host-auth.ts` additions (a new `lib/screen-token.ts` sibling to avoid cookie/auth-file churn), and the e2e drain/advance helpers. No file overlap expected; flag any unavoidable overlap for sequential merge.

## Scope / acceptance

- [ ] Screen-token mint/verify module with bucket rollover + wrong-room rejection + host-session acceptance.
- [ ] Advance route enforces per the flag (`log` default → `enforce`); per-room advance rate limit as backstop.
- [ ] TvScreen sends `X-Boraoke-Screen` on every advance (watchdog + ENDED auto-advance + manual skip button all go through this one fetch layer).
- [ ] Host skip (`/api/host/skip`) + admin skip keep working unchanged.
- [ ] e2e drain/advance helpers migrated to authenticated advance via a **shared test helper** that mints/obtains the credential.
- [ ] Tests: unit (token mint/verify incl. bucket rollover, wrong-room rejection, log-vs-enforce; rate limit) + e2e (patron bare advance → 401 in enforce mode; TV flow green; host skip green).
- [ ] Any new user-visible strings via the next-intl catalogs (should be ~none — maybe an admin hint). CI i18n-completeness parity stays green.

## Non-goals

- Re-scoping the host cookie or requiring TV login (the plan rejected host-session as the primary gate — it breaks the zero-login TV UX).
- Accounts / durable identity (#14).
