/**
 * TICKET-45 — per-room advance rate limiter: unit tests for the dual-bucket
 * (per-room) sliding window, plus a route-level check that an over-limit advance
 * gets a 429 and never reaches the store.
 */
import { NextRequest } from "next/server";
import {
  advanceRateLimitOk,
  ADVANCE_RATE_ROOM_MAX,
  ADVANCE_RATE_WINDOW_MS,
  _resetAdvanceRateLimit,
} from "@/lib/advance-rate-limit";
import { store, DEFAULT_ROOM } from "@/lib/store";
import { POST } from "@/app/api/queue/advance/route";
import { mintScreenToken, SCREEN_TOKEN_HEADER } from "@/lib/screen-token";

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  _resetAdvanceRateLimit();
  await store.clear(DEFAULT_ROOM);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("advanceRateLimitOk (unit)", () => {
  const NOW = 2_000_000;

  it("allows up to the per-room cap, then trips", () => {
    for (let i = 0; i < ADVANCE_RATE_ROOM_MAX; i++) {
      expect(advanceRateLimitOk("roomA", NOW + i)).toBe(true);
    }
    expect(advanceRateLimitOk("roomA", NOW + 50)).toBe(false);
  });

  it("buckets are independent per room", () => {
    for (let i = 0; i < ADVANCE_RATE_ROOM_MAX; i++) {
      advanceRateLimitOk("roomA", NOW + i);
    }
    expect(advanceRateLimitOk("roomA", NOW + 50)).toBe(false);
    // a different room is unaffected
    expect(advanceRateLimitOk("roomB", NOW + 51)).toBe(true);
  });

  it("frees after the window slides", () => {
    for (let i = 0; i < ADVANCE_RATE_ROOM_MAX; i++) {
      advanceRateLimitOk("roomA", NOW + i);
    }
    expect(advanceRateLimitOk("roomA", NOW + 100)).toBe(false);
    expect(advanceRateLimitOk("roomA", NOW + ADVANCE_RATE_WINDOW_MS + 101)).toBe(true);
  });
});

describe("POST /api/queue/advance rate limiting (route)", () => {
  async function authedAdvance(): Promise<NextRequest> {
    const token = await mintScreenToken(DEFAULT_ROOM);
    return new NextRequest("http://127.0.0.1:3045/api/queue/advance", {
      method: "POST",
      headers: token ? { [SCREEN_TOKEN_HEADER]: token } : {},
    });
  }

  it("429s once the room exceeds its per-minute advance cap", async () => {
    // dev-fallback secret so the token authorizes; enforce mode so auth is real.
    delete process.env.HOST_TOKEN;
    process.env.NODE_ENV = "test";
    process.env.ADVANCE_AUTH = "enforce";

    let saw429 = false;
    for (let i = 0; i < ADVANCE_RATE_ROOM_MAX + 2; i++) {
      const res = await POST(await authedAdvance());
      if (res.status === 429) {
        saw429 = true;
        const body = await res.json();
        expect(body.reason).toBe("rate");
        break;
      }
      expect(res.status).toBe(200);
    }
    expect(saw429).toBe(true);
  });
});
