// What /api/chat accepts from the browser. Instructions never come from the client: it may only say
// that this turn was spoken, and the words that flag adds to the instructions live here.

export const VOICE_STYLE = `Voice mode: the user spoke this question and will hear your reply read aloud. Answer in one or two short spoken sentences, in the language the user used, with no lists, markdown, emoji or symbols. Cards are not read aloud, so the sentence must make sense on its own.`;

export function parseChatRequest(raw: string): { messages: unknown; voice: boolean } {
  try {
    const body = JSON.parse(raw) as { messages?: unknown; voice?: unknown };
    return { messages: body.messages, voice: body.voice === true };
  } catch {
    return { messages: undefined, voice: false };
  }
}
