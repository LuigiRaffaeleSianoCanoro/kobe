import { describe, expect, it } from "vitest";
import { tagFor } from "../../lib/voice";

describe("tagFor", () => {
  it("keeps the browser's regional tag", () => {
    expect(tagFor("es", ["en-US", "es-AR"])).toBe("es-AR");
    expect(tagFor("en", ["es-AR", "en-GB"])).toBe("en-GB");
  });

  it("falls back to a default region", () => {
    expect(tagFor("es", ["en-US"])).toBe("es-ES");
    expect(tagFor("en", [])).toBe("en-US");
  });

  it("does not match a longer language code", () => {
    expect(tagFor("en", ["eng"])).toBe("en-US");
  });
});
