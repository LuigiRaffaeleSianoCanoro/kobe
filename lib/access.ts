export type Access = { mode: "open" } | { mode: "password"; password: string } | { mode: "locked" };

// /api/chat spends the gateway token, and /api/season and /api/imports read and write your records,
// so a production server only serves them behind KOBE_PASSWORD. `next dev` stays open for local work.
export function access(): Access {
  const password = process.env.KOBE_PASSWORD;
  if (password) return { mode: "password", password };
  return process.env.NODE_ENV === "production" ? { mode: "locked" } : { mode: "open" };
}
