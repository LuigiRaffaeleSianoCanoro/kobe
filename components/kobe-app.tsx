"use client";

import {
  AssistantRuntimeProvider,
  AttachmentPrimitive,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useLocalRuntime,
  type AssistantRuntime,
  type EmptyMessagePartProps,
} from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { Mic, Paperclip, Square } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { kobeAdapter } from "@/lib/agent";
import { type ConnectorFlags } from "@/lib/connectors";
import { CHANNELS, PLAYS, RECORDS, SOURCE_GROUPS, levelFor, type Person, type RecordId } from "@/lib/data";
import { game, registerAsk, useGame } from "@/lib/game";
import { LANG_NAMES, dictation, useHydrated, useVoice, voice } from "@/lib/voice";
import { describeImport, whatsAppAttachments, type ImportResult } from "@/lib/whatsapp/upload";
import { CourtShader } from "./court-shader";
import { SavedPlanList, SetPlan } from "./plan-panel";
import { ServiceLogo } from "./service-logo";
import { BriefCard, ConflictCard, ConnectorDraftCard, ConnectorSendCard, DraftCard, GmailSearchCard, ImportCard, PeopleCard, PlanCard, SlackSearchCard } from "./tool-cards";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const CHIPS = ["Who has a birthday this week?", "Brief me on Marcus", "Any conflicts this week?", "Who haven't I talked to lately?", "Remind me before Maya's birthday"];

// Live: Mastra agent on the Neon AI Gateway via /api/chat. Offline: scripted local agent.
const transport = new AssistantChatTransport({ api: "/api/chat" });

let postImport: (result: ImportResult, file: { id: string; name: string }) => void = () => {};
// WhatsApp imports need the database. Without one the composer takes no files at all: an explicit
// undefined also turns off the AI SDK runtime's default adapter, which would send files to the model.
const WITH_IMPORTS = { dictation, attachments: whatsAppAttachments((result, file) => postImport(result, file)) };
const NO_FILES = { dictation, attachments: undefined };

type Wiring = { roster: Person[]; persisted: boolean };

const ConnectorStatus = createContext<ConnectorFlags>({ gmail: false, slack: false });
const useConnectorStatus = () => useContext(ConnectorStatus);

const idle = (runtime: AssistantRuntime) =>
  new Promise<void>((resolve) => {
    const unsubscribe = runtime.thread.subscribe(() => {
      if (runtime.thread.getState().isRunning) return;
      unsubscribe();
      resolve();
    });
    if (!runtime.thread.getState().isRunning) {
      unsubscribe();
      resolve();
    }
  });

function useWire(runtime: AssistantRuntime, { roster, persisted }: Wiring) {
  useEffect(() => {
    registerAsk((text) => runtime.thread.append({ role: "user", content: [{ type: "text", text }] }));
    postImport = async ({ report, roster }, file) => {
      game.mergeServerRoster(roster);
      const card = describeImport(report);
      game.notify(card.summary);
      const composer = runtime.thread.composer;
      // Let the adapter's add() finish before dropping its chip.
      setTimeout(() => {
        const index = composer.getState().attachments.findIndex((a) => a.id === file.id);
        if (index >= 0) composer.getAttachmentByIndex(index).remove();
      });
      // A streaming reply rewrites the last message, so post the card once Kobe is done talking.
      await idle(runtime);
      runtime.thread.append({ role: "user", content: [{ type: "text", text: file.name }], startRun: false });
      runtime.thread.append({ role: "assistant", content: [{ type: "data", name: "whatsapp-import", data: card }], startRun: false });
    };
    game.load(roster, persisted);
    return game.startFeed();
  }, [runtime, roster, persisted]);
}

function LiveKobe({ connectors, ...wiring }: Wiring & { connectors: ConnectorFlags }) {
  const adapters = wiring.persisted ? WITH_IMPORTS : NO_FILES;
  const runtime = useChatRuntime({ transport, adapters });
  useWire(runtime, wiring);
  return <Court runtime={runtime} connectors={connectors} imports={wiring.persisted} />;
}

function ScriptedKobe({ connectors, ...wiring }: Wiring & { connectors: ConnectorFlags }) {
  const adapters = wiring.persisted ? WITH_IMPORTS : NO_FILES;
  const runtime = useLocalRuntime(kobeAdapter, { adapters });
  useWire(runtime, wiring);
  return <Court runtime={runtime} connectors={connectors} imports={wiring.persisted} />;
}

export function KobeApp({ live, connectors, ...wiring }: Wiring & { live: boolean; connectors: ConnectorFlags }) {
  return live ? <LiveKobe connectors={connectors} {...wiring} /> : <ScriptedKobe connectors={connectors} {...wiring} />;
}

function Court({ runtime, connectors, imports }: { runtime: AssistantRuntime; connectors: ConnectorFlags; imports: boolean }) {
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ConnectorStatus.Provider value={connectors}>
      {/* A file dropped anywhere on the page goes to the composer instead of replacing the page. */}
      <ComposerPrimitive.AttachmentDropzone className="group/drop contents">
      <CourtShader />
      <div className="grain" aria-hidden />
      <Header />
      <Thread />
      <Composer imports={imports} />
      <Lane />
      <Integrations imports={imports} />
      <RecordModal />
      </ComposerPrimitive.AttachmentDropzone>
      </ConnectorStatus.Provider>
    </AssistantRuntimeProvider>
  );
}

/* ───────────────────────── Header + season HUD ───────────────────────── */

function Ball({ size = 26, line = 1.5 }: { size?: number; line?: number }) {
  return (
    <span
      className="relative block flex-none overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        background:
          "radial-gradient(circle at 32% 28%, rgba(255,220,180,.4), transparent 45%), radial-gradient(circle, rgba(60,20,0,.35) .8px, transparent 1.2px) 0 0/3px 3px, radial-gradient(circle at 70% 75%, #9c3f0c, #e0712a 70%)",
      }}
    >
      <span className="absolute inset-y-0 left-1/2 bg-[#2a1206]" style={{ width: line, marginLeft: -line / 2 }} />
      <span className="absolute inset-x-0 top-1/2 bg-[#2a1206]" style={{ height: line, marginTop: -line / 2 }} />
      <span className="absolute -inset-y-[10%] -left-[62%] w-full rounded-full border-[#2a1206]" style={{ borderWidth: line }} />
      <span className="absolute -inset-y-[10%] -right-[62%] w-full rounded-full border-[#2a1206]" style={{ borderWidth: line }} />
    </span>
  );
}

function Header() {
  const ref = useRef<HTMLElement>(null);
  // The header wraps to a second row when its items overflow; everything pinned below it reads --header-h.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <header ref={ref} className="fixed inset-x-0 top-0 z-20 flex min-h-[68px] flex-wrap content-center items-center gap-x-3 gap-y-2 px-4 py-2 min-[1000px]:gap-x-4 min-[1000px]:px-5">
      <div className="flex flex-none items-center gap-2.5">
        <Ball />
        <span className="display text-[26px] leading-none">
          KOBE<span className="text-gold">.AI</span>
        </span>
      </div>
      <SeasonHud />
      <div className="ml-auto flex max-w-full flex-wrap justify-end gap-2">
        <button onClick={() => game.openModal("sources")} className="glass press flex h-[38px] flex-none items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold whitespace-nowrap">
          Integrations
          <HeaderLive />
        </button>
        <button onClick={() => game.openModal("channels")} className="press flex h-[38px] flex-none items-center gap-2 rounded-full bg-chalk px-4 text-[13px] font-bold whitespace-nowrap text-ink">
          Add Kobe to…
        </button>
      </div>
    </header>
  );
}

function SeasonHud() {
  const xp = useGame((s) => s.xp);
  const streak = useGame((s) => s.streak);
  const assists = useGame((s) => s.assists);
  const floaters = useGame((s) => s.floaters);
  const lvl = levelFor(xp);
  const reduce = useReducedMotion();
  return (
    <div className="glass relative hidden items-center gap-3 rounded-full py-1 pr-4 pl-1 lg:flex">
      <motion.span
        key={lvl.name}
        initial={reduce ? false : { opacity: 0, transform: "scale(0.9)", filter: "blur(4px)" }}
        animate={{ opacity: 1, transform: "scale(1)", filter: "blur(0px)" }}
        transition={{ duration: 0.3, ease: EASE_OUT }}
        className="display rounded-full bg-gold px-3 py-1.5 text-[15px] text-ink"
      >
        {lvl.name}
      </motion.span>
      <div className="flex w-48 flex-col gap-1">
        <div className="label flex justify-between gap-2 text-[9.5px] whitespace-nowrap text-chalk-3">
          <span className="text-chalk">
            <Counter value={xp} /> XP
          </span>
          <span>{lvl.next ? `${lvl.toNext} TO ${lvl.next}` : "MAX LEVEL"}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full origin-left rounded-full bg-[linear-gradient(90deg,#9B6CE0,#F2B63A)]"
            animate={{ transform: `scaleX(${lvl.progress})` }}
            transition={{ type: "spring", duration: 0.6, bounce: 0.15 }}
          />
        </div>
      </div>
      <Stat k="STREAK" v={`${streak}D`} />
      <Stat k="ASSISTS" v={<Counter value={assists} />} />
      <div className="pointer-events-none absolute top-full left-4 mt-2">
        <AnimatePresence>
          {floaters.map((f) => (
            <motion.div
              key={f.id}
              initial={{ opacity: 0, transform: "translateY(6px)" }}
              animate={{ opacity: 1, transform: "translateY(0px)" }}
              exit={{ opacity: 0, transform: "translateY(-10px)", transition: { duration: 0.2 } }}
              transition={{ duration: 0.3, ease: EASE_OUT }}
              className="label whitespace-nowrap text-gold"
            >
              {f.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex flex-col items-start leading-none">
      <span className="label text-[9px] text-chalk-3">{k}</span>
      <span className="display text-[20px]">{v}</span>
    </div>
  );
}

function Counter({ value }: { value: number }) {
  const spring = useSpring(value, { stiffness: 120, damping: 20 });
  const text = useTransform(spring, (v) => Math.round(v).toString());
  useEffect(() => spring.set(value), [spring, value]);
  return <motion.span>{text}</motion.span>;
}

/* ───────────────────────── Thread ───────────────────────── */

function Thread() {
  return (
    <ThreadPrimitive.Root className="contents">
      <ThreadPrimitive.Viewport className="chat-mask fixed top-(--header-h) right-0 bottom-[104px] left-0 z-[5] overflow-y-auto min-[1000px]:right-[380px]">
        <div className="mx-auto flex max-w-[720px] flex-col gap-3.5 px-5 pt-[96px] pb-8 min-[1000px]:pt-[6vh]">
          <Hero />
          <motion.div {...enter} className="flex max-w-[92%] items-start gap-2.5">
            <span className="mt-0.5">
              <Ball size={28} />
            </span>
            <AgentText text="Morning. Three things need you today. They'll pop up as they come in, or ask me about anyone." />
          </motion.div>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

function Hero() {
  const reduce = useReducedMotion();
  const today = useMemo(
    () => new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase().replace(",", ""),
    [],
  );
  return (
    <div className="mb-5 flex flex-col gap-3.5">
      <span className="label text-gold">COURTSIDE · {today}</span>
      <h1 className="display max-w-[560px] text-[clamp(52px,8.5vw,92px)] [text-wrap:balance]">
        {["Know", "your", "people."].map((w, i) => (
          <motion.span
            key={w}
            className="mr-[0.22em] inline-block"
            initial={reduce ? false : { opacity: 0, transform: "translateY(24px)", filter: "blur(6px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)", filter: "blur(0px)" }}
            transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.1 + i * 0.07 }}
          >
            {w}
          </motion.span>
        ))}
      </h1>
      <p className="max-w-[520px] text-base leading-normal text-chalk-2 [text-wrap:pretty]">
        Never miss a birthday, double-book a night, or walk into a conversation cold.
      </p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {CHIPS.map((c, i) => (
          <motion.div
            key={c}
            initial={reduce ? false : { opacity: 0, transform: "translateY(8px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ duration: 0.4, ease: EASE_OUT, delay: 0.35 + i * 0.05 }}
          >
            <ThreadPrimitive.Suggestion prompt={c} send asChild>
              <button className="glass chip press h-[34px] rounded-full px-3.5 text-[13px]">{c}</button>
            </ThreadPrimitive.Suggestion>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

const enter = {
  initial: { opacity: 0, transform: "translateY(10px)" },
  animate: { opacity: 1, transform: "translateY(0px)" },
  transition: { duration: 0.35, ease: EASE_OUT },
};

function UserMessage() {
  return (
    <MessagePrimitive.Root asChild>
      <motion.div {...enter} className="max-w-[78%] self-end rounded-[18px_18px_4px_18px] bg-chalk px-4 py-2.5 text-[15px] leading-snug text-ink">
        <MessagePrimitive.Parts />
      </motion.div>
    </MessagePrimitive.Root>
  );
}

function AgentText({ text }: { text: string }) {
  return (
    <div className="glass self-start rounded-[4px_18px_18px_18px] px-4 py-3 text-[15px] leading-normal [text-wrap:pretty]">{text}</div>
  );
}

// The chat library keeps the error only on the newest message, so an older failed turn has to remember its own text.
const failedTurns = new Map<string, string>();

function failedTurnCopy(status: EmptyMessagePartProps["status"]) {
  if (status.type !== "incomplete" || status.reason !== "error") return;
  const error = status.error;
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message) return error.message;
}

function Thinking({ status }: EmptyMessagePartProps) {
  const id = useAuiState((s) => s.message.id);
  const copy = failedTurnCopy(status);
  if (id && copy) failedTurns.set(id, copy);
  if (status.type === "running") {
    if (id) failedTurns.delete(id);
    return (
      <div className="glass flex gap-1.5 self-start rounded-[4px_18px_18px_18px] px-4 py-3.5">
        {[0, 0.15, 0.3].map((d) => (
          <span key={d} className="h-1.5 w-1.5 rounded-full bg-gold" style={{ animation: `kdot 1s ${d}s infinite` }} />
        ))}
      </div>
    );
  }
  // The live error is already rendered by MessagePrimitive.Error.
  if (copy) return null;
  return <AgentText text={(id && failedTurns.get(id)) || "Kobe couldn't answer that one."} />;
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root asChild>
      <motion.div {...enter} className="flex max-w-[92%] items-start gap-2.5">
        <span className="mt-0.5">
          <Ball size={28} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <MessagePrimitive.Parts
            unstable_showEmptyOnNonTextEnd={false}
            components={{
              Text: AgentText,
              Empty: Thinking,
              tools: {
                by_name: {
                  show_people: PeopleCard,
                  pregame_brief: BriefCard,
                  draft_message: DraftCard,
                  resolve_conflict: ConflictCard,
                  set_plan: PlanCard,
                  gmail_search: GmailSearchCard,
                  gmail_draft: ConnectorDraftCard,
                  gmail_send: ConnectorSendCard,
                  slack_search: SlackSearchCard,
                  slack_draft: ConnectorDraftCard,
                  slack_send: ConnectorSendCard,
                },
              },
              data: { by_name: { "whatsapp-import": ImportCard } },
            }}
          />
          <MessagePrimitive.Error>
            <ErrorPrimitive.Root className="glass self-start rounded-[4px_18px_18px_18px] px-4 py-3 text-[15px] leading-normal [text-wrap:pretty]">
              <ErrorPrimitive.Message />
            </ErrorPrimitive.Root>
          </MessagePrimitive.Error>
        </div>
      </motion.div>
    </MessagePrimitive.Root>
  );
}

/* ───────────────────────── Composer ───────────────────────── */

const PLACEHOLDER = "Ask Kobe about anyone you know";

let measure: CanvasRenderingContext2D | null = null;

// A textarea wraps a placeholder that doesn't fit, and the autosizing input then grows to two
// lines. Keep the whole words that fit on one line instead.
function placeholderThatFits(el: HTMLTextAreaElement) {
  const style = getComputedStyle(el);
  const budget = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 1;
  measure ??= document.createElement("canvas").getContext("2d");
  if (!measure) return `${PLACEHOLDER}…`;
  measure.font = style.font;
  let kept = "";
  for (const word of PLACEHOLDER.split(" ")) {
    const next = kept ? `${kept} ${word}` : word;
    if (measure.measureText(`${next}…`).width > budget) break;
    kept = next;
  }
  return `${kept}…`;
}

// Opens the file picker; the chosen export goes through the composer like a dropped file.
function PickExport({ onPick, ...button }: Omit<ComponentProps<"button">, "onClick"> & { onPick?: () => void }) {
  const aui = useAui();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" {...button} onClick={() => input.current?.click()} />
      <input
        ref={input}
        type="file"
        accept=".zip,.txt"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          onPick?.();
          // A failed import shows its error on the chip.
          aui.composer.addAttachment(file).catch(() => {});
        }}
      />
    </>
  );
}

function ImportChips() {
  const notice = useGame((s) => s.notice);
  return (
    <div aria-live="polite" className="mb-2 flex flex-col items-start gap-1.5">
      <ComposerPrimitive.Attachments>
        {({ attachment: a }) => (
          <AttachmentPrimitive.Root className="glass flex max-w-full items-center gap-2.5 rounded-2xl bg-[rgba(16,12,20,.94)]! py-2 pr-2 pl-3.5 text-[13px] leading-snug">
            {a.status.type === "incomplete" ? (
              <>
                <span className="h-2 w-2 flex-none rounded-full bg-red" />
                <span className="min-w-0 [text-wrap:pretty]">
                  <span className="font-semibold">Couldn&apos;t import <AttachmentPrimitive.Name />.</span> {a.status.message}
                </span>
                <AttachmentPrimitive.Remove aria-label="Dismiss import error" className="press grid h-[22px] w-[22px] flex-none place-items-center rounded-full bg-white/[.06] text-sm text-chalk-2">
                  ×
                </AttachmentPrimitive.Remove>
              </>
            ) : (
              <>
                <span className="h-2 w-2 flex-none rounded-full bg-gold motion-safe:animate-pulse" />
                <span className="min-w-0 truncate pr-1.5">
                  Importing <AttachmentPrimitive.Name />…
                </span>
              </>
            )}
          </AttachmentPrimitive.Root>
        )}
      </ComposerPrimitive.Attachments>
      <p className="sr-only">{notice}</p>
    </div>
  );
}

function Composer({ imports }: { imports: boolean }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [placeholder, setPlaceholder] = useState(`${PLACEHOLDER}…`);
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    const fit = () => setPlaceholder(placeholderThatFits(el));
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    document.fonts?.ready.then(fit);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="fixed right-0 bottom-[22px] left-0 z-10 px-4 min-[1000px]:right-[380px]">
      <VoiceNotice />
      <div className="mx-auto max-w-[720px]">
        {imports && <ImportChips />}
        <p className="label mb-2 hidden w-fit rounded-full bg-gold px-3 py-1.5 text-ink group-data-[dragging=true]/drop:block">Drop a WhatsApp export to import it</p>
      </div>
      <ComposerPrimitive.Root
        className={`glass mx-auto flex max-w-[720px] items-center gap-2.5 rounded-full py-2 pr-2 shadow-[0_24px_60px_rgba(0,0,0,.5)] group-data-[dragging=true]/drop:outline-2 group-data-[dragging=true]/drop:outline-gold ${imports ? "pl-2" : "pl-5"}`}
      >
        {imports && (
          <PickExport aria-label="Import a WhatsApp chat export" title="Import a WhatsApp chat (.zip or .txt)" className="press grid h-10 w-10 flex-none place-items-center rounded-full text-chalk-2 hover:bg-white/[.06]">
            <Paperclip size={18} aria-hidden />
          </PickExport>
        )}
        <ComposerPrimitive.Input
          ref={input}
          rows={1}
          autoFocus
          placeholder={placeholder}
          aria-label={PLACEHOLDER}
          className="h-10 min-w-0 flex-1 resize-none bg-transparent py-2.5 text-[15.5px] text-chalk outline-none placeholder:text-chalk-3"
        />
        <Dictation />
        <ComposerPrimitive.Send asChild>
          <button title="Send" className="ball flex-none rounded-full shadow-[0_6px_18px_rgba(224,113,42,.45)] disabled:opacity-60">
            <Ball size={46} line={2} />
          </button>
        </ComposerPrimitive.Send>
      </ComposerPrimitive.Root>
    </div>
  );
}

// Push-to-talk. Hidden until hydration and in browsers without Web Speech.
function Dictation() {
  const hydrated = useHydrated();
  const lang = useVoice((s) => s.lang);
  const listening = useAuiState((s) => s.composer.dictation != null);
  const [local, setLocal] = useState(false);
  const refocus = useRef(false);
  useEffect(() => {
    let live = true;
    dictation?.prepare().then(() => live && setLocal(!!dictation?.isLocal()));
    return () => {
      live = false;
    };
  }, [lang]);
  if (!hydrated || !dictation) return null;

  // Starting or stopping swaps the button. Keep keyboard focus on whichever one is showing.
  const handoff = {
    onClick: (e: MouseEvent<HTMLButtonElement>) => {
      refocus.current = document.activeElement === e.currentTarget;
      voice.notify(null);
    },
    ref: (el: HTMLButtonElement | null) => {
      if (el && refocus.current && el !== document.activeElement) {
        refocus.current = false;
        el.focus();
      }
    },
  };
  const other = lang === "es" ? "en" : "es";
  const dictate = `Dictate in ${LANG_NAMES[lang]}${local ? ", on this device" : ""}`;
  return (
    <>
      <button
        type="button"
        disabled={listening}
        onClick={() => voice.setLang(other)}
        title={`Dictation language: ${LANG_NAMES[lang]}. Switch to ${LANG_NAMES[other]}`}
        aria-label={`Dictation language: ${LANG_NAMES[lang]}. Switch to ${LANG_NAMES[other]}`}
        className="label press h-8 min-w-8 flex-none rounded-full px-1.5 text-chalk-3 hover:text-gold disabled:opacity-40"
      >
        {lang}
      </button>
      <AuiIf condition={(s) => s.composer.dictation == null}>
        <ComposerPrimitive.Dictate asChild>
          <button {...handoff} title={dictate} aria-label={dictate} className="mic glass press grid h-10 w-10 flex-none place-items-center rounded-full text-chalk-2">
            <Mic size={18} aria-hidden />
          </button>
        </ComposerPrimitive.Dictate>
      </AuiIf>
      <AuiIf condition={(s) => s.composer.dictation != null}>
        <ComposerPrimitive.StopDictation asChild>
          <button {...handoff} title="Stop dictation" aria-label="Stop dictation" className="listening press grid h-10 w-10 flex-none place-items-center rounded-full bg-gold text-ink">
            <Square size={13} fill="currentColor" aria-hidden />
          </button>
        </ComposerPrimitive.StopDictation>
      </AuiIf>
    </>
  );
}

function VoiceNotice() {
  const notice = useVoice((s) => s.notice);
  const reduce = useReducedMotion();
  return (
    <div role="status" aria-live="polite" className="mx-auto flex max-w-[720px] justify-center">
      <AnimatePresence>
        {notice && (
          <motion.div
            key={notice}
            initial={{ opacity: 0, transform: reduce ? "none" : "translateY(6px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="glass mb-2 rounded-full px-4 py-2 text-center text-[13px] leading-snug text-chalk-2 [text-wrap:pretty]"
          >
            {notice}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ───────────────────────── Lane: game plan + sample feed alerts ───────────────────────── */

// Wide screens get a right-hand lane. Below 1000px it becomes a strip under the header that
// shows the game plan collapsed and only the newest alert.
function Lane() {
  const alerts = useGame((s) => s.alerts);
  const visible = [...alerts].reverse().filter((a) => a.visible);
  return (
    <aside className="pointer-events-none fixed top-[calc(var(--header-h)+16px)] right-4 left-4 z-30 flex flex-col gap-2.5 min-[1000px]:top-[calc(var(--header-h)+8px)] min-[1000px]:right-5 min-[1000px]:bottom-[104px] min-[1000px]:left-auto min-[1000px]:w-[340px] min-[1000px]:overflow-y-auto min-[1000px]:pb-5">
      <GamePlan />
      {visible.length > 1 && (
        <button onClick={game.clearAlerts} className="glass label press pointer-events-auto hidden h-[26px] self-end rounded-full px-2.5 text-chalk-2 min-[1000px]:block">
          CLEAR {visible.length}
        </button>
      )}
      <AnimatePresence initial={false}>
        {visible.map((a, i) => (
          <motion.div
            key={a.id}
            layout
            initial={{ opacity: 0, transform: "translateY(-10px) scale(0.96)", filter: "blur(6px)" }}
            animate={{ opacity: 1, transform: "translateY(0px) scale(1)", filter: "blur(0px)" }}
            exit={{ opacity: 0, transform: "translateX(24px) scale(0.98)", transition: { duration: 0.18, ease: EASE_OUT } }}
            transition={{ duration: 0.4, ease: EASE_OUT, layout: { type: "spring", duration: 0.4, bounce: 0 } }}
            className={`glass pointer-events-auto flex-col gap-2 rounded-[18px] bg-[rgba(16,12,20,.94)]! p-4 pr-3.5 min-[1000px]:bg-[rgba(16,12,20,.76)]! shadow-[0_18px_50px_rgba(0,0,0,.5)] ${i === 0 ? "flex" : "hidden min-[1000px]:flex"}`}
          >
            <div className="label flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: a.color, boxShadow: `0 0 12px ${a.color}` }} />
              <span className="text-chalk">{a.kind}</span>
              <span className="truncate text-chalk-3">· {a.source}</span>
              <span className="ml-auto text-chalk-3">NOW</span>
              <button onClick={() => game.dismiss(a.id)} aria-label="Dismiss" className="press grid h-[22px] w-[22px] place-items-center rounded-full bg-white/[.06] text-sm text-chalk-2">
                ×
              </button>
            </div>
            <div className="text-[15px] leading-tight font-semibold [text-wrap:pretty]">{a.title}</div>
            <div className="text-[13px] leading-snug text-[#CFC7BB] [text-wrap:pretty]">{a.body}</div>
            {a.a1 && (
              <div className="mt-0.5 flex gap-2">
                {[a.a1, a.a2].filter(Boolean).map((act, i) => (
                  <button
                    key={act!.label}
                    onClick={() => {
                      game.dismiss(a.id);
                      if (act!.run) game.ask(act!.run);
                      if (act!.record) game.openRecord(act!.record);
                    }}
                    className={`press h-[30px] rounded-full px-3 text-[12.5px] ${i === 0 ? "bg-chalk font-bold text-ink" : "border border-white/15"}`}
                  >
                    {act!.label}
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </aside>
  );
}

function GamePlan() {
  const plays = useGame((s) => s.plays);
  const [open, setOpen] = useState(false);
  const done = PLAYS.filter((p) => plays[p.id]).length;
  const prompts: Record<string, string> = { maya: "Draft a birthday message for Maya", marcus: "Brief me on Marcus", dev: "Draft a reply to Dev" };
  return (
    <div className="glass pointer-events-auto flex flex-col gap-3 rounded-[18px] bg-[rgba(16,12,20,.94)]! px-4 py-3 min-[1000px]:bg-(--glass)! min-[1000px]:p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center justify-between text-left min-[1000px]:pointer-events-none min-[1000px]:items-end"
      >
        <div className="flex flex-col gap-1">
          <span className="label text-gold">TODAY&apos;S GAME PLAN</span>
          <span className="display text-[22px] min-[1000px]:text-[28px]">
            {done}/{PLAYS.length} plays
          </span>
        </div>
        <ShotClock done={done} total={PLAYS.length} />
      </button>
      <div className={`flex-col ${open ? "flex" : "hidden"} min-[1000px]:flex`}>
        {PLAYS.map((p) => {
          const ok = plays[p.id];
          return (
            <button
              key={p.id}
              disabled={ok}
              onClick={() => game.ask(prompts[p.id])}
              className="row press flex items-center gap-3 rounded-lg px-1 py-2 text-left disabled:cursor-default"
            >
              <span className={`grid h-5 w-5 flex-none place-items-center rounded-md border transition-colors duration-200 ${ok ? "border-green bg-green text-ink" : "border-white/20"}`}>
                <AnimatePresence>
                  {ok && (
                    <motion.svg initial={{ opacity: 0, transform: "scale(0.6)" }} animate={{ opacity: 1, transform: "scale(1)" }} transition={{ duration: 0.2, ease: EASE_OUT }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
                      <path d="M5 12l5 5L20 7" />
                    </motion.svg>
                  )}
                </AnimatePresence>
              </span>
              <span className={`flex-1 text-[13.5px] ${ok ? "text-chalk-3 line-through" : ""}`}>{p.label}</span>
              <span className="label text-gold">+{p.xp}</span>
            </button>
          );
        })}
        <div className="mt-1 flex flex-col gap-2 border-t border-white/10 pt-2">
          <SavedPlanList />
          <SetPlan />
        </div>
      </div>
    </div>
  );
}

function ShotClock({ done, total }: { done: number; total: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 48 48" className="h-10 w-10 -rotate-90 min-[1000px]:h-12 min-[1000px]:w-12">
      <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="4" />
      <motion.circle
        cx="24"
        cy="24"
        r={r}
        fill="none"
        stroke="var(--gold)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        animate={{ strokeDashoffset: c * (1 - done / total) }}
        transition={{ type: "spring", duration: 0.7, bounce: 0.1 }}
      />
    </svg>
  );
}

/* ───────────────────────── Modals ───────────────────────── */

function Modal({ open, onClose, children, width }: { open: boolean; onClose: () => void; children: ReactNode; width: number }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 grid place-items-center bg-[rgba(8,5,4,.55)] p-5 backdrop-blur-[6px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, transform: "scale(0.96) translateY(8px)" }}
            animate={{ opacity: 1, transform: "scale(1) translateY(0px)" }}
            exit={{ opacity: 0, transform: "scale(0.98)", transition: { duration: 0.15 } }}
            transition={{ duration: 0.3, ease: EASE_OUT }}
            style={{ width: `min(${width}px, 100%)` }}
            className="flex max-h-[86vh] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[rgba(18,13,16,.92)] shadow-[0_40px_100px_rgba(0,0,0,.6)] backdrop-blur-[26px]"
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function probedLive(id: string, connected: ConnectorFlags) {
  return (id === "gmail" && connected.gmail) || (id === "slack" && connected.slack);
}

function LiveBadge() {
  return <span className="label flex-none rounded-md bg-green/15 px-1.5 py-0.5 text-[10px] text-green">LIVE</span>;
}

function NotConnected() {
  return <span className="label flex-none rounded-md bg-white/[.07] px-1.5 py-0.5 text-[10px] text-chalk-3">NOT CONNECTED</span>;
}

function HeaderLive() {
  const connected = useConnectorStatus();
  if (!connected.gmail && !connected.slack) return null;
  return <LiveBadge />;
}

function connectedNote(connected: ConnectorFlags) {
  const names = [connected.gmail ? "Gmail" : null, connected.slack ? "Slack" : null].filter((name): name is string => !!name);
  if (names.length === 0) return null;
  const verb = names.length > 1 ? "are" : "is";
  return `${names.join(" and ")} ${verb} connected. Kobe can search and draft there, and sending waits for an explicit confirm.`;
}

const EXPORT_STEPS = [
  { phone: "iPhone", steps: ["Open the chat in WhatsApp.", "Tap the contact's name at the top.", "Export Chat → Without Media."] },
  { phone: "Android", steps: ["Open the chat in WhatsApp.", "Tap ⋮ → More.", "Export chat → Without media."] },
];

function WhatsAppImport({ imports, onPick }: { imports: boolean; onPick: () => void }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="label text-gold">MESSAGES</span>
      <div className="flex flex-col gap-3.5 rounded-[14px] border border-white/[.08] bg-white/[.035] p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-white/[.07] text-[#CFC7BB]"><ServiceLogo id="whatsapp" size={22} /></span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-semibold">WhatsApp</span>
            <span className="text-xs text-[#ACA397]">{imports ? "Import a chat export, one person or group at a time" : "Importing chats needs a database (DATABASE_URL)"}</span>
          </span>
          {imports ? (
            <PickExport onPick={onPick} className="press h-[34px] flex-none rounded-full bg-chalk px-3.5 text-[13px] font-bold text-ink">
              Import a chat
            </PickExport>
          ) : (
            <NotConnected />
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {EXPORT_STEPS.map(({ phone, steps }) => (
            <div key={phone} className="flex flex-col gap-1.5">
              <span className="label text-[9.5px] text-chalk-3">ON {phone}</span>
              <ol className="flex flex-col gap-1 text-[13px] leading-snug text-[#CFC7BB]">
                {steps.map((step, i) => (
                  <li key={step} className="flex gap-2">
                    <span className="label flex-none pt-px text-gold">{i + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <span className="text-xs text-[#ACA397]">Get the .zip or .txt onto this computer, then pick it here or drop it on the chat.</span>
      </div>
    </div>
  );
}

function Integrations({ imports }: { imports: boolean }) {
  const modal = useGame((s) => s.modal);
  const connected = useConnectorStatus();
  const close = () => game.openModal(null);
  const tab = modal === "channels" ? "channels" : "sources";
  return (
    <Modal open={!!modal} onClose={close} width={860}>
      <div className="flex items-center gap-4 px-5.5 pt-5">
        <div className="flex gap-1 rounded-full bg-white/[.06] p-1">
          {(["sources", "channels"] as const).map((t) => (
            <button key={t} onClick={() => game.openModal(t)} className="press relative h-8 rounded-full px-3.5 text-[13px] font-bold">
              {tab === t && <motion.span layoutId="tab" className="absolute inset-0 rounded-full bg-chalk" transition={{ type: "spring", duration: 0.35, bounce: 0 }} />}
              <span className={`relative transition-colors duration-200 ${tab === t ? "text-ink" : "text-chalk-2"}`}>{t === "sources" ? "Integrations" : "Add Kobe to…"}</span>
            </button>
          ))}
        </div>
        <button onClick={close} aria-label="Close" className="press ml-auto grid h-[34px] w-[34px] place-items-center rounded-full bg-white/[.06] text-lg">
          ×
        </button>
      </div>
      <div className="flex flex-col gap-5.5 overflow-y-auto px-5.5 pt-5 pb-6">
        {tab === "sources" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <div className="display text-[38px]">Scouting sources</div>
              <div className="text-sm text-[#BDB5AA]">
                {connectedNote(connected) ?? "Gmail and Slack are the live connectors. Every other source stays on this device and does not send."}
                {imports ? " WhatsApp chats can be imported from an export." : ""}
              </div>
            </div>
            <WhatsAppImport imports={imports} onPick={close} />
            {SOURCE_GROUPS.map((g) => (
              <div key={g.name} className="flex flex-col gap-2.5">
                <span className="label text-gold">{g.name}</span>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2">
                  {g.items.map((it) => (
                    <div key={it.id} className="flex items-center gap-3 rounded-[14px] border border-white/[.08] bg-white/[.035] p-3">
                      <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-white/[.07] text-[#CFC7BB]"><ServiceLogo id={it.id} size={22} /></span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-sm font-semibold">{it.name}</span>
                        <span className="truncate text-xs text-[#ACA397]">{probedLive(it.id, connected) ? "Live connector" : "Not connected"}</span>
                      </span>
                      {probedLive(it.id, connected) ? <LiveBadge /> : <NotConnected />}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <div className="display text-[38px]">Put Kobe in your rotation</div>
              <div className="text-sm text-[#BDB5AA]">{connectedNote(connected) ?? "Slack can send. Telegram, WhatsApp, and Discord are not connected."}</div>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
              {CHANNELS.map((ch) => (
                <div key={ch.id} className="flex items-center gap-3 rounded-[14px] border border-white/[.07] bg-white/[.025] p-3">
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-white/[.08]"><ServiceLogo id={ch.id} size={22} /></span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-semibold">{ch.name}</span>
                    <span className="truncate text-xs text-[#ACA397]">{probedLive(ch.id, connected) ? "Live connector" : "Not connected"}</span>
                  </span>
                  {probedLive(ch.id, connected) ? <LiveBadge /> : <NotConnected />}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function RecordModal() {
  const r = useGame((s) => (s.record ? s.people[s.record] : undefined));
  const close = () => game.openRecord(null);
  const seed = r && r.id in RECORDS ? RECORDS[r.id as RecordId] : undefined;
  const action = seed?.action ?? "Brief me";
  const prompt = seed?.prompt ?? `Brief me on ${r?.name}`;
  return (
    <Modal open={!!r} onClose={close} width={460}>
      {r && (
        <div className="flex flex-col gap-4.5 overflow-y-auto p-5.5">
          <div className="flex items-start gap-4">
            <div className="flex flex-1 flex-col gap-2">
              <span className="label text-gold">SCOUTING REPORT</span>
              <span className="display text-[46px]">{r.name}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13.5px] text-[#CFC7BB]">{r.role}</span>
                <span className="label rounded-md bg-gold/15 px-1.5 py-0.5 text-[10px] text-gold">{r.tier}</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span className="display text-[76px] leading-[.85] text-transparent [-webkit-text-stroke:1.5px_var(--gold)]">
                <Counter value={r.rapport} />
              </span>
              <span className="label text-[9.5px] text-chalk-3">RAPPORT</span>
            </div>
          </div>
          <div className="grid grid-cols-[96px_1fr] gap-x-3.5 gap-y-2.5 border-y border-white/[.08] py-3.5 text-[13.5px]">
            {[
              ["BIRTHDAY", r.birthday],
              ["LAST TOUCH", r.last],
              ["NEXT UP", r.next],
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <span className="label pt-0.5 text-chalk-3">{k}</span>
                <span>{v || "—"}</span>
              </div>
            ))}
          </div>
          {/* Someone new from a WhatsApp import has no talking points or open loop yet. */}
          {r.points.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="label text-gold">TALKING POINTS</span>
              {r.points.map((pt) => (
                <div key={pt} className="flex gap-2.5 text-sm leading-snug text-[#E6E0D7]">
                  <span className="mt-[7px] h-1.5 w-1.5 flex-none rotate-45 bg-gold" />
                  <span>{pt}</span>
                </div>
              ))}
            </div>
          )}
          {r.loop && <div className="rounded-xl bg-gold/10 px-3.5 py-3 text-[13.5px] leading-snug text-[#F4E3BC]">Open loop: {r.loop}</div>}
          <div className="flex flex-col gap-2">
            <span className="label text-gold">Triggers & routines</span>
            <SavedPlanList personId={r.id} />
            <SetPlan personId={r.id} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {r.sources.map((s) => (
              <span key={s} className="label rounded-full border border-white/15 px-2 py-1 text-[#CFC7BB]">
                {s}
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                close();
                game.ask(prompt);
              }}
              className="press h-[42px] flex-1 rounded-full bg-gold text-sm font-bold text-ink"
            >
              {action}
            </button>
            <button onClick={close} className="press h-[42px] rounded-full border border-white/15 px-4.5 text-sm">
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
