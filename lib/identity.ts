/**
 * Identity request policy (TICKET-26) — Next.js-specific glue on top of the
 * framework-agnostic `lib/identity-store.ts`. Kept as its own file (mirrors
 * `lib/host-auth.ts` sitting beside the plain `lib/rooms.ts` persistence) so
 * the store stays easy to unit-test with no `NextRequest`/`NextResponse` in
 * the loop, while this module owns cookie shape + the mint/reuse/adopt policy.
 *
 * Cookie is the AUTHORITATIVE copy (httpOnly — never readable from client JS,
 * unlike the existing localStorage-only `cantai_patron_uuid`). localStorage on
 * the client remains a fallback copy so a cookie-cleared-but-storage-intact
 * device still recovers its identity via the `legacyUuid` adoption path below.
 */

import "server-only";

import type { NextResponse } from "next/server";
import { validate as uuidValidate, v4 as uuidv4 } from "uuid";
import {
  identityStore,
  type IdentityStore,
  type UserAgentClass,
} from "./identity-store";

/**
 * STORAGE-KEY NOTE: unlike `lib/host-auth.ts`'s `cantai_host*` (frozen — live
 * auth state), this cookie is BRAND NEW as of this ticket, so it uses the
 * current `boraoke` brand (mirrors `SCREEN_TOKEN_PREFIX` in
 * `lib/screen-token.ts`) — no legacy-name constraint applies here.
 */
export const IDENTITY_COOKIE = "boraoke_identity";

/**
 * Cookie lifetime. This is a durable IDENTITY, not a login session (contrast
 * `lib/host-auth.ts`'s 12h host session) — long-lived so a returning patron
 * keeps their identity across visits, capped so it isn't literally forever.
 */
const IDENTITY_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2; // 2 years

/** Cookie options for the identity cookie (httpOnly, prod-secure, root-scoped). */
export function identityCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: IDENTITY_MAX_AGE_SECONDS,
  };
}

export function isValidUuid(v: unknown): v is string {
  return typeof v === "string" && uuidValidate(v);
}

/**
 * Coarse User-Agent classification (zero-PII invariant — see
 * `lib/identity-store.ts` file header). Deliberately a small fixed enum, never
 * the raw header value: no version numbers, no device model, no fingerprint
 * surface. Order matters — bot check first (bots often also match
 * mobile/desktop substrings).
 */
export function classifyUserAgent(ua: string | null | undefined): UserAgentClass {
  if (!ua) return "unknown";
  const s = ua.toLowerCase();
  if (/bot|crawler|spider|curl|wget|headless|python-requests/.test(s)) return "bot";
  if (/mobi|android|iphone|ipad/.test(s)) return "mobile";
  if (/mozilla|chrome|safari|firefox|edg\//.test(s)) return "desktop";
  return "unknown";
}

export interface ResolvedIdentity {
  uuid: string;
  /**
   * false = the durable store failed (fail-open, acceptance #4). The caller
   * MUST NOT set the identity cookie in this case — the client keeps using
   * its local-only uuid and the next page load naturally retries
   * registration (no explicit retry loop needed).
   */
  ok: boolean;
}

/** The minimal request shape this module needs — real callers pass a NextRequest. */
export interface IdentityRequestLike {
  cookies: { get(name: string): { value: string } | undefined };
  headers: { get(name: string): string | null };
}

/**
 * Build an identity resolver bound to an explicit store (tests inject a
 * throwing fake to prove fail-open — mirrors `lib/telemetry.ts`'s
 * `createTracker(store)` factory). Production uses the `resolveIdentity`
 * singleton below, bound to the real `identityStore`.
 *
 * Precedence (see work/planning/accounts-and-identity.md "Layer 1"):
 *   1. existing identity cookie whose uuid resolves in the store → touch it
 *      (repeat-load reuse, acceptance #1).
 *   2. else a valid caller-supplied legacy uuid (the client's existing
 *      localStorage `patronUuid`) → touch it, creating a record under that
 *      EXACT uuid if none exists yet (continuity/adoption, acceptance #2 —
 *      no duplicate identity is ever created for a device that already had
 *      one).
 *   3. else mint a brand-new uuid v4 → touch it (fresh-device first touch,
 *      acceptance #1).
 */
export function createIdentityResolver(store: IdentityStore) {
  return async function resolveIdentity(
    req: IdentityRequestLike,
    legacyUuid?: unknown,
  ): Promise<ResolvedIdentity> {
    const cookieUuid = req.cookies.get(IDENTITY_COOKIE)?.value;
    const candidate = isValidUuid(cookieUuid)
      ? cookieUuid
      : isValidUuid(legacyUuid)
        ? legacyUuid
        : uuidv4();
    const userAgentClass = classifyUserAgent(req.headers.get("user-agent"));
    try {
      await store.touch(candidate, userAgentClass);
      return { uuid: candidate, ok: true };
    } catch {
      // Fail-open (acceptance #4): never throw, never block the caller's flow.
      // The candidate uuid is still returned so the client has something
      // consistent to keep using locally even though nothing was persisted.
      return { uuid: candidate, ok: false };
    }
  };
}

/** Production resolver, bound to the real durable `identityStore`. */
export const resolveIdentity = createIdentityResolver(identityStore);

/** Apply the identity cookie to a response. Only call when `ok` is true. */
export function applyIdentityCookie(res: NextResponse, uuid: string): void {
  res.cookies.set(IDENTITY_COOKIE, uuid, identityCookieOptions());
}
