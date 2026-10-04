import { unzipSync, type Unzipped } from "fflate";
import { MAX_EXPORT_BYTES, TOO_LARGE } from "./limits";
import { ImportError } from "./parse";

const CHAT_FILE_NAME = /^(?:WhatsApp Chat(?: with| -)|Chat de WhatsApp(?: con| -)) (.+)$/i;

function chatNameFrom(fileName: string): string | null {
  const base = fileName.split(/[\\/]/).pop()!.replace(/\.(zip|txt)$/i, "").replace(/ \(\d+\)$/, "");
  return CHAT_FILE_NAME.exec(base)?.[1].trim() || null;
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

export function readExportFile(fileName: string, bytes: Uint8Array): { chatName: string | null; text: string } {
  if (bytes.length > MAX_EXPORT_BYTES) throw new ImportError(TOO_LARGE);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) {
    if (/\.zip$/i.test(fileName)) throw new ImportError("This .zip file is damaged. Export the chat again from WhatsApp.");
    return { chatName: chatNameFrom(fileName), text: decode(bytes) };
  }
  let files: Unzipped;
  let unpacked = 0;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        if (!/\.txt$/i.test(file.name) || file.name.startsWith("__MACOSX/")) return false;
        // fflate inflates each entry into a buffer of exactly its declared size and never grows it,
        // so capping the declared sizes before inflating caps the memory a crafted .zip can take.
        unpacked += file.originalSize;
        if (unpacked > MAX_EXPORT_BYTES) {
          throw new ImportError("This .zip unpacks to more than 50 MB of chat text. Export the chat again and choose Without media.");
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError("This .zip file is damaged. Export the chat again from WhatsApp.");
  }
  const names = Object.keys(files);
  const chat = names.find((name) => name.split("/").pop() === "_chat.txt") ?? names[0];
  if (!chat) throw new ImportError("This .zip has no chat text (_chat.txt) in it. Export the chat again from WhatsApp.");
  return { chatName: chatNameFrom(fileName) ?? chatNameFrom(chat), text: decode(files[chat]) };
}
