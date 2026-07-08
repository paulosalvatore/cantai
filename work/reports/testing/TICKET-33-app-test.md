# TICKET-33 — App Tester Gate Report: Boraoke code rebrand + publish metadata

Gate: PR #20 (`paulosalvatore/boraoke`, branch `ticket/33-code-rebrand`) · Tested at `38ccced` (includes the OG filename fix `9f8879f`) · Date: 2026-07-08 · Serve: `next dev -p 3033` (memory store, dev mode) · CI: green (`build-and-test` pass).

## Verdict: PASS (launch review)

One known cross-PR dependency (OG image asset in unmerged PR #19) and one minor non-blocking note (`/favicon.ico`); details below.

## 1. Zero stale brand — PASS

Rendered HTML of every route fetched via curl and grepped case-insensitively for `cantai`:

| Route | Status | `cantai` hits |
| --- | --- | --- |
| `/` (landing) | 200 | 0 |
| `/new` | 200 | 0 |
| `/bar-do-ze` (patron, joined state verified in browser too) | 200 | 0 |
| `/bar-do-ze/tv` | 200 | 0 |
| `/bar-do-ze/admin` (pre- and post-login states) | 200 | 0 |
| `/nonexistent-room-xyz` (room-not-found fallback) | 200 | 0 |
| `/tv` legacy → 307 `/default/tv`, followed | 200 | 0 |
| `/admin` legacy → 307 `/default/admin`, followed | 200 | 0 |

**Zero user-visible stragglers.** The only `cantai` strings observed anywhere during testing were (a) the local filesystem path of the worktree (`GitHub/cantai/...`) inside dev-mode redirect stack bodies — machine-local, never present in prod output; and (b) the deliberate `cantai_*` localStorage/cookie keys (§5), which are internal per the ticket decision.

## 2. Publish metadata — PASS (with known cross-PR dependency)

- `<title>`: default `Boraoke — a fila de karaokê do seu bar`; template works — TV page renders `TV · Boraoke` (`%s · Boraoke`).
- `<meta name=description>` pt-BR present; `og:title`, `og:description`, `og:url=https://boraoke.com`, `og:site_name=Boraoke`, `og:locale=pt_BR`, `og:type=website`, `og:image=https://boraoke.com/brand/og-image-pt-BR.png` (ABSOLUTE URL, post-fix filename), `og:image:width/height=1200/630`, `og:image:alt` all present; `twitter:card=summary_large_image` + title/description/image present. Evidence: `apptester-05-og-meta-tags.png`.
- **Known cross-PR dependency (not a fail):** `/brand/og-image-pt-BR.png` → 404 on this branch alone; the PNG ships in unmerged PR #19 (brand-assets). The tag references the correct per-locale path. PR #19 must merge before/with #20 for the OG image to resolve in prod.
- Icons: `/icon.png` 200 `image/png` (32×32, linked `rel=icon`), `/apple-icon.png` 200 `image/png` (180×180, linked `rel=apple-touch-icon`), `/icons/icon-192.png` + `/icons/icon-512.png` 200.
- `manifest.json`: 200, valid JSON — name/short_name **Boraoke**, `theme_color`/`background_color` **#0D0A14**, lang pt-BR, standalone, 192/512 maskable icons. `<meta name=theme-color content=#0D0A14>` present.
- `robots.txt`: 200 — `User-agent: * / Allow: /` + `Sitemap: https://boraoke.com/sitemap.xml`.
- MINOR (non-blocking): no `public/favicon.ico` — a raw `/favicon.ico` request falls through to the `[room]` catch-all and returns the room-not-found HTML with 200. Browsers use the `<link rel=icon>` so real UX is unaffected, but legacy clients/crawlers hitting `/favicon.ico` get HTML. Suggest a follow-up: add a real `favicon.ico` (asset could ride PR #19).

## 3. Canonical redirect — PASS

- `curl -H "Host: cantai-snowy.vercel.app" /bar-do-ze?x=1&y=2` → **HTTP/1.1 308 Permanent Redirect**, `location: https://boraoke.com/bar-do-ze?x=1&y=2` — path AND query preserved.
- Normal host, same path → 200, no redirect.

## 4. TV byline — PASS

`powered by Boraoke` present in the SSR HTML of `/bar-do-ze/tv` and rendered on screen (wordmark span, footer flag default on). Evidence: `apptester-03-tv-powered-by-boraoke.png` (idle screen: Boraoke wordmark ×2 + byline).

## 5. Storage-key continuity — PASS

Joined `bar-do-ze` as "Tester" via the real UI. localStorage after join:
`cantai_patron_uuid` (uuid written fresh), `cantai_nickname=Tester`, `cantai_last_room=bar-do-ze`, `cantai:bar-do-ze:nick=Tester` — the deliberate legacy prefixes intact, no forced identity loss. App fully functional on those keys.

## 6. Regression — PASS

- Unit: **24 suites / 354 tests PASS** (includes the new `__tests__/metadata.test.ts`).
- E2E (`PORT=3033 npm run test:e2e`): **28/28 PASS** — see suite log line below.
- Submit flow (manual, browser): pasted YouTube URL on patron page → "Link colado" resolved → Add to queue → "✓ Song added to the queue!" → Live queue (1 song). PASS.
- Mode switcher smoke (manual, browser): admin login with host code → switched 🎤 Karaokê completo → 🍻 2 por mesa → new mode shows ATIVO/checked. PASS. Evidence: `apptester-04-admin-mode-switched.png`.
- Dev-only observation (pre-existing, not a rebrand regression): the in-memory store resets on each route's first compile (documented memory-driver caveat), which intermittently 401s/503s host APIs until routes are warmed — exactly why e2e warms routes. No action needed.

## Evidence (`work/evidence/ticket-33/`)

- `apptester-01-landing-boraoke.png` — landing, Boraoke wordmark + new title
- `apptester-02-patron-joined.png` — patron page joined (🎤 Boraoke header)
- `apptester-03-tv-powered-by-boraoke.png` — TV with `powered by Boraoke` byline
- `apptester-04-admin-mode-switched.png` — admin, mode switched to 2 por mesa
- `apptester-05-og-meta-tags.png` — rendered OG/Twitter/icon/manifest tags

Servers stopped after testing.
