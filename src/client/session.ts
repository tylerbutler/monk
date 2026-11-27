import { z } from "zod";
import { sessionCredentialsSchema } from "../shared/protocol";

export const savedSessionSchema = sessionCredentialsSchema.extend({
  leaving: z.boolean().optional(),
  savedAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
});
export type SavedSession = z.infer<typeof savedSessionSchema>;

export function remainingSessionMs(session: SavedSession, now = Date.now()): number | null {
  if (session.expiresAtMs === undefined) return null;
  const savedAtMs = session.savedAtMs ?? now;
  // A large clock rollback makes the saved lifetime unreliable.
  if (now < savedAtMs - 300000) return 0;
  return Math.max(0, Math.min(session.expiresAtMs - now, 86400000 - Math.max(0, now - savedAtMs)));
}
