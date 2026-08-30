import { describe, expect, it } from "vitest";
import {
  addUsage,
  formatUsageCost,
  formatUsageDetail,
  formatUsageSummary,
  formatUsageTokens,
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
