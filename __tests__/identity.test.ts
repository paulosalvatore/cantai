/**
 * Identity request-policy tests (TICKET-26). Exercises `createIdentityResolver`
 * against an injected `MemoryIdentityStore` (mint/reuse/adopt) and an injected
 * always-throwing store (fail-open) — mirrors how __tests__ elsewhere test
 * `lib/telemetry.ts`'s `createTracker(store)` factory without touching the real
 * singleton.
 */
import {
  createIdentityResolver,
  classifyUserAgent,
  isValidUuid,
  IDENTITY_COOKIE,
  type IdentityRequestLike,
} from "@/lib/identity";
import { MemoryIdentityStore, type IdentityStore } from "@/lib/identity-store";

function fakeReq(opts: { cookie?: string; userAgent?: string } = {}): IdentityRequestLike {
  return {
    cookies: {
      get: (name: string) =>
        name === IDENTITY_COOKIE && opts.cookie ? { value: opts.cookie } : undefined,
    },
    headers: {
      get: (name: string) => (name === "user-agent" ? opts.userAgent ?? null : null),
    },
  };
}

const A = "123e4567-e89b-42d3-a456-426614174000";
const B = "223e4567-e89b-42d3-a456-426614174001";

describe("resolveIdentity (via createIdentityResolver)", () => {
  it("mints a fresh uuid when there is no cookie and no legacy uuid", async () => {
    const store = new MemoryIdentityStore();
    const resolve = createIdentityResolver(store);
    const result = await resolve(fakeReq());
    expect(result.ok).toBe(true);
    expect(isValidUuid(result.uuid)).toBe(true);
    expect(await store.get(result.uuid)).not.toBeNull();
  });

  it("repeat load with the same cookie reuses the same identity (no duplicate)", async () => {
    const store = new MemoryIdentityStore();
    const resolve = createIdentityResolver(store);
    const first = await resolve(fakeReq());
    const second = await resolve(fakeReq({ cookie: first.uuid }));
    expect(second.uuid).toBe(first.uuid);
    const record = await store.get(first.uuid);
    expect(record?.lastSeenAt).toBeDefined();
  });

  it("adopts a valid pre-existing legacy patronUuid when there is no cookie yet", async () => {
    const store = new MemoryIdentityStore();
    const resolve = createIdentityResolver(store);
    const result = await resolve(fakeReq(), A);
    expect(result.ok).toBe(true);
    expect(result.uuid).toBe(A); // adopted, not replaced with a new mint
    expect(await store.get(A)).not.toBeNull();
  });

  it("adopting an already-registered legacy uuid touches it instead of duplicating", async () => {
    const store = new MemoryIdentityStore();
    const resolve = createIdentityResolver(store);
    await resolve(fakeReq(), A); // first touch under A
    const before = await store.get(A);
    const second = await resolve(fakeReq(), A);
    expect(second.uuid).toBe(A);
    const after = await store.get(A);
    expect(after?.createdAt).toBe(before?.createdAt); // same record, not recreated
  });

  it("an existing cookie wins over a supplied legacy uuid", async () => {
    const store = new MemoryIdentityStore();
    const resolve = createIdentityResolver(store);
    await resolve(fakeReq({ cookie: B })); // register B via cookie path
    const result = await resolve(fakeReq({ cookie: B }), A); // legacy A ignored
    expect(result.uuid).toBe(B);
  });

  it("an invalid legacy uuid is ignored — falls through to a fresh mint", async () => {
    const store = new MemoryIdentityStore();
    const resolve = createIdentityResolver(store);
    const result = await resolve(fakeReq(), "not-a-uuid");
    expect(result.ok).toBe(true);
    expect(isValidUuid(result.uuid)).toBe(true);
    expect(result.uuid).not.toBe("not-a-uuid");
  });

  it("fail-open: a throwing store never throws out of resolveIdentity", async () => {
    const throwingStore: IdentityStore = {
      get: async () => {
        throw new Error("store down");
      },
      touch: async () => {
        throw new Error("store down");
      },
      addRoom: async () => {
        throw new Error("store down");
      },
      listRooms: async () => {
        throw new Error("store down");
      },
      clear: async () => {
        throw new Error("store down");
      },
    };
    const resolve = createIdentityResolver(throwingStore);
    const result = await resolve(fakeReq(), A);
    expect(result.ok).toBe(false);
    expect(result.uuid).toBe(A); // best-known candidate still returned
  });

  it("fail-open with no legacy uuid and no cookie still returns SOME uuid", async () => {
    const throwingStore: IdentityStore = {
      get: async () => null,
      touch: async () => {
        throw new Error("store down");
      },
      addRoom: async () => {},
      listRooms: async () => [],
      clear: async () => {},
    };
    const resolve = createIdentityResolver(throwingStore);
    const result = await resolve(fakeReq());
    expect(result.ok).toBe(false);
    expect(isValidUuid(result.uuid)).toBe(true);
  });
});

describe("classifyUserAgent — coarse buckets only, never the raw string", () => {
  it("classifies common bot user agents", () => {
    expect(classifyUserAgent("curl/8.0.1")).toBe("bot");
    expect(classifyUserAgent("Googlebot/2.1")).toBe("bot");
  });

  it("classifies common mobile user agents", () => {
    expect(
      classifyUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      ),
    ).toBe("mobile");
    expect(classifyUserAgent("Mozilla/5.0 (Linux; Android 14)")).toBe("mobile");
  });

  it("classifies common desktop user agents", () => {
    expect(
      classifyUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0",
      ),
    ).toBe("desktop");
  });

  it("falls back to unknown for absent/unrecognized values", () => {
    expect(classifyUserAgent(null)).toBe("unknown");
    expect(classifyUserAgent(undefined)).toBe("unknown");
    expect(classifyUserAgent("")).toBe("unknown");
    expect(classifyUserAgent("some-obscure-client/1.0")).toBe("unknown");
  });
});

describe("isValidUuid", () => {
  it("accepts a real v4 uuid, rejects garbage", () => {
    expect(isValidUuid(A)).toBe(true);
    expect(isValidUuid("not-a-uuid")).toBe(false);
    expect(isValidUuid(undefined)).toBe(false);
    expect(isValidUuid(123)).toBe(false);
  });
});
