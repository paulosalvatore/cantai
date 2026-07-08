/**
 * TICKET-41 — TV player watchdog: pure state-machine tests.
 *
 * The module under test holds every watchdog DECISION (error classification,
 * stall escalation ladder, bootstrap backoff) with no React/player/timer
 * dependencies, so the whole reliability contract is provable here.
 */
import {
  isFatalPlayerError,
  createStallState,
  stallTick,
  bootstrapRetryDelayMs,
  STALL_WINDOW_MS,
  MIN_PROGRESS_SECONDS,
  ESCALATION_LADDER,
  BOOTSTRAP_READY_TIMEOUT_MS,
  type StallState,
  type StallSample,
  type PlayerStates,
} from "@/components/tv/watchdog";

const STATES: PlayerStates = {
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  ENDED: 0,
  CUED: 5,
};

const sample = (over: Partial<StallSample>): StallSample => ({
  playerState: STATES.PLAYING,
  currentTime: 0,
  now: 0,
  states: STATES,
  ...over,
});

/** Run one tick and return both halves for terse assertions. */
const tick = (s: StallState, over: Partial<StallSample>) =>
  stallTick(s, sample(over));

describe("isFatalPlayerError — onError code classification", () => {
  it.each([2, 5, 100, 101, 150])("code %i is fatal (skip the video)", (c) => {
    expect(isFatalPlayerError(c)).toBe(true);
  });

  it.each([0, 1, 3, 42, -1])("code %i is NOT fatal (left to the ladder)", (c) => {
    expect(isFatalPlayerError(c)).toBe(false);
  });
});

describe("stall machine — healthy playback", () => {
  it("first sample only baselines the clock", () => {
    const { state, action } = tick(createStallState(0), {
      currentTime: 12.5,
      now: 1000,
    });
    expect(action).toBe("none");
    expect(state.lastTime).toBe(12.5);
    expect(state.escalation).toBe(0);
  });

  it("forward progress resets the ladder fully", () => {
    const s: StallState = { escalation: 2, lastTime: 10, windowStart: 0 };
    const r = tick(s, { currentTime: 10 + MIN_PROGRESS_SECONDS, now: 3000 });
    expect(r.action).toBe("none");
    expect(r.state.escalation).toBe(0);
    expect(r.state.windowStart).toBe(3000);
  });

  it("BACKWARD clock movement counts as activity (reload/recreate restart at 0)", () => {
    const s: StallState = { escalation: 2, lastTime: 45.2, windowStart: 0 };
    const r = tick(s, { currentTime: 0.4, now: 3000 });
    expect(r.action).toBe("none");
    expect(r.state.escalation).toBe(0);
  });

  it("PAUSED is benign: no escalation, window re-armed for a later resume", () => {
    const s: StallState = { escalation: 1, lastTime: 20, windowStart: 0 };
    const r = tick(s, {
      playerState: STATES.PAUSED,
      currentTime: 20,
      now: STALL_WINDOW_MS * 5, // way past any window
    });
    expect(r.action).toBe("none");
    expect(r.state.escalation).toBe(1); // pause doesn't reset the ladder…
    expect(r.state.windowStart).toBe(STALL_WINDOW_MS * 5); // …but re-arms the window
  });

  it("ENDED is benign (onStateChange owns advancing)", () => {
    const s: StallState = { escalation: 0, lastTime: 100, windowStart: 0 };
    const r = tick(s, {
      playerState: STATES.ENDED,
      currentTime: 100,
      now: STALL_WINDOW_MS * 5,
    });
    expect(r.action).toBe("none");
  });

  it("buffering WITH progress is benign", () => {
    const s: StallState = { escalation: 0, lastTime: 30, windowStart: 0 };
    const r = tick(s, {
      playerState: STATES.BUFFERING,
      currentTime: 30 + 1,
      now: STALL_WINDOW_MS * 5,
    });
    expect(r.action).toBe("none");
    expect(r.state.escalation).toBe(0);
  });
});

describe("stall machine — escalation ladder", () => {
  /** Drive a frozen clock through one full window and return the action. */
  const freezeThroughWindow = (s: StallState, from: number) => {
    // Inside the window: nothing.
    const mid = tick(s, { currentTime: s.lastTime ?? 0, now: from + STALL_WINDOW_MS - 1 });
    expect(mid.action).toBe("none");
    // Window elapsed: escalate.
    return tick(mid.state, { currentTime: s.lastTime ?? 0, now: from + STALL_WINDOW_MS });
  };

  it("walks replay → reload → recreate → advance on a frozen clock", () => {
    let s = createStallState(0);
    // Baseline.
    s = tick(s, { currentTime: 50, now: 0 }).state;

    const actions: string[] = [];
    let now = 0;
    for (let i = 0; i < ESCALATION_LADDER.length; i++) {
      const r = freezeThroughWindow(s, now);
      actions.push(r.action);
      s = r.state;
      now += STALL_WINDOW_MS;
      // Each rung re-arms a fresh window.
      expect(s.windowStart).toBe(now);
    }
    expect(actions).toEqual(["replay", "reload", "recreate", "advance"]);
  });

  it("stays quiet while the window is still open", () => {
    let s = createStallState(0);
    s = tick(s, { currentTime: 5, now: 0 }).state;
    const r = tick(s, { currentTime: 5, now: STALL_WINDOW_MS - 1 });
    expect(r.action).toBe("none");
    expect(r.state.escalation).toBe(0);
  });

  it("a wedged player (null state + null time) escalates too", () => {
    const s = createStallState(0);
    const r = tick(s, {
      playerState: null,
      currentTime: null,
      now: STALL_WINDOW_MS,
    });
    expect(r.action).toBe("replay");
  });

  it("progress between rungs resets to the bottom of the ladder", () => {
    let s: StallState = { escalation: 2, lastTime: 10, windowStart: 0 };
    s = tick(s, { currentTime: 15, now: 1000 }).state; // healthy again
    expect(s.escalation).toBe(0);
    const r = tick(s, { currentTime: 15, now: 1000 + STALL_WINDOW_MS });
    expect(r.action).toBe("replay"); // ladder restarted from rung 0
  });

  it("never loops advance: past the top it resets defensively", () => {
    const s: StallState = {
      escalation: ESCALATION_LADDER.length,
      lastTime: 10,
      windowStart: 0,
    };
    const r = tick(s, { currentTime: 10, now: STALL_WINDOW_MS });
    expect(r.action).toBe("none");
    expect(r.state.escalation).toBe(0);
  });
});

describe("bootstrap backoff — the TV never sits dead", () => {
  it("backs off 5s, 10s, 20s, then caps at 30s forever", () => {
    expect(bootstrapRetryDelayMs(1)).toBe(5_000);
    expect(bootstrapRetryDelayMs(2)).toBe(10_000);
    expect(bootstrapRetryDelayMs(3)).toBe(20_000);
    expect(bootstrapRetryDelayMs(4)).toBe(30_000);
    expect(bootstrapRetryDelayMs(50)).toBe(30_000); // unlimited retries, capped delay
  });

  it("sanity: constants are in the ticket's sane ranges", () => {
    expect(STALL_WINDOW_MS).toBeGreaterThanOrEqual(10_000);
    expect(STALL_WINDOW_MS).toBeLessThanOrEqual(15_000);
    expect(BOOTSTRAP_READY_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
