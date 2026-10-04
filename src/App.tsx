import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CHIPS, D, INITIAL_SOURCES, PAIR_CODE, VOICE_LINES, type AlertAction, type FeedItem } from "./data";
import { reply, type AgentReply } from "./agent";
import { Court } from "./Court";
import { PersonReport } from "./PersonReport";
import { blankPerson, browserStorage, cardMeta, cardRight, cloneSeed, findPerson, fromForm, initials, readPeople, toForm, writePeople, type Person, type PersonForm } from "./crm";

type Message = AgentReply & { id: number; role: "agent" | "user"; sent?: boolean };
type LiveAlert = FeedItem & { id: number; visible: boolean };

const mono = "'JetBrains Mono', monospace";
const glass = "rgba(16,12,20,.66)";

function Ball({ size, shadow }: { size: number; shadow?: string }) {
  const seam = size >= 40 ? 2 : 1.5;
  return (
    <div style={{ position: "relative", width: size, height: size, borderRadius: "50%", overflow: "hidden", background: "radial-gradient(circle at 32% 28%, rgba(255,220,180,.4), transparent 45%), radial-gradient(circle, rgba(60,20,0,.35) .8px, transparent 1.2px) 0 0/3px 3px, radial-gradient(circle at 70% 75%, #9c3f0c, #e0712a 70%)", boxShadow: shadow }}>
      <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: seam, marginLeft: -seam / 2, background: "#2a1206" }} />
      <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: seam, marginTop: -seam / 2, background: "#2a1206" }} />
      <div style={{ position: "absolute", top: "-10%", bottom: "-10%", left: "-62%", width: "100%", borderRadius: "50%", border: `${seam}px solid #2a1206` }} />
      <div style={{ position: "absolute", top: "-10%", bottom: "-10%", right: "-62%", width: "100%", borderRadius: "50%", border: `${seam}px solid #2a1206` }} />
    </div>
  );
}

function Diamond() {
  return <span style={{ flex: "none", width: 6, height: 6, marginTop: 7, background: "#F2B63A", transform: "rotate(45deg)" }} />;
}

export default function App() {
  const scrollRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const timers = useRef<number[]>([]);
  const recInt = useRef<number | null>(null);
  const voiceI = useRef(-1);
  const aid = useRef(0);

  const [vw, setVw] = useState(window.innerWidth);
  const [headerHeight, setHeaderHeight] = useState(68);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [modal, setModal] = useState<null | "sources" | "channels" | "roster">(null);
  const [record, setRecord] = useState<string | null>(null);
  const [pairing, setPairing] = useState("telegram");
  const [pairBusy, setPairBusy] = useState(false);
  const [sources, setSources] = useState<Record<string, boolean>>({ ...INITIAL_SOURCES });
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const [people, setPeople] = useState<Person[]>(() => {
    try {
      return readPeople(browserStorage());
    } catch {
      return cloneSeed();
    }
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const peopleRef = useRef(people);
  peopleRef.current = people;
  const [form, setForm] = useState<PersonForm | null>(null);
  const [channels, setChannels] = useState<Record<string, boolean>>({});
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, role: "agent", text: "Morning. Three things need you today. They'll pop up as they come in, or ask me about anyone." },
  ]);
  const [rec, setRec] = useState(false);
  const [recSec, setRecSec] = useState(0);

  const bars = useMemo(
    () => Array.from({ length: 28 }, (_, i) => ({ dur: (0.6 + ((i * 37) % 9) / 12).toFixed(2) + "s", delay: (-((i * 53) % 10) / 10).toFixed(2) + "s" })),
    [],
  );

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
  };

  const pushAlert = (a: FeedItem) => {
    const id = ++aid.current;
    setAlerts((s) => [...s, { ...a, id, visible: true }]);
    if (a.auto) later(() => dismiss(id), 4200);
  };

  const dismiss = (id: number) => {
    setAlerts((s) => s.map((x) => (x.id === id ? { ...x, visible: false } : x)));
  };

  const runAgent = (text: string) => {
    if (!text || !text.trim()) return;
    const id = Date.now();
    setInput("");
    setTyping(true);
    setMessages((s) => [...s, { id, role: "user", text }]);
    later(() => {
      const r = reply(text, sourcesRef.current, peopleRef.current);
      setTyping(false);
      setMessages((s) => [...s, { id: id + 1, role: "agent", ...r }]);
    }, 900 + Math.random() * 600);
  };

  const act = (a: LiveAlert, action?: AlertAction) => {
    dismiss(a.id);
    if (!action) return;
    if (action.run) runAgent(action.run);
    if (action.record) openRecord(action.record);
  };

  const sync = (title: string, body: string, source: string) => {
    pushAlert({ at: 0, kind: "SYNCED", source, color: "#3DBE8B", title, body, auto: true });
  };

  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize);
    const k = 1;
    D.feed.forEach((f) => later(() => pushAlert(f), f.at * k));
    return () => {
      window.removeEventListener("resize", onResize);
      if (recInt.current) window.clearInterval(recInt.current);
      timers.current.forEach((t) => window.clearTimeout(t));
    };
    // mount only — alert cadence matches the design's Live pace
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, typing]);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => {
      const next = el.offsetHeight;
      setHeaderHeight((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const startRec = () => {
    setRec(true);
    setRecSec(0);
    recInt.current = window.setInterval(() => setRecSec((s) => s + 1), 1000);
  };
  const stopRec = (send: boolean) => {
    if (recInt.current) window.clearInterval(recInt.current);
    recInt.current = null;
    setRec(false);
    setRecSec(0);
    if (send) {
      voiceI.current = (voiceI.current + 1) % VOICE_LINES.length;
      runAgent("🎙 " + VOICE_LINES[voiceI.current]);
    }
  };

  const sendDraft = (mid: number) => {
    const m = messages.find((x) => x.id === mid);
    setMessages((s) => s.map((x) => (x.id === mid ? { ...x, sent: true } : x)));
    if (m?.draft) {
      pushAlert({ at: 0, kind: "SENT", source: m.draft.channel.toUpperCase(), color: "#3DBE8B", title: `Message sent to ${m.draft.to}`, body: "Logged to their record. Rapport +3.", auto: true });
    }
  };

  const toggleSource = (id: string, name: string) => {
    const on = !sources[id];
    setSources((s) => ({ ...s, [id]: on }));
    if (on) sync(`${name} connected`, "Backfilling the last 12 months. New context will show up on records.", name.toUpperCase());
  };

  const pair = () => {
    const id = pairing;
    const ch = D.channels.find((c) => c.id === id);
    if (!ch) return;
    setPairBusy(true);
    later(() => {
      setPairBusy(false);
      setChannels((s) => ({ ...s, [id]: true }));
      sync(`Kobe joined ${ch.name}`, "Message Kobe there anytime. Alerts will follow you.", ch.name.toUpperCase());
    }, 1500);
  };

  const persistPeople = (next: Person[]): boolean => {
    if (!writePeople(browserStorage(), next)) return false;
    setPeople(next);
    return true;
  };

  const openRecord = (id: string) => {
    setForm(null);
    setRecord(id);
  };

  const startCreate = () => {
    const person = blankPerson();
    setSaveError(null);
    setForm(toForm(person));
    setRecord(person.id);
    setModal(null);
  };

  const editRecord = () => {
    if (!record) return;
    const saved = findPerson(people, record);
    if (!saved) return;
    setSaveError(null);
    setForm(toForm(saved));
  };

  const saveForm = () => {
    if (!form) return;
    const existing = findPerson(people, form.id);
    const nextPerson = fromForm(form, existing);
    const next = existing ? people.map((person) => (person.id === nextPerson.id ? nextPerson : person)) : [...people, nextPerson];
    if (!persistPeople(next)) {
      setSaveError("Couldn't save. Browser storage rejected the write, so this record is unchanged.");
      return;
    }
    setSaveError(null);
    setForm(null);
    setRecord(nextPerson.id);
  };

  const cancelForm = () => {
    if (!form) return;
    const exists = people.some((person) => person.id === form.id);
    setSaveError(null);
    setForm(null);
    if (!exists) setRecord(null);
  };

  const closeReport = () => {
    setSaveError(null);
    setForm(null);
    setRecord(null);
  };

  const wide = vw >= 1000;
  const connectedCount = Object.values(sources).filter(Boolean).length;
  const channelCount = Object.values(channels).filter(Boolean).length;
  const visibleCount = alerts.filter((a) => a.visible).length;
  const ordered = [...alerts].reverse();
  let shown = 0;
  const laneAlerts = ordered.map((a) => {
    const v = a.visible && (wide || shown++ < 1);
    return { ...a, visible: v };
  });
  const headerDelta = wide ? 0 : Math.max(0, headerHeight - 68);
  const lane = wide
    ? { chatTop: 68, chatRight: 380, laneTop: 76, laneBottom: 104, laneRight: 20, laneW: "340px", laneMask: "linear-gradient(#000 calc(100% - 24px), transparent)" }
    : { chatTop: 284 + headerDelta, chatRight: 0, laneTop: 72 + headerDelta, laneBottom: `calc(100vh - ${280 + headerDelta}px)`, laneRight: 16, laneW: "calc(100vw - 32px)", laneMask: "none" };

  const pc = D.channels.find((c) => c.id === pairing) ?? D.channels[0];
  const added = !!channels[pc.id];
  const tab = (on: boolean) => ({ bg: on ? "#F4F1EC" : "transparent", fg: on ? "#15110D" : "#D3CBC0" });
  const ts = tab(modal === "sources");
  const tc = tab(modal === "channels");
  const tr = tab(modal === "roster");
  const savedRecord = record ? findPerson(people, record) ?? null : null;
  const reportOpen = Boolean(record && (savedRecord || form));

  return (
    <>
      <Court />
      <header ref={headerRef} style={{ position: "fixed", top: 0, left: 0, right: 0, minHeight: 68, boxSizing: "border-box", display: "flex", flexWrap: "wrap", alignItems: "center", alignContent: "center", columnGap: 8, rowGap: 8, padding: "0 16px", zIndex: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
          <Ball size={26} shadow="0 2px 10px rgba(224,113,42,.45)" />
          <div style={{ fontWeight: 800, fontStretch: "72%", fontSize: 24, letterSpacing: ".01em", lineHeight: 1, whiteSpace: "nowrap" }}>
            KOBE<span style={{ color: "#F2B63A" }}>.AI</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none", padding: "6px 12px", borderRadius: 999, background: "rgba(16,12,20,.5)", border: "1px solid rgba(255,255,255,.08)", backdropFilter: "blur(14px)", font: `500 11px ${mono}`, letterSpacing: ".06em", color: "#D9D2C7", whiteSpace: "nowrap" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#3DBE8B", boxShadow: "0 0 10px #3DBE8B", animation: "kpulse 1.8s ease-in-out infinite" }} />
          <span>SCOUTING {connectedCount} SOURCES</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end", maxWidth: "100%" }}>
          <button className="hover-int" aria-label="Roster" onClick={() => setModal("roster")} style={{ display: "flex", alignItems: "center", gap: 8, flex: "none", height: 38, padding: "0 14px", borderRadius: 999, background: "rgba(16,12,20,.6)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,.1)", color: "#F4F1EC", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
            <span>Roster</span>
            <span style={{ font: `600 11px ${mono}`, padding: "2px 6px", borderRadius: 6, background: "rgba(242,182,58,.18)", color: "#F2B63A" }}>{people.length}</span>
          </button>
          <button className="hover-int" onClick={() => setModal("sources")} style={{ display: "flex", alignItems: "center", gap: 8, flex: "none", height: 38, padding: "0 14px", borderRadius: 999, background: "rgba(16,12,20,.6)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,.1)", color: "#F4F1EC", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
            <span>Integrations</span>
            <span style={{ font: `600 11px ${mono}`, padding: "2px 6px", borderRadius: 6, background: "rgba(242,182,58,.18)", color: "#F2B63A" }}>{connectedCount}</span>
          </button>
          <button className="hover-cream" onClick={() => setModal("channels")} style={{ display: "flex", alignItems: "center", gap: 8, flex: "none", height: 38, padding: "0 16px", borderRadius: 999, background: "#F4F1EC", border: "none", color: "#15110D", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
            <span>Add Kobe to…</span>
            {channelCount > 0 && <span style={{ font: `600 11px ${mono}`, padding: "2px 6px", borderRadius: 6, background: "#15110D", color: "#F2B63A" }}>{channelCount}</span>}
          </button>
        </div>
      </header>

      <main ref={scrollRef} style={{ position: "fixed", top: lane.chatTop, bottom: 104, left: 0, right: lane.chatRight, overflowY: "auto", zIndex: 5, maskImage: "linear-gradient(transparent, #000 36px, #000 calc(100% - 20px), transparent)", WebkitMaskImage: "linear-gradient(transparent, #000 36px, #000 calc(100% - 20px), transparent)" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "7vh 20px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 18 }}>
            <div style={{ font: `500 11px ${mono}`, letterSpacing: ".16em", color: "#F2B63A" }}>COURTSIDE · SUN OCT 4</div>
            <h1 style={{ margin: 0, fontWeight: 800, fontStretch: "66%", fontSize: "clamp(48px, 8vw, 84px)", lineHeight: 0.9, letterSpacing: "-.005em", textTransform: "uppercase", textWrap: "balance" }}>Know your people.</h1>
            <p style={{ margin: 0, maxWidth: 520, fontSize: 16, lineHeight: 1.5, color: "#D3CBC0", textWrap: "pretty" }}>Kobe watches your inbox, calendar, socials and calls so you never miss a birthday, double-book a night, or walk into a conversation cold.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
              {CHIPS.map((label) => (
                <button key={label} className="chip" onClick={() => runAgent(label)} style={{ height: 34, padding: "0 14px", borderRadius: 999, background: "rgba(16,12,20,.55)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,.12)", color: "#F4F1EC", fontSize: 13 }}>{label}</button>
              ))}
            </div>
          </div>

          {messages.map((m) => (
            <div key={m.id} style={{ display: "flex", flexDirection: "column", animation: "kup .35s ease both" }}>
              {m.role === "user" && (
                <div style={{ alignSelf: "flex-end", maxWidth: "78%", padding: "11px 15px", borderRadius: "18px 18px 4px 18px", background: "#F4F1EC", color: "#15110D", fontSize: 15, lineHeight: 1.45 }}>{m.text}</div>
              )}
              {m.role === "agent" && (
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start", maxWidth: "92%" }}>
                  <div style={{ flex: "none", marginTop: 2 }}><Ball size={28} /></div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0, flex: 1 }}>
                    <div style={{ padding: "12px 16px", borderRadius: "4px 18px 18px 18px", background: glass, backdropFilter: "blur(18px) saturate(140%)", border: "1px solid rgba(255,255,255,.08)", fontSize: 15, lineHeight: 1.5, color: "#F4F1EC", textWrap: "pretty", alignSelf: "flex-start" }}>{m.text}</div>
                    {m.people && (
                      <div style={{ display: "flex", flexDirection: "column", borderRadius: 16, overflow: "hidden", background: glass, backdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,.08)" }}>
                        {m.people.map((card) => {
                          const person = findPerson(people, card.id);
                          if (!person) return null;
                          const role = cardMeta(person, card.metaField);
                          const meta = card.metaField === "role" && person.sources[0] ? [role, person.sources[0]].filter((part) => part.length > 0).join(" · ") : role;
                          const right = cardRight(person, card.rightField);
                          return (
                            <button key={card.id} className="rowbtn" aria-label={`Open ${person.name || "record"}`} onClick={() => openRecord(person.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,.06)", color: "#F4F1EC", textAlign: "left" }}>
                              <div style={{ width: 34, height: 34, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(242,182,58,.14)", color: "#F2B63A", fontWeight: 800, fontStretch: "75%", fontSize: 14 }}>{initials(person.name)}</div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                                <span style={{ fontSize: 14.5, fontWeight: 600 }}>{person.name}</span>
                                <span style={{ fontSize: 12.5, color: "#BDB5AA" }}>{meta}</span>
                              </div>
                              <span style={{ font: `500 11px ${mono}`, color: "#F2B63A", letterSpacing: ".04em" }}>{right}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {m.brief && (() => {
                      const person = findPerson(people, m.brief.id);
                      if (!person) return null;
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16, borderRadius: 16, background: "rgba(16,12,20,.7)", backdropFilter: "blur(18px)", border: "1px solid rgba(242,182,58,.25)" }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                            <span style={{ font: `500 10.5px ${mono}`, letterSpacing: ".14em", color: "#F2B63A" }}>PREGAME</span>
                            <span style={{ fontSize: 12.5, color: "#BDB5AA" }}>{person.nextPlan}</span>
                          </div>
                          <div style={{ fontWeight: 800, fontStretch: "70%", fontSize: 30, lineHeight: 1, minHeight: "1em", textTransform: "uppercase" }}>{person.name}</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                            {person.points.map((point, index) => (
                              <div key={`${point}-${index}`} style={{ display: "flex", gap: 10, fontSize: 14, lineHeight: 1.45, color: "#E6E0D7" }}><Diamond /><span>{point}</span></div>
                            ))}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px", borderRadius: 10, background: "rgba(242,182,58,.1)", fontSize: 13.5, color: "#F4E3BC" }}>
                            <span style={{ font: `500 10.5px ${mono}`, letterSpacing: ".12em", color: "#F2B63A" }}>OPEN LOOP</span>
                            <span>{person.openLoop}</span>
                          </div>
                          <button className="hover-cream" aria-label="Full scouting report" onClick={() => openRecord(person.id)} style={{ alignSelf: "flex-start", height: 32, padding: "0 14px", borderRadius: 999, background: "#F4F1EC", border: "none", color: "#15110D", fontSize: 12.5, fontWeight: 700 }}>Full scouting report</button>
                        </div>
                      );
                    })()}
                    {m.draft && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16, borderRadius: 16, background: "rgba(16,12,20,.7)", backdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,.1)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, font: `500 10.5px ${mono}`, letterSpacing: ".12em", color: "#BDB5AA" }}>
                          <span>DRAFT</span><span>→ {m.draft.to}</span><span style={{ marginLeft: "auto", color: "#F2B63A" }}>{m.draft.channel}</span>
                        </div>
                        <div style={{ fontSize: 15, lineHeight: 1.5, color: "#F4F1EC" }}>{m.draft.body}</div>
                        {!m.sent ? (
                          <div style={{ display: "flex", gap: 8 }}>
                            <button className="gold" onClick={() => sendDraft(m.id)} style={{ height: 32, padding: "0 14px", borderRadius: 999, background: "#F2B63A", border: "none", color: "#15110D", fontSize: 12.5, fontWeight: 700 }}>Send via {m.draft.channel}</button>
                            <button className="ghost" onClick={() => setInput(m.draft!.body)} style={{ height: 32, padding: "0 14px", borderRadius: 999, background: "transparent", border: "1px solid rgba(255,255,255,.16)", color: "#F4F1EC", fontSize: 12.5 }}>Edit</button>
                          </div>
                        ) : (
                          <div style={{ font: `500 11px ${mono}`, letterSpacing: ".08em", color: "#3DBE8B" }}>✓ SENT · LOGGED TO RECORD</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {typing && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", animation: "kfade .2s ease both" }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "radial-gradient(circle at 70% 75%, #9c3f0c, #e0712a 70%)" }} />
              <div style={{ display: "flex", gap: 5, padding: "14px 16px", borderRadius: "4px 18px 18px 18px", background: glass, backdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,.08)" }}>
                {[0, 0.15, 0.3].map((d) => (
                  <span key={d} style={{ width: 6, height: 6, borderRadius: "50%", background: "#F2B63A", animation: `kdot 1s ${d}s infinite` }} />
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      <div style={{ position: "fixed", left: 0, right: lane.chatRight, bottom: 22, zIndex: 10, padding: "0 16px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", alignItems: "center", gap: 10, padding: "8px 8px 8px 20px", borderRadius: 999, background: "rgba(16,12,20,.72)", backdropFilter: "blur(20px) saturate(150%)", border: "1px solid rgba(255,255,255,.12)", boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>
          {!rec ? (
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") runAgent(input); }} placeholder="Ask Kobe about anyone you know…" style={{ flex: 1, minWidth: 0, height: 40, background: "transparent", border: "none", outline: "none", color: "#F4F1EC", font: "400 15.5px 'Archivo', system-ui, sans-serif" }} />
          ) : (
            <div style={{ flex: 1, minWidth: 0, height: 40, display: "flex", alignItems: "center", gap: 12, animation: "kfade .2s ease both" }}>
              <span style={{ font: `600 12px ${mono}`, letterSpacing: ".08em", color: "#E5484D" }}>● 0:{String(recSec).padStart(2, "0")}</span>
              <div style={{ flex: 1, minWidth: 0, height: 22, display: "flex", alignItems: "center", gap: 3, overflow: "hidden" }}>
                {bars.map((b, i) => (
                  <span key={i} style={{ flex: "none", width: 3, height: 22, borderRadius: 2, background: "#F2B63A", transformOrigin: "center", animation: `kbar ${b.dur} ease-in-out ${b.delay} infinite` }} />
                ))}
              </div>
              <button className="ghost" onClick={() => stopRec(false)} style={{ flex: "none", height: 30, padding: "0 12px", borderRadius: 999, background: "transparent", border: "1px solid rgba(255,255,255,.16)", color: "#D3CBC0", fontSize: 12.5 }}>Cancel</button>
            </div>
          )}
          <button className="mic" title={rec ? "Stop and send" : "Voice message"} onClick={() => (rec ? stopRec(true) : startRec())} style={{ flex: "none", width: 46, height: 46, padding: 0, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: rec ? "#E5484D" : "rgba(255,255,255,.06)", border: `1px solid ${rec ? "#E5484D" : "rgba(255,255,255,.14)"}`, color: rec ? "#fff" : "#F4F1EC", animation: rec ? "kring 1.2s ease-out infinite" : "none", transition: "background .2s, transform .2s" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><line x1="12" y1="18" x2="12" y2="21" /><line x1="8.5" y1="21" x2="15.5" y2="21" /></svg>
          </button>
          <button className="send-ball" title="Send" onClick={() => runAgent(input)} style={{ flex: "none", position: "relative", width: 46, height: 46, padding: 0, borderRadius: "50%", overflow: "hidden", border: "none", background: "transparent" }}>
            <Ball size={46} shadow="0 6px 18px rgba(224,113,42,.45)" />
          </button>
        </div>
      </div>

      <aside style={{ position: "fixed", top: lane.laneTop, bottom: lane.laneBottom, right: lane.laneRight, width: lane.laneW, display: "flex", flexDirection: "column", gap: 10, zIndex: 30, pointerEvents: "none", overflowY: "auto", padding: "4px 0 20px", boxSizing: "border-box", maskImage: lane.laneMask, WebkitMaskImage: lane.laneMask }}>
        {visibleCount > 1 && (
          <button onClick={() => setAlerts((st) => st.map((a) => ({ ...a, visible: false })))} style={{ pointerEvents: "auto", alignSelf: "flex-end", height: 26, padding: "0 10px", borderRadius: 999, background: "rgba(16,12,20,.6)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,.1)", color: "#D3CBC0", font: `500 10.5px ${mono}`, letterSpacing: ".08em" }}>CLEAR {visibleCount}</button>
        )}
        {laneAlerts.map((a) => a.visible && (
          <div key={a.id} style={{ pointerEvents: "auto", display: "flex", flexDirection: "column", gap: 9, padding: "14px 14px 13px 16px", borderRadius: 18, background: "rgba(16,12,20,.76)", backdropFilter: "blur(22px) saturate(150%)", border: "1px solid rgba(255,255,255,.1)", boxShadow: "0 18px 50px rgba(0,0,0,.5)", animation: "kpop .5s cubic-bezier(.2,1.3,.4,1) both" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, font: `500 10.5px ${mono}`, letterSpacing: ".12em" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: a.color, boxShadow: `0 0 12px ${a.color}` }} />
              <span style={{ color: "#F4F1EC" }}>{a.kind}</span>
              <span style={{ color: "#A39A8E" }}>· {a.source}</span>
              <span style={{ marginLeft: "auto", color: "#A39A8E" }}>NOW</span>
              <button className="xbtn" title="Dismiss" onClick={() => dismiss(a.id)} style={{ width: 22, height: 22, padding: 0, borderRadius: "50%", background: "rgba(255,255,255,.06)", border: "none", color: "#D3CBC0", fontSize: 14, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 15, fontWeight: 650, lineHeight: 1.3, textWrap: "pretty" }}>{a.title}</div>
            <div style={{ fontSize: 13, lineHeight: 1.45, color: "#CFC7BB", textWrap: "pretty" }}>{a.body}</div>
            {a.a1 && (
              <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                <button className="hover-cream" onClick={() => act(a, a.a1)} style={{ height: 30, padding: "0 13px", borderRadius: 999, background: "#F4F1EC", border: "none", color: "#15110D", fontSize: 12.5, fontWeight: 700 }}>{a.a1.label}</button>
                {a.a2 && <button className="ghost" onClick={() => act(a, a.a2)} style={{ height: 30, padding: "0 13px", borderRadius: 999, background: "transparent", border: "1px solid rgba(255,255,255,.16)", color: "#F4F1EC", fontSize: 12.5 }}>{a.a2.label}</button>}
              </div>
            )}
          </div>
        ))}
      </aside>

      {modal && (
        <div onClick={() => setModal(null)} style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(8,5,4,.55)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "kfade .2s ease both" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(860px, 100%)", maxHeight: "84vh", display: "flex", flexDirection: "column", borderRadius: 24, background: "rgba(18,13,16,.9)", backdropFilter: "blur(26px) saturate(150%)", border: "1px solid rgba(255,255,255,.1)", boxShadow: "0 40px 100px rgba(0,0,0,.6)", overflow: "hidden", animation: "kpop .45s cubic-bezier(.2,1.25,.4,1) both" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "20px 22px 0" }}>
              <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 999, background: "rgba(255,255,255,.06)" }}>
                <button onClick={() => setModal("roster")} style={{ height: 32, padding: "0 14px", borderRadius: 999, border: "none", background: tr.bg, color: tr.fg, fontSize: 13, fontWeight: 700 }}>Roster</button>
                <button onClick={() => setModal("sources")} style={{ height: 32, padding: "0 14px", borderRadius: 999, border: "none", background: ts.bg, color: ts.fg, fontSize: 13, fontWeight: 700 }}>Integrations</button>
                <button onClick={() => setModal("channels")} style={{ height: 32, padding: "0 14px", borderRadius: 999, border: "none", background: tc.bg, color: tc.fg, fontSize: 13, fontWeight: 700 }}>Add Kobe to…</button>
              </div>
              <button className="xbtn" onClick={() => setModal(null)} style={{ marginLeft: "auto", width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,.06)", border: "none", color: "#F4F1EC", fontSize: 18 }}>×</button>
            </div>
            {modal === "roster" && (
              <div style={{ overflowY: "auto", padding: "20px 22px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontWeight: 800, fontStretch: "68%", fontSize: 36, lineHeight: 1, textTransform: "uppercase" }}>Roster</div>
                  <div style={{ fontSize: 14, color: "#BDB5AA" }}>Each person is a record in this browser. Creates and edits stay after a reload. Neon is not connected.</div>
                </div>
                <button className="gold" aria-label="Add person" onClick={startCreate} style={{ alignSelf: "flex-start", height: 38, padding: "0 16px", borderRadius: 999, background: "#F2B63A", border: "none", color: "#15110D", fontSize: 13.5, fontWeight: 700 }}>Add person</button>
                <div style={{ display: "flex", flexDirection: "column", borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,.08)" }}>
                  {people.map((person) => (
                    <button key={person.id} className="rowbtn" aria-label={`Open ${person.name || "empty record"}`} onClick={() => { setModal(null); openRecord(person.id); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "rgba(255,255,255,.03)", border: "none", borderBottom: "1px solid rgba(255,255,255,.06)", color: "#F4F1EC", textAlign: "left" }}>
                      <div style={{ width: 34, height: 34, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(242,182,58,.14)", color: "#F2B63A", fontWeight: 800, fontStretch: "75%", fontSize: 14 }}>{initials(person.name)}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 14.5, fontWeight: 600, minHeight: "1.2em" }}>{person.name}</span>
                        <span style={{ fontSize: 12.5, color: "#BDB5AA" }}>{person.role}</span>
                      </div>
                      {person.sample ? <span style={{ font: `600 10px ${mono}`, letterSpacing: ".1em", color: "#BDB5AA" }}>SAMPLE</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {modal === "sources" && (
              <div style={{ overflowY: "auto", padding: "20px 22px 24px", display: "flex", flexDirection: "column", gap: 22 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontWeight: 800, fontStretch: "68%", fontSize: 36, lineHeight: 1, textTransform: "uppercase" }}>Scouting sources</div>
                  <div style={{ fontSize: 14, color: "#BDB5AA" }}>{connectedCount} connected. Kobe reads to build context and never posts on your behalf.</div>
                </div>
                {D.groups.map((g) => (
                  <div key={g.name} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ font: `500 10.5px ${mono}`, letterSpacing: ".14em", color: "#F2B63A" }}>{g.name}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8 }}>
                      {g.items.map(([id, name, mark, desc]) => {
                        const on = !!sources[id];
                        return (
                          <button key={id} className="src" onClick={() => toggleSource(id, name)} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, background: "rgba(255,255,255,.035)", border: `1px solid ${on ? "rgba(242,182,58,.45)" : "rgba(255,255,255,.08)"}`, color: "#F4F1EC", textAlign: "left", transition: "border-color .2s" }}>
                            <div style={{ flex: "none", width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: on ? "#F2B63A" : "rgba(255,255,255,.07)", color: on ? "#15110D" : "#CFC7BB", fontWeight: 800, fontStretch: "75%", fontSize: 14, transition: "background .2s" }}>{mark}</div>
                            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span>
                              <span style={{ fontSize: 12, color: "#ACA397", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{desc}</span>
                            </div>
                            <div style={{ flex: "none", position: "relative", width: 36, height: 20, borderRadius: 999, background: on ? "#F2B63A" : "rgba(255,255,255,.16)", transition: "background .2s" }}>
                              <div style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#F4F1EC", transition: "left .25s cubic-bezier(.2,1.4,.4,1)" }} />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {modal === "channels" && (
              <div style={{ overflowY: "auto", padding: "20px 22px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontWeight: 800, fontStretch: "68%", fontSize: 36, lineHeight: 1, textTransform: "uppercase" }}>Put Kobe in your rotation</div>
                  <div style={{ fontSize: 14, color: "#BDB5AA" }}>Talk to Kobe wherever you already message. Alerts follow you there.</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, alignItems: "start" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {D.channels.map((c) => {
                      const sel = c.id === pairing;
                      const on = !!channels[c.id];
                      return (
                        <button key={c.id} className="ch" onClick={() => { setPairing(c.id); setPairBusy(false); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderRadius: 14, background: sel ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.025)", border: `1px solid ${sel ? "rgba(242,182,58,.5)" : "rgba(255,255,255,.07)"}`, color: "#F4F1EC", textAlign: "left" }}>
                          <div style={{ flex: "none", width: 34, height: 34, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,.08)", fontWeight: 800, fontStretch: "75%", fontSize: 13 }}>{c.mono}</div>
                          <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{c.name}</span>
                          <span style={{ font: `500 10px ${mono}`, letterSpacing: ".1em", color: on ? "#3DBE8B" : "#A39A8E" }}>{on ? "LIVE" : "ADD"}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 20, borderRadius: 18, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 52, height: 52, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", background: "#F4F1EC", color: "#15110D", fontWeight: 800, fontStretch: "72%", fontSize: 20 }}>{pc.mono}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ fontWeight: 800, fontStretch: "72%", fontSize: 26, lineHeight: 1, textTransform: "uppercase" }}>{pc.name}</span>
                        <span style={{ font: `500 12px ${mono}`, color: "#F2B63A" }}>{pc.handle}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {pc.steps.map((text, i) => (
                        <div key={text} style={{ display: "flex", gap: 12, alignItems: "baseline", fontSize: 14, lineHeight: 1.45, color: "#E6E0D7" }}>
                          <span style={{ flex: "none", width: 22, font: `600 12px ${mono}`, color: "#F2B63A" }}>0{i + 1}</span>
                          <span>{text}</span>
                        </div>
                      ))}
                    </div>
                    {pc.hasCode && (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderRadius: 12, background: "#0d0a09", border: "1px dashed rgba(242,182,58,.4)" }}>
                        <span style={{ font: `600 22px ${mono}`, letterSpacing: ".16em", color: "#F2B63A" }}>{PAIR_CODE}</span>
                        <span style={{ font: `500 10px ${mono}`, letterSpacing: ".1em", color: "#A39A8E" }}>EXPIRES 10:00</span>
                      </div>
                    )}
                    {!added && !pairBusy && (
                      <button className="gold" onClick={pair} style={{ height: 42, borderRadius: 999, background: "#F2B63A", border: "none", color: "#15110D", fontSize: 14, fontWeight: 700 }}>{pc.cta}</button>
                    )}
                    {pairBusy && !added && (
                      <div style={{ height: 42, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 999, background: "rgba(255,255,255,.06)", font: `500 12px ${mono}`, letterSpacing: ".1em", color: "#F2B63A" }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#F2B63A", animation: "kpulse 1s infinite" }} />VERIFYING
                      </div>
                    )}
                    {added && (
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <div style={{ flex: 1, height: 42, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 999, background: "rgba(61,190,139,.14)", font: `600 12px ${mono}`, letterSpacing: ".1em", color: "#3DBE8B" }}>✓ KOBE IS LIVE HERE</div>
                        <button className="ghost" onClick={() => setChannels((st) => ({ ...st, [pc.id]: false }))} style={{ height: 42, padding: "0 16px", borderRadius: 999, background: "transparent", border: "1px solid rgba(255,255,255,.16)", color: "#F4F1EC", fontSize: 13 }}>Remove</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {reportOpen && (
        <PersonReport
          saved={savedRecord}
          form={form}
          onForm={setForm}
          onEdit={editRecord}
          onSave={saveForm}
          onCancel={cancelForm}
          onClose={closeReport}
          onAsk={(prompt) => { closeReport(); runAgent(prompt); }}
          saveError={saveError}
        />
      )}
    </>
  );
}
