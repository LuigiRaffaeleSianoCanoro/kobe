import { describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/chat/route";
import { buildKobeAgent } from "@/lib/kobe-agent";

vi.mock("@/lib/kobe-agent", () => ({ buildKobeAgent: vi.fn() }));

describe("POST /api/chat after a WhatsApp import", () => {
  it("hands the model the import card's summary as text", async () => {
    let seen: unknown;
    vi.mocked(buildKobeAgent).mockResolvedValue({
      stream: async (messages: unknown) => {
        seen = messages;
        throw new Error("No model in tests.");
      },
    } as never);
    const summary = "Added 6 messages with Valentina Ríos, Mar 2026 → today.";
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "WhatsApp Chat - Valentina Ríos.zip" }] },
      { id: "a1", role: "assistant", parts: [{ type: "data-whatsapp-import", data: { summary, people: [{ id: "valentina-rios", name: "Valentina Ríos" }] } }] },
      { id: "u2", role: "user", parts: [{ type: "text", text: "Brief me on her" }] },
    ];

    await expect(POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ messages }) }))).rejects.toThrow("No model in tests.");

    expect(seen).toEqual([
      expect.objectContaining({ role: "user", parts: [{ type: "text", text: "WhatsApp Chat - Valentina Ríos.zip" }] }),
      expect.objectContaining({ role: "assistant", parts: [{ type: "text", text: summary }] }),
      expect.objectContaining({ role: "user", parts: [{ type: "text", text: "Brief me on her" }] }),
    ]);
  });
});
