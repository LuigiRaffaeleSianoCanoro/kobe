"use client";

import dynamic from "next/dynamic";

// The courtside CRM reads window and localStorage while it renders.
// Skip SSR so the roster, Add person, and browser storage run in the browser.
const App = dynamic(() => import("@/src/App"), { ssr: false });

export function CrmClient() {
  return (
    <div id="root">
      <App />
    </div>
  );
}
