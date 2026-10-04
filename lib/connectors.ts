import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// Connectors Kobe may use. Anything else — including Luma, Notion, Linear, Drive, and Apify — is refused.
const ALLOWED = new Set(["gmail", "slack"]);

export type ConnectorFlags = { gmail: boolean; slack: boolean };

export type GmailHit = { id: string; threadId: string; from: string; subject: string; date: string; snippet: string; link: string };
export type SlackHit = { channel: string; user: string; text: string; when: string; link: string | null };

export type GmailClient = {
  search(query: string): Promise<GmailHit[]>;
  draft(input: { to: string; subject: string; body: string }): Promise<{ draftId: string }>;
  sendDraft(draftId: string): Promise<void>;
};

export type SlackClient = {
  search(query: string): Promise<SlackHit[]>;
  send(input: { channel: string; text: string }): Promise<void>;
};

export type LiveConnectors = { gmail: GmailClient | null; slack: SlackClient | null };

const USER_TEXT = "userText";
const GMAIL_TOOLS = ["gmail_search", "gmail_draft", "gmail_send"] as const;
const SLACK_TOOLS = ["slack_search", "slack_draft", "slack_send"] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DRAFT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const SendConfirm = z.object({
  draftId: z.string().regex(DRAFT_ID),
  confirm: z.literal(true),
});

type HeldDraft = {
  id: string;
  connector: "gmail" | "slack";
  body: string;
  to?: string;
  subject?: string;
  channel?: string;
  providerDraftId?: string;
  sent: boolean;
  sending: boolean;
};

export type Mailbox = {
  put(draft: HeldDraft): HeldDraft;
  get(id: string): HeldDraft | undefined;
};

export type SendResult =
  | { ok: true; status: "sent"; draftId: string }
  | { ok: false; status: "awaiting_confirm"; error: string; draftId?: string }
  | { ok: false; status: "missing_draft"; error: string }
  | { ok: false; status: "failed"; error: string; draftId?: string };

type ConfirmContext = { requestContext?: { getRaw?: (key: string) => unknown } };

export function createMailbox(): Mailbox {
  const drafts = new Map<string, HeldDraft>();
  return {
    put(draft) {
      drafts.set(draft.id, draft);
      return draft;
    },
    get(id) {
      return drafts.get(id);
    },
  };
}

export const connectorMailbox = createMailbox();

export function kobeMayCall(connectorId: string): boolean {
  return ALLOWED.has(connectorId);
}

export function toolsForConnectedConnectors(connected: Record<string, boolean | undefined>): string[] {
  const names: string[] = [];
  if (connected.gmail === true) names.push(...GMAIL_TOOLS);
  if (connected.slack === true) names.push(...SLACK_TOOLS);
  return names;
}

export function connectorBadge(id: string, connected: ConnectorFlags): "on" | "soon" {
  if (id === "luma") return "soon";
  if (id === "gmail" && connected.gmail) return "on";
  if (id === "slack" && connected.slack) return "on";
  return "soon";
}

// The whole message has to be the confirmation. "Send Maya a birthday email" is a request to draft, not a confirm.
export function isExplicitSendConfirm(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!]+$/g, "").replace(/\s+/g, " ");
  if (!normalized || normalized.length > 80) return false;
  return /^(?:yes,? )?(?:please )?(?:go ahead and )?send(?: it| this| the draft| the email| the message| the slack message| the gmail draft)?$|^(?:yes,? )?confirm(?: send)?$/.test(normalized);
}

export function connectorInstructions(flags: ConnectorFlags): string {
  const lines = [
    "Luma is not connected. Never say you checked Luma.",
    "Do not call Notion, Linear, Google Drive, or Apify for a Kobe question. You have no tools for them.",
  ];
  if (flags.gmail) {
    lines.push(
      'Gmail is connected. Use gmail_search to look up mail and gmail_draft to create a draft. Neither one sends. Call gmail_send only when the user\'s latest message is an explicit confirmation such as "send it" or "confirm send". Otherwise it waits. Never say an email was sent unless gmail_send returns status "sent".',
    );
  } else {
    lines.push("Gmail is not connected. Do not claim you searched or drafted email.");
  }
  if (flags.slack) {
    lines.push(
      'Slack is connected. Use slack_search to look up messages and slack_draft to hold a message. Neither one posts it. Call slack_send only when the user\'s latest message is an explicit confirmation such as "send it" or "confirm send". Otherwise it waits. Never say a Slack message was sent unless slack_send returns status "sent".',
    );
  } else {
    lines.push("Slack is not connected. Do not claim you searched or drafted Slack.");
  }
  return lines.join("\n");
}

export async function runKobeConnector<T>(id: string, run: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  if (!kobeMayCall(id)) return { ok: false, error: "Kobe doesn't call that connector." };
  return run();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  if (/bearer|token|ya29|xox[pabrs]-/i.test(message)) return fallback;
  return message.slice(0, 200) || fallback;
}

function explicitConfirmFrom(context: ConfirmContext | undefined): boolean {
  const userText = context?.requestContext?.getRaw?.(USER_TEXT);
  return typeof userText === "string" && isExplicitSendConfirm(userText);
}

class ConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorError";
  }
}

async function guarded<T extends { ok: boolean }>(id: string, run: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await runKobeConnector(id, run);
  } catch (error) {
    return { ok: false, error: safeError(error, "That connector call failed.") };
  }
}

function searchQuery(value: string): string | null {
  const query = value.trim().replace(/\s+/g, " ");
  if (!query || query.length > 500) return null;
  return query;
}

function slackChannel(value: string): string | null {
  const trimmed = value.trim();
  if (/^[CDGUW][A-Z0-9]{8,}$/.test(trimmed)) return trimmed;
  if (/^[#@][A-Za-z0-9._-]{1,80}$/.test(trimmed)) return trimmed;
  if (/^[A-Za-z0-9._-]{1,80}$/.test(trimmed)) return `#${trimmed}`;
  return null;
}

function safeSlackLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "slack.com" && !url.hostname.endsWith(".slack.com")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function headerValue(payload: unknown, name: string): string {
  if (!isRecord(payload) || !Array.isArray(payload.headers)) return "";
  const found = payload.headers.find((item) => isRecord(item) && String(item.name).toLowerCase() === name.toLowerCase());
  return found && isRecord(found) && typeof found.value === "string" ? found.value.slice(0, 300) : "";
}

function encodeRaw(message: { to: string; subject: string; body: string }) {
  const subject = message.subject.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  const encoded = /^[\x20-\x7E]*$/.test(subject) ? subject : `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
  const raw = [`To: ${message.to}`, `Subject: ${encoded}`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "", message.body.slice(0, 8000)].join("\r\n");
  return Buffer.from(raw, "utf8").toString("base64url");
}

async function gmailApi(token: string, fetchImpl: typeof fetch, url: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const parsed = await res.json().catch(() => null);
  if (!res.ok || !isRecord(parsed)) throw new ConnectorError(`Gmail returned ${res.status}.`);
  return parsed;
}

function createGmailClient(token: string, fetchImpl: typeof fetch): GmailClient {
  return {
    async search(query) {
      const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
      listUrl.searchParams.set("q", query);
      listUrl.searchParams.set("maxResults", "5");
      const list = await gmailApi(token, fetchImpl, listUrl.toString());
      const messages = Array.isArray(list.messages) ? list.messages.filter(isRecord).slice(0, 5) : [];
      const hits = await Promise.all(
        messages.map(async (message) => {
          const id = typeof message.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(message.id) ? message.id : "";
          if (!id) return null;
          const metaUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
          metaUrl.searchParams.set("format", "metadata");
          for (const name of ["Subject", "From", "Date"]) metaUrl.searchParams.append("metadataHeaders", name);
          const meta = await gmailApi(token, fetchImpl, metaUrl.toString());
          const threadId = typeof meta.threadId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(meta.threadId) ? meta.threadId : id;
          return {
            id,
            threadId,
            from: headerValue(meta.payload, "From"),
            subject: headerValue(meta.payload, "Subject"),
            date: headerValue(meta.payload, "Date"),
            snippet: typeof meta.snippet === "string" ? meta.snippet.slice(0, 240) : "",
            link: `https://mail.google.com/mail/u/0/#all/${threadId}`,
          };
        }),
      );
      return hits.filter((hit): hit is GmailHit => !!hit);
    },
    async draft(input) {
      const to = input.to.trim();
      if (!EMAIL.test(to)) throw new ConnectorError("That needs a real email address.");
      const created = await gmailApi(token, fetchImpl, "https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
        message: { raw: encodeRaw({ to, subject: input.subject, body: input.body }) },
      });
      if (typeof created.id !== "string" || !created.id) throw new ConnectorError("Gmail didn't create a draft.");
      return { draftId: created.id };
    },
    async sendDraft(draftId) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(draftId)) throw new ConnectorError("That Gmail draft isn't valid.");
      await gmailApi(token, fetchImpl, "https://gmail.googleapis.com/gmail/v1/users/me/drafts/send", { id: draftId });
    },
  };
}

async function slackApi(token: string, fetchImpl: typeof fetch, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetchImpl(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(params),
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !isRecord(body) || body.ok !== true) {
    const code = isRecord(body) && typeof body.error === "string" && /^[a-z0-9_]+$/.test(body.error) ? body.error : "error";
    throw new ConnectorError(`Slack couldn't complete that (${code}).`);
  }
  return body;
}

function createSlackClient(token: string, fetchImpl: typeof fetch): SlackClient {
  return {
    async search(query) {
      const body = await slackApi(token, fetchImpl, "search.messages", { query, count: 5, sort: "timestamp" });
      const messages = isRecord(body.messages) && Array.isArray(body.messages.matches) ? body.messages.matches.filter(isRecord).slice(0, 5) : [];
      return messages.map((match) => ({
        channel: isRecord(match.channel) && typeof match.channel.name === "string" ? match.channel.name : "",
        user: typeof match.username === "string" ? match.username : typeof match.user === "string" ? match.user : "",
        text: typeof match.text === "string" ? match.text.slice(0, 400) : "",
        when: typeof match.ts === "string" ? match.ts : "",
        link: safeSlackLink(match.permalink),
      }));
    },
    async send(input) {
      const channel = slackChannel(input.channel);
      if (!channel) throw new ConnectorError("That needs a Slack channel or person id.");
      await slackApi(token, fetchImpl, "chat.postMessage", { channel, text: input.text.slice(0, 4000) });
    },
  };
}

async function connectGmail(token: string, fetchImpl: typeof fetch): Promise<GmailClient | null> {
  try {
    const res = await fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !isRecord(body) || typeof body.emailAddress !== "string") return null;
    return createGmailClient(token, fetchImpl);
  } catch (error) {
    console.error("[kobe] Gmail is not connected", safeError(error, "probe failed"));
    return null;
  }
}

async function connectSlack(token: string, fetchImpl: typeof fetch): Promise<SlackClient | null> {
  try {
    const res = await fetchImpl("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !isRecord(body) || body.ok !== true) return null;
    return createSlackClient(token, fetchImpl);
  } catch (error) {
    console.error("[kobe] Slack is not connected", safeError(error, "probe failed"));
    return null;
  }
}

export async function discoverLiveConnectors(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<LiveConnectors> {
  const gmailToken = env.GMAIL_ACCESS_TOKEN?.trim() ?? "";
  const slackToken = env.SLACK_USER_TOKEN?.trim() ?? "";
  const [gmail, slack] = await Promise.all([
    gmailToken ? connectGmail(gmailToken, fetchImpl) : Promise.resolve(null),
    slackToken ? connectSlack(slackToken, fetchImpl) : Promise.resolve(null),
  ]);
  return { gmail, slack };
}

let cached: { at: number; value: LiveConnectors } | null = null;

export async function liveConnectors(): Promise<LiveConnectors> {
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  const value = await discoverLiveConnectors();
  cached = { at: Date.now(), value };
  return value;
}

export async function connectorFlags(): Promise<ConnectorFlags> {
  try {
    const live = await liveConnectors();
    return { gmail: live.gmail !== null, slack: live.slack !== null };
  } catch (error) {
    console.error("[kobe] connector probe failed", safeError(error, "probe failed"));
    return { gmail: false, slack: false };
  }
}

export async function sendHeldDraft(input: {
  draftId: string;
  explicitConfirm: boolean;
  mailbox: Mailbox;
  gmail: GmailClient | null;
  slack: SlackClient | null;
  connector?: "gmail" | "slack";
}): Promise<SendResult> {
  const draft = input.mailbox.get(input.draftId);
  if (!draft || (input.connector && draft.connector !== input.connector)) return { ok: false, status: "missing_draft", error: "That draft isn't here." };
  if (draft.sent) return { ok: true, status: "sent", draftId: draft.id };
  if (input.explicitConfirm !== true) {
    return { ok: false, status: "awaiting_confirm", error: "Sending waits for an explicit confirm.", draftId: draft.id };
  }
  if (draft.sending) return { ok: false, status: "awaiting_confirm", error: "Already sending.", draftId: draft.id };
  draft.sending = true;
  try {
    const outcome = await runKobeConnector(draft.connector, async () => {
      if (draft.connector === "gmail") {
        if (!input.gmail || !draft.providerDraftId) throw new ConnectorError("Gmail isn't connected.");
        await input.gmail.sendDraft(draft.providerDraftId);
      } else {
        if (!input.slack || !draft.channel) throw new ConnectorError("Slack isn't connected.");
        await input.slack.send({ channel: draft.channel, text: draft.body });
      }
      return { ok: true as const };
    });
    if (!outcome.ok) return { ok: false, status: "failed", error: outcome.error, draftId: draft.id };
    draft.sent = true;
    return { ok: true, status: "sent", draftId: draft.id };
  } catch (error) {
    const message = safeError(error, "Couldn't send.");
    console.error("[kobe] connector send failed", message);
    return { ok: false, status: "failed", error: message, draftId: draft.id };
  } finally {
    draft.sending = false;
  }
}

export async function sendConnectorDraft(draftId: string, explicitConfirm: boolean): Promise<SendResult> {
  const live = await liveConnectors();
  return sendHeldDraft({ draftId, explicitConfirm, mailbox: connectorMailbox, gmail: live.gmail, slack: live.slack });
}

export async function handleConnectorSend(body: unknown, send: (draftId: string, explicitConfirm: boolean) => Promise<SendResult> = sendConnectorDraft): Promise<{ status: number; body: SendResult }> {
  const parsed = SendConfirm.safeParse(body);
  if (!parsed.success) {
    return { status: 400, body: { ok: false, status: "awaiting_confirm", error: "Sending waits for an explicit confirm." } };
  }
  const result = await send(parsed.data.draftId, true);
  const status = result.ok ? 200 : result.status === "missing_draft" ? 404 : result.status === "failed" ? 502 : 409;
  return { status, body: result };
}

export function createConnectorTools(input: { gmail: GmailClient | null; slack: SlackClient | null; mailbox: Mailbox }) {
  const tools: Record<string, ReturnType<typeof createTool>> = {};
  const { gmail, slack, mailbox } = input;

  if (gmail) {
    tools.gmail_search = createTool({
      id: "gmail_search",
      description: "Search the connected Gmail account. Does not send mail.",
      inputSchema: z.object({ query: z.string().describe("Gmail search, such as from:maya newer_than:30d") }),
      execute: async ({ query }) => {
        const q = searchQuery(query);
        if (!q) return { ok: false, error: "That search needs a short query." };
        return guarded("gmail", async () => ({ ok: true as const, query: q, hits: await gmail.search(q) }));
      },
    });
    tools.gmail_draft = createTool({
      id: "gmail_draft",
      description: "Create a Gmail draft. Does not send it.",
      inputSchema: z.object({
        to: z.string().describe("Recipient email address"),
        subject: z.string(),
        body: z.string().describe("Plain text body. No Markdown."),
      }),
      execute: async ({ to, subject, body }) => {
        const address = to.trim();
        if (!EMAIL.test(address)) return { ok: false, error: "That needs a real email address." };
        return guarded("gmail", async () => {
          const created = await gmail.draft({ to: address, subject, body });
          const draft = mailbox.put({
            id: crypto.randomUUID(),
            connector: "gmail",
            body,
            to: address,
            subject,
            providerDraftId: created.draftId,
            sent: false,
            sending: false,
          });
          return { ok: true as const, status: "draft" as const, draftId: draft.id, to: address, subject, body };
        });
      },
    });
    tools.gmail_send = createTool({
      id: "gmail_send",
      description: 'Send a Gmail draft created by gmail_draft. Waits unless the user\'s latest message is an explicit confirmation such as "send it".',
      inputSchema: z.object({ draftId: z.string().describe("draftId returned by gmail_draft") }),
      execute: async ({ draftId }, context) =>
        sendHeldDraft({ draftId, explicitConfirm: explicitConfirmFrom(context), mailbox, gmail, slack, connector: "gmail" }),
    });
  }

  if (slack) {
    tools.slack_search = createTool({
      id: "slack_search",
      description: "Search the connected Slack workspace. Does not post a message.",
      inputSchema: z.object({ query: z.string().describe("Slack search, such as from:@maya move") }),
      execute: async ({ query }) => {
        const q = searchQuery(query);
        if (!q) return { ok: false, error: "That search needs a short query." };
        return guarded("slack", async () => ({ ok: true as const, query: q, hits: await slack.search(q) }));
      },
    });
    tools.slack_draft = createTool({
      id: "slack_draft",
      description: "Hold a Slack message as a draft. Does not post it.",
      inputSchema: z.object({
        channel: z.string().describe("Channel id, @user id, or #channel"),
        body: z.string().describe("Message text"),
      }),
      execute: async ({ channel, body }) => {
        const target = slackChannel(channel);
        if (!target) return { ok: false, error: "That needs a Slack channel or person id." };
        if (!body.trim()) return { ok: false, error: "The draft needs some text." };
        return guarded("slack", async () => {
          const draft = mailbox.put({
            id: crypto.randomUUID(),
            connector: "slack",
            body: body.slice(0, 4000),
            channel: target,
            sent: false,
            sending: false,
          });
          return { ok: true as const, status: "draft" as const, draftId: draft.id, channel: target, body: draft.body };
        });
      },
    });
    tools.slack_send = createTool({
      id: "slack_send",
      description: 'Post a Slack draft created by slack_draft. Waits unless the user\'s latest message is an explicit confirmation such as "send it".',
      inputSchema: z.object({ draftId: z.string().describe("draftId returned by slack_draft") }),
      execute: async ({ draftId }, context) =>
        sendHeldDraft({ draftId, explicitConfirm: explicitConfirmFrom(context), mailbox, gmail, slack, connector: "slack" }),
    });
  }

  return tools;
}

export { USER_TEXT };
