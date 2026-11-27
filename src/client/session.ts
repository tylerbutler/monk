import { z } from "zod";
import { sessionCredentialsSchema } from "../shared/protocol";

export const savedSessionSchema = sessionCredentialsSchema.extend({
  leaving: z.boolean().optional(),
});
export type SavedSession = z.infer<typeof savedSessionSchema>;
