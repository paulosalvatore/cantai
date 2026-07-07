# TICKET-20 — Dev report

Status: implemented — full unit + e2e green locally; PR open, awaiting CI.
Branch: `ticket/20-p0-ux-fixes`
Worktree: `/Users/paulosalvatore/Documents/GitHub/cantai/.worktrees/ticket-20`
App port: 3020

## Root-cause verdict — room-404 (item 1)

**CONFIRMED: production runs the MEMORY driver (Upstash unprovisioned).** Room meta lives only on
the lambda that created the room; any other lambda 404s it.

Live-API proof (against https://cantai-snowy.vercel.app):

- Created a probe room via `POST /api/rooms` → id `ticket20-rootcause-probe-wwkn`.
- A **parallel burst** of 20 `GET /api/rooms?id=<id>` (no keep-alive, cache-busted → forces
  multiple lambda instances): **13 → HTTP 200, 7 → HTTP 404.** Divergence = per-lambda state.
- A fresh `GET /<id>` (patron page HTML) returned **"Essa sala não existe"** — exactly the TL's
  symptom. Sequential curl (one keep-alive connection = one lambda) returned 200×10, which is why
  the bug looks intermittent from a browser but reliably reproduces under lambda spread.

**THE fix is Upstash provisioning (TL action — escalated separately).** This ticket ships the
honest-failure UX + recreate path, not the infra fix.

## Per-bug fixes

1a. **Honest ephemeral notice.** New `isEphemeralRoomStore()` in `lib/rooms.ts` (memory driver AND
   `NODE_ENV==='production'` → true; false in dev/CI so it never leaks into local UX/tests).
   `POST /api/rooms` now returns `ephemeral`; `/new` success screen shows a pt-BR temporary-room
   warning when true; the room-404 page shows the same notice.
1b. **One-click recreate.** Room-404 page: when the slug is a valid shape but has no record, offers
   a "Recriar sala «Nome»" button → `/new?name=<derived>` (prefilled create form → user gets a
   fresh room + host code + QR). `deriveRoomName()` de-slugifies (drops a trailing 4-char suffix,
   title-cases). `/new` reads `?name=` to prefill.
2. **Landing join input reveal.** Root cause: the input's default fill is `var(--surface)` — the
   SAME fill as its container card — so it was camouflaged. Fixed with a darker fill
   (`var(--bg)`) + clearer border + a helper line. Evidence 01 shows it now clearly reads as a field.
3. **"Customer YT screen isn't showing".** BOTH interpretations investigated:
   - (a) Patron page has **no** player **by design** (video plays on the shared `/[room]/tv`, not on
     N phones = N audio streams). Added a `data-testid="patron-player-hint"` "assista na TV" hint
     linking to the TV view; design decision recorded in a code comment.
   - (b) `/[room]/tv` renders the YT iframe host (`#yt-player`) correctly with a seeded queue and a
     sane idle poster with an empty queue — verified by new e2e (no real rendering bug found).
4. **Clean room slugs.** `slugify()` now returns the clean slug (no random suffix). `createRoom()`
   appends `-<4char>` ONLY on collision with an existing room OR a reserved id. Added
   `RESERVED_ROOM_IDS = {new, api, tv, admin, default}` + `isReservedRoomId()` — SECURITY-CRITICAL:
   the old always-on suffix was what made a `tv`/`admin`/`api`/`new`/`default` collision impossible;
   dropping it required this explicit guard so a venue named "TV" can never shadow the `/tv` route.
   `isValidRoomId` unchanged.
5. **Admin → customer-screen nav.** Admin header now has "Sala do público ↗" (→ `/[room]`) and
   "Abrir /tv ↗" (→ `/[room]/tv`), both new tab. (Evidence 04.)
6. **Render + link test suite.** New `e2e/render-and-links.spec.ts` (10 specs): per-page essential
   elements for landing, `/new`, `/new?name=` prefill, `/[room]` join→song input+queue+player-hint,
   room-404 recreate path, `/[room]/tv` iframe (seeded) + idle, `/[room]/admin` login→controls+mode
   switcher+customer links, legacy `/admin` & `/tv` redirects, and a link-crawler asserting every
   internal href on landing/`/new`/room-tv/room resolves non-404. Warms routes before seeding
   (memory-store first-compile reset pattern).

## Test inventory / counts

- Unit (jest): **333 → 333 passed** (23 suites). Updated `__tests__/rooms.test.ts` for the clean-slug
  change; added tests for `isReservedRoomId`, `deriveRoomName`, clean-slug mint, collision-suffix,
  and reserved-name→forced-suffix.
- E2e (playwright, PORT=3020): **28 → 28 passed** (was 18; +10 new in render-and-links.spec.ts).
- Build: `npm run build` exit 0 (typecheck clean).

## Evidence

`work/evidence/ticket-20/` (7 PNGs): 01 landing input visible, 02 new-room created, 03 patron
player-hint, 04 admin customer-screen links, 05 room-404 recreate, 06 tv playing (embed), 07 tv idle.

## Files touched

- `lib/rooms.ts` — slugify clean, reserved ids, collision-only suffix, deriveRoomName,
  isEphemeralRoomStore/roomStoreDriver.
- `app/api/rooms/route.ts` — return `ephemeral`.
- `app/new/page.tsx` — `?name=` prefill + ephemeral notice.
- `app/(patron)/[room]/page.tsx` — honest 404 + recreate path.
- `app/page.tsx` — landing input contrast.
- `app/(patron)/[room]/PatronRoom.tsx` — player-hint.
- `app/(patron)/[room]/admin/AdminRoom.tsx` — customer-screen links.
- `__tests__/rooms.test.ts`, `e2e/render-and-links.spec.ts`.

Did NOT touch `lib/store/**` (parallel Dev owns it).

## CI

To be pasted verbatim once the PR CI runs.
</content>
