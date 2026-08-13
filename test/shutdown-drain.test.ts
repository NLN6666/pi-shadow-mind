import { describe, expect, it, vi } from "vitest";
import { waitForSettled } from "../src/shutdown-drain.js";

describe("waitForSettled", () => {
  it("requires a quiet settled window", async () => {
    vi.useFakeTimers();
    let settled = false;
    setTimeout(() => { settled = true; }, 30);
    const pending = waitForSettled({ timeoutMs: 200, pollMs: 10, quietMs: 20, isSettled: () => settled });
    await vi.advanceTimersByTimeAsync(60);
    await expect(pending).resolves.toMatchObject({ settled: true, durationMs: 50 });
    vi.useRealTimers();
  });

  it("returns a bounded timeout", async () => {
    vi.useFakeTimers();
    const pending = waitForSettled({ timeoutMs: 40, pollMs: 10, isSettled: () => false });
    await vi.advanceTimersByTimeAsync(40);
    await expect(pending).resolves.toEqual({ settled: false, durationMs: 40 });
    vi.useRealTimers();
  });
});
