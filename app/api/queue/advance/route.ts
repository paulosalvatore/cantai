import { NextRequest, NextResponse } from "next/server";
import { store, DEFAULT_ROOM } from "@/lib/store";
import { isValidRoomId } from "@/lib/rooms";
import { track } from "@/lib/telemetry";

/**
 * Allowlisted skip reasons the TV client may attach to an advance (TICKET-41).
 * Anything else is ignored — never let a caller inject junk telemetry props.
 */
const ADVANCE_SKIP_REASONS = new Set(["unplayable"]);

/**
 * POST /api/queue/advance?room=<id>[&reason=unplayable] — advance the room's
 * queue head (called by /tv on video end, or by the TICKET-41 watchdog when a
 * video can't play: onError 2/5/100/101/150 or a stalled-out player). Absent
 * `room` = the legacy `default` room. Validates the id before it reaches a
 * Redis key. A valid `reason` additionally emits the existing `song_skipped`
 * event with that reason prop (props variant only — no new event types).
 */
export async function POST(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("room");
  const roomId = raw == null || raw === "" ? DEFAULT_ROOM : raw;
  if (!isValidRoomId(roomId)) {
    return NextResponse.json({ error: "Invalid room id" }, { status: 400 });
  }
  const rawReason = req.nextUrl.searchParams.get("reason");
  const skipReason =
    rawReason && ADVANCE_SKIP_REASONS.has(rawReason) ? rawReason : null;
  // Head being skipped — read BEFORE advance, telemetry-only (fail-open).
  const skipped = skipReason ? await store.nowPlaying(roomId) : null;
  const next = await store.advance(roomId);
  if (skipReason && skipped) {
    // TICKET-41: watchdog skip observability — existing event, new reason value.
    void track("song_skipped", {
      roomId,
      uuid: skipped.patronUuid,
      props: { reason: skipReason },
    });
  }
  if (next) void track("song_played", { roomId, uuid: next.patronUuid, props: { mode: next.mode } }); // TICKET-12 (C1): the ONE song_played source; fire-and-forget, fail-open
  return NextResponse.json({
    nowPlaying: next,
    message: next ? "Advanced to next entry" : "Queue is now empty",
  });
}
