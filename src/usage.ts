export interface ShadowUsageCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface ShadowUsage {
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: ShadowUsageCost;
}

export function zeroUsage(): ShadowUsage {
  return {
    requests: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

export function addUsage(left: ShadowUsage, right: ShadowUsage): ShadowUsage {
  return {
    requests: left.requests + right.requests,
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    totalTokens: left.totalTokens + right.totalTokens,
    cost: {
      input: left.cost.input + right.cost.input,
      output: left.cost.output + right.cost.output,
      cacheRead: left.cost.cacheRead + right.cost.cacheRead,
      cacheWrite: left.cost.cacheWrite + right.cost.cacheWrite,
      total: left.cost.total + right.cost.total,
    },
  };
}

export function formatUsageTokens(tokens: number): string {
  if (tokens < 1_000) return tokens.toLocaleString("en-US");
  if (tokens < 999_950) return `${formatCompact(tokens / 1_000)}k`;
  return `${formatCompact(tokens / 1_000_000)}m`;
}

export function formatUsageCost(cost: number): string {
  if (cost === 0) return "$0";
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  if (cost >= 0.001) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(4)}`;
}

export function formatUsageSummary(usage: ShadowUsage): string {
  return `${usage.requests} requests · ${formatUsageTokens(usage.totalTokens)} tokens · API ${formatUsageCost(usage.cost.total)}`;
}

export function formatUsageDetail(scope: string, usage: ShadowUsage): string {
  return [
    `usage ${scope}`,
    `${usage.requests} requests`,
    `${formatUsageTokens(usage.totalTokens)} total`,
    `${formatUsageTokens(usage.input)} input`,
    `${formatUsageTokens(usage.output)} output`,
    `${formatUsageTokens(usage.cacheRead)} cache read`,
    `${formatUsageTokens(usage.cacheWrite)} cache write`,
    `API ${formatUsageCost(usage.cost.total)}`,
  ].join(" · ");
}

function formatCompact(value: number): string {
  return Number(value.toFixed(1)).toString();
}
