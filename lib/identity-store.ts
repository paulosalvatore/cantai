/**
 * Identity store (TICKET-26) — the server-side anonymous identity registry.
 *
 * OWN module, OWN `identity:*` keyspace — mirrors `lib/feedback-store.ts` /
 * `lib/telemetry-store.ts`, NOT the frozen `QueueStore` (`lib/store/types.ts`,
 * TICKET-6): that interface is queue-shaped and explicitly must not be touched
 * by later tickets. This module instead mirrors the house driver-selection
 * pattern exactly, so it inherits the same `STORE_DRIVER` env behavior:
 *
 *   STORE_DRIVER=upstash            → durable Upstash Redis (production)
 *   STORE_DRIVER=memory             → in-process memory (local dev / CI)
 *   (unset) + UPSTASH_REDIS_REST_URL present → upstash
 *   (unset) + no Upstash creds      → memory  (default; boots with zero secrets)
 *
 * ZERO-PII INVARIANT (binding — see work/planning/accounts-and-identity.md
 * "Layer 1", acceptance criterion #5): `IdentityRecord` carries NO personal
 * data. No name, email, phone, IP address, or device fingerprint — ever.
 * `userAgentClass` is a coarse bucket (mobile/desktop/bot/unknown, see
 * `lib/identity.ts#classifyUserAgent`), NEVER the raw User-Agent string. Any
 * future field added to this record MUST preserve this invariant.
 *
 * FUTURE CLAIM HOOK (TICKET-28, NOT built here): `accountId` is reserved as an
 * optional/nullable field so the future Google-OAuth claim can attach an
 * account via a LINK WRITE (`identity.accountId = id`) — never a data rewrite
 * or migration. See accounts-and-identity.md "Layer 2 — Host accounts".
 *
 * HONEST VOLATILITY NOTE: the memory driver is per-process (each serverless
 * lambda holds its own copy) — identities registered under it are NOT
 * durable/shared, exactly like the queue/feedback/telemetry memory drivers.
 * Production requires Upstash for identity continuity to actually hold.
 */

import "server-only";

import { Redis } from "@upstash/redis";

/** Coarse User-Agent bucket — see the zero-PII invariant above. */
export type UserAgentClass = "mobile" | "desktop" | "bot" | "unknown";

/**
 * A registered anonymous identity. See the zero-PII invariant and the
 * TICKET-28 claim-hook note in the file header above — both are load-bearing
 * for this shape, not just documentation.
 */
export interface IdentityRecord {
  uuid: string;
  createdAt: string; // ISO 8601 — set once, at first touch.
  lastSeenAt: string; // ISO 8601 — updated on every subsequent touch.
  userAgentClass: UserAgentClass;
  /**
   * Reserved for TICKET-28 (Google OAuth claim). `undefined`/`null` until an
   * account claims this identity. NOT set or read by this ticket.
   */
  accountId?: string | null;
}

/** Redis key schema — identity's own namespace (never collides with `room:*`, `feedback:*`, `telemetry:*`). */
export const identityKeys = {
  item: (uuid: string) => `identity:${uuid}`,
  /** Room ids created by this identity (TICKET-28's O(1) claim hook). */
  rooms: (uuid: string) => `identity:${uuid}:rooms`,
};

/**
 * Durable identity registry. Every op is async so one interface covers both
 * the in-process memory driver and the HTTP-based Upstash driver.
 */
export interface IdentityStore {
  /** Fetch a record by uuid, or null if never registered. */
  get(uuid: string): Promise<IdentityRecord | null>;

  /**
   * Register-or-refresh: create a new record on first touch (`createdAt` =
   * `lastSeenAt` = now), or update `lastSeenAt`/`userAgentClass` on an
   * existing one (`createdAt` is never modified after creation). Idempotent —
   * calling this repeatedly for the same uuid never creates a duplicate
   * record. This single upsert op is what makes cookie-reuse, legacy-uuid
   * adoption, and fresh-mint all resolve through the same code path in
   * `lib/identity.ts`.
   */
  touch(uuid: string, userAgentClass: UserAgentClass, now?: Date): Promise<IdentityRecord>;

  /** Record that this identity created a room (TICKET-28's claim hook). Idempotent. */
  addRoom(uuid: string, roomId: string): Promise<void>;

  /** Room ids created by this identity, unordered. */
  listRooms(uuid: string): Promise<string[]>;

  /** Wipe all identity state (test/reset helper — never called from a route). */
  clear(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory driver
// ─────────────────────────────────────────────────────────────────────────────

export class MemoryIdentityStore implements IdentityStore {
  private items = new Map<string, IdentityRecord>();
  private rooms = new Map<string, Set<string>>();

  async get(uuid: string): Promise<IdentityRecord | null> {
    return this.items.get(uuid) ?? null;
  }

  async touch(
    uuid: string,
    userAgentClass: UserAgentClass,
    now: Date = new Date(),
  ): Promise<IdentityRecord> {
    const iso = now.toISOString();
    const existing = this.items.get(uuid);
    if (existing) {
      const updated: IdentityRecord = { ...existing, lastSeenAt: iso, userAgentClass };
      this.items.set(uuid, updated);
      return updated;
    }
    const record: IdentityRecord = {
      uuid,
      createdAt: iso,
      lastSeenAt: iso,
      userAgentClass,
      accountId: null,
    };
    this.items.set(uuid, record);
    return record;
  }

  async addRoom(uuid: string, roomId: string): Promise<void> {
    let set = this.rooms.get(uuid);
    if (!set) {
      set = new Set<string>();
      this.rooms.set(uuid, set);
    }
    set.add(roomId);
  }

  async listRooms(uuid: string): Promise<string[]> {
    return [...(this.rooms.get(uuid) ?? new Set<string>())];
  }

  async clear(): Promise<void> {
    this.items.clear();
    this.rooms.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Upstash driver
// ─────────────────────────────────────────────────────────────────────────────

/** The subset of the Redis client this store depends on (keeps it injectable). */
export interface IdentityRedisLike {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<unknown>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  del(...keys: string[]): Promise<number>;
}

export class UpstashIdentityStore implements IdentityStore {
  constructor(private readonly redis: IdentityRedisLike) {}

  async get(uuid: string): Promise<IdentityRecord | null> {
    return (await this.redis.get<IdentityRecord>(identityKeys.item(uuid))) ?? null;
  }

  async touch(
    uuid: string,
    userAgentClass: UserAgentClass,
    now: Date = new Date(),
  ): Promise<IdentityRecord> {
    const iso = now.toISOString();
    const key = identityKeys.item(uuid);
    const existing = await this.redis.get<IdentityRecord>(key);
    const record: IdentityRecord = existing
      ? { ...existing, lastSeenAt: iso, userAgentClass }
      : { uuid, createdAt: iso, lastSeenAt: iso, userAgentClass, accountId: null };
    await this.redis.set(key, record);
    return record;
  }

  async addRoom(uuid: string, roomId: string): Promise<void> {
    await this.redis.sadd(identityKeys.rooms(uuid), roomId);
  }

  async listRooms(uuid: string): Promise<string[]> {
    return this.redis.smembers(identityKeys.rooms(uuid));
  }

  async clear(): Promise<void> {
    // Test/reset helper only — a real deployment has no bounded keyspace scan
    // here (mirrors the same limitation as the other stores' `clear()`).
  }
}

/**
 * Build an UpstashIdentityStore from environment credentials. Throws if either
 * Upstash var is missing — callers only reach here when the upstash driver was
 * explicitly selected (see `createIdentityStore` below).
 */
export function createUpstashIdentityStore(): UpstashIdentityStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Upstash identity driver selected but UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set.",
    );
  }
  return new UpstashIdentityStore(new Redis({ url, token }));
}

function resolveDriver(): "memory" | "upstash" {
  const explicit = process.env.STORE_DRIVER?.toLowerCase();
  if (explicit === "upstash" || explicit === "memory") return explicit;
  return process.env.UPSTASH_REDIS_REST_URL ? "upstash" : "memory";
}

function createIdentityStore(): IdentityStore {
  return resolveDriver() === "upstash"
    ? createUpstashIdentityStore()
    : new MemoryIdentityStore();
}

/** The process-wide identity store singleton. */
export const identityStore: IdentityStore = createIdentityStore();
