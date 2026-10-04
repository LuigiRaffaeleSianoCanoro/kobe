import type { ChangeEvent } from "react";
import type { Person, PersonForm } from "./crm";

const mono = "'JetBrains Mono', monospace";

function Diamond() {
  return <span style={{ flex: "none", width: 6, height: 6, marginTop: 7, background: "#F2B63A", transform: "rotate(45deg)" }} />;
}

function Field({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  const shared = {
    className: "field",
    "aria-label": label,
    value,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
  };
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ font: `500 10.5px ${mono}`, letterSpacing: ".1em", color: "#A39A8E" }}>{label}</span>
      {multiline ? <textarea {...shared} rows={label === "TALKING POINTS" ? 4 : 3} /> : <input {...shared} />}
    </label>
  );
}

export function PersonReport({
  saved,
  form,
  onForm,
  onEdit,
  onSave,
  onCancel,
  onClose,
  onAsk,
  saveError,
}: {
  saved: Person | null;
  form: PersonForm | null;
  onForm: (form: PersonForm) => void;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onClose: () => void;
  onAsk: (prompt: string) => void;
  saveError?: string | null;
}) {
  const editing = form !== null;
  const person = saved;
  const creating = editing && !saved;
  const view = person;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(8,5,4,.5)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "kfade .2s ease both" }}>
      <div onClick={(event) => event.stopPropagation()} style={{ width: "min(460px, 100%)", maxHeight: "86vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 18, padding: 22, borderRadius: 24, background: "rgba(18,13,16,.92)", backdropFilter: "blur(26px)", border: "1px solid rgba(255,255,255,.1)", boxShadow: "0 40px 100px rgba(0,0,0,.6)", animation: "kpop .45s cubic-bezier(.2,1.25,.4,1) both" }}>
        {editing && form ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ font: `500 10.5px ${mono}`, letterSpacing: ".16em", color: "#F2B63A" }}>{creating ? "NEW RECORD" : "EDIT RECORD"}</span>
              <span style={{ fontSize: 14, color: "#BDB5AA" }}>Empty fields stay empty.</span>
            </div>
            <Field label="NAME" value={form.name} onChange={(name) => onForm({ ...form, name })} />
            <Field label="ROLE" value={form.role} onChange={(role) => onForm({ ...form, role })} />
            <Field label="TIER" value={form.tier} onChange={(tier) => onForm({ ...form, tier })} />
            <Field label="BIRTHDAY" value={form.birthday} onChange={(birthday) => onForm({ ...form, birthday })} />
            <Field label="LAST TOUCH" value={form.lastTouch} onChange={(lastTouch) => onForm({ ...form, lastTouch })} />
            <Field label="NEXT PLAN" value={form.nextPlan} onChange={(nextPlan) => onForm({ ...form, nextPlan })} />
            <Field label="OPEN LOOP" value={form.openLoop} onChange={(openLoop) => onForm({ ...form, openLoop })} multiline />
            <Field label="SOURCES" value={form.sourcesText} onChange={(sourcesText) => onForm({ ...form, sourcesText })} multiline />
            <Field label="TALKING POINTS" value={form.pointsText} onChange={(pointsText) => onForm({ ...form, pointsText })} multiline />
            {saveError ? (
              <div role="alert" style={{ fontSize: 13.5, lineHeight: 1.45, color: "#E5484D" }}>{saveError}</div>
            ) : null}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="gold" aria-label="Save record" onClick={onSave} style={{ flex: 1, height: 42, borderRadius: 999, background: "#F2B63A", border: "none", color: "#15110D", fontSize: 14, fontWeight: 700 }}>Save record</button>
              <button className="ghost" aria-label={creating ? "Discard record" : "Cancel edit"} onClick={onCancel} style={{ height: 42, padding: "0 18px", borderRadius: 999, background: "transparent", border: "1px solid rgba(255,255,255,.16)", color: "#F4F1EC", fontSize: 14 }}>{creating ? "Discard" : "Cancel"}</button>
            </div>
          </>
        ) : view ? (
          <>
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ font: `500 10.5px ${mono}`, letterSpacing: ".16em", color: "#F2B63A" }}>SCOUTING REPORT</span>
                <span style={{ fontWeight: 800, fontStretch: "66%", fontSize: 44, lineHeight: 0.92, minHeight: "0.92em", textTransform: "uppercase", overflowWrap: "anywhere" }}>{view.name}</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 13.5, color: "#CFC7BB" }}>{view.role}</span>
                  {view.tier ? <span style={{ font: `600 10px ${mono}`, letterSpacing: ".1em", padding: "3px 7px", borderRadius: 6, background: "rgba(242,182,58,.16)", color: "#F2B63A" }}>{view.tier}</span> : null}
                  {view.sample ? <span style={{ font: `600 10px ${mono}`, letterSpacing: ".1em", padding: "3px 7px", borderRadius: 6, background: "rgba(255,255,255,.08)", color: "#BDB5AA" }}>SAMPLE</span> : null}
                </div>
              </div>
              {view.score !== null && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                  <span style={{ fontWeight: 900, fontStretch: "62%", fontSize: 72, lineHeight: 0.85, color: "transparent", WebkitTextStroke: "1.5px #F2B63A" }}>{view.score}</span>
                  <span style={{ font: `500 9.5px ${mono}`, letterSpacing: ".16em", color: "#A39A8E" }}>RAPPORT</span>
                </div>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: "10px 14px", padding: "14px 0", borderTop: "1px solid rgba(255,255,255,.08)", borderBottom: "1px solid rgba(255,255,255,.08)", fontSize: 13.5 }}>
              <span style={{ font: `500 10.5px ${mono}`, letterSpacing: ".1em", color: "#A39A8E", paddingTop: 2 }}>BIRTHDAY</span><span>{view.birthday}</span>
              <span style={{ font: `500 10.5px ${mono}`, letterSpacing: ".1em", color: "#A39A8E", paddingTop: 2 }}>LAST TOUCH</span><span>{view.lastTouch}</span>
              <span style={{ font: `500 10.5px ${mono}`, letterSpacing: ".1em", color: "#A39A8E", paddingTop: 2 }}>NEXT PLAN</span><span>{view.nextPlan}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ font: `500 10.5px ${mono}`, letterSpacing: ".14em", color: "#F2B63A" }}>TALKING POINTS</span>
              {view.points.map((point, index) => (
                <div key={`${point}-${index}`} style={{ display: "flex", gap: 10, fontSize: 14, lineHeight: 1.45, color: "#E6E0D7" }}><Diamond /><span>{point}</span></div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "11px 13px", borderRadius: 12, background: "rgba(242,182,58,.1)", fontSize: 13.5, lineHeight: 1.45, color: "#F4E3BC" }}>
              <span style={{ font: `500 10.5px ${mono}`, letterSpacing: ".12em", color: "#F2B63A" }}>OPEN LOOP</span>
              <span>{view.openLoop}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ font: `500 10.5px ${mono}`, letterSpacing: ".14em", color: "#A39A8E" }}>SOURCES</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {view.sources.map((source) => (
                  <span key={source} style={{ font: `500 10.5px ${mono}`, letterSpacing: ".06em", padding: "4px 8px", borderRadius: 999, border: "1px solid rgba(255,255,255,.14)", color: "#CFC7BB" }}>{source}</span>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {view.action && view.prompt ? (
                <button className="gold" aria-label={view.action} onClick={() => onAsk(view.prompt, view.id)} style={{ flex: "1 1 160px", height: 42, borderRadius: 999, background: "#F2B63A", border: "none", color: "#15110D", fontSize: 14, fontWeight: 700 }}>{view.action}</button>
              ) : null}
              <button className={view.action && view.prompt ? "ghost" : "gold"} aria-label="Edit record" onClick={onEdit} style={view.action && view.prompt ? { height: 42, padding: "0 16px", borderRadius: 999, background: "transparent", border: "1px solid rgba(255,255,255,.16)", color: "#F4F1EC", fontSize: 14 } : { flex: "1 1 160px", height: 42, borderRadius: 999, background: "#F2B63A", border: "none", color: "#15110D", fontSize: 14, fontWeight: 700 }}>Edit record</button>
              {view.name.trim() && !/^brief me\b/i.test(view.prompt) ? (
                <button className="ghost" aria-label="Brief me" onClick={() => onAsk(`Brief me on ${view.name}`)} style={{ height: 42, padding: "0 16px", borderRadius: 999, background: "transparent", border: "1px solid rgba(255,255,255,.16)", color: "#F4F1EC", fontSize: 14 }}>Brief me</button>
              ) : null}
              <button className="ghost" aria-label="Close report" onClick={onClose} style={{ height: 42, padding: "0 18px", borderRadius: 999, background: "transparent", border: "1px solid rgba(255,255,255,.16)", color: "#F4F1EC", fontSize: 14 }}>Close</button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
