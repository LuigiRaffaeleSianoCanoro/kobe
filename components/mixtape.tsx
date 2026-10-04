"use client";

import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { SAMPLE_CALENDAR } from "@/lib/data";
import { game, useGame } from "@/lib/game";
import { weeklyMixtape, type Mixtape, type MixtapeTrack } from "@/lib/highlights";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

const KIND = { BIRTHDAY: "BIRTHDAY", PLAN: "ON THE BOOKS", TOUCH: "LAST TOUCH" } as const;

function kindLabel(track: MixtapeTrack) {
  if (track.kind === "TOUCH" && track.lines.some((line) => line.from === "logged note")) return "LOGGED NOTE";
  return KIND[track.kind];
}

export function MixtapeView({ tape, onOpen }: { tape: Mixtape; onOpen: (personId: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label text-gold">HIGHLIGHTS</span>
        <span className="label text-chalk-3">{tape.label}</span>
      </div>
      <div className="display text-[34px]">Weekly mixtape</div>
      <p className="text-[13.5px] leading-snug text-[#BDB5AA]">Built from the records and notes already stored.</p>
      <span className="label text-chalk-3">
        {tape.tracks.length} {tape.tracks.length === 1 ? "TRACK" : "TRACKS"}
      </span>
      {tape.tracks.length === 0 ? (
        <p className="text-[14px] leading-snug text-[#E6E0D7]">Nothing dated on those records falls in {tape.label}.</p>
      ) : (
        <div className="flex flex-col">
          {tape.tracks.map((track, index) => (
            <button
              key={track.id}
              type="button"
              onClick={() => onOpen(track.personId)}
              className="row press flex w-full flex-col gap-2 border-t border-white/[.08] py-3 text-left"
            >
              <div className="flex items-baseline gap-3">
                <span className="label w-7 flex-none text-gold">{String(index + 1).padStart(2, "0")}</span>
                <span className="display min-w-0 flex-1 text-[26px]">{track.name}</span>
                <span className="label flex-none text-chalk-3">{track.whenLabel}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-10">
                <span className="label rounded-md bg-gold/15 px-1.5 py-0.5 text-[10px] text-gold">{kindLabel(track)}</span>
                {track.role && <span className="text-[12.5px] text-[#CFC7BB]">{track.role}</span>}
                {track.via.map((channel) => (
                  <span key={channel} className="label text-[10px] text-gold">
                    Copied for {channel}
                  </span>
                ))}
              </div>
              <div className="flex flex-col gap-1 pl-10">
                {track.lines.map((line) => (
                  <p key={`${line.from}:${line.text}`} className="text-[14px] leading-snug">
                    {line.text}
                  </p>
                ))}
              </div>
              {track.notes.length > 0 && (
                <div className="flex flex-col gap-1.5 pl-10">
                  <span className="label text-gold">NOTES</span>
                  {track.notes.map((note) =>
                    note.loop ? (
                      <div key={note.text} className="rounded-[10px] bg-gold/10 px-3 py-2 text-[13px] leading-snug text-[#F4E3BC]">
                        Open loop: {note.text}
                      </div>
                    ) : (
                      <div key={note.text} className="flex gap-2.5 text-[13.5px] leading-snug text-[#E6E0D7]">
                        <span className="mt-[7px] h-1.5 w-1.5 flex-none rotate-45 bg-gold" />
                        <span>{note.text}</span>
                      </div>
                    ),
                  )}
                </div>
              )}
              <span className="label pl-10 text-[9.5px] text-chalk-3">{track.cited}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CardIn({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="glass rounded-2xl p-4"
      initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(10px) scale(0.98)", filter: "blur(4px)" }}
      animate={{ opacity: 1, transform: "translateY(0px) scale(1)", filter: "blur(0px)" }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

export function HighlightsCard() {
  const people = useGame((s) => s.people);
  const touches = useGame((s) => s.touches);
  // Snapshot the records as they are when the card appears, so later edits do not rewrite the tape.
  const [tape] = useState(() => weeklyMixtape(Object.values(people), SAMPLE_CALENDAR, new Date(), touches));
  return (
    <CardIn>
      <MixtapeView tape={tape} onOpen={(id) => game.openRecord(id)} />
    </CardIn>
  );
}
