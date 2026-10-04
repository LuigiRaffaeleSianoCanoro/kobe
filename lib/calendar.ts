// Sample calendar stored with the demo roster. No calendar account reads or replaces it.
export type StoredEvent = {
  when: string;
  title: string;
  source: string;
  where: string;
  person?: string;
};

export const SAMPLE_CALENDAR: StoredEvent[] = [
  { when: "Today 3:30 PM", title: "Coffee with Marcus Reid", source: "GOOGLE CALENDAR", where: "Blue Bottle", person: "marcus" },
  { when: "Thu 7:00 PM", title: "Dinner with Jordan Blake", source: "PARTIFUL", where: "Nopa", person: "jordan" },
  { when: "Thu 7:00 PM", title: "Product sync", source: "GOOGLE CALENDAR", where: "Zoom" },
  { when: "Thu 5:30 PM", title: "(free slot)", source: "GOOGLE CALENDAR", where: "" },
  { when: "Oct 17 morning", title: "(free)", source: "GOOGLE CALENDAR", where: "" },
  { when: "Oct 18 7:00 PM", title: "Family dinner", source: "GOOGLE CALENDAR", where: "Mom's place", person: "dev" },
];
