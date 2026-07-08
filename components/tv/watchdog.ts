/**
 * TICKET-41 — TV player watchdog: pure decision logic.
 *
 * The TV must NEVER require a human refresh mid-night. This module holds every
 * watchdog DECISION as pure functions (no React, no timers, no player handle)
 * so the state machine is unit-testable in isolation. `TvScreen` wires the
 * decisions to the real YT player.
 *
 * Three concerns:
 *  1. Fatal-error classification — IFrame API onError codes that mean "this
 *     video will never play here": skip it.
 *  2. Stall detection — a video that SHOULD be playing but whose
 *     getCurrentTime() stops progressing walks an escalation ladder:
 *     replay → reload → recreate → advance.
 *  3. Bootstrap backoff — if the IFrame API script or player creation fails
 *     (venue-wifi blip), retry with capped backoff forever; never sit dead.
 */

// ---------------------------------------------------------------------------
// 1. Fatal onError codes
// ---------------------------------------------------------------------------

/**
 * YT IFrame API error codes that are unrecoverable for THIS video:
 *  2   — invalid videoId parameter
 *  5   — HTML5 player error for the requested content
 *  100 — video not found / removed / private
 *  101 — embedding disabled by the video owner
 *  150 — same as 101 (disguised)
 * Anything else (or unknown future codes) is left to the stall ladder.
 */
const FATAL_ERROR_CODES: ReadonlySet<number> = new Set([2, 5, 100, 101, 150]);

export function isFatalPlayerError(code: number): boolean {
  return FATAL_ERROR_CODES.has(code);
}

// ---------------------------------------------------------------------------
// 2. Stall machine
// ---------------------------------------------------------------------------

/** No-progress window before escalating one rung (ticket: ~10–15s). */
export const STALL_WINDOW_MS = 12_000;

/** Minimum getCurrentTime() delta (seconds) that counts as real progress. */
export const MIN_PROGRESS_SECONDS = 0.25;

/**
 * Escalation ladder, in order. Each stall window without progress climbs one
 * rung; real progress resets to the bottom.
 */
export const ESCALATION_LADDER = [
  "replay", // seekTo(current) + playVideo — cheapest nudge
  "reload", // loadVideoById again — fresh stream
  "recreate", // destroy + new YT.Player — fresh iframe
  "advance", // give up on this video: skip it
] as const;

export type StallAction = (typeof ESCALATION_LADDER)[number] | "none";

export interface StallState {
  /** Rungs already climbed for the current video (0 = none). */
  escalation: number;
  /** Last observed getCurrentTime() value (null = no sample yet). */
  lastTime: number | null;
  /** Timestamp (ms) when the current no-progress window was armed. */
  windowStart: number;
}

/**
 * The subset of YT.PlayerState the machine needs, passed in (not imported)
 * so the module stays pure and testable without the IFrame API loaded.
 */
export interface PlayerStates {
  PLAYING: number;
  PAUSED: number;
  BUFFERING: number;
  ENDED: number;
  CUED: number;
}

export interface StallSample {
  /**
   * getPlayerState() result, or null when the call threw / player is wedged —
   * a wedged player counts as no-progress, not as benign.
   */
  playerState: number | null;
  /** getCurrentTime() result, or null when the call threw. */
  currentTime: number | null;
  /** Sample timestamp, ms (Date.now()). */
  now: number;
  states: PlayerStates;
}

export function createStallState(now: number): StallState {
  return { escalation: 0, lastTime: null, windowStart: now };
}

/**
 * Feed one poll sample; get the next state and the action to take.
 *
 * Benign (window re-armed, ladder untouched or reset):
 *  - ENDED — onStateChange owns advancing; nothing to watch.
 *  - PAUSED — paused by design (host used the player controls).
 *  - real progress — ladder fully resets.
 * Suspicious (window keeps running): PLAYING/BUFFERING/UNSTARTED/CUED with no
 * progress, or a wedged player (null state). When the window elapses, climb
 * one rung, emit that rung's action, and re-arm the window.
 */
export function stallTick(
  state: StallState,
  sample: StallSample
): { state: StallState; action: StallAction } {
  const { playerState, currentTime, now, states } = sample;

  // ENDED / PAUSED are by-design states — re-arm so a later resume gets a
  // fresh window, and keep the ladder where it is (progress resets it, not
  // a pause).
  if (playerState === states.ENDED || playerState === states.PAUSED) {
    return {
      state: { ...state, lastTime: currentTime, windowStart: now },
      action: "none",
    };
  }

  // Real progress → everything is healthy: full reset. Absolute delta on
  // purpose: after a reload/recreate rung the clock jumps BACKWARDS (video
  // restarts at 0) — that is activity, not continued stall. A genuinely
  // wedged player has a frozen clock in every direction.
  if (
    currentTime !== null &&
    state.lastTime !== null &&
    Math.abs(currentTime - state.lastTime) >= MIN_PROGRESS_SECONDS
  ) {
    return {
      state: { escalation: 0, lastTime: currentTime, windowStart: now },
      action: "none",
    };
  }

  // First sample for this video: arm the window, record the baseline.
  if (state.lastTime === null && currentTime !== null) {
    return {
      state: { ...state, lastTime: currentTime },
      action: "none",
    };
  }

  // No progress. Window still open → keep waiting.
  if (now - state.windowStart < STALL_WINDOW_MS) {
    return { state, action: "none" };
  }

  // Window elapsed with no progress → climb one rung.
  const rung = state.escalation;
  if (rung >= ESCALATION_LADDER.length) {
    // Defensive: past the top the integration resets us; never loop advance.
    return {
      state: { escalation: 0, lastTime: currentTime, windowStart: now },
      action: "none",
    };
  }
  const action = ESCALATION_LADDER[rung];
  return {
    state: {
      escalation: rung + 1,
      // Re-baseline so post-action progress is measured fresh.
      lastTime: currentTime,
      windowStart: now,
    },
    action,
  };
}

// ---------------------------------------------------------------------------
// 3. Bootstrap backoff
// ---------------------------------------------------------------------------

/**
 * Delay (ms) before bootstrap retry number `attempt` (1-based).
 * 5s, 10s, 20s, then 30s forever — capped but UNLIMITED: a dead venue wifi
 * eventually heals and the TV must be alive when it does.
 */
export function bootstrapRetryDelayMs(attempt: number): number {
  const schedule = [5_000, 10_000, 20_000];
  return schedule[attempt - 1] ?? 30_000;
}

/** How long to wait for the IFrame API to become ready before retrying. */
export const BOOTSTRAP_READY_TIMEOUT_MS = 10_000;
