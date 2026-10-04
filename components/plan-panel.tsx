"use client";

import { useState } from "react";
import { promptForPerson } from "@/lib/data";
import { game, useGame, type PlanStorage } from "@/lib/game";
import {
  conditionsFor,
  describePlan,
  freshPlanId,
  planDetail,
  planDue,
  type PlanCondition,
  type PlanKind,
  type PlanPerson,
} from "@/lib/plans";

function storageCopy(storage: PlanStorage): string {
  if (storage === "postgres") return "Saved with their record.";
  if (storage === "browser") return "Saved in this browser with their record. No account is connected.";
  return "This browser isn't storing records. This lasts until you reload.";
}

function asPlanPerson(person: { id: string; name: string; birthday: string; last: string; next: string; loop: string }): PlanPerson {
  return { ...person, prompt: promptForPerson(person.id, person.name) };
}

export function PlanStorageNote() {
  const storage = useGame((s) => s.planStorage);
  return <p className="text-[12px] leading-snug text-[#BDB5AA]">{storageCopy(storage)}</p>;
}

export function SavedPlanList({ personId }: { personId?: string }) {
  const plans = useGame((s) => s.plans);
  const people = useGame((s) => s.people);
  const mine = plans.filter((plan) => people[plan.personId] && (!personId || plan.personId === personId));
  if (mine.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {!personId && <span className="label text-[9.5px] text-chalk-3">On the record</span>}
      {mine.map((plan) => {
        const person = people[plan.personId];
        const due = planDue(person, plan.condition);
        return (
          <div key={plan.id} className="flex flex-col gap-1 rounded-xl border border-white/10 bg-white/[.03] px-2.5 py-2">
            <div className="flex items-center gap-2">
              <span className="label text-[9px] text-gold">{plan.kind === "trigger" ? "Trigger" : "Routine"}</span>
              {plan.kind === "trigger" && <span className={`label text-[9px] ${due ? "text-green" : "text-chalk-3"}`}>{due ? "Due" : "Not due"}</span>}
              {!personId && <span className="ml-auto truncate text-[11px] text-chalk-3">{person.name}</span>}
            </div>
            <div className="text-[13px] leading-snug">{plan.label}</div>
            <div className="text-[12px] leading-snug text-[#BDB5AA]">{planDetail(person, plan.condition)}</div>
            <div className="mt-1 flex gap-2">
              <button type="button" onClick={() => game.ask(plan.prompt)} className="press h-7 rounded-full bg-chalk px-2.5 text-[12px] font-bold text-ink">
                Run
              </button>
              <button type="button" onClick={() => void game.removePlan(plan.id)} className="press h-7 rounded-full border border-white/15 px-2.5 text-[12px]">
                Remove
              </button>
            </div>
          </div>
        );
      })}
      <PlanStorageNote />
    </div>
  );
}

export function SetPlan({ personId }: { personId?: string }) {
  const plans = useGame((s) => s.plans);
  const [open, setOpen] = useState(false);
  const hasMine = plans.some((plan) => !personId || plan.personId === personId);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="press h-[30px] self-start rounded-full border border-white/15 px-3 text-[12.5px]"
      >
        {open ? "Close" : "Set a trigger or routine"}
      </button>
      {open && (
        <PlanEditor
          personId={personId}
          onSaved={() => setOpen(false)}
        />
      )}
      {open && !hasMine && <PlanStorageNote />}
    </div>
  );
}

function PlanEditor({ personId: lockedId, onSaved }: { personId?: string; onSaved: () => void }) {
  const peopleMap = useGame((s) => s.people);
  const people = Object.values(peopleMap).sort((a, b) => a.name.localeCompare(b.name));
  const [personId, setPersonId] = useState(lockedId && peopleMap[lockedId] ? lockedId : (people[0]?.id ?? ""));
  const [kind, setKind] = useState<PlanKind>("trigger");
  const [condition, setCondition] = useState<PlanCondition>("birthday");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const activeId = lockedId && peopleMap[lockedId] ? lockedId : personId;
  const person = peopleMap[activeId];
  const options = conditionsFor(person ? asPlanPerson(person) : undefined, kind);
  const selected = options.some((option) => option.condition === condition) ? condition : options[0]?.condition;

  const save = async () => {
    if (!person || !selected || busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    const described = describePlan(asPlanPerson(person), selected);
    const result = await game.savePlan({
      id: freshPlanId(),
      personId: person.id,
      kind,
      condition: selected,
      label: described.label,
      prompt: described.prompt,
    });
    setBusy(false);
    if (result.status === "rejected") {
      setError(result.message);
      return;
    }
    if (result.status === "duplicate") {
      setNote("Already on their record.");
      return;
    }
    onSaved();
  };

  if (!person) return null;

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-white/10 bg-black/20 p-2.5">
      <div className="flex gap-1.5">
        {(["trigger", "routine"] as const).map((next) => (
          <button
            key={next}
            type="button"
            onClick={() => setKind(next)}
            className={`press h-7 rounded-full px-2.5 text-[12px] ${kind === next ? "bg-chalk font-bold text-ink" : "border border-white/15"}`}
          >
            {next === "trigger" ? "Trigger" : "Routine"}
          </button>
        ))}
      </div>
      {!lockedId && (
        <label className="flex flex-col gap-1">
          <span className="label text-[9.5px] text-chalk-3">Person</span>
          <select
            value={person?.id ?? ""}
            onChange={(event) => setPersonId(event.target.value)}
            className="scheme-dark h-9 rounded-xl border border-white/15 bg-black/30 px-2 text-[13px] text-chalk outline-none"
          >
            {people.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {options.length > 0 && selected ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {options.map((option) => (
              <button
                key={option.condition}
                type="button"
                onClick={() => setCondition(option.condition)}
                className={`press h-7 rounded-full px-2.5 text-[12px] ${selected === option.condition ? "bg-chalk font-bold text-ink" : "border border-white/15"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="text-[13px] leading-snug">{describePlan(asPlanPerson(person), selected).label}</div>
          <div className="text-[12px] leading-snug text-[#BDB5AA]">{planDetail(person, selected)}</div>
          <p className="text-[12px] leading-snug text-chalk-3">This reads their record. It does not connect an account.</p>
          {note && <p className="text-[12.5px] leading-snug text-green">{note}</p>}
          {error && <p className="text-[12.5px] leading-snug text-red">{error}</p>}
          <button type="button" disabled={busy} onClick={() => void save()} className="press h-8 rounded-full bg-gold text-[12.5px] font-bold text-ink disabled:opacity-50">
            {busy ? "Saving" : "Save to record"}
          </button>
        </>
      ) : (
        <p className="text-[12.5px] leading-snug text-[#BDB5AA]">This record has no birthday, last touch, next plan, or open loop to trigger on.</p>
      )}
    </div>
  );
}
