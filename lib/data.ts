export type RecordId = "maya" | "marcus" | "jordan" | "priya" | "dev";

// One person as the agent and every card see them, whether read from Postgres or the seed below.
export type Person = {
  id: string;
  name: string;
  role: string;
  tier: string;
  birthday: string;
  last: string;
  next: string;
  points: string[];
  loop: string;
  sources: string[];
  rapport: number;
};

export type PersonRecord = {
  name: string;
  role: string;
  tier: "STARTING FIVE" | "ROTATION" | "BENCH";
  score: number;
  birthday: string;
  last: string;
  next: string;
  points: string[];
  loop: string;
  sources: string[];
  action: string;
  prompt: string;
};

export const RECORDS: Record<RecordId, PersonRecord> = {
  maya: {
    name: "Maya Chen",
    role: "College roommate",
    tier: "STARTING FIVE",
    score: 82,
    birthday: "Oct 5 · tomorrow · turns 29",
    last: "Instagram DM · 6 weeks ago",
    next: "Nothing scheduled",
    points: ["Moved to Brooklyn in August", "Training for the NYC Half in March", "Favorite spot: Bunna Cafe"],
    loop: "She asked for your running playlist.",
    sources: ["INSTAGRAM", "GMAIL"],
    action: "Draft birthday message",
    prompt: "Draft a birthday message for Maya",
  },
  marcus: {
    name: "Marcus Reid",
    role: "Former manager · mentor",
    tier: "ROTATION",
    score: 74,
    birthday: "Feb 11",
    last: "Fathom call · Sep 12",
    next: "Coffee today 3:30 PM · Blue Bottle",
    points: ["Relocated to Austin in August", "Daughter just started kindergarten", "Thinking about advising early-stage teams"],
    loop: "You promised an intro to Lena Ortiz.",
    sources: ["FATHOM", "GMAIL", "GOOGLE CALENDAR"],
    action: "Brief me again",
    prompt: "Brief me on Marcus",
  },
  jordan: {
    name: "Jordan Blake",
    role: "Friend from rec league",
    tier: "STARTING FIVE",
    score: 88,
    birthday: "Oct 9",
    last: "Partiful RSVP · 4 days ago",
    next: "Dinner Thu 7:00 PM · Nopa",
    points: ["Just adopted a dog named Biscuit", "Tore an ACL in June, back on court now", "Hosting the dinner for 6"],
    loop: "Thursday dinner clashes with Product sync.",
    sources: ["PARTIFUL", "INSTAGRAM"],
    action: "Fix Thursday conflict",
    prompt: "Fix my Thursday conflict",
  },
  priya: {
    name: "Priya Nair",
    role: "Ex-colleague",
    tier: "BENCH",
    score: 61,
    birthday: "Oct 13",
    last: "LinkedIn like · 2 months ago",
    next: "Nothing scheduled",
    points: ["Started as Head of Design at Northwind", "Ran her first marathon last spring", "Prefers voice notes over texts"],
    loop: 'You both said "coffee soon" in July.',
    sources: ["LINKEDIN", "GMAIL"],
    action: "Draft congrats",
    prompt: "Draft congrats to Priya",
  },
  dev: {
    name: "Dev Patel",
    role: "Cousin",
    tier: "STARTING FIVE",
    score: 79,
    birthday: "Jan 22",
    last: "WhatsApp · 9 days ago (unanswered)",
    next: "Family dinner Oct 18",
    points: ["Asked if you can help him move on the 17th", "Started a new job at a robotics lab", "Rooting hard for the home team this season"],
    loop: "Reply about helping him move.",
    sources: ["WHATSAPP", "GOOGLE CALENDAR"],
    action: "Draft reply",
    prompt: "Draft a reply to Dev",
  },
};

export const SEED_ROSTER: Person[] = Object.entries(RECORDS).map(([id, r]) => ({
  id,
  name: r.name,
  role: r.role,
  tier: r.tier,
  birthday: r.birthday,
  last: r.last,
  next: r.next,
  points: r.points,
  loop: r.loop,
  sources: r.sources,
  rapport: r.score,
}));

export const DRAFT_CHANNELS = ["Instagram", "WhatsApp", "LinkedIn", "SMS", "Email"] as const;
export type DraftChannel = (typeof DRAFT_CHANNELS)[number];
export const isDraftChannel = (c: unknown): c is DraftChannel => DRAFT_CHANNELS.includes(c as DraftChannel);

export type FeedItem = {
  at: number;
  kind: string;
  source: string;
  color: string;
  title: string;
  body: string;
  a1?: { label: string; run?: string; record?: RecordId };
  a2?: { label: string; run?: string; record?: RecordId };
};

export const FEED: FeedItem[] = [
  { at: 1400, kind: "BIRTHDAY", source: "INSTAGRAM", color: "#F2B63A", title: "Maya Chen turns 29 tomorrow", body: "You last talked 6 weeks ago. She's been posting from Brooklyn.", a1: { label: "Draft message", run: "Draft a birthday message for Maya" }, a2: { label: "Open record", record: "maya" } },
  { at: 4200, kind: "PREGAME", source: "FATHOM", color: "#9B6CE0", title: "Coffee with Marcus Reid at 3:30", body: "Last call Sep 12. He moved to Austin, and you owe him an intro.", a1: { label: "Brief me", run: "Brief me on Marcus" }, a2: { label: "Snooze" } },
  { at: 8500, kind: "CONFLICT", source: "PARTIFUL × CALENDAR", color: "#E5484D", title: "Double-booked Thursday 7:00 PM", body: "Dinner with Jordan overlaps Product sync.", a1: { label: "Resolve", run: "Fix my Thursday conflict" }, a2: { label: "Keep both" } },
  { at: 15000, kind: "FOLLOW UP", source: "WHATSAPP", color: "#E0712A", title: "Dev hasn't heard back in 9 days", body: "He asked if you can help him move on the 17th.", a1: { label: "Draft reply", run: "Draft a reply to Dev" }, a2: { label: "Open record", record: "dev" } },
  { at: 24000, kind: "LIFE UPDATE", source: "LINKEDIN", color: "#3DBE8B", title: "Priya Nair started a new role", body: 'Head of Design at Northwind. You said "coffee soon" in July.', a1: { label: "Congratulate", run: "Draft congrats to Priya" }, a2: { label: "Open record", record: "priya" } },
];

export type SourceItem = { id: string; name: string; mono: string; desc: string };

export const SOURCE_GROUPS: { name: string; items: SourceItem[] }[] = [
  {
    name: "SOCIAL",
    items: [
      { id: "instagram", name: "Instagram", mono: "IG", desc: "DMs, stories, birthdays" },
      { id: "linkedin", name: "LinkedIn", mono: "IN", desc: "Job changes and posts" },
      { id: "x", name: "X", mono: "X", desc: "Mentions and DMs" },
      { id: "facebook", name: "Facebook", mono: "FB", desc: "Birthdays and events" },
    ],
  },
  {
    name: "MEETING RECORDINGS",
    items: [
      { id: "fathom", name: "Fathom", mono: "FA", desc: "Call recordings and notes" },
      { id: "zoom", name: "Zoom", mono: "ZM", desc: "Meetings and transcripts" },
      { id: "meet", name: "Google Meet", mono: "GM", desc: "Transcripts and attendees" },
    ],
  },
  {
    name: "MAIL & CALENDAR",
    items: [
      { id: "gmail", name: "Gmail", mono: "GM", desc: "Threads and contacts" },
      { id: "gcal", name: "Google Calendar", mono: "GC", desc: "Events and invites" },
    ],
  },
  {
    name: "EVENTS",
    items: [
      { id: "partiful", name: "Partiful", mono: "PA", desc: "Parties and RSVPs" },
      { id: "luma", name: "Luma", mono: "LU", desc: "Events and guest lists" },
    ],
  },
];

export const ENGINE = [
  { name: "assistant-ui", job: "Chat runtime + tool cards" },
  { name: "Mastra", job: "Agent loop + tools" },
  { name: "Neon AI Gateway", job: "Model in live mode" },
  { name: "Postgres", job: "Roster + season stats" },
];

export const CHANNELS = [
  { id: "telegram", name: "Telegram", mono: "TG", desc: "Chat with Kobe in a DM" },
  { id: "whatsapp", name: "WhatsApp", mono: "WA", desc: "Briefs and nudges by message" },
  { id: "slack", name: "Slack", mono: "SL", desc: "/kobe in your workspace" },
  { id: "discord", name: "Discord", mono: "DC", desc: "/kobe brief @name" },
];

export const ASSIST_XP = 15;

export const PLAY_IDS = ["maya", "marcus", "dev"] as const;
export type PlayId = (typeof PLAY_IDS)[number];

export const PLAYS: { id: PlayId; label: string; xp: number }[] = [
  { id: "maya", label: "Wish Maya a happy birthday", xp: 35 },
  { id: "marcus", label: "Pregame before coffee with Marcus", xp: 20 },
  { id: "dev", label: "Get back to Dev about the move", xp: 35 },
];

export const LEVELS = [
  { name: "ROOKIE", min: 0 },
  { name: "STARTER", min: 100 },
  { name: "ALL-STAR", min: 250 },
  { name: "MVP", min: 450 },
  { name: "MAMBA", min: 700 },
];

export function promptForPerson(id: string, name: string): string {
  if (id in RECORDS) return RECORDS[id as RecordId].prompt;
  const first = name.trim().split(/\s+/)[0] || name;
  return `Draft a check-in for ${first}`;
}

export function levelFor(xp: number) {
  let i = 0;
  while (i < LEVELS.length - 1 && xp >= LEVELS[i + 1].min) i++;
  const cur = LEVELS[i];
  const next = LEVELS[i + 1];
  const progress = next ? (xp - cur.min) / (next.min - cur.min) : 1;
  return { index: i, name: cur.name, next: next?.name ?? null, toNext: next ? next.min - xp : 0, progress };
}
