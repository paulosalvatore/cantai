# TICKET-30 — i18n framework + language switcher — Dev report

- **Status:** IMPLEMENTED (non-contested surfaces) · PR #23 (draft, REBASES-LAST) · awaiting 40/41/43 merge for the final contested-surface sweep.
- **Branch:** `ticket/30-i18n` · **Worktree:** `.worktrees/ticket-30` · **App port:** 3030 requested but OCCUPIED by another product's dev server — used **3230** for local e2e (note in Friction).
- **PR:** https://github.com/paulosalvatore/boraoke/pull/23

## Framework choice + URL decision
**next-intl 4.13.1, App Router, WITHOUT i18n routing.** Locale in the `NEXT_LOCALE` cookie (resolution: cookie → room default language → `Accept-Language` → pt-BR). **Zero URL changes** — rooms stay `/<room>`, no `[locale]` segment, no middleware. Documented in `i18n/locales.ts` header + `next.config.ts` comment.

## What's implemented (this PR — non-contested)
- **Infra:** `i18n/locales.ts` (pure resolution fns), `i18n/request.ts` (getRequestConfig, cookie+Accept-Language), `i18n/set-locale.ts` (server action), next-intl plugin in `next.config.ts`, `NextIntlClientProvider` + dynamic `<html lang>` in `app/layout.tsx`.
- **Catalogs:** `messages/{pt-BR,en,es}.json` — FULL (all surfaces incl. contested), pt-BR source of truth; en/es authored natural + party-host voice.
- **Metadata:** `app/generate-metadata.ts` (locale-aware title/description/OG image, pt-BR fallback) split from CJS-testable `app/metadata.ts`; `ogImageForLocale` helper.
- **Switcher:** `components/LanguageSwitcher.tsx` (+`.module.css`) — globe pill, native names, no flags, popover/bottom-sheet, logical-properties CSS (RTL pre-work). Live on `/new`.
- **Room language (additive):** `RoomSettings.language?` + `get/setRoomLanguage` in `lib/rooms.ts`; `POST /api/host/language` (host-authed, mirrors `/api/host/mode`).
- **Extracted now:** `/new` (full), `FeedbackWidget` + `FeedbackSheet` (full), rooms API user-facing 429/503 errors (server `getTranslations`).

## Implementation log (commit SHAs)
- `827ea0f`→ infra + /new + catalogs + switcher + room-lang model + plan + audit (first commit).
- feedback + rooms errors + i18n tests (locale/room-lang/completeness) + metadata split + next-intl-server jest mock.
- e2e language-switcher spec (this commit).
(SHAs on the PR branch; see `gh pr view 23`.)

## Self-verification (proof, not prose)
- **Unit:** `npx jest` → **382 passed / 27 suites** (incl. i18n-locales, i18n-completeness [CI gate: key + ICU placeholder parity], room-language, metadata OG fallback).
- **Build:** `npm run build` → GREEN; `/api/host/language` compiles; all routes build.
- **E2E:** `PORT=3230 npx playwright test language-switcher` → **4 passed** (switch→persist→no-URL-change; en-US Accept-Language→EN; es-MX→ES). Full e2e suite run pending (in progress at report time; will paste result).
- **verify-green-local.sh:** to run before gate request.

## Contested-components checklist (FINAL REBASE — after 40/41/43 merge)
Translations already authored in catalogs; rebase = pure `t()` wiring.
- [ ] `app/(patron)/[room]/PatronRoom.tsx` — the wrong-language surface (~26 EN strings) → `Patron` namespace + switcher placement + ICU queueCount/positionHero. **TICKET-40.**
- [ ] `components/SongSearch.tsx` — `Search` namespace; degraded reason codes → `t()`. **TICKET-40.**
- [ ] `components/tv/TvScreen.tsx` — `Tv` namespace; MUST read ROOM language (not user cookie) via a scoped provider; NO switcher. **TICKET-41.**
- [ ] `app/page.tsx` (landing) — `Landing` namespace + switcher. **TICKET-43.**
- [ ] `app/(patron)/[room]/admin/AdminRoom.tsx` + `components/host/ModeSwitcher.tsx` + `lib/rotation-modes.ts` — `Admin`/`Modes` namespaces + room-language selector UI (wires `POST /api/host/language`). **TICKET-43.**
- [ ] Remaining user-facing API errors localized alongside their contested consumers: search 429, queue 429 (`SUBMIT_RATE_MESSAGE`), host 503.

## Translation coverage
- Infra + non-contested surfaces: **100%** extracted + translated (3/3 locales, completeness-gated).
- Whole app (incl. contested, not yet wired to components): catalogs are **100% authored** for all 3 locales; component wiring of contested surfaces is the rebase pass.

## Friction
- **Port 3030 collision:** the assigned app port was already held by another product's `next dev` (served desapega's 404 page). Had to hunt a free port (3230). A `port-allocate` skill / per-product port ranges would prevent this.
- **next-intl ESM under ts-jest:** `next-intl/server` is ESM and breaks CJS jest on import. Resolved by (a) splitting `generateMetadata` out of the testable `metadata.ts`, (b) a `__mocks__/next-intl-server.ts` stub mapped in jest config (returns real pt-BR copy so route tests still assert user-facing strings).
