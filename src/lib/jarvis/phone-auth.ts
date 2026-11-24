import "server-only";
import { checkHealthToken } from "@/lib/jarvis/health/data";
import { decryptDeviceToken } from "@/lib/jwt";
import { isDeviceActive } from "@/lib/jarvis/mobile-devices";

// The iPhone (Shortcuts and the native app) authenticates with the key minted
// at /jarvis/health: "Authorization: Bearer <key>" or "x-health-key: <key>",
// or with a paired-app device token (src/lib/jarvis/mobile-devices.ts).
export async function phoneAuthorised(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const given = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : (req.headers.get("x-health-key") ?? "").trim();
  if (await checkHealthToken(given)) return true;
  // The paired Jarvis app (mobile/) uses its device token for these routes too.
  const device = await decryptDeviceToken(given);
  return !!device && (await isDeviceActive(device.dev));
}
