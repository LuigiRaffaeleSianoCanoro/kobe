import { readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readExportFile } from "../../lib/whatsapp/export-file";
import { ImportError } from "../../lib/whatsapp/parse";

const chatText = readFileSync(new URL("../fixtures/whatsapp/ios-es/_chat.txt", import.meta.url), "utf8");

describe("readExportFile", () => {
  it("reads _chat.txt out of an iPhone .zip and takes the chat name from the file name", () => {
    const zip = zipSync({ "IMG-0001.jpg": new Uint8Array([0xff, 0xd8, 0xff]), "_chat.txt": strToU8(chatText) });

    expect(readExportFile("WhatsApp Chat - Valentina Ríos.zip", zip)).toEqual({ chatName: "Valentina Ríos", text: chatText });
  });

  it("falls back to the first .txt in a .zip that has no _chat.txt", () => {
    const zip = zipSync({ "Chat de WhatsApp con Tomás Herrera.txt": strToU8("hola") });

    expect(readExportFile("export.zip", zip)).toEqual({ chatName: "Tomás Herrera", text: "hola" });
  });

  it("reads an Android .txt and drops the byte order mark", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8("hola")]);

    expect(readExportFile("WhatsApp Chat with Sam Carter.txt", bytes)).toEqual({ chatName: "Sam Carter", text: "hola" });
  });

  it.each([
    ["WhatsApp Chat - Valentina Ríos.zip", "Valentina Ríos"],
    ["WhatsApp Chat with Sam Carter.txt", "Sam Carter"],
    ["Chat de WhatsApp con Asado del sábado.txt", "Asado del sábado"],
    ["Chat de WhatsApp - Tomás Herrera (1).zip", "Tomás Herrera"],
    ["C:\\Downloads\\WhatsApp Chat with Sam Carter (2).txt", "Sam Carter"],
    ["_chat.txt", null],
    ["notes.txt", null],
  ])("reads the chat name from %s", (fileName, chatName) => {
    const bytes = fileName.endsWith(".zip") ? zipSync({ "_chat.txt": strToU8("hola") }) : strToU8("hola");

    expect(readExportFile(fileName, bytes).chatName).toBe(chatName);
  });

  it.each([
    ["a .zip with no chat text", "WhatsApp Chat - Sam Carter.zip", zipSync({ "IMG-0001.jpg": new Uint8Array([1, 2, 3]) }), /no chat text/],
    ["a .zip that is not a zip", "WhatsApp Chat - Sam Carter.zip", strToU8("not a zip"), /damaged/],
    ["a truncated .zip", "WhatsApp Chat - Sam Carter.zip", zipSync({ "_chat.txt": strToU8(chatText) }).slice(0, 40), /damaged/],
    ["a file over 50 MB", "WhatsApp Chat - Sam Carter.txt", new Uint8Array(50 * 1024 * 1024 + 1), /larger than 50 MB/],
  ])("rejects %s with a readable error", (_, fileName, bytes, message) => {
    expect(() => readExportFile(fileName, bytes)).toThrow(ImportError);
    expect(() => readExportFile(fileName, bytes)).toThrow(message);
  });
});
