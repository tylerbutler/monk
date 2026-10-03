import { z } from "zod";

export const factionSchema = z.enum(["rock", "paper", "scissors"]);
export type Faction = z.infer<typeof factionSchema>;
