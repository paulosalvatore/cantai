/**
 * Per-room advance rate limiter (TICKET-45) — the defense-in-depth backstop rung
 * under the screen token. Same house dual-bucket sliding-window pattern as
 * `queue-rate-limit.ts` (and the TICKET-8 search / TICKET-11 feedback limiters);
 * standalone so the advance path stays dependency-free from other tickets.
 *
 * WHY, even with the screen token: the token is scrapeable off the public TV
 * page (see the honest threat note in screen-token.ts). A scraper who lifts a
 * valid token could still spam advance and grief a room. A per-room throttle
 * caps how fast ANY caller — token-holder or not — can drain a queue, which
 * blunts skip-spam without touching the legitimate TV cadence: the TV advances
 * once per song (minutes apart) and the watchdog skips at most once per stall.
 *
 *   - 12 advances / min / room  (generous: a normal show never approaches it;
 *     even a rapid all-unplayable drain of a full 200-entry queue is naturally
 *     paced by the watchdog's per-video ladder, not a tight loop)
 *
 * Bucketed PER ROOM (not per IP/uuid): the venue TV is one caller per room, and
 * an attacker rotating IPs still hits the same room bucket. Heap-growth guard:
 * LRU-capped map (room ids are attacker-mintable slugs), oldest-touched evict.
 */

const ADVANCE_ROOM_MAX = 12; // advances per room per window
const ADVANCE_WINDOW_MS = 60_000;
const ADVANCE_BUCKETS_MAX = 2000;

const hits = new Map<string, number[]>();

/** Evict oldest-touched buckets past the cap (heap-growth guard). */
function evictOverflow(): void {
  while (hits.size > ADVANCE_BUCKETS_MAX) {
    const oldest = hits.keys().next().value;
    if (oldest === undefined) break;
    hits.delete(oldest);
  }
}

/**
 * Returns true when this advance may proceed (and charges the room bucket),
 * false when the room has exceeded its per-minute window.
 */
export function advanceRateLimitOk(roomId: string, now: number = Date.now()): boolean {
  const key = `room:${roomId}`;
  const windowStart = now - ADVANCE_WINDOW_MS;
  const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);
  // LRU touch: delete + re-set moves the key to the Map's insertion-order tail.
  hits.delete(key);
  if (recent.length >= ADVANCE_ROOM_MAX) {
    hits.set(key, recent); // keep the pruned window
    evictOverflow();
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  evictOverflow();
  return true;
}

export const ADVANCE_RATE_ROOM_MAX = ADVANCE_ROOM_MAX;
export const ADVANCE_RATE_WINDOW_MS = ADVANCE_WINDOW_MS;

/** Test helper — clear rate-limit state. */
export function _resetAdvanceRateLimit(): void {
  hits.clear();
}
