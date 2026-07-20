# Security report — TICKET-26 (anonymous identity registry)

- **PR:** #37 (draft) — branch `ticket/26-anon-identity-registry`
- **Gate:** Cyber Security (runs after App Tester PASS, sequential D-007)
- **Verdict:** **PASS-WITH-NOTES** — no BLOCKER, no HIGH. MEDIUM/LOW notes below are for the Reviewer and, chiefly, for TICKET-28.

## Scope audited

The full diff `origin/main..HEAD` — the two new server modules (`lib/identity-store.ts`, `lib/identity.ts`), the new route `app/api/identity/route.ts`, and the edits to `app/api/rooms/route.ts`, `lib/rooms.ts`, plus the two client callers (`PatronRoom.tsx`, `app/new/page.tsx`). Blast radius followed into `lib/host-auth.ts` (`clientIpFrom`, cookie precedent) and the spec `work/planning/accounts-and-identity.md` (Layer 1/2, claim model, LGPD section). No new dependencies added (uses existing `uuid` + `@upstash/redis`).

## Security-critical invariants

### 1. Zero-PII invariant — CONFIRMED (real in code, not just a comment)

`IdentityRecord` (`lib/identity-store.ts:45-55`) is exactly `{ uuid, createdAt, lastSeenAt, userAgentClass, accountId:null }`. No name/email/phone, **no IP address**, no device fingerprint. Both `touch()` implementations (memory `:105`, upstash `:167`) construct records from only those fields — verified there is no code path that writes anything else. `userAgentClass` is a coarse fixed enum (`mobile|desktop|bot|unknown`, `lib/identity.ts:61-68`), derived from the raw UA and immediately discarded — the raw `User-Agent` string is never stored. The request IP (`clientIpFrom`, `app/api/rooms/route.ts:65`) is consumed **only** by the pre-existing per-IP room-creation throttle and is never passed into the identity store. No `console.*`/logger calls in any touched file, so no PII leaks to logs. LGPD data-minimization for the free/anonymous flow holds.

### 2. Cookie security — CONFIRMED

`identityCookieOptions()` (`lib/identity.ts:40-48`): `httpOnly:true` (not JS-readable — a genuine hardening over the existing localStorage-only `cantai_patron_uuid`), `secure` gated on `NODE_ENV==='production'`, `sameSite:'lax'`, `path:'/'`, `maxAge` 2y. `lax` is the correct choice for a top-level-navigation identity cookie; the endpoints perform no cookie-authenticated sensitive state change that a CSRF would exploit (worst-case CSRF just touches an identity record). Cookie is only ever set on the success path (see invariant 5).

### 3. UUID handling + key-injection — CONFIRMED safe

`isValidUuid` (`lib/identity.ts:50-52`) delegates to the `uuid` library's strict `validate`, which enforces canonical hex-with-hyphens. In `resolveIdentity` (`:109-114`) the candidate is *always* one of: a `validate`-passing cookie value, a `validate`-passing `legacyUuid`, or a freshly minted `uuidv4()`. A validated UUID cannot contain Redis key separators (`:`) or glob chars (`*`), so `identity:${uuid}` / `identity:${uuid}:rooms` cannot be smuggled into a foreign keyspace, and there is no attacker-controlled unbounded keyspace expansion (the only writes are one record + one set-add per request, both behind the IP throttle on the room path). Room id interpolation is separately guarded by the pre-existing `ROOM_ID_RE` (`lib/rooms.ts:112`).

### 4. legacyUuid adoption — threat model (no BLOCKER at this layer; load-bearing note for TICKET-28)

At this layer identities are anonymous and carry no PII and no ownership value, so the adoption path is **not exploitable today**. Precedence is cookie → legacyUuid → mint (`:109-114`), so a returning device's httpOnly cookie always wins; `legacyUuid`/`patronUuid` is honored only when no valid cookie is present. The spec's binding claim-path AC — *server must treat client-posted room lists/flags as untrusted, never ownership evidence* — is **upheld**: the server never accepts a client-posted "rooms I own" list; `identity:{uuid}:rooms` is written server-side only, at room-creation time (`app/api/rooms/route.ts:132`). See MEDIUM-1 / LOW-1 for what TICKET-28 must not do with this.

### 5. Fail-open safety — CONFIRMED

On `store.touch` throwing, `resolveIdentity` returns `{ uuid, ok:false }` and **persists nothing** (`lib/identity.ts:116-124`). Both routes gate `applyIdentityCookie` strictly behind `ok`/`resolved.ok` (`app/api/identity/route.ts:39`, `app/api/rooms/route.ts:148`), so a failure never sets a cookie and, because nothing is persisted on the throw path, never silently stores PII. `addRoom` is best-effort with a swallowed rejection (`:132`) and never fails room creation.

## Findings

### MEDIUM-1 (for TICKET-28, not a blocker now) — a bare UUID is a bearer identifier

Presenting any valid UUID as `legacyUuid`/`patronUuid` (or restoring it via a cleared-cookie device) makes the server adopt that UUID and set it as the httpOnly identity cookie. The `patronUuid` is *not* a hardened secret — per the Dev report it also rides on `POST /api/queue` bodies and appears in `GET /api/queue/pending?...&uuid=` query strings (loggable) and in localStorage. Today that grants nothing. **Once TICKET-28 attaches account/room ownership value to `identity:{uuid}`, mere possession of a leaked UUID becomes account/room impersonation.** TICKET-28 MUST NOT treat "caller presented uuid X" as claim authorization on its own — bind the claim to the OAuth-verified account + the *currently-set httpOnly cookie* on an as-yet-unclaimed identity, and honor the spec's collision rule (a uuid already linked to another account never silently re-links, `accounts-and-identity.md:45`). Recommend recording this explicitly on the TICKET-28 board as a security AC.

### LOW-1 (for TICKET-28) — index pollution via unauthenticated `patronUuid` at creation

An attacker who learns a victim's UUID `V` can `POST /api/rooms` with `patronUuid:V` and no cookie; the created room gets `creatorUuid:V` and is added to `identity:{V}:rooms`. This only *donates* an attacker-made room into the victim's future ownership set (nuisance, not asset theft) and requires knowing the semi-secret `V`. Mitigation for TICKET-28: when surfacing "your rooms", prefer the cookie-authoritative identity and treat auto-claimed `creatorUuid` rooms as advisory, since the creation-time `creatorUuid` derives from an unauthenticated client value whenever no cookie was present.

### LOW-2 — full request body buffered before the size check

`app/api/identity/route.ts:25` and `app/api/rooms/route.ts:77` both `await req.text()` (reads the entire body into memory) *before* the `MAX_BODY_BYTES` length check, so the cap does not actually bound what is buffered. Bounded in practice by the platform (Vercel serverless request-body cap ~4.5MB), and `/api/rooms` sits behind the per-IP throttle, so impact is low. Optional hardening: reject on `Content-Length` before reading, or stream with a hard cap. Pre-existing pattern (not introduced by this ticket for `/api/rooms`); flagged for consistency.

## CI / gate status

boraoke has **no `scripts/verify-green-local.sh`** (D-051's Docker verdict script does not exist in this product repo; the Dev report notes the same and falls back to the repo's own `.github/workflows/ci.yml` conventions). As my own evidence I ran the Jest suite in the worktree: **39 suites / 571 tests passed** (includes `identity-store.test.ts`, `identity.test.ts`, extended `rooms.test.ts`). Dev-reported `npm run build` GREEN and Playwright e2e (`identity.spec.ts` 3 passed + regression pass) are consistent. Treating the repo's own green CI as authoritative here; the S1 `blocked-on-CI` verdict is scoped to the framework's Docker script, which is absent by design in this product.

## Verdict

**PASS-WITH-NOTES.** No BLOCKER or HIGH. The zero-PII invariant, cookie hardening, UUID validation/key-injection safety, and fail-open behavior are all confirmed in code. MEDIUM-1 and LOW-1 are forward-looking requirements the Reviewer should carry onto the TICKET-28 board (they are not defects in this PR); LOW-2 is optional hardening. Not merging (Reviewer approves; TM merges).
