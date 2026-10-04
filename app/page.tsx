import { KobeApp } from "@/components/kobe-app";
import { access } from "@/lib/access";
import { connectorFlags } from "@/lib/connectors";
import { SEED_ROSTER } from "@/lib/data";
import { sql } from "@/lib/db";
import { loadRoster } from "@/lib/roster";

// Read credentials at request time so Docker images pick them up from the runtime env.
export const dynamic = "force-dynamic";

export default async function Page() {
  // A production server without KOBE_PASSWORD is public: serve the offline demo and never read real records.
  const api = access().mode !== "locked";
  const live = api && !!process.env.NEON_AI_GATEWAY_TOKEN && !!process.env.NEON_AI_GATEWAY_BASE_URL;
  const connectors = api ? await connectorFlags() : { gmail: false, slack: false };
  return (
    <KobeApp
      live={live}
      persisted={api && !!sql}
      roster={api ? await loadRoster() : SEED_ROSTER}
      model={process.env.KOBE_MODEL ?? "neon/gpt-oss-120b"}
      connectors={connectors}
    />
  );
}
