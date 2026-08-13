import { describe, expect, it, vi } from "vitest";
import { ReportBatcher } from "../src/report-batcher.js";

describe("ReportBatcher", () => {
  it("combines reports inside the window", async () => {
    vi.useFakeTimers();
    const delivered: string[][] = [];
    const batcher = new ReportBatcher(400, (reports) => { delivered.push(reports.map(({ content }) => content)); });
    batcher.add({ shadowId: "a", shadowName: "A", content: "one", epoch: 1, runId: "1" });
    batcher.add({ shadowId: "b", shadowName: "B", content: "two", epoch: 1, runId: "2" });
    expect(batcher.hasPending).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(delivered).toEqual([["one", "two"]]);
    expect(batcher.hasPending).toBe(false);
    vi.useRealTimers();
  });
});
