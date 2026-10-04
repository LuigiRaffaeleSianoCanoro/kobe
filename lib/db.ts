import postgres from "postgres";

// Standard Postgres wire protocol, so it works against Neon or any self-hosted Postgres.
// Without DATABASE_URL the app still runs, keeping season stats in memory only.
const url = process.env.DATABASE_URL;

export const sql = url ? postgres(url, { max: 5, prepare: false }) : null;
