import { describe, expect, it } from "vitest";
import { parseShadowMarkdown } from "../src/registry.js";

describe("parseShadowMarkdown", () => {
  it("applies shadow defaults", () => {
    const shadow = parseShadowMarkdown("---\nname: Fact checker\n---\nCheck claims against the project.", "C:/tmp/facts.md");
    expect(shadow).toMatchObject({
      id: "facts",
      name: "Fact checker",
      enabled: true,
      debug: false,
      activationProbability: 0.3,
      activeForModels: ["*"],
      tools: [],
    });
  });

  it("rejects an empty prompt", () => {
    expect(() => parseShadowMarkdown("---\nid: empty\n---\n", "C:/tmp/empty.md")).toThrow(/empty/);
  });

  it("accepts off as a thinking level", () => {
    const shadow = parseShadowMarkdown(
      "---\nid: quick-check\nthinking_level: off\n---\nCheck once and report.",
      "C:/tmp/quick-check.md",
    );
    expect(shadow.thinkingLevel).toBe("off");
  });
});
