/**
 * Identity store conformance tests (TICKET-26). Mirrors the house pattern from
 * __tests__/telemetry-store.test.ts / __tests__/feedback-store.test.ts: the
 * SAME contract suite runs against both MemoryIdentityStore and
 * UpstashIdentityStore over an in-memory FakeRedis (zero network/credentials).
 */
import {
  MemoryIdentityStore,
  UpstashIdentityStore,
  type IdentityRedisLike,
  type IdentityRecord,
  type IdentityStore,
} from "@/lib/identity-store";

/** Minimal in-memory fake of the Redis subset the identity store uses. */
class FakeRedis implements IdentityRedisLike {
  private kv = new Map<string, unknown>();
  private sets = new Map<string, Set<string>>();

  async get<T = unknown>(key: string): Promise<T | null> {
    return (this.kv.get(key) as T) ?? null;
  }

  async set(key: string, value: unknown): Promise<unknown> {
    this.kv.set(key, value);
    return "OK";
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) {
        set.add(m);
        added += 1;
      }
    }
    this.sets.set(key, set);
    return added;
  }

  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? new Set<string>())];
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.kv.delete(k)) n += 1;
      if (this.sets.delete(k)) n += 1;
    }
    return n;
  }
}

const drivers: Array<[string, () => IdentityStore]> = [
  ["MemoryIdentityStore", () => new MemoryIdentityStore()],
  ["UpstashIdentityStore", () => new UpstashIdentityStore(new FakeRedis())],
];

const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe.each(drivers)("IdentityStore contract — %s", (_name, make) => {
  let store: IdentityStore;

  beforeEach(() => {
    store = make();
  });

  it("first touch mints exactly one durable record", async () => {
    expect(await store.get(UUID)).toBeNull();
    const record = await store.touch(UUID, "mobile", new Date("2026-07-01T10:00:00.000Z"));
    expect(record.uuid).toBe(UUID);
    expect(record.createdAt).toBe("2026-07-01T10:00:00.000Z");
    expect(record.lastSeenAt).toBe("2026-07-01T10:00:00.000Z");
    expect(record.userAgentClass).toBe("mobile");
    const fetched = await store.get(UUID);
    expect(fetched).toEqual(record);
  });

  it("repeat touch reuses the record: createdAt frozen, lastSeenAt updated", async () => {
    await store.touch(UUID, "mobile", new Date("2026-07-01T10:00:00.000Z"));
    const second = await store.touch(UUID, "desktop", new Date("2026-07-02T09:30:00.000Z"));
    expect(second.createdAt).toBe("2026-07-01T10:00:00.000Z"); // unchanged
    expect(second.lastSeenAt).toBe("2026-07-02T09:30:00.000Z"); // refreshed
    expect(second.userAgentClass).toBe("desktop");
    // Still exactly one record for this uuid, not a duplicate.
    expect(await store.get(UUID)).toEqual(second);
  });

  it("addRoom populates identity:{uuid}:rooms, idempotently", async () => {
    await store.touch(UUID, "mobile");
    await store.addRoom(UUID, "room-a");
    await store.addRoom(UUID, "room-b");
    await store.addRoom(UUID, "room-a"); // duplicate add — no dup entry
    const rooms = await store.listRooms(UUID);
    expect([...rooms].sort()).toEqual(["room-a", "room-b"]);
  });

  it("listRooms is empty for an identity that created nothing", async () => {
    await store.touch(UUID, "mobile");
    expect(await store.listRooms(UUID)).toEqual([]);
  });

  it("clear() wipes everything", async () => {
    await store.touch(UUID, "mobile");
    await store.addRoom(UUID, "room-a");
    await store.clear();
    if (store instanceof MemoryIdentityStore) {
      // Upstash clear() is a documented test/reset no-op (no bounded keyspace
      // scan) — only assert the hard-wipe contract for the memory driver.
      expect(await store.get(UUID)).toBeNull();
      expect(await store.listRooms(UUID)).toEqual([]);
    }
  });

  it("zero-PII invariant: a record has ONLY the documented fields", async () => {
    const record = await store.touch(UUID, "bot");
    const keys = Object.keys(record).sort();
    expect(keys).toEqual(["accountId", "createdAt", "lastSeenAt", "userAgentClass", "uuid"].sort());
    // No name/email/phone/ip/fingerprint field of any kind.
    const disallowed = ["name", "email", "phone", "ip", "ipAddress", "fingerprint", "userAgent"];
    for (const bad of disallowed) {
      expect(keys).not.toContain(bad);
    }
  });
});

describe("identity key schema", () => {
  it("uses its own namespace (never collides with room:*/feedback:*/telemetry:*)", async () => {
    const { identityKeys } = await import("@/lib/identity-store");
    expect(identityKeys.item(UUID)).toBe(`identity:${UUID}`);
    expect(identityKeys.rooms(UUID)).toBe(`identity:${UUID}:rooms`);
  });
});

describe("MemoryIdentityStore isolation", () => {
  it("two different uuids never collide", async () => {
    const store = new MemoryIdentityStore();
    const other = "223e4567-e89b-42d3-a456-426614174001";
    await store.touch(UUID, "mobile");
    await store.touch(other, "desktop");
    await store.addRoom(UUID, "room-a");
    expect(await store.listRooms(other)).toEqual([]);
    const a = (await store.get(UUID)) as IdentityRecord;
    const b = (await store.get(other)) as IdentityRecord;
    expect(a.uuid).not.toBe(b.uuid);
  });
});
