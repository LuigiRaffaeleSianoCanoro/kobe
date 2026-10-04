import { CrmClient } from "@/components/crm-client";
import "@/src/index.css";
import { access } from "@/lib/access";
import { sql } from "@/lib/db";

// Season totals are read at request time so a database configured at runtime is picked up.
export const dynamic = "force-dynamic";

export default function Page() {
  const api = access().mode !== "locked";
  return <CrmClient persisted={api && !!sql} />;
}
