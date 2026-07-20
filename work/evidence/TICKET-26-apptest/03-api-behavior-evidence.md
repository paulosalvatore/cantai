# TICKET-26 — API / behavioral evidence log (App Tester)

Captured against a live `next dev -p 3026` on branch `ticket/26-anon-identity-registry`. Complements the three PNG screenshots in this directory. Every claim below was produced by a real request against the running app (curl or in-browser `fetch`), not read from code.

## State 1 — Fresh device (mint + httpOnly cookie)

`POST /api/identity` with an empty body, no prior cookie:

```
HTTP/1.1 200 OK
set-cookie: boraoke_identity=189b8aad-9c67-4e84-a9a5-3b1303fc8bbc; Path=/; Expires=Wed, 19 Jul 2028 ...; Max-Age=63072000; HttpOnly; SameSite=lax
{"uuid":"189b8aad-9c67-4e84-a9a5-3b1303fc8bbc","registered":true}
```

- Exactly one identity minted, `registered:true`.
- Cookie flags: **HttpOnly** ✓, SameSite=lax ✓, Path=/ ✓, Max-Age = 2 years (63072000s) ✓. `Secure` is correctly ABSENT in dev (`NODE_ENV!=production`); it is applied in prod per `identityCookieOptions()`.
- In-browser (screenshot 01): after loading `/default`, `document.cookie` = `fb_locale=en; NEXT_LOCALE=en; apptester-boom=1` — **no `boraoke_identity`**; `window.cookieStore.getAll()` also does not list it. The identity cookie is invisible to page JS (the whole point vs. the localStorage-only legacy `patronUuid`). The `POST /api/identity => 200` fire-and-forget call is present in the page's network log.

## State 2 — Returning device (reuse, no duplicate)

Reload of `/default`, then re-registering with the device's stored uuid:

```
localStorage cantai_patron_uuid : fa65e56a-727d-485c-b419-daf16c98faa1
server_returned_uuid            : fa65e56a-727d-485c-b419-daf16c98faa1
same_identity_reused            : true
registered                      : true
```

- Same uuid returned across reload — no duplicate identity created.
- Full join flow exercised (screenshot 02): joined as "AppTester", pasted a YouTube link, "Add to queue" → **"✓ You're in the queue!"**; the live queue grew to 2 songs with my entry (row 2) attributed to nickname "AppTester". Identity registration did not disrupt the existing patronUuid-scoped join/submit path.
- Cookie precedence proven at the API level (a request carrying `Cookie: boraoke_identity=<A>` and body `legacyUuid=<B>` returned `<A>` — the cookie wins over a supplied legacy uuid).

## State 3 — Legacy continuity (adoption, no duplicate)

Legacy device = a stored client-minted uuid, no identity cookie yet (`credentials:'omit'` in-browser fetch, plus a `curl` with a valid v4 legacy uuid):

```
legacy_uuid_sent                   : d3adb33f-1234-4abc-89de-0123456789ab
identity_uuid_returned             : d3adb33f-1234-4abc-89de-0123456789ab
adopted_legacy_without_duplicate   : true
registered                         : true
still_httpOnly_invisible_to_js     : true
```

- The server adopts the legacy uuid **exactly** as the identity uuid (no new/duplicate identity). Existing patrons keep their uuid → own-row highlighting continuity preserved. Join UX is visually unchanged (same page as screenshot 01).
- Edge case: a legacy uuid that is not a valid RFC-4122 uuid (variant nibble outside `[89ab]`) is treated as "no legacy" and a fresh uuid is minted — real client `patronUuid`s are always `uuidv4()`, so this only affects malformed input, and it fails safe (still mints, still 200).

## State 4 — Room creation

`POST /api/rooms {"name":"Apptest Room","patronUuid":"<v4>"}`:

```
HTTP/1.1 201 Created
set-cookie: boraoke_identity=272c947b-...; Path=/; ...; HttpOnly; SameSite=lax
{"id":"apptest-room","name":"Apptest Room","hostCode":"...","joinPath":"/apptest-room","ephemeral":false}
```

- Room creation succeeds (201) and applies the httpOnly identity cookie. `creatorUuid` / `identity:{uuid}:rooms` persistence is server-side (memory store in dev) and asserted by `__tests__/rooms.test.ts` + `__tests__/identity-store.test.ts`.
- In-browser (screenshot 04): `/new` → "Create room" → **"Room's live!"** with QR, guest URL, and host code. No regression to the creation flow.

## State 5 — Fail-open / no-block

- The endpoint tolerates bad input without ever 4xx-ing: malformed JSON body → `HTTP 200`; oversized (>512B) body → `HTTP 200` (treated as "no legacy uuid").
- Store-outage fail-open is covered by `__tests__/identity.test.ts` → `"fail-open: a throwing store never throws out of resolveIdentity"` (injects a store whose every method throws; asserts `result.ok === false` and no throw). Confirmed present and green.

## Automated tests

- **Jest:** `39 suites / 571 tests passed` (includes `identity.test.ts`, `identity-store.test.ts`, extended `rooms.test.ts`).
- **Playwright e2e (`PORT=3026`, reusing the running dev server):** `47 passed, 2 failed`.
  - The 3 identity specs PASS: fresh-device single httpOnly cookie; repeat-visit reuse; patronUuid pending-poll continuity.
  - The 2 failures are `advance-auth.spec.ts` (bare/stale-token advance → 401). These are an **environment artifact, not a regression**: `playwright.config.ts`'s `webServer.env` sets `ADVANCE_AUTH=enforce`, but because a plain `next dev` server was already running, `reuseExistingServer` reused it *without* that env, so advance auth ran in default log-only mode (`curl -X POST /api/queue/advance` → `HTTP 200` instead of 401). Unrelated to identity; the assertions themselves are correct.
