/**
 * Screen-token authorization for `POST /api/queue/advance` (TICKET-45).
 *
 * WHY: advance/skip was unauthenticated — any patron who reads the room QR knows
 * the slug and can `curl` it to skip the current singer (TICKET-1 security INFO,
 * accepted-for-prototype; the TL asked to close it: "skip should only be from tv
 * … confirm the session code"). This is the design from
 * work/plans/TICKET-41-plan.md §advance-auth (option 2 + 3 combined).
 *
 * MODEL: the `/[room]/tv` server component resolves the room server-side and
 * mints a STATELESS token
 *
 *     HMAC-SHA256(key = <room secret>, msg = "boraoke-screen-v1|<roomId>|<bucket>")
 *
 * where `<room secret>` is the room's server-only `resolveRoomToken` value (its
 * `hostCodeHash`; the legacy `default` room keys off env `HOST_TOKEN`, then the
 * dev fallback) and `<bucket>` is the 24h expiry bucket. The token is handed to
 * TvScreen as a prop; the TV sends it on advance as `X-Boraoke-Screen`. The
 * route recomputes and `timingSafeEqual`s, accepting the CURRENT and PREVIOUS
 * bucket so a TV page open across a day boundary keeps working. Stateless by
 * design — Vercel serverless + memory/Upstash duality means verification must
 * not depend on a shared session store.
 *
 * ── HONEST THREAT-MODEL NOTE (per the plan — do not delete) ───────────────────
 * `/[room]/tv` is a PUBLIC page, so a determined attacker can scrape the screen
 * token from its HTML/props. This token raises the bar from "one curl of a
 * guessed slug" to "fetch + parse THIS room's TV page" — which kills the casual /
 * patron-prank skip class, the class that actually threatens a venue night. It
 * does NOT stop a targeted scraper; the accounts wave (#14) hardens further.
 * A deliberate, documented prototype trade-off.
 *
 * NO-KEY ROOMS: when `resolveRoomToken` is null (a production room with nothing
 * configured), there is no secret to mint/verify against, so enforcement is off
 * for that room — there is no skip to protect against yet (fail-open).
 */

import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { resolveRoomToken, requireHost } from "./host-auth";

/** HTTP header the TV sends the screen token on. */
export const SCREEN_TOKEN_HEADER = "x-boraoke-screen";

/**
 * Token domain-separation prefix. Distinct from the host-session HMAC message
 * ("cantai-host-session-v1") so a screen token can never be replayed as a
 * session value or vice-versa. Kept under the new brand — screen tokens are
 * ephemeral (24h buckets), so there is no live state to migrate (unlike the
 * deliberately-frozen `cantai-*` host/hostcode strings — see host-auth.ts).
 */
const SCREEN_TOKEN_PREFIX = "boraoke-screen-v1";

/** Bucket width — one token is valid for its 24h window plus the previous one. */
export const SCREEN_TOKEN_BUCKET_MS = 24 * 60 * 60 * 1000;

/** The 24h expiry bucket index for a moment in time. */
export function bucketFor(now: number): number {
  return Math.floor(now / SCREEN_TOKEN_BUCKET_MS);
}

/** Compute the raw HMAC token for a (secret, roomId, bucket) triple. */
function computeToken(secret: string, roomId: string, bucket: number): string {
  return createHmac("sha256", secret)
    .update(`${SCREEN_TOKEN_PREFIX}|${roomId}|${bucket}`)
    .digest("hex");
}

/**
 * Mint the screen token for a room, or `null` when the room has no configured
 * secret (no-key room → enforcement off; the server page passes `null` through
 * and the TV simply sends no header). Called from the `/[room]/tv` server
 * component at request time.
 */
export async function mintScreenToken(
  roomId: string,
  now: number = Date.now(),
): Promise<string | null> {
  const secret = await resolveRoomToken(roomId);
  if (!secret) return null; // no-key room — nothing to mint against
  return computeToken(secret, roomId, bucketFor(now));
}

/** Constant-time compare of two hex token strings (length-safe). */
function timingSafeHexEqual(a: string, b: string): boolean {
  // Hash both to a fixed length first so a length mismatch never throws and no
  // length signal leaks; timingSafeEqual then compares in constant time. Same
  // shape as host-auth.ts's comparator (kept local to avoid coupling files).
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Verify a submitted screen token against a room's secret, accepting the current
 * AND previous 24h bucket (rollover tolerance). Returns false when the room has
 * no secret (caller decides what "no secret" means — see {@link isAdvanceAuthorized}),
 * the token is absent/malformed, or it matches neither bucket.
 */
export async function verifyScreenToken(
  roomId: string,
  submitted: unknown,
  now: number = Date.now(),
): Promise<boolean> {
  const secret = await resolveRoomToken(roomId);
  if (!secret) return false;
  if (typeof submitted !== "string" || submitted.length === 0) return false;
  const current = bucketFor(now);
  // Accept current and previous bucket: a TV page rendered just before a bucket
  // boundary must keep advancing for a full window after.
  for (const bucket of [current, current - 1]) {
    if (timingSafeHexEqual(submitted, computeToken(secret, roomId, bucket))) {
      return true;
    }
  }
  return false;
}

/**
 * Advance-auth rollout flag (TICKET-45). `log` (DEFAULT) records a would-block
 * observation but lets the call through; `enforce` returns 401 on a missing /
 * invalid credential. Ship with `log`; the TM flips to `enforce` via env after a
 * quiet observation window. Any unrecognized value is treated as `log` — the
 * safe default (never accidentally hard-block a live venue on a typo).
 */
export type AdvanceAuthMode = "log" | "enforce";

export function advanceAuthMode(): AdvanceAuthMode {
  return process.env.ADVANCE_AUTH?.trim().toLowerCase() === "enforce"
    ? "enforce"
    : "log";
}

/** Outcome of an advance-auth check — drives the route's log-vs-enforce branch. */
export interface AdvanceAuthResult {
  /** True when the caller is authorized OR the room has no key (nothing to enforce). */
  ok: boolean;
  /**
   * Why: `screen-token` (valid header), `host-session` (valid host cookie),
   * `no-key` (room has no secret → enforcement off), or `unauthorized`
   * (no valid credential and the room DOES have a secret).
   */
  reason: "screen-token" | "host-session" | "no-key" | "unauthorized";
}

/**
 * Decide whether an advance call is authorized for a room, INDEPENDENT of the
 * rollout mode (the route applies `log` vs `enforce` on top). Accepts either a
 * valid `X-Boraoke-Screen` token OR a valid host session cookie (admin skip
 * path). A room with no configured secret is `no-key` → `ok: true` (fail-open).
 */
export async function isAdvanceAuthorized(
  req: NextRequest,
  roomId: string,
  now: number = Date.now(),
): Promise<AdvanceAuthResult> {
  // No-key room: nothing to enforce against (production room with nothing set,
  // or dev with the store locked). Fail-open — there is no skip to protect yet.
  if ((await resolveRoomToken(roomId)) === null) {
    return { ok: true, reason: "no-key" };
  }
  const header = req.headers.get(SCREEN_TOKEN_HEADER);
  if (await verifyScreenToken(roomId, header, now)) {
    return { ok: true, reason: "screen-token" };
  }
  // Host session ALSO authorizes advance — a logged-in host controlling the
  // room from /admin holds the same secret material as the TV screen.
  if (await requireHost(req, roomId)) {
    return { ok: true, reason: "host-session" };
  }
  return { ok: false, reason: "unauthorized" };
}
