/**
 * Room model + persistence unit tests (TICKET-9).
 */
import {
  slugify,
  generateHostCode,
  isValidRoomId,
  createRoom,
  getRoom,
  getPublicRoom,
} from "@/lib/rooms";

describe("isValidRoomId", () => {
  it("accepts lowercase alnum + hyphen ids", () => {
    expect(isValidRoomId("bar-do-ze-k7q2")).toBe(true);
    expect(isValidRoomId("default")).toBe(true);
    expect(isValidRoomId("a")).toBe(true);
  });

  it("rejects malformed / injection-y ids", () => {
    expect(isValidRoomId("Bar Do Ze")).toBe(false); // spaces + caps
    expect(isValidRoomId("room:default:queue")).toBe(false); // colon (key injection)
    expect(isValidRoomId("../etc")).toBe(false);
    expect(isValidRoomId("")).toBe(false);
    expect(isValidRoomId("x".repeat(65))).toBe(false); // too long
    expect(isValidRoomId(123)).toBe(false);
    expect(isValidRoomId(null)).toBe(false);
  });
});

describe("slugify", () => {
  it("produces a valid, hyphenated, suffixed slug", () => {
    const slug = slugify("Bar do Zé");
    expect(slug).toMatch(/^bar-do-ze-[0-9a-hjkmnp-tv-z]{4}$/);
    expect(isValidRoomId(slug)).toBe(true);
  });

  it("strips accents and collapses non-alnum runs", () => {
    const slug = slugify("Açaí & Cia!!!");
    expect(slug.startsWith("acai-cia-")).toBe(true);
    expect(isValidRoomId(slug)).toBe(true);
  });

  it("falls back to 'sala' for a degenerate name", () => {
    const slug = slugify("!!! ###");
    expect(slug.startsWith("sala-")).toBe(true);
    expect(isValidRoomId(slug)).toBe(true);
  });

  it("gives distinct slugs for the same name (random suffix)", () => {
    expect(slugify("Bar do Zé")).not.toBe(slugify("Bar do Zé"));
  });
});

describe("generateHostCode", () => {
  it("is an 8-char Crockford base32 code", () => {
    const code = generateHostCode();
    expect(code).toMatch(/^[0-9a-hjkmnp-tv-z]{8}$/);
  });

  it("is (practically) unique per call", () => {
    const codes = new Set(Array.from({ length: 100 }, generateHostCode));
    expect(codes.size).toBe(100);
  });
});

describe("createRoom / getRoom / getPublicRoom", () => {
  it("creates and reads back a room record", async () => {
    const room = await createRoom("Bar do Zé");
    expect(isValidRoomId(room.id)).toBe(true);
    expect(room.name).toBe("Bar do Zé");
    expect(room.hostCode).toMatch(/^[0-9a-hjkmnp-tv-z]{8}$/);
    expect(room.settings.mode).toBe("full");

    const fetched = await getRoom(room.id);
    expect(fetched?.id).toBe(room.id);
    expect(fetched?.hostCode).toBe(room.hostCode);
  });

  it("getPublicRoom never leaks the host code", async () => {
    const room = await createRoom("Bar Público");
    const pub = await getPublicRoom(room.id);
    expect(pub).toBeTruthy();
    expect(pub).not.toHaveProperty("hostCode");
    expect(JSON.stringify(pub)).not.toContain(room.hostCode);
  });

  it("returns null for unknown / invalid ids", async () => {
    expect(await getRoom("no-such-room")).toBeNull();
    expect(await getRoom("bad id!")).toBeNull();
    expect(await getPublicRoom("no-such-room")).toBeNull();
  });
});
