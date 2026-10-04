export class ImportError extends Error {}

export type ParsedMessage = { sentAt: Date; sender: string; body: string; kind: "text" | "media" };

export type ParsedChat = {
  platform: "ios" | "android";
  messages: ParsedMessage[];
  senders: string[];
  systemLines: number;
  chatNameHint: string | null;
};

type Header = {
  platform: "ios" | "android";
  dayOrMonth: number;
  monthOrDay: number;
  year: number;
  hour: number;
  minute: number;
  second: number;
  rest: string;
};

const LRM = "\u200E";
const MARKS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const LEADING_MARKS = /^[\u200E\u200F\u202A-\u202E\u2066-\u2069]+/;
const HEADER =
  /^(\[)?(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2}),? (\d{1,2}):(\d{2})(?::(\d{2}))?(?: ?([ap])\.? ?m\.?)?(\] | - )(.*)$/i;
const DATED = /^\[?\d{1,2}[/.-]\d{1,2}[/.-]\d{2}/;
const MEDIA =
  /^(?:<Media omitted>|<Multimedia omitido>|(?:image|video|audio|sticker|GIF) omitted|imagen omitida|(?:video|audio|sticker|GIF) omitido|<(?:attached|adjunto): .+>|.*\b(?:document omitted|documento omitido))$/i;

const notAnExport = (hint: string) =>
  new ImportError(
    `This file is not a WhatsApp chat export: ${hint}. In WhatsApp, open the chat, choose Export chat → Without media, and import that file.`,
  );

function readHeader(line: string): Header | null {
  const m = HEADER.exec(line);
  if (!m) return null;
  const [, bracket, dayOrMonth, monthOrDay, year, hour, minute, second, half, separator, rest] = m;
  if (Boolean(bracket) !== separator.startsWith("]")) return null;
  const h = Number(hour);
  return {
    platform: bracket ? "ios" : "android",
    dayOrMonth: Number(dayOrMonth),
    monthOrDay: Number(monthOrDay),
    year: year.length === 2 ? 2000 + Number(year) : Number(year),
    hour: half ? (h % 12) + (half.toLowerCase() === "p" ? 12 : 0) : h,
    minute: Number(minute),
    second: Number(second ?? 0),
    rest,
  };
}

function wallClock(h: Header, dayFirst: boolean): number | null {
  const [day, month] = dayFirst ? [h.dayOrMonth, h.monthOrDay] : [h.monthOrDay, h.dayOrMonth];
  const wall = Date.UTC(h.year, month - 1, day, h.hour, h.minute, h.second);
  const back = new Date(wall);
  const exists = back.getUTCDate() === day && back.getUTCMonth() === month - 1 && h.hour < 24 && h.minute < 60 && h.second < 60;
  return exists ? wall : null;
}

// The export writes dates in the phone's locale with no marker of the order, so read it off the data.
function readsDayFirst(headers: Header[]): boolean {
  if (headers.some((h) => h.dayOrMonth > 12)) return true;
  if (headers.some((h) => h.monthOrDay > 12)) return false;
  const inOrder = (dayFirst: boolean) => {
    const walls = headers.map((h) => wallClock(h, dayFirst));
    return walls.every((wall, i) => wall !== null && (i === 0 || walls[i - 1]! <= wall));
  };
  return inOrder(true) || !inOrder(false);
}

function zonedInstant(timeZone: string): (wall: number) => Date {
  let format: Intl.DateTimeFormat;
  try {
    const n = "numeric";
    format = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: n, month: n, day: n, hour: n, minute: n, second: n });
  } catch {
    throw new ImportError(`"${timeZone}" is not a time zone. Use an IANA name such as America/Argentina/Buenos_Aires.`);
  }
  const offset = (instant: number) => {
    const p = Object.fromEntries(format.formatToParts(instant).map((part) => [part.type, Number(part.value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant;
  };
  return (wall) => new Date(wall - offset(wall - offset(wall)));
}

const cleanSender = (raw: string) => raw.replace(MARKS, "").replace(/^~ ?/, "").trim();

export function parseWhatsAppChat(text: string, opts: { timeZone: string }): ParsedChat {
  const toInstant = zonedInstant(opts.timeZone);
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/[\u00A0\u202F]/g, " ").replace(LEADING_MARKS, ""));
  const headers = lines.map(readHeader);
  const found = headers.filter((h) => h !== null);
  if (!found.length) {
    throw notAnExport('no line starts with a date and time like "[04/10/26, 14:03:22]" or "04/10/26, 14:03 -"');
  }
  const unknownDated = lines.filter((line, i) => !headers[i] && DATED.test(line)).length;
  if (unknownDated > found.length) {
    throw notAnExport(`${unknownDated} lines start with a date in a format Kobe does not recognize`);
  }
  const stray = lines.slice(0, headers.indexOf(found[0])).findIndex((line) => line.trim());
  if (stray >= 0) throw notAnExport(`line ${stray + 1} does not start with a date and time`);

  const platform = found[0].platform;
  const dayFirst = readsDayFirst(found);
  const messages: ParsedMessage[] = [];
  let systemLines = 0;
  let chatNameHint: string | null = null;
  let current: ParsedMessage | null = null;

  for (let i = 0; i < lines.length; i++) {
    const h = headers[i];
    if (!h) {
      if (current) current.body += `\n${lines[i]}`;
      continue;
    }
    const wall = wallClock(h, dayFirst);
    if (wall === null) throw new ImportError(`Line ${i + 1} of this chat export has a date or time that does not exist.`);
    const colon = h.rest.indexOf(": ");
    const sender = colon < 0 ? "" : cleanSender(h.rest.slice(0, colon));
    const raw = colon < 0 ? "" : h.rest.slice(colon + 2);
    const body = raw.replace(LEADING_MARKS, "");
    const kind = MEDIA.test(body) ? "media" : "text";
    // iOS writes its own notices (encryption, deleted messages, missed calls) as a message that starts with an LRM.
    if (!sender || (platform === "ios" && raw.startsWith(LRM) && kind === "text")) {
      systemLines++;
      if (platform === "ios" && sender) chatNameHint ??= sender;
      current = null;
      continue;
    }
    current = { sentAt: toInstant(wall), sender, body, kind };
    messages.push(current);
  }

  if (!messages.length) throw new ImportError("This chat export has no messages to import, only WhatsApp notices.");
  for (const message of messages) message.body = message.body.trimEnd();
  return { platform, messages, senders: [...new Set(messages.map((m) => m.sender))], systemLines, chatNameHint };
}
