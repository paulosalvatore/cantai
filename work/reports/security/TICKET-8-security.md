# Security Audit — TICKET-8: In-App YouTube Search

**Agent:** cyber-security
**Date:** 2026-07-05
**PR:** #8 — paulosalvatore/cantai, branch `ticket/8-youtube-search`
**Verdict:** PASS-WITH-NOTES

---

## Scope Audited

| Surface | File |
|---|---|
| YouTube API helper | `lib/youtube-search.ts` |
| Search API route | `app/api/search/route.ts` |
| Client search component | `components/SongSearch.tsx` |
| Env placeholder | `.env.example` |
| Unit test coverage | `__tests__/api-search.test.ts`, `__tests__/youtube-search.test.ts` |
| Client bundle (production build) | `.next/static/**` |

Blast-radius files checked: `lib/youtube.ts` (parseYouTubeVideoId), `next.config.ts`, `package.json`/`package-lock.json`.

TICKET-1 protections: queue routes (`app/api/queue/`) untouched by this PR — confirmed via diff. All 71 unit tests pass.

CI state: Vercel ✓ pass (both checks), confirmed via `gh pr checks 8`.

---

## Key-Containment Verification (S1 — fresh production build)

Ran `npm run build` in the worktree, then:

```
grep -rE "YOUTUBE_API_KEY|googleapis" .next/static/   → No matches
grep -rE "searchYouTube|rateLimitOk"   .next/static/   → No matches
```

The API key and all server-side helper code are absent from every client bundle.
`YOUTUBE_API_KEY` has no `NEXT_PUBLIC_` prefix, is never referenced in a client component,
and the route reads it only server-side. `.env.example` carries only the empty placeholder
(`YOUTUBE_API_KEY=`). Handle-secret baseline: no `cat`/`echo`/`console.log` touching the
key anywhere in the diff.

---

## Findings

### MEDIUM — Rate limiter bypassable by rotating `uuid` (no IP fallback)

**File:** `lib/youtube-search.ts:257`, `app/api/search/route.ts:32`

The rate limiter is keyed on a client-supplied `uuid` query parameter (`params.get("uuid") ?? "" || "anon"`). There is no server-side IP-based fallback. A caller that cycles a fresh UUID per request (trivially achievable — change one character in the stored localStorage value, or script requests from a headless client) never hits the 5-req/10s cap, allowing unbounded YouTube Data API v3 quota consumption. The comment on the limiter (`best-effort per instance`) acknowledges this is a prototype-tier control; severity here is rated honestly at MEDIUM (quota exhaustion, not a data breach). A stricter limit would pair `uuid` with the IP reported by the `x-forwarded-for` header from Vercel's edge.

**Remediation direction:** Add a secondary IP-based bucket keyed on `request.headers.get("x-forwarded-for")` as an AND-gate (both the uuid bucket and the IP bucket must pass). No code change needed from Dev now; file as a follow-up hardening ticket before production launch.

---

### MEDIUM — `hits` Map grows unboundedly; old entries never pruned

**File:** `lib/youtube-search.ts:251`

```ts
const hits = new Map<string, number[]>();
```

`rateLimitOk` prunes the timestamp array *for a given key* on re-access, but map entries for UUIDs that are never seen again are never removed. A caller that sends one request per unique UUID (UUID rotation, see above) fills the map indefinitely. On a Vercel cold-start the map resets, but on a warm serverless instance under sustained unique-UUID traffic, heap grows without bound. An attacker can intentionally trigger this with a script that generates a new UUID every request. This is a slow memory DoS, not immediately severe in a serverless ephemeral context, but genuinely unbounded if an instance stays warm.

**Remediation direction:** Add a GC pass in `rateLimitOk` (e.g. when `hits.size > SOME_CEILING`, iterate and delete entries whose entire timestamp array is older than the window). The query-result LRU cache (`queryCache`) already implements a size ceiling via `CACHE_MAX`; apply the same pattern to `hits`.

---

### LOW — No length cap on the `uuid` query parameter

**File:** `app/api/search/route.ts:32`

```ts
const uuid = (params.get("uuid") ?? "").trim() || "anon";
```

No maximum length check. A caller could supply a multi-kilobyte `uuid` string, creating a large map key. Combined with the unbounded-growth issue above, each such entry wastes proportionally more heap. In isolation (no unbounded growth) this would be INFO; combined, it modestly amplifies the DoS.

**Remediation direction:** Truncate or reject `uuid` values longer than, say, 64 chars before passing to `rateLimitOk`.

---

### INFO — Degraded-mode response distinguishes `no-api-key` vs `quota`

**File:** `app/api/search/route.ts:58`, `app/api/search/route.ts:74`

The `reason` field in the degraded response (`"no-api-key"` vs `"quota"` vs `"error"`) lets an external observer learn whether a YouTube API key is provisioned and whether quota is exhausted. No key value is disclosed; the boolean fact of whether a key exists is effectively public-facing (the UI also shows the degraded notice). Exploit path is negligible (the UI already signals degraded state visually). Noted for completeness.

---

### INFO — Pre-existing moderate npm vulnerability (postcss, not introduced by this PR)

`npm audit` reports a moderate-severity PostCSS XSS via `</style>` tag in stringify output. This is in `next`'s transitive dependency tree and predates this PR — `package.json`/`package-lock.json` are unchanged between main and this branch (confirmed via diff). Fix requires a breaking downgrade to Next.js 9.3.3; not actionable here. Note for the framework maintenance queue.

---

## URL Construction / Injection Assessment

`searchUrl.searchParams.set("q", q)` and `videosUrl.searchParams.set("id", ids.join(","))` use the WHATWG URL API which percent-encodes values before inserting them into the query string. No injection into the upstream googleapis URL structure is possible. The `ids` array is derived from the `videoId` field of the API response (a string fed into a downstream `videos.list` call); since no user input flows directly into `ids`, SSRF via param manipulation is not feasible.

Response fields forwarded to the client (`videoId`, `title`, `channelTitle`, `duration`, `thumbnailUrl`) are all rendered as React JSX text nodes or `img` `src` attributes. No `dangerouslySetInnerHTML`. `decodeHtmlEntities` decodes only the five safe HTML entities from Google snippet text; React then re-escapes these as text content — no XSS path.

The `thumbnailUrl` is passed from the Google API response (`i.ytimg.com` CDN) through the server to the client and rendered as `<img src={r.thumbnailUrl}>`. No validation that the URL is an `i.ytimg.com` origin; in practice the trusted Google API is the source. Low-risk (IMG src doesn't execute JavaScript in any current browser), noted only for completeness.

---

## Checklist

| Check | Result |
|---|---|
| `YOUTUBE_API_KEY` absent from `.next/static/` (production build) | PASS |
| `YOUTUBE_API_KEY` not logged / echoed anywhere in diff | PASS |
| `.env.example` placeholder only (no real value) | PASS |
| No `NEXT_PUBLIC_YOUTUBE_API_KEY` prefix | PASS |
| URL construction uses WHATWG searchParams (safe encoding) | PASS |
| Error responses never include key or upstream error detail | PASS |
| Rate limiter present (note: bypassable — MEDIUM above) | PARTIAL |
| Degraded mode not exploitable beyond boolean env probe | PASS |
| No new npm dependencies introduced | PASS |
| TICKET-1 queue protections untouched | PASS |
| Unit suite 71/71 | PASS |
| CI green (Vercel) | PASS |

---

## Verdict

**PASS-WITH-NOTES**

No BLOCKERs, no HIGHs. Two MEDIUMs (rate-limiter bypass + unbounded map growth) are prototype-acknowledged; both should be addressed before the feature goes into production at scale. One LOW (uuid length) and two INFOs.
