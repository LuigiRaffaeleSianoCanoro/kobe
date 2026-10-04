export type SourceItem = [id: string, name: string, mono: string, desc: string];

export type Channel = {
  id: string;
  name: string;
  mono: string;
  handle: string;
  hasCode: boolean;
  cta: string;
  steps: string[];
};

export type AlertAction = { label: string; run?: string; record?: string; personId?: string };

export type FeedItem = {
  at: number;
  kind: string;
  source: string;
  color: string;
  title: string;
  body: string;
  a1?: AlertAction;
  a2?: AlertAction;
  auto?: boolean;
};

export const D = {
  groups: [
    { name: "SOCIAL", items: [["instagram", "Instagram", "IG", "DMs, stories, birthdays"], ["linkedin", "LinkedIn", "IN", "Job changes and posts"], ["x", "X", "X", "Mentions and DMs"], ["facebook", "Facebook", "FB", "Birthdays and events"], ["threads", "Threads", "TH", "Replies and mentions"], ["tiktok", "TikTok", "TT", "DMs and shares"]] as SourceItem[] },
    { name: "MEETING RECORDINGS", items: [["fathom", "Fathom", "FA", "Call recordings and notes"], ["zoom", "Zoom", "ZM", "Meetings and transcripts"], ["meet", "Google Meet", "GM", "Transcripts and attendees"], ["otter", "Otter", "OT", "Notes and highlights"]] as SourceItem[] },
    { name: "MAIL & CALENDAR", items: [["gmail", "Gmail", "GM", "Threads and contacts"], ["gcal", "Google Calendar", "GC", "Events and invites"], ["outlook", "Outlook", "OL", "Mail and calendar"], ["icloud", "iCloud Contacts", "IC", "Birthdays and addresses"]] as SourceItem[] },
    { name: "EVENTS", items: [["partiful", "Partiful", "PA", "Parties and RSVPs"], ["luma", "Luma", "LU", "Events and guest lists"], ["eventbrite", "Eventbrite", "EB", "Tickets and events"], ["calendly", "Calendly", "CA", "Bookings"]] as SourceItem[] },
  ],
  channels: [
    { id: "telegram", name: "Telegram", mono: "TG", handle: "@KobeAgentBot", hasCode: true, cta: "I've sent the code", steps: ["Open @KobeAgentBot in Telegram", "Send the pairing code below", "Kobe confirms and starts answering in your DMs"] },
    { id: "whatsapp", name: "WhatsApp", mono: "WA", handle: "+1 415 555 0142", hasCode: true, cta: "I've sent the code", steps: ["Save Kobe as a contact", "Send the pairing code on WhatsApp", "Forward any chat to Kobe for context"] },
    { id: "teams", name: "Microsoft Teams", mono: "MT", handle: "Kobe for Teams", hasCode: false, cta: "Install app", steps: ["Approve the Kobe app in your tenant", "Pin Kobe to your Teams sidebar", "Kobe reads invites and chats you share"] },
    { id: "slack", name: "Slack", mono: "SL", handle: "Add to workspace", hasCode: false, cta: "Add to Slack", steps: ["Pick a workspace", "Approve access to DMs and channels you choose", "Message @kobe in any thread"] },
    { id: "discord", name: "Discord", mono: "DC", handle: "Invite to server", hasCode: false, cta: "Invite Kobe", steps: ["Choose a server you manage", "Grant read access in selected channels", "Use /kobe brief @name anywhere"] },
  ] as Channel[],
  feed: [
    { at: 1400, kind: "BIRTHDAY", source: "INSTAGRAM", color: "#F2B63A", title: "Maya Chen turns 29 tomorrow", body: "You last talked 6 weeks ago. She's been posting from Brooklyn.", a1: { label: "Draft message", run: "Draft a birthday message for Maya" }, a2: { label: "Open record", record: "maya" } },
    { at: 4200, kind: "PREGAME", source: "FATHOM", color: "#9B6CE0", title: "Coffee with Marcus Reid at 3:30", body: "Last call Sep 12. He moved to Austin, and you owe him an intro.", a1: { label: "Brief me", run: "Brief me on Marcus", personId: "marcus" }, a2: { label: "Snooze" } },
    { at: 8500, kind: "CONFLICT", source: "PARTIFUL × CALENDAR", color: "#E5484D", title: "Double-booked Thursday 7:00 PM", body: "Dinner with Jordan overlaps Product sync.", a1: { label: "Resolve", run: "Fix my Thursday conflict" }, a2: { label: "Keep both" } },
    { at: 15000, kind: "FOLLOW UP", source: "WHATSAPP", color: "#E0712A", title: "Dev hasn't heard back in 9 days", body: "He asked if you can help him move on the 17th.", a1: { label: "Draft reply", run: "Draft a reply to Dev" }, a2: { label: "Open record", record: "dev" } },
    { at: 24000, kind: "LIFE UPDATE", source: "LINKEDIN", color: "#3DBE8B", title: "Priya Nair started a new role", body: 'Head of Design at Northwind. You said "coffee soon" in July.', a1: { label: "Congratulate", run: "Draft congrats to Priya" }, a2: { label: "Open record", record: "priya" } },
  ] as FeedItem[],
};

export const CHIPS = [
  "Who has a birthday this week?",
  "Brief me on Marcus",
  "Any conflicts this week?",
  "Who haven't I talked to lately?",
];

export const VOICE_LINES = [
  "Who should I check in with this week?",
  "Brief me on Marcus before coffee",
  "Any birthdays coming up?",
  "Do I have conflicts on Thursday?",
];

export const PAIR_CODE = "KB-4821";
export const INITIAL_SOURCES: Record<string, boolean> = { gmail: true, gcal: true, instagram: true, fathom: true };
