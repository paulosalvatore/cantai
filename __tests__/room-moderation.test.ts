/**
 * Room moderation-flag persistence (TICKET-44). The `moderation` field is
 * ADDITIVE and optional on RoomSettings: a fresh/legacy room reads back as
 * `false` (moderation OFF = current behavior) with no migration and no write; the
 * host mutator persists in place. Mirrors the getRoomLanguage/setRoomLanguage
 * contract tests.
 */
import {
  createRoom,
  getRoomModeration,
  setRoomModeration,
  getPublicRoom,
} from "@/lib/rooms";

async function mustCreateRoom(name: string) {
  const created = await createRoom(name);
  if (!created) throw new Error("room ceiling hit in test");
  return created;
}

describe("room moderation flag", () => {
  it("defaults to false on a fresh room (no moderation field written)", async () => {
    const { room } = await mustCreateRoom("Bar Mod A");
    expect(await getRoomModeration(room.id)).toBe(false);
    // The additive field is NOT written on creation (no migration surface).
    const pub = await getPublicRoom(room.id);
    expect(pub?.settings.moderation).toBeUndefined();
  });

  it("defaults to false for an unknown room id (no record)", async () => {
    expect(await getRoomModeration("does-not-exist")).toBe(false);
  });

  it("persists a host-set moderation flag in place", async () => {
    const { room } = await mustCreateRoom("Bar Mod B");
    const applied = await setRoomModeration(room.id, true);
    expect(applied).toBe(true);
    expect(await getRoomModeration(room.id)).toBe(true);
    // Mode is untouched — the update is additive.
    const pub = await getPublicRoom(room.id);
    expect(pub?.settings.mode).toBeDefined();
    expect(pub?.settings.moderation).toBe(true);
  });

  it("is idempotent and re-settable (on → off → on)", async () => {
    const { room } = await mustCreateRoom("Bar Mod C");
    await setRoomModeration(room.id, true);
    await setRoomModeration(room.id, true);
    expect(await getRoomModeration(room.id)).toBe(true);
    await setRoomModeration(room.id, false);
    expect(await getRoomModeration(room.id)).toBe(false);
  });

  it("returns null when setting moderation on a missing room", async () => {
    expect(await setRoomModeration("nope-not-here", true)).toBeNull();
  });
});
