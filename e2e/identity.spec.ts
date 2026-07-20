import { test, expect } from "@playwright/test";

/**
 * E2E: anonymous identity registry (TICKET-26).
 *
 * The identity cookie is httpOnly by design (that's the whole point vs. the
 * old localStorage-only patronUuid) — page JS can never read it via
 * `document.cookie`, so these assertions go through Playwright's
 * `context.cookies()` (server-visible cookie jar), not `page.evaluate`.
 */

const IDENTITY_COOKIE = "boraoke_identity";
const UUID_RE = /^[0-9a-f-]{36}$/i;

test("fresh device's first page load sets exactly one identity cookie", async ({ page, context }) => {
  // Wait for the actual /api/identity registration response rather than a
  // fixed sleep — under `next dev` the route's FIRST hit includes a cold
  // compile that can exceed any fixed timeout. The response carries the
  // Set-Cookie the browser then applies to the context jar.
  const identityResponse = page.waitForResponse(
    (r) => r.url().includes("/api/identity") && r.status() === 200,
  );
  await page.goto("/default");
  await page.getByLabel("Seu apelido").waitFor();
  await identityResponse;

  const cookies = await context.cookies();
  const identityCookies = cookies.filter((c) => c.name === IDENTITY_COOKIE);
  expect(identityCookies).toHaveLength(1);
  expect(identityCookies[0].httpOnly).toBe(true);
  expect(identityCookies[0].value).toMatch(UUID_RE);
});

test("repeat visit reuses the same identity cookie (cookie survives reload)", async ({ page, context }) => {
  const firstReg = page.waitForResponse(
    (r) => r.url().includes("/api/identity") && r.status() === 200,
  );
  await page.goto("/default");
  await page.getByLabel("Seu apelido").waitFor();
  await firstReg;

  const first = (await context.cookies()).find((c) => c.name === IDENTITY_COOKIE);
  expect(first?.value).toMatch(UUID_RE);

  const secondReg = page.waitForResponse(
    (r) => r.url().includes("/api/identity") && r.status() === 200,
  );
  await page.reload();
  await page.getByLabel("Seu apelido").waitFor();
  await secondReg;

  const second = (await context.cookies()).find((c) => c.name === IDENTITY_COOKIE);
  expect(second?.value).toBe(first?.value);
});

test("own pending/rejected panel still resolves via the (now-registered) patronUuid", async ({ page }) => {
  // Regression guard for continuity (acceptance #2): the patron flow's
  // uuid-scoped "my submissions" poll (`/api/queue/pending?...&uuid=`) must
  // keep working once that uuid rides through server-side identity
  // registration — i.e. registration never disrupts the existing patronUuid
  // the join flow already depends on.
  await page.goto("/default");
  await page.getByLabel("Seu apelido").waitFor();
  await page.getByPlaceholder(/ex\.: Maria/i).fill("IdentityTester");
  await page.getByRole("button", { name: /entrar na fila/i }).click();
  await page.getByRole("heading", { name: /adicionar música/i }).waitFor();

  // The uuid used for the (empty, but 200-OK) pending poll must be a valid
  // uuid the whole time — a broken registration flow would leave it empty and
  // the request would 400/never fire.
  const pendingReq = page.waitForRequest((req) => req.url().includes("/api/queue/pending"));
  const req = await pendingReq;
  const url = new URL(req.url());
  expect(url.searchParams.get("uuid")).toMatch(UUID_RE);
});
