import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addUsage,
  formatUsageCost,
  formatUsageDetail,
  formatUsageSummary,
  formatUsageTokens,
  UsageStore,
  zeroUsage,
  type ShadowUsage,
} from "../src/usage.js";

type UsageOverrides = Omit<Partial<ShadowUsage>, "cost"> & { cost?: Partial<ShadowUsage["cost"]> };

function usage(overrides: UsageOverrides = {}): ShadowUsage {
  const base = zeroUsage();
  return {
    ...base,
    ...overrides,
    cost: { ...base.cost, ...overrides.cost },
  };
}

describe("Shadow usage", () => {
  it("creates zero usage and adds every token and API cost component", () => {
    const left = usage({
      requests: 1,
      input: 10,
      output: 20,
      cacheRead: 30,
      cacheWrite: 40,
      totalTokens: 100,
      cost: { input: 0.01, output: 0.02, cacheRead: 0.03, cacheWrite: 0.04, total: 0.1 },
    });
    const right = usage({
      requests: 2,
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
      totalTokens: 10,
      cost: { input: 0.001, output: 0.002, cacheRead: 0.003, cacheWrite: 0.004, total: 0.01 },
    });

    expect(zeroUsage()).toEqual(usage());
    expect(addUsage(left, right)).toEqual(usage({
      requests: 3,
      input: 11,
      output: 22,
      cacheRead: 33,
      cacheWrite: 44,
      totalTokens: 110,
      cost: { input: 0.011, output: 0.022, cacheRead: 0.033, cacheWrite: 0.044, total: 0.11 },
    }));
  });

  it("formats compact tokens, API-equivalent cost, and detailed status values", () => {
    const sample = usage({
      requests: 2,
      input: 70_000,
      output: 10_000,
      cacheRead: 4_000,
      cacheWrite: 700,
      totalTokens: 84_700,
      cost: { total: 0.42 },
    });

    expect(formatUsageTokens(999)).toBe("999");
    expect(formatUsageTokens(1_000)).toBe("1k");
    expect(formatUsageTokens(84_700)).toBe("84.7k");
    expect(formatUsageTokens(999_950)).toBe("1m");
    expect(formatUsageTokens(1_250_000)).toBe("1.3m");
    expect(formatUsageCost(0)).toBe("$0");
    expect(formatUsageCost(0.0042)).toBe("$0.004");
    expect(formatUsageCost(0.42)).toBe("$0.42");
    expect(formatUsageSummary(sample)).toBe("2 requests · 84.7k tokens · API $0.42");
    expect(formatUsageDetail("session", sample)).toBe(
      "usage session · 2 requests · 84.7k total · 70k input · 10k output · 4k cache read · 700 cache write · API $0.42",
    );
  });
});

describe("UsageStore", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "shadow-usage-"));
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("starts missing lifetime data at zero", async () => {
    const store = new UsageStore(agentDir);
    await store.initialize();

    expect(store.current).toEqual(zeroUsage());
    expect(store.error).toBeUndefined();
  });

  it("loads a valid versioned lifetime document", async () => {
    const lifetime = usage({ requests: 3, input: 42, totalTokens: 42, cost: { input: 0.12, total: 0.12 } });
    const path = join(agentDir, "shadow-minds", "usage.json");
    await mkdir(join(agentDir, "shadow-minds"), { recursive: true });
    await writeFile(path, `${JSON.stringify({ version: 1, lifetime })}\n`, "utf8");

    const store = new UsageStore(agentDir);
    await store.initialize();

    expect(store.current).toEqual(lifetime);
    expect(store.error).toBeUndefined();
  });

  it("reports invalid or unsupported lifetime data and starts a new in-memory aggregate", async () => {
    const path = join(agentDir, "shadow-minds", "usage.json");
    await mkdir(join(agentDir, "shadow-minds"), { recursive: true });
    await writeFile(path, JSON.stringify({ version: 2, lifetime: {} }), "utf8");

    const store = new UsageStore(agentDir);
    await store.initialize();

    expect(store.current).toEqual(zeroUsage());
    expect(store.error).toMatch(/unsupported/);
  });

  it("persists lifetime data for a new store instance", async () => {
    const initial = new UsageStore(agentDir);
    await initial.initialize();
    await initial.add(usage({ requests: 1, input: 12, output: 3, totalTokens: 15, cost: { input: 0.1, output: 0.02, total: 0.12 } }));
    await initial.flush();

    const reloaded = new UsageStore(agentDir);
    await reloaded.initialize();

    expect(reloaded.current).toEqual(usage({ requests: 1, input: 12, output: 3, totalTokens: 15, cost: { input: 0.1, output: 0.02, total: 0.12 } }));
  });

  it("serializes concurrent additions without losing any aggregate", async () => {
    const store = new UsageStore(agentDir);
    await store.initialize();
    const additions = [
      usage({ requests: 1, input: 10, totalTokens: 10, cost: { input: 0.1, total: 0.1 } }),
      usage({ requests: 1, output: 20, totalTokens: 20, cost: { output: 0.2, total: 0.2 } }),
      usage({ requests: 1, cacheRead: 30, cacheWrite: 40, totalTokens: 70, cost: { cacheRead: 0.3, cacheWrite: 0.4, total: 0.7 } }),
    ];

    await Promise.all(additions.map((entry) => store.add(entry)));
    await store.flush();

    const persisted = JSON.parse(await readFile(store.usagePath, "utf8"));
    expect(persisted.version).toBe(1);
    expect(persisted.lifetime).toEqual(usage({
      requests: 3,
      input: 10,
      output: 20,
      cacheRead: 30,
      cacheWrite: 40,
      totalTokens: 100,
      cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
    }));
  });

  it("merges concurrent additions from separate stores through the shared usage file", async () => {
    const first = new UsageStore(agentDir);
    const second = new UsageStore(agentDir);
    await Promise.all([first.initialize(), second.initialize()]);

    await Promise.all([
      first.add(usage({ requests: 1, input: 10, totalTokens: 10, cost: { input: 0.1, total: 0.1 } })),
      second.add(usage({ requests: 2, output: 20, totalTokens: 20, cost: { output: 0.2, total: 0.2 } })),
    ]);
    await Promise.all([first.flush(), second.flush()]);

    const reloaded = new UsageStore(agentDir);
    await reloaded.initialize();

    const combined = usage({
      requests: 3,
      input: 10,
      output: 20,
      totalTokens: 30,
      cost: { input: 0.1, output: 0.2, total: 0.1 + 0.2 },
    });
    expect([first.current, second.current]).toContainEqual(combined);
    expect(reloaded.current).toEqual(combined);
  });
});
