import { describe, expect, it } from "vitest";
import { createRandom } from "../src/random.js";

describe("createRandom", () => {
  it("replays the same sequence for the same seed", () => {
    const first = createRandom(42);
    const second = createRandom(42);
    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
  });

  it("keeps distinct seeds distinct", () => {
    expect(createRandom(1)()).not.toBe(createRandom(2)());
  });
});
