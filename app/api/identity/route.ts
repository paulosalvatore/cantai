import { NextRequest, NextResponse } from "next/server";
import { applyIdentityCookie, resolveIdentity } from "@/lib/identity";

const MAX_BODY_BYTES = 512;

/**
 * POST /api/identity — register or refresh the caller's anonymous identity
 * (TICKET-26). Called from `PatronRoom.tsx` on every mount (fire-and-forget —
 * the join flow never awaits or blocks on this).
 *
 * Body (optional): `{ legacyUuid?: string }` — a pre-existing client-minted
 * `patronUuid` to adopt so an existing patron keeps their identity and their
 * own-row highlighting (continuity, acceptance #2). Malformed/oversized/absent
 * bodies are treated as "no legacy uuid", never a 4xx — this endpoint is not
 * user input validation, it's best-effort continuity.
 *
 * Always replies 200 with `{ uuid, registered }`. `registered: false` means
 * the durable store failed (fail-open, acceptance #4) — the identity cookie is
 * NOT set in that case, so the client keeps using its local-only uuid and this
 * call is safely retried on the next page load (no client-side retry loop
 * needed).
 */
export async function POST(req: NextRequest) {
  let legacyUuid: unknown;
  const raw = await req.text();
  if (raw.length > 0 && raw.length <= MAX_BODY_BYTES) {
    try {
      const body = JSON.parse(raw);
      if (typeof body === "object" && body !== null) {
        legacyUuid = (body as Record<string, unknown>).legacyUuid;
      }
    } catch {
      // Malformed body — proceed as if no legacy uuid was supplied.
    }
  }

  const resolved = await resolveIdentity(req, legacyUuid);
  const res = NextResponse.json({ uuid: resolved.uuid, registered: resolved.ok });
  if (resolved.ok) applyIdentityCookie(res, resolved.uuid);
  return res;
}
