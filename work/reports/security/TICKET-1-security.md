# Security Report — TICKET-1: Walking Skeleton (Karaoke Prototype Core)

**Verdict: PASS-WITH-NOTES**
**Date:** 2026-07-05
**Auditor:** Cyber Security agent
**PR:** paulosalvatore/cantai #4 (`ticket/1-walking-skeleton`)
**App Tester gate:** PASSED (functional) — pre-condition satisfied

---

## Scope Audited

- `app/api/queue/route.ts` — POST/GET queue API, input parsing/validation
- `app/api/queue/advance/route.ts` — unauthenticated advance (skip) endpoint
- `lib/youtube.ts` — YouTube URL/ID parser
- `lib/store.ts` — in-memory queue store
- `app/page.tsx` — patron-facing UI (queue submission + live list)
- `app/tv/page.tsx` — venue TV display (YouTube IFrame API player)
- `.github/workflows/ci.yml` — CI workflow for secret/config leakage
- `package.json` / `package-lock.json` — dependency audit

Audit bar: **prototype-stage** — block real exploitable issues; note-and-defer hardening.

---

## CI Status

`gh pr checks 4` output:

| Check | Status |
|---|---|
| Vercel (deployment) | **FAIL** |
| Vercel Preview Comments | pass |
| `build-and-test` (GitHub Actions) | **never ran** |

The GitHub Actions workflow `ci.yml` is introduced by this very PR; GitHub does not run a workflow against a PR if it doesn't yet exist on `main`. This is expected bootstrap behaviour, not a process failure. The functional App Tester gate (PASSED) provides equivalent evidence. The Vercel deployment failure is an operational issue (deployment configuration), not a security issue — no required security-relevant checks are blocked.

---

## Findings

### MEDIUM — Unvalidated `rawVideoId` Bypass (`app/api/queue/route.ts:37–38`)

**Location:** `app/api/queue/route.ts` lines 36–39

```ts
const resolvedVideoId =
  typeof rawVideoId === "string" && rawVideoId
    ? rawVideoId          // ← NO format validation
    : parseYouTubeVideoId(...);
```

When a caller POSTs `{"videoId": "<arbitrary-string>", ...}` instead of `youtubeUrl`, the API skips the YouTube parser entirely and stores the raw value without validating it against the 11-char `[A-Za-z0-9_-]{11}` regex. The helper `isValidVideoId` in `lib/youtube.ts:53` exists but is not called on this path.

**Impact:** An attacker can store arbitrary strings (e.g. `"../../../../etc"`, `"<evil>"`, 10 000-char blobs) as `videoId`. React's JSX text interpolation escapes the value when rendering (`youtu.be/${entry.videoId}`) — no stored XSS. The YouTube IFrame API (`loadVideoById`) also handles invalid IDs safely by failing to load, not by injecting code. The primary impact is **data integrity corruption** and enabling oversized-field abuse on this field (it has no length cap unlike nickname having a trim-length check).

**Remediation (MVP):** Add format validation on the direct-videoId path:
```ts
if (!isValidVideoId(rawVideoId)) return NextResponse.json({ error: "Invalid videoId" }, { status: 400 });
```
Export `isValidVideoId` from `lib/youtube.ts` and call it in the route.

---

### MEDIUM — No Field Length Caps (`app/api/queue/route.ts:48–66`)

**Location:** `app/api/queue/route.ts` lines 48–66

None of the string fields — `nickname`, `title`, `table`, `patronUuid` — have a maximum-length check. A caller can store multi-megabyte values for each, multiplied by unbounded queue entries (see next finding).

**Impact at prototype:** Server-local, low real-world risk. At MVP/production with external access: DoS via memory exhaustion from a single malicious request (e.g. 100 MB `nickname`).

**Remediation (MVP):** Add per-field max lengths (e.g. nickname ≤ 64, title ≤ 200, table ≤ 16, patronUuid ≤ 36 / UUID length). Reject out-of-range with 400.

---

### MEDIUM — Unbounded Queue Depth (`lib/store.ts:26–29`)

**Location:** `lib/store.ts` — `addToQueue` (line 29)

```ts
export function addToQueue(entry: QueueEntry): void {
  queue.push(entry);  // no depth cap
}
```

The in-memory queue has no maximum size. An unauthenticated caller can POST arbitrarily many entries, exhausting server memory.

**Impact at prototype:** Acceptable (single-venue test, server is local). At MVP: DoS vector with no auth guard.

**Remediation (MVP):** Add a configurable `MAX_QUEUE_DEPTH` (e.g. 200) and return 429 when exceeded.

---

### MEDIUM — Next.js 15.3.4 CVEs (`package.json`)

**`npm audit` summary (2 vulnerabilities, 1 moderate, 1 critical):**

| Package | Severity | Relevant CVEs |
|---|---|---|
| `next` 15.3.4 | critical | Cache Key Confusion, Content Injection, SSRF in Middleware redirects, RCE in React flight, Server Actions source exposure, DoS via Server Components/cache, HTTP smuggling in rewrites |
| `postcss` (transitive via next) | moderate | XSS via unescaped `</style>` in CSS Stringify |

**Applicability to this app:** This app uses API Routes, not Middleware, Server Actions, or Image Optimization. The most severe advisories (SSRF in Middleware, RCE in React flight protocol, Server Actions source exposure) do not have an exploit path in this configuration. Cache-poisoning and DoS via Server Components are partially applicable if the app is ever deployed behind a CDN.

**Fix available:** `npm audit fix --force` installs `next@15.5.20`. The package.json pins an exact version (`"next": "15.3.4"`), not a range, hence the "outside stated range" message — the fix is safe to apply by changing the pin.

**Remediation (MVP, before public deployment):** Bump `"next": "15.3.4"` → `"next": "15.5.20"` (or latest stable 15.x) in `package.json` and re-lock.

---

### INFO — No Content-Security-Policy Headers (`next.config.ts`)

**Location:** `next.config.ts` (empty config)

No CSP is configured. The app loads the YouTube IFrame API (`https://www.youtube.com/iframe_api`) via a dynamically injected `<script>` tag (`app/tv/page.tsx:61–65`). At prototype stage this is acceptable; for production a CSP is required to restrict script-src.

**Remediation (post-MVP):** Add `headers()` in `next.config.ts` with a CSP that allows `script-src 'self' https://www.youtube.com https://s.ytimg.com` and `frame-src https://www.youtube.com`.

---

### INFO — Vercel Deployment Failing (Non-Security)

The Vercel preview deployment for this PR is failing. This is an operational/config issue, not a security finding. The GitHub Actions `build-and-test` job (which covers build + unit tests + Playwright e2e) has not run because it was introduced by this PR. Standard Next.js build should be verified before merging by re-triggering CI or confirming the App Tester gate is sufficient.

---

### INFO — Unauthenticated `POST /api/queue/advance` (By Design)

**Location:** `app/api/queue/advance/route.ts`

The skip/advance endpoint has no authentication. Any browser tab with knowledge of the URL can skip the current song. This is explicitly in-scope as a prototype design decision (venue operator controls the TV screen, no patron auth). **Not a finding** at this stage; flag for operator-auth before production.

---

## XSS Assessment

**Result: No XSS vectors found.**

- `app/page.tsx` and `app/tv/page.tsx` render all user-supplied values (`nickname`, `title`, `table`, `videoId`) as JSX text nodes — React escapes these at render time.
- Searched for `dangerouslySetInnerHTML`, `innerHTML` assignment, and `eval(` across `app/` and `lib/` — none found.
- `videoId` is passed to `window.YT.Player` / `loadVideoById()` via the YouTube IFrame API, which constructs the embed URL internally. YouTube's API URL-encodes the parameter; no direct injection into `<iframe src>`.

---

## Secrets Audit

**Result: No secrets found.**

- No API keys, tokens, passwords, or credentials in `app/`, `lib/`, `.github/workflows/ci.yml`, or `next.config.ts`.
- CI workflow passes no secrets to jobs; `NODE_OPTIONS` env var (localstorage file path) is not sensitive.
- `package.json` `"private": true` — not published to npm.

---

## Summary Table

| Finding | Severity | File:Line | Verdict Impact |
|---|---|---|---|
| Unvalidated rawVideoId bypass | MEDIUM | `app/api/queue/route.ts:37–38` | Note, defer to MVP |
| No field length caps | MEDIUM | `app/api/queue/route.ts:48–66` | Note, defer to MVP |
| Unbounded queue depth | MEDIUM | `lib/store.ts:29` | Note, defer to MVP |
| Next.js 15.3.4 CVEs | MEDIUM | `package.json` | Note, fix before prod deploy |
| No CSP headers | INFO | `next.config.ts` | Post-MVP |
| Vercel deployment failing | INFO | CI | Operational, not security |
| Unauthenticated advance | INFO | `app/api/queue/advance/route.ts` | By design |

**No BLOCKER or HIGH findings. Verdict: PASS-WITH-NOTES.**

---

## Friction (Recurring Pattern Note)

The `isValidVideoId` helper is defined in `lib/youtube.ts` but scoped `function` (unexported), making it unavailable to the API route. A pattern to establish: export shared validators so API routes can reuse them without reimplementing. Propose adding a rule to the Dev agent prompt for "validate at the API boundary using shared validators" (W6 improvement).
