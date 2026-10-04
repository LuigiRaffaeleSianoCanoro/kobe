import { KobeApp } from "@/components/kobe-app";
import { access } from "@/lib/access";
import { SEED_ROSTER } from "@/lib/data";
import { sql } from "@/lib/db";
import { loadRoster, loadTouches } from "@/lib/roster";

// Read credentials at request time so Docker images pick them up from the runtime env.
export const dynamic = "force-dynamic";

export default async function Page() {
  // A production server without KOBE_PASSWORD is public: serve the local roster and never read real records.
  const api = access().mode !== "locked";
  const live = api && !!process.env.NEON_AI_GATEWAY_TOKEN && !!process.env.NEON_AI_GATEWAY_BASE_URL;
  return (
    <KobeApp live={live} persisted={api && !!sql} roster={api ? await loadRoster() : SEED_ROSTER} touches={api ? await loadTouches() : []} />
  );
}
