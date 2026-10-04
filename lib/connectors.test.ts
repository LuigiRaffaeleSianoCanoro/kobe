import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RequestContext } from "@mastra/core/request-context";
import {
  USER_TEXT,
  SendConfirm,
  connectorBadge,
  connectorInstructions,
  createConnectorTools,
  createMailbox,
  discoverLiveConnectors,
  handleConnectorSend,
  isExplicitSendConfirm,
  kobeMayCall,
  runKobeConnector,
  sendHeldDraft,
  toolsForConnectedConnectors,
  type GmailClient,
  type SlackClient,
} from "./connectors.ts";

const blocked = ["notion", "linear", "drive", "google-drive", "google_drive", "apify", "luma"];

test("tools are added only for Gmail and Slack when those connectors are on", () => {
  assert.deepEqual(Object.keys(createConnectorTools({ gmail: null, slack: null, mailbox: createMailbox() })), []);
  assert.deepEqual(toolsForConnectedConnectors({ gmail: false, slack: false, luma: true, notion: true, linear: true, drive: true, apify: true }), []);
  assert.deepEqual(toolsForConnectedConnectors({ gmail: true, slack: false, notion: true, luma: true }), ["gmail_search", "gmail_draft", "gmail_send"]);
  assert.deepEqual(toolsForConnectedConnectors({ gmail: false, slack: true, drive: true, apify: true }), ["slack_search", "slack_draft", "slack_send"]);
  assert.deepEqual(toolsForConnectedConnectors({ gmail: true, slack: true }), [
    "gmail_search",
    "gmail_draft",
    "gmail_send",
    "slack_search",
    "slack_draft",
    "slack_send",
  ]);
});

test("Luma stays disconnected and other rows stay soon until a real connector is on", () => {
  assert.equal(connectorBadge("luma", { gmail: true, slack: true }), "soon");
  assert.equal(connectorBadge("gmail", { gmail: false, slack: true }), "soon");
  assert.equal(connectorBadge("gmail", { gmail: true, slack: false }), "on");
  assert.equal(connectorBadge("slack", { gmail: true, slack: false }), "soon");
  assert.equal(connectorBadge("slack", { gmail: false, slack: true }), "on");
  assert.equal(connectorBadge("notion", { gmail: true, slack: true }), "soon");
});

test("a Kobe question cannot call Notion, Linear, Drive, Apify, or Luma", async () => {
  const called: string[] = [];
  for (const id of blocked) {
    assert.equal(kobeMayCall(id), false);
    const result = await runKobeConnector(id, async () => {
      called.push(id);
      return { ok: true as const };
    });
    assert.equal(result.ok, false);
  }
  assert.deepEqual(called, []);
  const gmail = await runKobeConnector("gmail", async () => ({ ok: true as const }));
  assert.equal(gmail.ok, true);
});

test("sending waits for an explicit confirm", () => {
  for (const line of ["send it", "Yes, send it.", "please send the draft", "confirm", "confirm send", "go ahead and send", "yes, send the email"]) {
    assert.equal(isExplicitSendConfirm(line), true, line);
  }
  for (const line of ["Send Maya a birthday email", "Draft a birthday message for Maya", "yes", "search slack for Maya", "send it and also mention the playlist", "Who has a birthday this week?"]) {
    assert.equal(isExplicitSendConfirm(line), false, line);
  }
});

test("instructions keep Luma disconnected and refuse the blocked connectors", () => {
  const text = connectorInstructions({ gmail: true, slack: false });
  assert.match(text, /Luma is not connected/);
  assert.match(text, /Do not call Notion, Linear, Google Drive, or Apify/);
  assert.match(text, /Gmail is connected/);
  assert.match(text, /Slack is not connected/);
  assert.doesNotMatch(text, /notion_search|linear_search|apify_/);
});

test("discovery probes only Gmail and Slack, and only when a token is set", async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    urls.push(String(input));
    return new Response("no", { status: 500 });
  };
  const env = {
    NOTION_TOKEN: "secret",
    LINEAR_API_KEY: "secret",
    APIFY_TOKEN: "secret",
    LUMA_API_KEY: "secret",
    GOOGLE_DRIVE_TOKEN: "secret",
  };
  const none = await discoverLiveConnectors(env, fetchImpl);
  assert.deepEqual(none, { gmail: null, slack: null });
  assert.deepEqual(urls, []);

  const denied = await discoverLiveConnectors({ GMAIL_ACCESS_TOKEN: "gmail-token", SLACK_USER_TOKEN: "xoxp-slack" }, fetchImpl);
  assert.equal(denied.gmail, null);
  assert.equal(denied.slack, null);
  assert.deepEqual(
    urls.map((url) => new URL(url).host),
    ["gmail.googleapis.com", "slack.com"],
  );
  assert.equal(urls.some((url) => /notion|linear|apify|lu\.ma|luma|drive/.test(url)), false);
});

test("a live Gmail client can search and draft, and draft does not send", async () => {
  const calls: { url: string; body?: string; auth?: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined, auth: headers.get("authorization") ?? undefined });
    if (url.endsWith("/profile")) return Response.json({ emailAddress: "me@example.com" });
    if (url.includes("/messages?") && !url.includes("/messages/")) return Response.json({ messages: [{ id: "m1", threadId: "t1" }] });
    if (url.includes("/messages/m1")) {
      return Response.json({
        id: "m1",
        threadId: "t1",
        snippet: "See you at Bunna",
        payload: { headers: [{ name: "From", value: "Maya <maya@example.com>" }, { name: "Subject", value: "Saturday" }, { name: "Date", value: "Oct 4" }] },
      });
    }
    if (url.endsWith("/drafts")) return Response.json({ id: "gd-1" });
    if (url.endsWith("/drafts/send")) return Response.json({ id: "sent-1" });
    return new Response("missing", { status: 404 });
  };
  const { gmail } = await discoverLiveConnectors({ GMAIL_ACCESS_TOKEN: "gmail-token" }, fetchImpl);
  assert.ok(gmail);
  const hits = await gmail.search("from:maya");
  assert.equal(hits[0]?.subject, "Saturday");
  assert.equal(hits[0]?.link, "https://mail.google.com/mail/u/0/#all/t1");
  await gmail.draft({ to: "maya@example.com", subject: "Hello\r\nBcc: evil@example.com", body: "Happy birthday" });
  const draftCall = calls.find((call) => call.url.endsWith("/drafts"));
  const raw = JSON.parse(draftCall?.body ?? "{}").message.raw as string;
  const text = Buffer.from(raw, "base64url").toString("utf8");
  assert.equal(text.includes("\nBcc:"), false);
  assert.match(text, /^To: maya@example.com\r\nSubject: Hello Bcc: evil@example.com\r\n/);
  assert.equal(calls.some((call) => call.url.endsWith("/drafts/send")), false);
  assert.equal(calls.every((call) => call.auth === "Bearer gmail-token" && !call.url.includes("gmail-token")), true);
  await gmail.sendDraft("gd-1");
  assert.equal(calls.some((call) => call.url.endsWith("/drafts/send")), true);
});

test("a live Slack client can search, and search does not post", async () => {
  const methods: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    methods.push(new URL(url).pathname);
    if (url.endsWith("/auth.test")) return Response.json({ ok: true });
    if (url.endsWith("/search.messages")) {
      return Response.json({
        ok: true,
        messages: { matches: [{ username: "maya", text: "the move", ts: "1", channel: { name: "general" }, permalink: "https://kobe.slack.com/archives/C1/p1" }] },
      });
    }
    if (url.endsWith("/chat.postMessage")) return Response.json({ ok: true });
    return Response.json({ ok: false, error: "nope" });
  };
  const { slack } = await discoverLiveConnectors({ SLACK_USER_TOKEN: "xoxp-slack" }, fetchImpl);
  assert.ok(slack);
  const hits = await slack.search("move");
  assert.equal(hits[0]?.user, "maya");
  assert.equal(hits[0]?.channel, "general");
  assert.equal(hits[0]?.link, "https://kobe.slack.com/archives/C1/p1");
  assert.equal(methods.includes("/api/chat.postMessage"), false);
  await slack.send({ channel: "general", text: "On my way" });
  assert.equal(methods.includes("/api/chat.postMessage"), true);
});

test("Gmail and Slack drafts do not send until the user confirms", async () => {
  const calls: string[] = [];
  const gmail: GmailClient = {
    async search() {
      calls.push("gmail-search");
      return [];
    },
    async draft() {
      calls.push("gmail-draft");
      return { draftId: "prov-1" };
    },
    async sendDraft(id) {
      calls.push(`gmail-send:${id}`);
    },
  };
  const slack: SlackClient = {
    async search() {
      calls.push("slack-search");
      return [];
    },
    async send(input) {
      calls.push(`slack-send:${input.channel}`);
    },
  };
  const mailbox = createMailbox();
  const tools = createConnectorTools({ gmail, slack, mailbox });
  assert.deepEqual(Object.keys(tools), ["gmail_search", "gmail_draft", "gmail_send", "slack_search", "slack_draft", "slack_send"]);

  const contextFor = (text: string) => {
    const requestContext = new RequestContext();
    requestContext.setRaw(USER_TEXT, text);
    return { requestContext };
  };
  const gmailDraft = await tools.gmail_draft!.execute!({ to: "maya@example.com", subject: "Hi", body: "Hello" }, contextFor("Draft an email to Maya"));
  assert.equal(gmailDraft.ok, true);
  if (!gmailDraft.ok || !("draftId" in gmailDraft)) return;
  const waiting = await tools.gmail_send!.execute!({ draftId: gmailDraft.draftId }, contextFor("Send Maya a birthday email"));
  assert.equal(waiting.ok, false);
  if (waiting.ok) return;
  assert.equal(waiting.status, "awaiting_confirm");
  assert.deepEqual(calls, ["gmail-draft"]);

  const sent = await tools.gmail_send!.execute!({ draftId: gmailDraft.draftId }, contextFor("send it"));
  assert.equal(sent.ok, true);
  const again = await tools.gmail_send!.execute!({ draftId: gmailDraft.draftId }, contextFor("send it"));
  assert.equal(again.ok, true);
  assert.deepEqual(calls, ["gmail-draft", "gmail-send:prov-1"]);

  const slackDraft = await tools.slack_draft!.execute!({ channel: "general", body: "On my way" }, contextFor("Draft a slack note"));
  assert.equal(slackDraft.ok, true);
  if (!slackDraft.ok || !("draftId" in slackDraft)) return;
  const slackWaiting = await sendHeldDraft({
    draftId: slackDraft.draftId,
    explicitConfirm: false,
    mailbox,
    gmail,
    slack,
    connector: "slack",
  });
  assert.equal(slackWaiting.status, "awaiting_confirm");
  assert.equal(calls.includes("slack-send:#general"), false);
  const slackSent = await sendHeldDraft({ draftId: slackDraft.draftId, explicitConfirm: true, mailbox, gmail, slack, connector: "slack" });
  assert.equal(slackSent.status, "sent");
  assert.equal(calls.filter((call) => call === "slack-send:#general").length, 1);
});

test("the confirm endpoint ignores anything except confirm: true", async () => {
  const id = crypto.randomUUID();
  let calls = 0;
  const denied = await handleConnectorSend({ draftId: id, confirm: false }, async () => {
    calls += 1;
    return { ok: true, status: "sent", draftId: id };
  });
  assert.equal(denied.status, 400);
  assert.equal(denied.body.status, "awaiting_confirm");
  assert.equal(calls, 0);
  assert.equal(SendConfirm.safeParse({ draftId: id, confirm: "true" }).success, false);
  const allowed = await handleConnectorSend({ draftId: id, confirm: true }, async (draftId, confirm) => {
    assert.equal(confirm, true);
    assert.equal(draftId, id);
    calls += 1;
    return { ok: true, status: "sent", draftId };
  });
  assert.equal(allowed.status, 200);
  assert.equal(calls, 1);
});

test("the scripted matcher and the composer send button stay put", () => {
  const matcher = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");
  assert.match(matcher, /function reply\(input: string\)/);
  assert.match(matcher, /This offline demo only knows the sample roster/);
  const app = readFileSync(new URL("../components/kobe-app.tsx", import.meta.url), "utf8");
  assert.match(app, /<ComposerPrimitive\.Send asChild>/);
  assert.match(app, /title="Send"/);
  assert.match(app, /<Ball size=\{46\} line=\{2\} \/>/);
  const agent = readFileSync(new URL("./kobe-agent.ts", import.meta.url), "utf8");
  assert.match(agent, /createConnectorTools/);
  assert.match(agent, /connectorInstructions/);
});
