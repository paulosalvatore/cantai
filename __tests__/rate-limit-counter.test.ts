/**
 * Rate-limit counter unit tests (TICKET-48) — MEMORY PATH.
 *
 * CI runs in memory mode (no Upstash env), mirroring how the standalone
 * throttle tests avoid a real Redis. These exercise the fixed-window semantics,
 * the max-failures gate, reset, window expiry, and the LRU cap. The Redis path
 * (INCR + EXPIRE-on-create, fail-open) is left to integration/manual since it
 * needs a live Upstash — it shares NO branch with the memory logic tested here
 * beyond the public API surface.
 */
import {
  isThrottled,
  registerFailure,
  resetKey,
  _clearAll,
} from "@/lib/rate-limit-counter";

const ORIGINAL_ENV = { ...process.env };
const OPTS = { max: 5, windowMs: 60_000 };

beforeEach(() => {
  // Force the memory path regardless of ambient env.
  delete process.env.UPSTASH_REDIS_REST_URL;
  process.env.STORE_DRIVER = "memory";
  _clearAll();
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.useRealTimers();
});

describe("rate-limit-counter (memory path)", () => {
  it("is not throttled before any failure", async () => {
    expect(await isThrottled("k", OPTS)).toBe(false);
  });

  it("trips exactly at the max-failures gate", async () => {
    const key = "login:203.0.113.7";
    for (let i = 0; i < OPTS.max; i++) {
      expect(await isThrottled(key, OPTS)).toBe(false);
      await registerFailure(key, OPTS);
    }
    expect(await isThrottled(key, OPTS)).toBe(true);
  });

  it("resetKey clears the counter", async () => {
    const key = "login:203.0.113.8";
    for (let i = 0; i < OPTS.max; i++) await registerFailure(key, OPTS);
    expect(await isThrottled(key, OPTS)).toBe(true);
    await resetKey(key);
    expect(await isThrottled(key, OPTS)).toBe(false);
  });

  it("expires the window after windowMs", async () => {
    jest.useFakeTimers();
    const key = "login:203.0.113.9";
    for (let i = 0; i < OPTS.max; i++) await registerFailure(key, OPTS);
    expect(await isThrottled(key, OPTS)).toBe(true);
    jest.advanceTimersByTime(OPTS.windowMs + 1);
    expect(await isThrottled(key, OPTS)).toBe(false);
  });

  it("anchors the window at the first failure (not sliding)", async () => {
    jest.useFakeTimers();
    const key = "login:203.0.113.10";
    await registerFailure(key, OPTS); // window opens at t=0
    jest.advanceTimersByTime(OPTS.windowMs - 1);
    for (let i = 0; i < OPTS.max; i++) await registerFailure(key, OPTS);
    // Still within the original window → throttled.
    expect(await isThrottled(key, OPTS)).toBe(true);
    // Cross the original window boundary → the first failure's window expired.
    jest.advanceTimersByTime(2);
    expect(await isThrottled(key, OPTS)).toBe(false);
  });

  it("caps tracked keys (LRU eviction, no unbounded growth)", async () => {
    await registerFailure("first-key", OPTS);
    for (let i = 0; i < 1000; i++) await registerFailure(`flood-${i}`, OPTS);
    // first-key's original bucket was evicted by the flood; fresh failures start
    // a new window — still under the max.
    for (let i = 0; i < OPTS.max - 1; i++) await registerFailure("first-key", OPTS);
    expect(await isThrottled("first-key", OPTS)).toBe(false);
  });

  it("keeps distinct keys independent", async () => {
    for (let i = 0; i < OPTS.max; i++) await registerFailure("key-a", OPTS);
    expect(await isThrottled("key-a", OPTS)).toBe(true);
    expect(await isThrottled("key-b", OPTS)).toBe(false);
  });
});
