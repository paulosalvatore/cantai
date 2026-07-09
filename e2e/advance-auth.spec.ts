import { test, expect } from "@playwright/test";
import { advanceOnce, screenTokenFor, SCREEN_TOKEN_HEADER } from "./helpers";

/**
 * E2E: advance/skip authorization (TICKET-45). The suite runs in enforce mode
 * (playwright.config.ts sets ADVANCE_AUTH=enforce), so a bare advance — exactly
 * the patron-prank curl the TL asked to close — must be rejected 401, while an
 * advance carrying the room's screen token succeeds.
 */
test.describe("advance auth (enforce mode)", () => {
  test("a bare (patron-context) advance is rejected 401", async ({ request }) => {
    const res = await request.post("/api/queue/advance", { method: "POST" });
    expect(res.status()).toBe(401);
  });

  test("a stale / wrong screen token is rejected 401", async ({ request }) => {
    const res = await request.post("/api/queue/advance", {
      headers: { [SCREEN_TOKEN_HEADER]: "deadbeef".repeat(8) },
    });
    expect(res.status()).toBe(401);
  });

  test("an advance carrying the valid room screen token succeeds", async ({ request }) => {
    // Seed one entry so there is a head to advance past, then advance with the
    // token the /[room]/tv page would mint.
    await request.post("/api/queue", {
      data: {
        videoId: "dQw4w9WgXcQ",
        title: "Autorizado",
        nickname: "TV",
        patronUuid: "123e4567-e89b-42d3-a456-426614174000",
        mode: "sing",
      },
    });
    const res = await advanceOnce(request);
    expect(res.status()).toBe(200);
    // Drain any residue so the shared in-memory store is left clean.
    await advanceOnce(request);
  });

  test("the screen token helper matches what the TV page renders (sanity)", async ({ request }) => {
    // The token is derived, not stored; the helper recomputes the same HMAC the
    // server mints. A round-trip through the real route is the proof.
    const token = screenTokenFor();
    const res = await request.post("/api/queue/advance", {
      headers: { [SCREEN_TOKEN_HEADER]: token },
    });
    // 200 (advanced/empty) — NOT 401. The token verified server-side.
    expect(res.status()).toBe(200);
  });
});
