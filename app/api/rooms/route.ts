import { NextRequest, NextResponse } from "next/server";
import { createRoom, getPublicRoom, isValidRoomId } from "@/lib/rooms";

const MAX_BODY_BYTES = 1024;
const MAX_NAME = 60;

/**
 * GET /api/rooms?id=<roomId> — fetch a client-safe room view (id, name,
 * createdAt, settings). NEVER returns the host code. 400 on a malformed id,
 * 404 when the room does not exist.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!isValidRoomId(id)) {
    return NextResponse.json({ error: "Invalid room id" }, { status: 400 });
  }
  const room = await getPublicRoom(id);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  return NextResponse.json({ room });
}

/**
 * POST /api/rooms — create a room from a venue name.
 * Body: { name: string }. Returns { id, name, hostCode, joinPath }. The
 * hostCode is returned EXACTLY ONCE here (the creation moment) and never again
 * by any endpoint — possession of it is venue identity until accounts (#14).
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body too large" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).name
      : undefined;

  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Venue name is required" }, { status: 400 });
  }
  if (name.trim().length > MAX_NAME) {
    return NextResponse.json(
      { error: `Venue name must be at most ${MAX_NAME} characters` },
      { status: 400 },
    );
  }

  const room = await createRoom(name);
  return NextResponse.json(
    {
      id: room.id,
      name: room.name,
      hostCode: room.hostCode,
      joinPath: `/${room.id}`,
    },
    { status: 201 },
  );
}
