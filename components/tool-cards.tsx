"use client";

import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { RECORDS, type RecordId } from "@/lib/data";
import { game, useGame } from "@/lib/game";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

// Tool args stream in as partial JSON from the model, so every field is optional here.
type Partial<T> = { [K in keyof T]?: T[K] };
const nameOf = (id?: string) => (id && id in RECORDS ? RECORDS[id as RecordId].name : (id ?? ""));

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
  const rapport = useGame((s) => s.rapport);
  const rows = (people ?? []).filter((p): p is Person => !!p?.id);
  return (
    <CardIn className="glass overflow-hidden rounded-2xl">
      <div className="label flex items-center justify-between px-4 pt-3 pb-2 text-gold">
        <span>{title ?? "ROSTER"}</span>
        <span className="text-chalk-3">RAPPORT</span>
      </div>
      {rows.map((p, i) => {
        const score = rapport[p.id as RecordId] ?? 50;
        return (
          <motion.button
            key={p.id}
            onClick={() => p.id in RECORDS && game.openRecord(p.id as RecordId)}
            initial={{ opacity: 0, transform: "translateY(6px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ duration: 0.3, ease: EASE_OUT, delay: 0.08 + i * 0.05 }}
            className="row press flex w-full items-center gap-3 border-t border-white/[.06] px-4 py-3 text-left"
          >
            <span className="display grid h-9 w-9 flex-none place-items-center rounded-full bg-gold/15 text-[15px] text-gold">
              {nameOf(p.id).split(" ").map((w) => w[0]).join("")}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[14.5px] font-semibold">{nameOf(p.id)}</span>
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
  const { recordId } = args as Partial<{ recordId: RecordId }>;
  const seed = recordId && recordId in RECORDS ? RECORDS[recordId] : null;
  const b = (result as Brief | undefined)?.name ? (result as Brief) : seed;

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
          {recordId && recordId in RECORDS && (
            <button onClick={() => game.openRecord(recordId)} className="press self-start rounded-full bg-chalk px-3.5 py-2 text-[12.5px] font-bold text-ink">
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

function DraftBody({ draft, sendKey, ready }: { draft: Partial<Draft>; sendKey: string; ready: boolean }) {
  const sent = useGame((s) => !!s.sent[sendKey]);
  const [edited, setEdited] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const body = edited ?? draft.body ?? "";
  const to = nameOf(draft.recordId);
  const recordId = draft.recordId && draft.recordId in RECORDS ? (draft.recordId as RecordId) : undefined;
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
          ✓ SENT · ASSIST LOGGED · RAPPORT +3
        </motion.div>
      ) : (
        <div className="flex gap-2">
          <button
            disabled={!ready || !body}
            onClick={() => game.sendDraft(sendKey, recordId, to, draft.channel ?? "Message")}
            className="press rounded-full bg-gold px-3.5 py-2 text-[12.5px] font-bold text-ink disabled:opacity-50"
          >
            Send via {draft.channel ?? "…"}
          </button>
          <button disabled={!ready} onClick={() => setEditing((e) => !e)} className="press rounded-full border border-white/15 px-3.5 py-2 text-[12.5px] disabled:opacity-50">
            {editing ? "Done" : "Edit"}
          </button>
        </div>
      )}
    </>
  );
}

export function DraftCard({ args, toolCallId, status }: ToolCallMessagePartProps) {
  return (
    <CardIn className="glass flex flex-col gap-3 rounded-2xl p-4">
      <DraftBody draft={args as Partial<Draft>} sendKey={toolCallId} ready={status.type !== "running"} />
    </CardIn>
  );
}

type Slot = { title: string; source: string; where: string };

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
      <DraftBody draft={c.draft ?? {}} sendKey={toolCallId} ready={status.type !== "running"} />
    </CardIn>
  );
}
