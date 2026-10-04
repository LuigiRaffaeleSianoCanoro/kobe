import postgres from "postgres";

// Standard Postgres wire protocol, so it works against Neon or any self-hosted Postgres.
// Without a usable DATABASE_URL the app still runs, keeping season stats in memory only.
function connectionUrl() {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return null;
  try {
    // Accept the Neon Console's psql snippet as well as the bare string.
    const url = new URL(raw.replace(/^psql\s+/, "").replace(/^['"]|['"]$/g, ""));
    // Neon's Console adds channel_binding; postgres.js would forward it as a startup
    // parameter and the server rejects it, so drop it.
    url.searchParams.delete("channel_binding");
    return url.toString();
  } catch {
    console.error("[kobe] DATABASE_URL is not a postgresql:// URL. Running without a database.");
    return null;
  }
}

const url = connectionUrl();

export const sql = url ? postgres(url, { max: 5, prepare: false }) : null;
