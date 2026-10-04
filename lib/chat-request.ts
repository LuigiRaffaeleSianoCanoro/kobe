// What /api/chat accepts from the browser. Instructions never come from the client: it may send
// coaching notes (checked against the roster) and say that this turn was spoken. The words that
// flag adds to the instructions live here.

export const VOICE_STYLE = `Voice mode: the user spoke this question and will hear your reply read aloud. Answer in one or two short spoken sentences, in the language the user used, with no lists, markdown, emoji or symbols. Cards are not read aloud, so the sentence must make sense on its own.`;

export function parseChatRequest(raw: string): { messages: unknown; coaching: unknown; voice: boolean } {
  try {
    const body = JSON.parse(raw) as { messages?: unknown; coaching?: unknown; voice?: unknown };
    return { messages: body.messages, coaching: body.coaching, voice: body.voice === true };
  } catch {
    return { messages: undefined, coaching: undefined, voice: false };
  }
}
