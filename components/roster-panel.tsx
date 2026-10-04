"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { RECORDS, type Person as GamePerson, type RecordId } from "@/lib/data";
import { game, useGame } from "@/lib/game";
import { PersonReport } from "@/src/PersonReport";
import {
  CRM_STORAGE_KEY,
  blankPerson,
  browserStorage,
  findPerson,
  fromForm,
  initials,
  peopleFromStoredJson,
  readPeople,
  readPeopleForUpdate,
  toForm,
  writePeople,
  type Person as CrmPerson,
  type PersonForm,
} from "@/src/crm";

export function crmToGame(person: CrmPerson): GamePerson {
  return {
    id: person.id,
    name: person.name,
    role: person.role,
    tier: person.tier,
    birthday: person.birthday,
    last: person.lastTouch,
    next: person.nextPlan,
    points: person.points,
    loop: person.openLoop,
    sources: person.sources,
    rapport: person.score ?? 50,
  };
}

export function gameToCrm(person: GamePerson): CrmPerson {
  const seed = person.id in RECORDS ? RECORDS[person.id as RecordId] : undefined;
  return {
    id: person.id,
    name: person.name,
    role: person.role,
    tier: person.tier,
    birthday: person.birthday,
    lastTouch: person.last,
    nextPlan: person.next,
    openLoop: person.loop,
    sources: [...person.sources],
    points: [...person.points],
    sample: !!seed,
    score: person.rapport,
    action: seed?.action ?? "",
    prompt: seed?.prompt ?? "",
  };
}

// Without Postgres the roster stays in this browser. An empty save is a real roster, not a reason to put the seed back.
export function browserRoster(fallback: GamePerson[]): GamePerson[] {
  const stored = readPeople(browserStorage());
  if (!stored.length) return fallback;
  return stored.map(crmToGame);
}

function payload(person: CrmPerson) {
  return {
    id: person.id,
    name: person.name,
    role: person.role,
    tier: person.tier,
    birthday: person.birthday,
    last: person.lastTouch,
    next: person.nextPlan,
    loop: person.openLoop,
    points: person.points,
    sources: person.sources,
  };
}

function Overlay({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

export function RosterControl({ persisted }: { persisted: boolean }) {
  const people = useGame((s) => s.people);
  const list = Object.values(people).sort((a, b) => a.name.localeCompare(b.name));
  const [open, setOpen] = useState(false);
  const [record, setRecord] = useState<string | null>(null);
  const [form, setForm] = useState<PersonForm | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (persisted) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CRM_STORAGE_KEY || event.newValue == null) return;
      const next = peopleFromStoredJson(event.newValue);
      if (next) game.replacePeople(next.map(crmToGame));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [persisted]);

  useEffect(() => {
    if (!open && !record) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSaveError(null);
      setForm(null);
      setRecord(null);
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, record]);

  const startCreate = () => {
    const person = blankPerson();
    setSaveError(null);
    setForm(toForm(person));
    setRecord(person.id);
    setOpen(false);
  };

  const openRecord = (id: string) => {
    setSaveError(null);
    setForm(null);
    setRecord(id);
    setOpen(false);
  };

  const fail = (message: string) => setSaveError(message);

  const showSaved = (person: GamePerson) => {
    game.upsertPerson(person);
    setSaveError(null);
    setForm(null);
    setRecord(person.id);
  };

  const saveLocal = (snapshot: PersonForm) => {
    const storage = browserStorage();
    const stored = readPeopleForUpdate(storage);
    if (!stored) return false;
    const existing = findPerson(stored, snapshot.id) ?? (people[snapshot.id] ? gameToCrm(people[snapshot.id]) : undefined);
    const nextPerson = fromForm(snapshot, existing);
    const next = findPerson(stored, nextPerson.id) ? stored.map((item) => (item.id === nextPerson.id ? nextPerson : item)) : [...stored, nextPerson];
    if (!writePeople(storage, next)) return false;
    game.replacePeople(next.map(crmToGame));
    setSaveError(null);
    setForm(null);
    setRecord(nextPerson.id);
    return true;
  };

  const saveForm = () => {
    if (!form) return;
    const snapshot = form;
    if (persisted) {
      const existing = people[snapshot.id] ? gameToCrm(people[snapshot.id]) : undefined;
      const nextPerson = fromForm(snapshot, existing);
      void fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(nextPerson)),
      })
        .then(async (res) => {
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as { error?: string } | null;
            fail(body?.error ?? "Couldn't save this person.");
            return;
          }
          showSaved((await res.json()) as GamePerson);
        })
        .catch(() => fail("Couldn't save this person."));
      return;
    }
    const denied = () => fail("Couldn't save. Browser storage rejected the write, so this record is unchanged.");
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) {
      if (!saveLocal(snapshot)) denied();
      return;
    }
    try {
      void locks.request(CRM_STORAGE_KEY, () => {
        if (!saveLocal(snapshot)) denied();
      }).catch(() => denied());
    } catch {
      denied();
    }
  };

  const saved = record && people[record] ? gameToCrm(people[record]) : null;

  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Roster" className="glass press flex h-[38px] flex-none items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold whitespace-nowrap">
        Roster
        <span className="label rounded-md bg-gold/20 px-1.5 py-0.5 text-gold">{list.length}</span>
      </button>
      {open && (
        <Overlay>
        <div onClick={() => setOpen(false)} className="fixed inset-0 z-[70] grid place-items-center bg-[rgba(8,5,4,.55)] p-5 backdrop-blur-[6px]">
          <div onClick={(event) => event.stopPropagation()} className="flex max-h-[84vh] w-[min(860px,100%)] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[rgba(18,13,16,.92)] shadow-[0_40px_100px_rgba(0,0,0,.6)] backdrop-blur-[26px]">
            <div className="flex items-center gap-4 px-5.5 pt-5">
              <span className="display text-[38px]">Roster</span>
              <button onClick={() => setOpen(false)} aria-label="Close" className="press ml-auto grid h-[34px] w-[34px] place-items-center rounded-full bg-white/[.06] text-lg">
                ×
              </button>
            </div>
            <div className="flex flex-col gap-4 overflow-y-auto px-5.5 pt-3 pb-6">
              <p className="text-sm text-[#BDB5AA]">
                {persisted
                  ? "Each person is a record in Postgres. Creates and edits stay after a reload, and logging a draft updates their rapport."
                  : "Each person is a record in this browser. Creates and edits stay after a reload. Postgres is not connected."}
              </p>
              <button onClick={startCreate} aria-label="Add person" className="press h-[38px] self-start rounded-full bg-gold px-4 text-[13.5px] font-bold text-ink">
                Add person
              </button>
              <div className="overflow-hidden rounded-2xl border border-white/[.08]">
                {list.map((person) => {
                  const crm = gameToCrm(person);
                  return (
                    <button
                      key={person.id}
                      aria-label={`Open ${person.name || "empty record"}`}
                      onClick={() => openRecord(person.id)}
                      className="row press flex w-full flex-wrap items-center gap-3 border-b border-white/[.06] px-3.5 py-3 text-left"
                    >
                      <span className="display grid h-[34px] w-[34px] flex-none place-items-center rounded-full bg-gold/15 text-[14px] text-gold">{initials(person.name)}</span>
                      <span className="flex min-w-[140px] flex-1 flex-col gap-0.5">
                        <span className="text-[14.5px] font-semibold">{person.name}</span>
                        <span className="text-[12.5px] text-[#BDB5AA]">{person.role}</span>
                      </span>
                      {crm.sample ? <span className="label text-[10px] text-chalk-3">SAMPLE</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        </Overlay>
      )}
      {record && (
        <Overlay>
        <PersonReport
          saved={form && !saved ? null : saved}
          form={form}
          onForm={setForm}
          onEdit={() => {
            if (!saved) return;
            setSaveError(null);
            setForm(toForm(saved));
          }}
          onSave={saveForm}
          onCancel={() => {
            const exists = !!saved;
            setSaveError(null);
            setForm(null);
            if (!exists) setRecord(null);
          }}
          onClose={() => {
            setSaveError(null);
            setForm(null);
            setRecord(null);
          }}
          onAsk={(prompt) => {
            setRecord(null);
            setForm(null);
            game.ask(prompt);
          }}
          saveError={saveError}
        />
        </Overlay>
      )}
    </>
  );
}
