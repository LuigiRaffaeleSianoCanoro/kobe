# Kobe.ai

A personal agent that treats the people you love like your starting five. The goal: never miss a birthday, double-book a night, or walk into a conversation cold.

Built for the Build Personal Agents Hack. MIT licensed, every dependency is open source, and it runs on your own machine.

## What works today

The home page is the courtside chat, the season meters, and the roster.

- **Chat with Kobe** built on [assistant-ui](https://www.assistant-ui.com) primitives. Replies stream in and render tool calls as cards: people lists, pregame briefs, message drafts, and schedule conflicts.
- **Live agent.** With Neon AI Gateway credentials, the composer sends the thread to `/api/chat`, which runs a [Mastra](https://mastra.ai) agent over your roster.
- **Roster.** Roster lists everyone Kobe knows. Add person creates a record, and Edit record changes it. Empty fields stay empty. With `DATABASE_URL`, that write goes to Postgres, so the live agent and the season log see the same person. Without a database, the roster stays in this browser.
- **Message drafts you send yourself.** Copying a draft does not send it. Gmail and Slack can search and draft when those accounts are connected. Sending either one waits until you explicitly confirm, and a draft created in the same turn cannot be sent. With Postgres, rapport goes up only after the database accepts the save. If it rejects the save, the page says the record was not saved.
- **Season mode.** XP, levels (Rookie → Mamba), a streak of consecutive active days, assists for every draft you log, and a three-play game plan per day. The meters sit in the header from 1024px up and follow the header when it wraps.
- **Game plan you set.** From chat or the game-plan panel, set a trigger or a routine on a person already in the roster. A trigger reads a birthday, last touch, next plan, or open loop already on that record. A routine is a daily or weekly check-in. With Postgres it is stored in `plans` on that person. Without a database it is stored in this browser. Setting one does not connect an inbox, calendar, or social account.
- **Scouting reports** per person with a rapport score that rises as you keep in touch.
- **Postgres (optional).** The roster and season stats persist in Postgres. Without a database, season stats stay in memory for the session and the roster stays in the browser.

## What is sample data

The scouting feed, the calendar, and the five people in the seed roster are a scripted demo. The feed is a fixed list of alerts in `lib/data.ts` that appear on a timer after the page loads. The calendar is a constant in `lib/roster.ts`. The Integrations and "Add Kobe to…" panels list planned sources and channels. Gmail and Slack show as connected only after their tokens answer a live probe. Luma stays disconnected. Kobe does not call Notion, Linear, Drive, or Apify.

## The agent

Kobe is a Mastra agent (`lib/kobe-agent.ts`) served from `/api/chat` and streamed into assistant-ui as an AI SDK v7 UI message stream. It reasons over the roster (from Postgres, or the seed when there is no database) and the sample calendar, and answers by calling one of four tools: `show_people`, `pregame_brief`, `draft_message`, `resolve_conflict`. With Postgres, the page and the agent read the same `people` table, so a person you add is who the cards and the next reply see. When Gmail or Slack is really connected, the agent also gets that account's search and draft tools. Send tools do nothing until the latest message is an explicit confirmation, or you confirm on the draft card. A draft created in the same turn cannot be sent.

There is no agent memory. The browser sends the whole thread with each message.

The model comes from the [Neon AI Gateway](https://neon.com/docs/ai-gateway/overview). The default is `gpt-oss-120b`, an open-weight model, so you can later point the same agent at a self-hosted OpenAI-compatible server running the same weights. Pick another model in the catalog with `KOBE_MODEL`.

## Run it

```bash
pnpm install
pnpm dev
```

That starts the app. For the live agent or persistence, copy `env.local.template` to `.env.local` (with the leading dot) and fill in what you need:

```bash
# Any Postgres 15+ (Neon, Supabase, or the one in docker-compose.yml)
DATABASE_URL="postgresql://..."
# Neon Console → Connect → AI Gateway
NEON_AI_GATEWAY_TOKEN="nt_live_..."
NEON_AI_GATEWAY_BASE_URL="https://<branch>-api.ai.<cell>.<region>.aws.neon.tech"
# Optional, defaults to neon/gpt-oss-120b
KOBE_MODEL="neon/gpt-oss-120b"
# Optional. Leave blank and Gmail or Slack stays disconnected.
GMAIL_ACCESS_TOKEN=""
SLACK_USER_TOKEN=""
```

`pnpm dev` is the Next app. Its chat stays on `/api/chat`. `pnpm dev:vite` is the Vite court. It reads the gateway token, base URL, model, and `KOBE_PASSWORD` from that same `.env.local` inside the Node process. The browser bundle does not receive the token.

Then load the schema. It is safe to re-run after pulling changes:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

## Import a WhatsApp chat

With Postgres set up, Kobe can store a WhatsApp chat on the matching person's record. Export the chat without media and keep the file name WhatsApp gives it:

- **iPhone:** open the chat, tap the name at the top, then Export Chat → Without Media. You get a `.zip`.
- **Android:** open the chat, then ⋮ → More → Export chat → Without media. You get a `.txt`.

In the app, drop the file on the chat, pick it with the paperclip next to the message box, or open Integrations → WhatsApp → Import a chat. The server parses and stores it, and Kobe answers with a card that links to the person's scouting report. From a terminal:

```bash
pnpm import:whatsapp "WhatsApp Chat - Valentina Ríos.zip"
```

It prints how many messages it stored, for whom, and the date range. Importing the same export again stores nothing new. A 1:1 chat goes onto the person with that name, and if nobody matches, Kobe adds them as "New from WhatsApp" for you to review. In a group chat, only senders already in your people are linked.

Set `KOBE_OWNER_NAME` in `.env.local` to your name as WhatsApp shows it, or pass `--owner "Your Name"`, so your own messages are marked as yours. Times are read as `America/Argentina/Buenos_Aires` unless you set `KOBE_TIME_ZONE` or pass `--tz`. Photos and other media are not imported.

## Access

`/api/chat` spends your gateway credits, and `/api/season` and `/api/imports` read and write your records. A production server (`next start` or Docker) only serves them when `KOBE_PASSWORD` is set, and then asks for that password in the browser before showing anything. Without `KOBE_PASSWORD`, production serves the sample roster and never touches the database or the gateway. `pnpm dev` stays open, so keep it on your own machine.

## Self-host

```bash
KOBE_PASSWORD=choose-one docker compose up --build
```

That starts Postgres 17 with the schema preloaded and the app on http://localhost:3000. Sign in with any username and your `KOBE_PASSWORD`. Postgres is only reachable from the app container. Set `POSTGRES_PASSWORD` the first time you start it if anyone else can reach the machine.

## Stack

| Piece | License |
| --- | --- |
| Next.js | MIT |
| assistant-ui | MIT |
| Mastra | Apache-2.0 |
| AI SDK | Apache-2.0 |
| Motion | MIT |
| Paper Shaders | Apache-2.0 |
| postgres.js | Unlicense |
| Postgres / Neon | PostgreSQL / Apache-2.0 |
