/**
 * Room model + persistence (TICKET-9).
 *
 * A room is a venue's own karaoke session: a short human slug, a display name,
 * a one-time host code (venue identity until accounts arrive in #14), and a
 * settings blob (mode placeholder for #10).
 *
 * WHY a parallel store (not the `QueueStore` interface): the TICKET-6 store
 * contract is frozen and this ticket must not touch `lib/store/**`. Rooms are a
 * new domain, so they get their own tiny persistence here, using the SAME key
 * namespace (`room:<id>:meta`, alongside `room:<id>:queue`) and the SAME driver
 * selection (memory | upstash) as `lib/store.ts`. This is the one deliberate
 * place outside `lib/store*` that talks to Redis directly — kept minimal and
 * documented so the schema stays coherent.
 *
 * Persistence is best-effort durable: with Upstash configured, room records
 * survive across serverless instances; with the memory driver (local dev / CI)
 * they live per-process, exactly like the queue store's memory driver.
 */

import "server-only";

import { randomBytes as nodeRandomBytes } from "crypto";
import { Redis } from "@upstash/redis";
import { DEFAULT_ROOM, type Mode } from "./store";

export interface RoomSettings {
  mode: Mode | "full"; // "full" = karaokê completo (default); #10 wires real modes
}

export interface Room {
  id: string;
  name: string;
  hostCode: string;
  createdAt: string; // ISO 8601
  settings: RoomSettings;
}

/** Client-safe room view — never leaks the host code. */
export type PublicRoom = Pick<Room, "id" | "name" | "createdAt"> & {
  settings: RoomSettings;
};

/** Redis key for a room's metadata record (sits beside `room:<id>:queue`). */
export const roomKey = (roomId: string) => `room:${roomId}:meta`;

/**
 * Valid room id: lowercase alnum + hyphen, 1–64 chars. SECURITY-CRITICAL — the
 * id is interpolated into Redis keys, so every route must validate it before
 * any store call to prevent key injection / cross-room access.
 */
const ROOM_ID_RE = /^[a-z0-9-]{1,64}$/;

export function isValidRoomId(id: unknown): id is string {
  return typeof id === "string" && ROOM_ID_RE.test(id);
}

// ─── Slug + host-code generation ─────────────────────────────────────────────

/** Crockford base32 alphabet (no I/L/O/U — avoids ambiguity when typed). */
const B32 = "0123456789abcdefghjkmnpqrstvwxyz";

function randomBase32(len: number): string {
  const bytes = nodeRandomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += B32[bytes[i] % 32];
  return out;
}

/**
 * Slugify a venue name into a short, human room id + a 4-char suffix for
 * uniqueness. Strips accents, lowercases, keeps [a-z0-9], collapses runs of
 * non-alnum to single hyphens. Empty/degenerate names fall back to "sala".
 */
export function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics (combining marks)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const stem = base || "sala";
  return `${stem}-${randomBase32(4)}`;
}

/** One-time host code: 8-char Crockford base32 (~40 bits). Shown once. */
export function generateHostCode(): string {
  return randomBase32(8);
}

// ─── Persistence ─────────────────────────────────────────────────────────────

interface RoomBackend {
  get(id: string): Promise<Room | null>;
  set(room: Room): Promise<void>;
}

class MemoryRoomBackend implements RoomBackend {
  private rooms = new Map<string, Room>();
  async get(id: string): Promise<Room | null> {
    return this.rooms.get(id) ?? null;
  }
  async set(room: Room): Promise<void> {
    this.rooms.set(room.id, room);
  }
}

class UpstashRoomBackend implements RoomBackend {
  constructor(private readonly redis: Redis) {}
  async get(id: string): Promise<Room | null> {
    return (await this.redis.get<Room>(roomKey(id))) ?? null;
  }
  async set(room: Room): Promise<void> {
    await this.redis.set(roomKey(room.id), room);
  }
}

function resolveDriver(): "memory" | "upstash" {
  const explicit = process.env.STORE_DRIVER?.toLowerCase();
  if (explicit === "upstash" || explicit === "memory") return explicit;
  return process.env.UPSTASH_REDIS_REST_URL ? "upstash" : "memory";
}

function createBackend(): RoomBackend {
  if (resolveDriver() === "upstash") {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new Error(
        "Upstash driver selected but UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set.",
      );
    }
    return new UpstashRoomBackend(new Redis({ url, token }));
  }
  return new MemoryRoomBackend();
}

/** Process-wide room backend singleton (mirrors the queue store singleton). */
export const roomBackend: RoomBackend = createBackend();

// ─── Public API ──────────────────────────────────────────────────────────────

/** Fetch a room record (server-side; includes the host code). */
export async function getRoom(roomId: string): Promise<Room | null> {
  if (!isValidRoomId(roomId)) return null;
  return roomBackend.get(roomId);
}

/** Fetch a client-safe room view (no host code). */
export async function getPublicRoom(roomId: string): Promise<PublicRoom | null> {
  const room = await getRoom(roomId);
  if (!room) return null;
  return {
    id: room.id,
    name: room.name,
    createdAt: room.createdAt,
    settings: room.settings,
  };
}

/**
 * Create a room from a venue name. Generates a unique slug (retrying on the
 * rare suffix collision) and a one-time host code. Returns the FULL record —
 * the host code is shown exactly once at the call site and never again.
 */
export async function createRoom(name: string): Promise<Room> {
  const trimmed = name.trim().slice(0, 60);
  let id = slugify(trimmed);
  // Extremely unlikely 4-char suffix collision — retry a few times.
  for (let attempt = 0; attempt < 5 && (await roomBackend.get(id)); attempt++) {
    id = slugify(trimmed);
  }
  const room: Room = {
    id,
    name: trimmed || "sala",
    hostCode: generateHostCode(),
    createdAt: new Date().toISOString(),
    settings: { mode: "full" },
  };
  await roomBackend.set(room);
  return room;
}

/** The legacy single-queue room id (pre-multi-room prototype). */
export { DEFAULT_ROOM };
