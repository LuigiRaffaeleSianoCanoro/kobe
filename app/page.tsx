import { KobeApp } from "@/components/kobe-app";

// Read the gateway credential at request time so Docker images pick it up from the runtime env.
export const dynamic = "force-dynamic";

export default function Page() {
  const live = !!process.env.NEON_AI_GATEWAY_TOKEN && !!process.env.NEON_AI_GATEWAY_BASE_URL;
  return <KobeApp live={live} model={process.env.KOBE_MODEL ?? "neon/gpt-oss-120b"} />;
}
