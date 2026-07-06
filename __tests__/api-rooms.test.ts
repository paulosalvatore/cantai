/**
 * API tests for /api/rooms (TICKET-9) — create + fetch, and the guarantee that
 * the host code is returned ONLY at creation, never by GET.
 */
import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/rooms/route";
import { isValidRoomId } from "@/lib/rooms";

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://127.0.0.1:3040/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function getReq(id: string): NextRequest {
  return new NextRequest(
    `http://127.0.0.1:3040/api/rooms?id=${encodeURIComponent(id)}`,
  );
}

describe("POST /api/rooms", () => {
  it("creates a room and returns id, name, hostCode, joinPath", async () => {
    const res = await POST(postReq({ name: "Bar do Zé" }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(isValidRoomId(data.id)).toBe(true);
    expect(data.name).toBe("Bar do Zé");
    expect(typeof data.hostCode).toBe("string");
    expect(data.hostCode.length).toBe(8);
    expect(data.joinPath).toBe(`/${data.id}`);
  });

  it("400s on a missing / empty name", async () => {
    expect((await POST(postReq({}))).status).toBe(400);
    expect((await POST(postReq({ name: "   " }))).status).toBe(400);
  });

  it("400s on an oversized name", async () => {
    const res = await POST(postReq({ name: "x".repeat(61) }));
    expect(res.status).toBe(400);
  });

  it("400s on invalid JSON", async () => {
    const res = await POST(postReq("{not json"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/rooms", () => {
  it("returns the public room WITHOUT the host code", async () => {
    const created = await (await POST(postReq({ name: "Bar Público" }))).json();
    const res = await GET(getReq(created.id));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.room.id).toBe(created.id);
    expect(data.room.name).toBe("Bar Público");
    expect(data.room).not.toHaveProperty("hostCode");
    expect(JSON.stringify(data)).not.toContain(created.hostCode);
  });

  it("400s on a malformed id", async () => {
    const res = await GET(getReq("bad id!"));
    expect(res.status).toBe(400);
  });

  it("404s on an unknown room", async () => {
    const res = await GET(getReq("no-such-room-xyz"));
    expect(res.status).toBe(404);
  });
});
