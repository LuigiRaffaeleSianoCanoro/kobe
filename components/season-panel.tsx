"use client";

import { useState } from "react";
import { PLAYS, levelFor, type PlayId } from "@/lib/data";
import { useGame } from "@/lib/game";

const mono = "'JetBrains Mono', monospace";

/** Level, XP bar, streak, and assists. Same season the Next app shows from 1024px up. */
export function SeasonHud() {
  const xp = useGame((s) => s.xp);
  const streak = useGame((s) => s.streak);
  const assists = useGame((s) => s.assists);
  const floaters = useGame((s) => s.floaters);
  const lvl = levelFor(xp);
  return (
    <div
      aria-label={`Season ${lvl.name}, ${xp} XP, streak ${streak} days, ${assists} assists`}
      style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, flex: "none", boxSizing: "border-box", padding: "4px 16px 4px 4px", borderRadius: 999, background: "rgba(16,12,20,.66)", border: "1px solid rgba(255,255,255,.08)", backdropFilter: "blur(18px) saturate(140%)" }}
    >
      <span style={{ boxSizing: "border-box", padding: "6px 12px", borderRadius: 999, background: "#F2B63A", color: "#15110D", fontWeight: 800, fontStretch: "66%", fontSize: 15, lineHeight: 1, letterSpacing: ".02em", textTransform: "uppercase" }}>{lvl.name}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, width: 168 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, font: `500 9.5px ${mono}`, letterSpacing: ".08em", color: "#A39A8E", whiteSpace: "nowrap" }}>
          <span style={{ color: "#F4F1EC" }}>{xp} XP</span>
          <span>{lvl.next ? `${lvl.toNext} TO ${lvl.next}` : "MAX LEVEL"}</span>
        </div>
        <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,.1)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.round(lvl.progress * 100)}%`, borderRadius: 999, background: "linear-gradient(90deg,#9B6CE0,#F2B63A)" }} />
        </div>
      </div>
      <Meter k="STREAK" v={`${streak}D`} />
      <Meter k="ASSISTS" v={String(assists)} />
      <div style={{ position: "absolute", top: "100%", left: 16, marginTop: 8, pointerEvents: "none" }}>
        {floaters.map((f) => (
          <div key={f.id} style={{ font: `500 10.5px ${mono}`, letterSpacing: ".08em", color: "#F2B63A", whiteSpace: "nowrap" }}>{f.text}</div>
        ))}
      </div>
    </div>
  );
}

function Meter({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1 }}>
      <span style={{ font: `500 9px ${mono}`, letterSpacing: ".12em", color: "#A39A8E" }}>{k}</span>
      <span style={{ fontWeight: 800, fontStretch: "66%", fontSize: 20, textTransform: "uppercase" }}>{v}</span>
    </div>
  );
}

const PROMPTS: Record<PlayId, string> = {
  maya: "Draft a birthday message for Maya",
  marcus: "Brief me on Marcus",
  dev: "Draft a reply to Dev",
};

/** Today's three plays. Expanded beside the chat from 1000px, collapsed into the alert strip below that. */
export function GamePlan({ wide, onAsk }: { wide: boolean; onAsk: (prompt: string) => void }) {
  const plays = useGame((s) => s.plays);
  const [open, setOpen] = useState(false);
  const done = PLAYS.filter((p) => plays[p.id]).length;
  const showList = wide || open;
  return (
    <div style={{ pointerEvents: "auto", display: "flex", flexDirection: "column", gap: 12, boxSizing: "border-box", padding: wide ? 16 : "12px 16px", borderRadius: 18, background: wide ? "rgba(16,12,20,.66)" : "rgba(16,12,20,.94)", border: "1px solid rgba(255,255,255,.08)", backdropFilter: "blur(18px) saturate(140%)" }}>
      <button
        type="button"
        aria-expanded={showList}
        aria-label="Today's game plan"
        onClick={() => { if (!wide) setOpen((value) => !value); }}
        style={{ display: "flex", alignItems: wide ? "flex-end" : "center", justifyContent: "space-between", width: "100%", padding: 0, background: "transparent", border: "none", color: "#F4F1EC", textAlign: "left", cursor: wide ? "default" : "pointer" }}
      >
        <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ font: `500 10.5px ${mono}`, letterSpacing: ".14em", color: "#F2B63A" }}>TODAY&apos;S GAME PLAN</span>
          <span style={{ fontWeight: 800, fontStretch: "66%", fontSize: wide ? 28 : 22, lineHeight: 0.9, textTransform: "uppercase" }}>{done}/{PLAYS.length} plays</span>
        </span>
        <ShotClock done={done} total={PLAYS.length} />
      </button>
      {showList && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {PLAYS.map((play) => {
            const ok = plays[play.id];
            return (
              <button
                key={play.id}
                type="button"
                disabled={ok}
                onClick={() => onAsk(PROMPTS[play.id])}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 4px", background: "transparent", border: "none", color: "#F4F1EC", textAlign: "left", cursor: ok ? "default" : "pointer" }}
              >
                <span style={{ flex: "none", width: 20, height: 20, boxSizing: "border-box", display: "grid", placeItems: "center", borderRadius: 6, border: `1px solid ${ok ? "#3DBE8B" : "rgba(255,255,255,.2)"}`, background: ok ? "#3DBE8B" : "transparent", color: "#15110D", fontSize: 12, fontWeight: 800 }}>{ok ? "✓" : ""}</span>
                <span style={{ flex: 1, fontSize: 13.5, color: ok ? "#A39A8E" : "#F4F1EC", textDecoration: ok ? "line-through" : "none" }}>{play.label}</span>
                <span style={{ font: `500 10.5px ${mono}`, letterSpacing: ".08em", color: "#F2B63A" }}>+{play.xp}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ShotClock({ done, total }: { done: number; total: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden style={{ flex: "none", transform: "rotate(-90deg)" }}>
      <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="4" />
      <circle cx="24" cy="24" r={r} fill="none" stroke="#F2B63A" strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - done / total)} />
    </svg>
  );
}
