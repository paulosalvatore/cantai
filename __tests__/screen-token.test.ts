/**
 * TICKET-45 — screen-token advance authorization: unit tests for token
 * mint/verify (incl. 24h bucket rollover + wrong-room rejection), the
 * log-vs-enforce mode flag, and the advance-authorization decision (screen
 * token / host session / no-key fail-open / unauthorized).
 */
import { NextRequest } from "next/server";
import {
  mintScreenToken,
  verifyScreenToken,
  isAdvanceAuthorized,
  advanceAuthMode,
  bucketFor,
  SCREEN_TOKEN_BUCKET_MS,
  SCREEN_TOKEN_HEADER,
} from "@/lib/screen-token";
import { createRoom, DEFAULT_ROOM } from "@/lib/rooms";
import { issueSession, hostCookieName } from "@/lib/host-auth";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/** Create a room in tests, asserting the ROOM_MAX ceiling didn't reject it. */
async function mustCreateRoom(name: string) {
  const created = await createRoom(name);
  if (!created) throw new Error("room ceiling hit in test");
  return created;
}

/** A NextRequest carrying an optional screen-token header + host cookie. */
function makeReq(opts: { token?: string; cookie?: { name: string; value: string } } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.token) headers[SCREEN_TOKEN_HEADER] = opts.token;
  if (opts.cookie) headers["cookie"] = `${opts.cookie.name}=${opts.cookie.value}`;
  return new NextRequest("http://127.0.0.1:3045/api/queue/advance", {
    method: "POST",
    headers,
  });
}

describe("mint + verify (default room, dev fallback secret)", () => {
  beforeEach(() => {
    delete process.env.HOST_TOKEN;
    process.env.NODE_ENV = "test"; // dev fallback token is the default-room secret
  });

  it("a freshly minted token verifies for the same room", async () => {
    const token = await mintScreenToken(DEFAULT_ROOM);
    expect(token).toBeTruthy();
    expect(await verifyScreenToken(DEFAULT_ROOM, token)).toBe(true);
  });

  it("rejects a garbage / empty / non-string token", async () => {
    expect(await verifyScreenToken(DEFAULT_ROOM, "not-a-real-token")).toBe(false);
    expect(await verifyScreenToken(DEFAULT_ROOM, "")).toBe(false);
    expect(await verifyScreenToken(DEFAULT_ROOM, undefined)).toBe(false);
    expect(await verifyScreenToken(DEFAULT_ROOM, 12345)).toBe(false);
  });
});

describe("24h bucket rollover", () => {
  beforeEach(() => {
    delete process.env.HOST_TOKEN;
    process.env.NODE_ENV = "test";
  });

  const T0 = 100 * SCREEN_TOKEN_BUCKET_MS + 5_000; // mid-bucket-100

  it("bucketFor floors to the 24h window index", () => {
    expect(bucketFor(T0)).toBe(100);
    expect(bucketFor(T0 + SCREEN_TOKEN_BUCKET_MS)).toBe(101);
  });

  it("a token minted this bucket still verifies in the NEXT bucket (prev-bucket tolerance)", async () => {
    const token = await mintScreenToken(DEFAULT_ROOM, T0);
    // one full window later → current bucket = 101, token was minted for 100:
    // accepted because verify checks current AND previous bucket.
    const next = T0 + SCREEN_TOKEN_BUCKET_MS;
    expect(await verifyScreenToken(DEFAULT_ROOM, token, next)).toBe(true);
  });

  it("a token expires two buckets later (beyond current + previous)", async () => {
    const token = await mintScreenToken(DEFAULT_ROOM, T0);
    const twoLater = T0 + 2 * SCREEN_TOKEN_BUCKET_MS;
    expect(await verifyScreenToken(DEFAULT_ROOM, token, twoLater)).toBe(false);
  });
});

describe("wrong-room rejection", () => {
  it("a token minted for room A does NOT verify for room B", async () => {
    delete process.env.HOST_TOKEN;
    process.env.NODE_ENV = "test";
    const a = await mustCreateRoom("Alpha Bar");
    const b = await mustCreateRoom("Bravo Bar");
    const tokenA = await mintScreenToken(a.room.id);
    expect(tokenA).toBeTruthy();
    expect(await verifyScreenToken(a.room.id, tokenA)).toBe(true);
    // Same token, different room → different secret AND different message → reject.
    expect(await verifyScreenToken(b.room.id, tokenA)).toBe(false);
  });
});

describe("no-key rooms", () => {
  it("mint returns null and enforcement is off in production with nothing configured", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.HOST_TOKEN; // default room is now LOCKED (no secret)
    expect(await mintScreenToken(DEFAULT_ROOM)).toBeNull();
    // isAdvanceAuthorized fails open (no-key) so a live venue is never bricked.
    const res = await isAdvanceAuthorized(makeReq(), DEFAULT_ROOM);
    expect(res.ok).toBe(true);
    expect(res.reason).toBe("no-key");
  });
});

describe("advanceAuthMode (log-vs-enforce flag)", () => {
  it("defaults to log", () => {
    delete process.env.ADVANCE_AUTH;
    expect(advanceAuthMode()).toBe("log");
  });
  it("is enforce only for the explicit value (case-insensitive)", () => {
    process.env.ADVANCE_AUTH = "enforce";
    expect(advanceAuthMode()).toBe("enforce");
    process.env.ADVANCE_AUTH = "ENFORCE";
    expect(advanceAuthMode()).toBe("enforce");
  });
  it("treats any unrecognized value as log (safe default)", () => {
    process.env.ADVANCE_AUTH = "banana";
    expect(advanceAuthMode()).toBe("log");
    process.env.ADVANCE_AUTH = "";
    expect(advanceAuthMode()).toBe("log");
  });
});

describe("isAdvanceAuthorized decision", () => {
  beforeEach(() => {
    delete process.env.HOST_TOKEN;
    process.env.NODE_ENV = "test";
  });

  it("authorizes with a valid screen token", async () => {
    const token = await mintScreenToken(DEFAULT_ROOM);
    const res = await isAdvanceAuthorized(makeReq({ token: token! }), DEFAULT_ROOM);
    expect(res.ok).toBe(true);
    expect(res.reason).toBe("screen-token");
  });

  it("authorizes with a valid host session cookie (admin skip path)", async () => {
    const session = await issueSession(DEFAULT_ROOM);
    const res = await isAdvanceAuthorized(
      makeReq({ cookie: { name: hostCookieName(DEFAULT_ROOM), value: session! } }),
      DEFAULT_ROOM,
    );
    expect(res.ok).toBe(true);
    expect(res.reason).toBe("host-session");
  });

  it("rejects a bare request when the room HAS a secret", async () => {
    const res = await isAdvanceAuthorized(makeReq(), DEFAULT_ROOM);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("unauthorized");
  });
});
