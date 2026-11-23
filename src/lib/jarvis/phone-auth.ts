import "server-only";
import { checkHealthToken } from "@/lib/jarvis/health/data";

// The iPhone (Shortcuts and the native app) authenticates with the key minted
// at /jarvis/health: "Authorization: Bearer <key>" or "x-health-key: <key>".
export async function phoneAuthorised(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const given = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : (req.headers.get("x-health-key") ?? "").trim();
  return checkHealthToken(given);
}
