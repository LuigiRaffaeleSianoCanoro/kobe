"use client";

import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { deliverDraft } from "@/lib/connectors";
import { isDraftChannel } from "@/lib/data";
import { game, useGame } from "@/lib/game";
import { planDetail, planFromToolArgs, planIdForCard, recordSupports, samePlan, type PlanCondition, type PlanKind } from "@/lib/plans";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

// Tool args stream in as partial JSON from the model, so every field is optional here.
type Partial<T> = { [K in keyof T]?: T[K] };
const usePerson = (id?: string) => useGame((s) => (id ? s.people[id] : undefined));

function CardIn({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(10px) scale(0.98)", filter: "blur(4px)" }}
      animate={{ opacity: 1, transform: "translateY(0px) scale(1)", filter: "blur(0px)" }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

const Diamond = () => <span className="mt-[7px] h-1.5 w-1.5 flex-none rotate-45 bg-gold" />;

function Shimmer({ w = "100%" }: { w?: string }) {
  return <span className="block h-3 animate-pulse rounded bg-white/10" style={{ width: w }} />;
}

type Person = { id: string; meta: string; right: string };

export function PeopleCard({ args }: ToolCallMessagePartProps) {
  const { title, people } = args as Partial<{ title: string; people: Partial<Person>[] }>;
  const roster = useGame((s) => s.people);
  const rows = (people ?? []).filter((p): p is Person => !!p?.id);
  return (
    <CardIn className="glass overflow-hidden rounded-2xl">
      <div className="label flex items-center justify-between px-4 pt-3 pb-2 text-gold">
        <span>{title ?? "ROSTER"}</span>
        <span className="text-chalk-3">RAPPORT</span>
      </div>
      {rows.map((p, i) => {
        const person = roster[p.id];
        const name = person?.name ?? p.id;
        const score = person?.rapport ?? 50;
        return (
          <motion.button
            key={p.id}
            onClick={() => person && game.openRecord(p.id)}
            initial={{ opacity: 0, transform: "translateY(6px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ duration: 0.3, ease: EASE_OUT, delay: 0.08 + i * 0.05 }}
            className="row press flex w-full items-center gap-3 border-t border-white/[.06] px-4 py-3 text-left"
          >
            <span className="display grid h-9 w-9 flex-none place-items-center rounded-full bg-gold/15 text-[15px] text-gold">
              {name.split(" ").map((w) => w[0]).join("")}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[14.5px] font-semibold">{name}</span>
              <span className="text-[12.5px] text-[#BDB5AA]">{p.meta}</span>
            </span>
            <span className="hidden w-20 flex-col items-end gap-1 sm:flex">
              <span className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                <motion.span
                  className="block h-full origin-left rounded-full bg-gold"
                  initial={{ transform: "scaleX(0)" }}
                  animate={{ transform: `scaleX(${score / 100})` }}
                  transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.15 + i * 0.05 }}
                />
              </span>
              <span className="label text-chalk-3">{score}</span>
            </span>
            <span className="label w-[72px] text-right text-gold">{p.right}</span>
          </motion.button>
        );
      })}
      {rows.length === 0 && (
        <div className="flex flex-col gap-2 border-t border-white/[.06] px-4 py-4">
          <Shimmer w="60%" />
          <Shimmer w="40%" />
        </div>
      )}
    </CardIn>
  );
}

type Brief = { name: string; next: string; points: string[]; loop: string };

export function BriefCard({ args, result }: ToolCallMessagePartProps) {
  const { recordId } = args as Partial<{ recordId: string }>;
  const person = usePerson(recordId);
  const b = (result as Brief | undefined)?.name ? (result as Brief) : person;

  useEffect(() => {
    if (recordId === "marcus") game.completePlay("marcus");
  }, [recordId]);

  return (
    <CardIn className="glass flex flex-col gap-3 rounded-2xl border-gold/25! p-4">
      <div className="flex items-baseline gap-2.5">
        <span className="label text-gold">PREGAME</span>
        <span className="text-[12.5px] text-[#BDB5AA]">{b?.next}</span>
      </div>
      {b ? (
        <>
          <div className="display text-[34px]">{b.name}</div>
          <div className="flex flex-col gap-2">
            {b.points.map((pt) => (
              <div key={pt} className="flex gap-2.5 text-[14px] leading-snug text-[#E6E0D7]">
                <Diamond />
                <span>{pt}</span>
              </div>
            ))}
          </div>
          <div className="rounded-[10px] bg-gold/10 px-3 py-2.5 text-[13.5px] text-[#F4E3BC]">Open loop: {b.loop}</div>
          {person && (
            <button onClick={() => game.openRecord(person.id)} className="press self-start rounded-full bg-chalk px-3.5 py-2 text-[12.5px] font-bold text-ink">
              Full scouting report
            </button>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <Shimmer w="50%" />
          <Shimmer />
          <Shimmer w="80%" />
        </div>
      )}
    </CardIn>
  );
}

type Draft = { recordId: string; channel: string; body: string };

function DraftBody({ draft, logKey, ready }: { draft: Partial<Draft>; logKey: string; ready: boolean }) {
  const sent = useGame((s) => !!s.sent[logKey]);
  const person = usePerson(draft.recordId);
  const [edited, setEdited] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [armed, setArmed] = useState(false);
  const body = edited ?? draft.body ?? "";
  const to = person?.name ?? draft.recordId ?? "";
  const channel = isDraftChannel(draft.channel) ? draft.channel : undefined;

  const copyDraft = async () => {
    if (!channel || !body) return;
    const copied = (await navigator.clipboard?.writeText(body).then(() => true, () => false)) ?? false;
    setNotice(copied ? "Copied. Not sent." : "Couldn't copy. Not sent.");
  };
  const sendDraft = async () => {
    if (!ready || !body || sending || sent) return;
    if (!armed) {
      setArmed(true);
      setNotice("Sending waits for an explicit confirm.");
      return;
    }
    if (!channel) {
      setNotice("That channel is not connected.");
      return;
    }
    setSending(true);
    const result = await deliverDraft(channel, { to, body });
    setSending(false);
    if (!result.ok) {
      setNotice(result.reason);
      return;
    }
    game.recordSent(logKey, { personId: person?.id, to, channel, body });
  };
  return (
    <>
      <div className="label flex items-center gap-2 text-[#BDB5AA]">
        <span>DRAFT</span>
        <span>→ {to}</span>
        <span className="ml-auto text-gold">{draft.channel}</span>
      </div>
      {editing ? (
        <textarea
          autoFocus
          value={body}
          onChange={(e) => setEdited(e.target.value)}
          rows={3}
          className="w-full resize-none rounded-xl border border-white/10 bg-black/30 p-3 text-[15px] leading-normal outline-none focus:border-gold/50"
        />
      ) : (
        <p className="min-h-6 text-[15px] leading-normal">
          {body}
          {!ready && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-gold" />}
        </p>
      )}
      {sent ? (
        <motion.div
          initial={{ opacity: 0, transform: "translateY(4px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ duration: 0.25, ease: EASE_OUT }}
          className="label text-green"
        >
          ✓ SENT{person ? " · RAPPORT +3" : ""}
        </motion.div>
      ) : (
        <>
          {notice && <div className="text-[12.5px] text-[#BDB5AA]">{notice}</div>}
          <div className="flex flex-wrap gap-2">
            <button
              disabled={!ready || !body || !channel}
              onClick={copyDraft}
              className="press rounded-full bg-gold px-3.5 py-2 text-[12.5px] font-bold text-ink disabled:opacity-50"
            >
              Copy for {draft.channel ?? "…"}
            </button>
            <button disabled={!ready || !body || sending} onClick={sendDraft} className="press rounded-full border border-white/15 px-3.5 py-2 text-[12.5px] disabled:opacity-50">
              {!armed ? "Confirm send" : sending ? "Sending" : "Send this draft"}
            </button>
            <button disabled={!ready} onClick={() => setEditing((e) => !e)} className="press rounded-full border border-white/15 px-3.5 py-2 text-[12.5px] disabled:opacity-50">
              {editing ? "Done" : "Edit"}
            </button>
          </div>
        </>
      )}
    </>
  );
}

export function DraftCard({ args, toolCallId, status }: ToolCallMessagePartProps) {
  return (
    <CardIn className="glass flex flex-col gap-3 rounded-2xl p-4">
      <DraftBody draft={args as Partial<Draft>} logKey={toolCallId} ready={status.type !== "running"} />
    </CardIn>
  );
}

type MailHit = { id?: string; from?: string; subject?: string; date?: string; snippet?: string; link?: string };
type SlackHit = { channel?: string; user?: string; text?: string; link?: string | null };

function asHits<T>(result: unknown): T[] | null {
  if (!result || typeof result !== "object" || !("hits" in result)) return null;
  const hits = (result as { hits?: unknown }).hits;
  return Array.isArray(hits) ? (hits as T[]) : null;
}

function resultError(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("ok" in result)) return null;
  const row = result as { ok?: unknown; error?: unknown };
  if (row.ok !== false) return null;
  return typeof row.error === "string" && row.error.trim() ? row.error : "That didn't work.";
}

function draftIdOf(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("draftId" in result)) return null;
  const id = (result as { draftId?: unknown }).draftId;
  return typeof id === "string" ? id : null;
}

function safeHttpLink(value: unknown, host: "google" | "slack"): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const ok = host === "google" ? url.hostname === "mail.google.com" : url.hostname === "slack.com" || url.hostname.endsWith(".slack.com");
    return ok ? url.toString() : null;
  } catch {
    return null;
  }
}

export function GmailSearchCard({ args, result }: ToolCallMessagePartProps) {
  const query = (args as Partial<{ query: string }>).query;
  const hits = asHits<MailHit>(result);
  const error = resultError(result);
  return (
    <CardIn className="glass flex flex-col gap-2 rounded-2xl p-4">
      <div className="label flex items-center gap-2 text-gold">
        <span>GMAIL</span>
        <span className="truncate text-chalk-3">{query}</span>
      </div>
      {error ? (
        <p className="text-[13.5px] text-red">{error}</p>
      ) : hits ? (
        hits.length === 0 ? (
          <p className="text-[13.5px] text-[#BDB5AA]">No matching threads.</p>
        ) : (
          hits.map((hit) => {
            const link = safeHttpLink(hit.link, "google");
            return (
              <div key={hit.id ?? hit.subject} className="flex flex-col gap-0.5 border-t border-white/[.06] pt-2">
                <span className="text-[14px] font-semibold">{hit.subject || "No subject"}</span>
                <span className="text-[12.5px] text-[#BDB5AA]">{[hit.from, hit.date].filter(Boolean).join(" · ")}</span>
                {hit.snippet && <span className="text-[13px] leading-snug text-[#E6E0D7]">{hit.snippet}</span>}
                {link && (
                  <a href={link} target="_blank" rel="noreferrer" className="text-[12.5px] text-gold">
                    Open in Gmail
                  </a>
                )}
              </div>
            );
          })
        )
      ) : (
        <div className="flex flex-col gap-2">
          <Shimmer w="70%" />
          <Shimmer w="45%" />
        </div>
      )}
    </CardIn>
  );
}

export function SlackSearchCard({ args, result }: ToolCallMessagePartProps) {
  const query = (args as Partial<{ query: string }>).query;
  const hits = asHits<SlackHit>(result);
  const error = resultError(result);
  return (
    <CardIn className="glass flex flex-col gap-2 rounded-2xl p-4">
      <div className="label flex items-center gap-2 text-gold">
        <span>SLACK</span>
        <span className="truncate text-chalk-3">{query}</span>
      </div>
      {error ? (
        <p className="text-[13.5px] text-red">{error}</p>
      ) : hits ? (
        hits.length === 0 ? (
          <p className="text-[13.5px] text-[#BDB5AA]">No matching messages.</p>
        ) : (
          hits.map((hit, index) => {
            const link = safeHttpLink(hit.link, "slack");
            return (
              <div key={`${hit.user ?? "slack"}-${index}`} className="flex flex-col gap-0.5 border-t border-white/[.06] pt-2">
                <span className="text-[12.5px] text-[#BDB5AA]">{[hit.user, hit.channel ? `#${hit.channel}` : ""].filter(Boolean).join(" · ")}</span>
                <span className="text-[14px] leading-snug">{hit.text}</span>
                {link && (
                  <a href={link} target="_blank" rel="noreferrer" className="text-[12.5px] text-gold">
                    Open in Slack
                  </a>
                )}
              </div>
            );
          })
        )
      ) : (
        <div className="flex flex-col gap-2">
          <Shimmer w="70%" />
          <Shimmer w="40%" />
        </div>
      )}
    </CardIn>
  );
}

function ConfirmSend({ draftId }: { draftId: string }) {
  const [step, setStep] = useState<"idle" | "confirm" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const send = async () => {
    setStep("sending");
    setError("");
    try {
      const res = await fetch("/api/connectors/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId, confirm: true }),
      });
      const data = (await res.json().catch(() => null)) as { status?: string; error?: string } | null;
      if (res.ok && data?.status === "sent") {
        setStep("sent");
        return;
      }
      setStep("error");
      setError(data?.error || "Sending waits for an explicit confirm.");
    } catch {
      setStep("error");
      setError("Couldn't reach Kobe to send that.");
    }
  };
  if (step === "sent") return <div className="label text-green">✓ SENT</div>;
  if (step === "confirm" || step === "sending" || step === "error") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[13px] leading-snug text-[#F4E3BC]">Send this draft? This is the confirm.</p>
        {error && <p className="text-[13px] text-red">{error}</p>}
        <div className="flex gap-2">
          <button type="button" disabled={step === "sending"} onClick={() => void send()} className="press rounded-full bg-gold px-3.5 py-2 text-[12.5px] font-bold text-ink disabled:opacity-50">
            {step === "sending" ? "Sending" : "Send this draft"}
          </button>
          <button type="button" disabled={step === "sending"} onClick={() => setStep("idle")} className="press rounded-full border border-white/15 px-3.5 py-2 text-[12.5px] disabled:opacity-50">
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <button type="button" onClick={() => setStep("confirm")} className="press self-start rounded-full bg-gold px-3.5 py-2 text-[12.5px] font-bold text-ink">
      Confirm send
    </button>
  );
}

export function ConnectorDraftCard({ args, result, status, toolName }: ToolCallMessagePartProps) {
  const slack = toolName.startsWith("slack");
  const draft = args as Partial<{ to: string; subject: string; body: string; channel: string }>;
  const error = resultError(result);
  const draftId = draftIdOf(result);
  const ready = status.type !== "running";
  const sent = !!result && typeof result === "object" && (result as { status?: string }).status === "sent";
  return (
    <CardIn className="glass flex flex-col gap-3 rounded-2xl p-4">
      <div className="label flex items-center gap-2 text-[#BDB5AA]">
        <span>{slack ? "SLACK DRAFT" : "GMAIL DRAFT"}</span>
        <span className="ml-auto text-gold">{slack ? draft.channel : draft.to}</span>
      </div>
      {!slack && draft.subject && <div className="text-[14px] font-semibold">{draft.subject}</div>}
      <p className="min-h-6 text-[15px] leading-normal">
        {draft.body}
        {!ready && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-gold" />}
      </p>
      {error ? (
        <p className="text-[13px] text-red">{error}</p>
      ) : sent ? (
        <div className="label text-green">✓ SENT</div>
      ) : (
        ready && draftId && <ConfirmSend draftId={draftId} />
      )}
    </CardIn>
  );
}

export function ConnectorSendCard({ result, status }: ToolCallMessagePartProps) {
  const error = resultError(result);
  const draftId = draftIdOf(result);
  const sent = !!result && typeof result === "object" && (result as { status?: string }).status === "sent";
  const waiting = !!result && typeof result === "object" && (result as { status?: string }).status === "awaiting_confirm";
  return (
    <CardIn className="glass flex flex-col gap-3 rounded-2xl p-4">
      <div className="label text-gold">SEND</div>
      {status.type === "running" ? (
        <Shimmer w="50%" />
      ) : sent ? (
        <div className="label text-green">✓ SENT</div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[13.5px] leading-snug text-[#F4E3BC]">{error || "Sending waits for an explicit confirm."}</p>
          {waiting && draftId && <ConfirmSend draftId={draftId} />}
        </div>
      )}
    </CardIn>
  );
}

type Slot = { title: string; source: string; where: string };

function blockedReason(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("ok" in result)) return null;
  const row = result as { ok?: unknown; reason?: unknown };
  if (row.ok !== false) return null;
  return typeof row.reason === "string" && row.reason.trim() ? row.reason : "That can't be saved on the record.";
}

type PlanArgs = { recordId?: string; personId?: string; kind?: PlanKind; condition?: PlanCondition; label?: string; prompt?: string };

export function PlanCard({ args, toolCallId, status, result }: ToolCallMessagePartProps) {
  const draft = args as PlanArgs;
  const recordId = draft.recordId || draft.personId;
  const person = usePerson(recordId);
  const plans = useGame((s) => s.plans);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const allocated = recordId && draft.kind && draft.condition ? planIdForCard(toolCallId || "draft", { personId: recordId, kind: draft.kind, condition: draft.condition }) : null;
  const blocked = blockedReason(result);
  const parsed = planFromToolArgs(draft, allocated ?? "plan_pendingrecord");
  const ready = status.type !== "running" && !!allocated && parsed.success && !!person && !!draft.condition && recordSupports(person, draft.condition) && !blocked;
  const unmet =
    status.type !== "running" && !ready && !blocked
      ? !person
        ? "That person isn't on the roster."
        : person && draft.condition && !recordSupports(person, draft.condition)
          ? `${person.name}'s record doesn't have that, so I won't invent it.`
          : !parsed.success
            ? (parsed.error.issues[0]?.message ?? "That plan can't be saved.")
            : null
      : null;
  const cardMatch = allocated && parsed.success ? plans.find((plan) => plan.id === allocated && samePlan(plan, parsed.data)) : undefined;
  const slotMatch = parsed.success ? plans.find((plan) => samePlan(plan, parsed.data)) : undefined;
  const stored = cardMatch ?? slotMatch;

  const save = async () => {
    if (!parsed.success || busy) return;
    setBusy(true);
    setError(null);
    const saved = await game.savePlan(parsed.data);
    setBusy(false);
    if (saved.status === "rejected") setError(saved.message);
  };

  return (
    <CardIn className="glass flex flex-col gap-3 rounded-2xl border-gold/25! p-4">
      <div className="label flex items-center gap-2 text-gold">
        <span>{draft.kind === "routine" ? "Routine" : "Trigger"}</span>
        <span className="text-chalk-3">On the record</span>
      </div>
      {person && draft.label ? (
        <>
          <div className="text-[15px] leading-snug">{draft.label}</div>
          <div className="text-[13px] leading-snug text-[#BDB5AA]">{person.name}{draft.condition ? ` · ${planDetail(person, draft.condition)}` : ""}</div>
          <p className="text-[12.5px] leading-snug text-chalk-3">This stays on their record. No account is connected.</p>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <Shimmer w="70%" />
          <Shimmer w="45%" />
        </div>
      )}
      {blocked ? (
        <div className="text-[13px] leading-snug text-red">{blocked}</div>
      ) : stored ? (
        <div className="label text-green">{cardMatch ? "✓ On their record" : "✓ Already on their record"}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {error && <div className="text-[13px] leading-snug text-red">{error}</div>}
          {unmet ? (
            <div className="text-[13px] leading-snug text-red">{unmet}</div>
          ) : (
            <button type="button" disabled={!ready || busy} onClick={() => void save()} className="press self-start rounded-full bg-gold px-3.5 py-2 text-[12.5px] font-bold text-ink disabled:opacity-50">
              {busy ? "Saving" : "Save to record"}
            </button>
          )}
        </div>
      )}
    </CardIn>
  );
}

export function ConflictCard({ args, toolCallId, status }: ToolCallMessagePartProps) {
  const c = args as Partial<{ slot: string; a: Partial<Slot>; b: Partial<Slot>; draft: Partial<Draft> }>;
  const slots = [c.a, c.b];
  return (
    <CardIn className="glass flex flex-col gap-3 rounded-2xl border-red/40! p-4">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-red shadow-[0_0_12px_var(--red)]" />
        <span className="label text-red">FOUL · DOUBLE-BOOKED</span>
        <span className="label ml-auto text-chalk-3">{c.slot}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
        {slots.map((s, i) => (
          <div key={i} className={`flex flex-col gap-1 rounded-xl border border-white/10 bg-white/[.03] p-3 ${i === 1 ? "col-start-3" : ""}`}>
            <span className="label text-chalk-3">{s?.source ?? "…"}</span>
            <span className="text-[14px] font-semibold">{s?.title ?? <Shimmer w="70%" />}</span>
            <span className="text-[12.5px] text-[#BDB5AA]">{s?.where}</span>
          </div>
        )).flatMap((el, i) => (i === 0 ? [el, <span key="vs" className="display self-center text-[22px] text-red">VS</span>] : [el]))}
      </div>
      <div className="h-px bg-white/10" />
      <DraftBody draft={c.draft ?? {}} logKey={toolCallId} ready={status.type !== "running"} />
    </CardIn>
  );
}
