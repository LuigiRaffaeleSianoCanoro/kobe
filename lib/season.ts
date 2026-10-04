import { z } from "zod";
import { DRAFT_CHANNELS, PLAY_IDS, type PlayId } from "./data";

// XP is decided on the server from the event type, never taken from the request.
export const SeasonEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assist"),
    personId: z.string().min(1).max(64).optional(),
    channel: z.enum(DRAFT_CHANNELS),
    body: z.string().min(1).max(2000),
  }),
  z.object({ type: z.literal("play"), playId: z.enum(PLAY_IDS) }),
]);
export type SeasonEvent = z.infer<typeof SeasonEvent>;

export type Season = {
  xp: number;
  assists: number;
  streak: number;
  activeToday: boolean;
  plays: PlayId[];
  people: Record<string, { rapport: number; last: string }>;
};
