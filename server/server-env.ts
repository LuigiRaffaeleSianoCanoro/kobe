/** Read by the Vite server. These names are not given a VITE_ prefix, so they stay out of the client bundle. */
export const SERVER_ENV_KEYS = ["NEON_AI_GATEWAY_TOKEN", "NEON_AI_GATEWAY_BASE_URL", "KOBE_MODEL", "KOBE_PASSWORD"] as const;

/**
 * Copy server settings parsed from `.env*` onto `target`.
 * A value already in the environment wins, the same way Next.js treats `.env.local`.
 */
export function applyServerEnv(fromFiles: Record<string, string | undefined>, target: Record<string, string | undefined>): void {
  for (const key of SERVER_ENV_KEYS) {
    if (target[key] !== undefined) continue;
    const value = fromFiles[key];
    if (typeof value !== "string") continue;
    target[key] = value;
  }
}
