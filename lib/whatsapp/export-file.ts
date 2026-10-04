import { unzipSync, type Unzipped } from "fflate";
import { ImportError } from "./parse";

const MAX_BYTES = 50 * 1024 * 1024;
const CHAT_FILE_NAME = /^(?:WhatsApp Chat(?: with| -)|Chat de WhatsApp(?: con| -)) (.+)$/i;

function chatNameFrom(fileName: string): string | null {
  const base = fileName.split(/[\\/]/).pop()!.replace(/\.(zip|txt)$/i, "").replace(/ \(\d+\)$/, "");
  return CHAT_FILE_NAME.exec(base)?.[1].trim() || null;
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

export function readExportFile(fileName: string, bytes: Uint8Array): { chatName: string | null; text: string } {
  if (bytes.length > MAX_BYTES) {
    throw new ImportError("This file is larger than 50 MB. Export the chat again and choose Without media.");
  }
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) {
    if (/\.zip$/i.test(fileName)) throw new ImportError("This .zip file is damaged. Export the chat again from WhatsApp.");
    return { chatName: chatNameFrom(fileName), text: decode(bytes) };
  }
  let files: Unzipped;
  try {
    files = unzipSync(bytes, { filter: (file) => /\.txt$/i.test(file.name) && !file.name.startsWith("__MACOSX/") });
  } catch {
    throw new ImportError("This .zip file is damaged. Export the chat again from WhatsApp.");
  }
  const names = Object.keys(files);
  const chat = names.find((name) => name.split("/").pop() === "_chat.txt") ?? names[0];
  if (!chat) throw new ImportError("This .zip has no chat text (_chat.txt) in it. Export the chat again from WhatsApp.");
  return { chatName: chatNameFrom(fileName) ?? chatNameFrom(chat), text: decode(files[chat]) };
}
