import postgres from "postgres";

// Standard Postgres wire protocol, so it works against Neon or any self-hosted Postgres.
// Without DATABASE_URL the app still runs, keeping season stats in memory only.
function connectionUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return null;
  const url = new URL(raw);
  // Neon's Console adds channel_binding; postgres.js would forward it as a startup
  // parameter and the server rejects it, so drop it.
  url.searchParams.delete("channel_binding");
  return url.toString();
}

const url = connectionUrl();

export const sql = url ? postgres(url, { max: 5, prepare: false }) : null;
