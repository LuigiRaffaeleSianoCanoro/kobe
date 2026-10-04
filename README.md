# Kobe.ai

A personal agent that treats the people you love like your starting five. It watches your inbox, calendar, socials and calls so you never miss a birthday, double-book a night, or walk into a conversation cold.

Built for the Build Personal Agents Hack. MIT licensed, every dependency is open source, and it runs on your own machine.

## What's in the MVP

- **Chat with Kobe** built on [assistant-ui](https://www.assistant-ui.com) primitives. Agent replies stream in and render tool calls as cards: birthday lists, pregame briefs, message drafts, and schedule conflicts.
- **Live scouting feed**: alerts land in the right lane as Kobe notices birthdays, follow-ups, conflicts and life updates.
- **Season mode**: XP, levels (Rookie → Mamba), a daily streak, assists for every message you send, and a three-play game plan per day.
- **Scouting reports** per person with a rapport score that rises as you keep in touch.
- **Hardwood court shader** (raw WebGL) plus a dithered ball from Paper Shaders.

## The agent

Kobe is a [Mastra](https://mastra.ai) agent (`lib/kobe-agent.ts`) served from `/api/chat` and streamed into assistant-ui. It reasons over your roster (read from Postgres) and your calendar, and answers by calling one of four tools, each rendered as a card: `show_people`, `pregame_brief`, `draft_message`, `resolve_conflict`.

The model comes from the [Neon AI Gateway](https://neon.com/docs/ai-gateway/overview). The default is `gpt-oss-120b`, an open-weight model, so you can later point the same agent at a self-hosted OpenAI-compatible server running the same weights. Pick any other model in the catalog with `KOBE_MODEL`.

Without gateway credentials the app falls back to a scripted offline agent (`lib/agent.ts`) with the same cards, so the demo always runs.

## Run it

```bash
pnpm install
pnpm dev
```

Create `.env.local` with:

```bash
# Any Postgres 15+ (Neon, Supabase, or the one in docker-compose.yml)
DATABASE_URL="postgresql://..."
# Neon Console → Connect → AI Gateway → Copy snippet
NEON_AI_GATEWAY_TOKEN="nt_live_..."
NEON_AI_GATEWAY_BASE_URL="https://<branch>-api.ai.<cell>.<region>.aws.neon.tech"
# Optional, defaults to neon/gpt-oss-120b
KOBE_MODEL="neon/gpt-oss-120b"
```

Then load the schema once:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

## Self-host

```bash
docker compose up --build
```

That starts Postgres 17 with the schema preloaded and the app on http://localhost:3000.

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
