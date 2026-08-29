import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isFiniteNumber } from "./validation.js";

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

interface UsageDocument {
  version: 1;
  lifetime: ShadowUsage;
}

const USAGE_DOCUMENT_VERSION = 1;
const USAGE_LOCK_RETRY_MS = 25;
const USAGE_LOCK_STALE_MS = 30_000;
const USAGE_LOCK_OWNER_FILE = "owner";
const USAGE_LOCK_OPERATION_DIRECTORY = ".operation";

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

/** Stores global lifetime usage separately from editable Shadow configuration. */
export class UsageStore {
  readonly usagePath: string;
  private lifetime = zeroUsage();
  private pendingUsage = zeroUsage();
  private lastError?: string;
  private initialization?: Promise<void>;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(agentDir: string) {
    this.usagePath = join(agentDir, "shadow-minds", "usage.json");
  }

  initialize(): Promise<void> {
    this.initialization ??= this.load();
    return this.initialization;
  }

  get current(): ShadowUsage {
    return {
      ...this.lifetime,
      cost: { ...this.lifetime.cost },
    };
  }

  get error(): string | undefined {
    return this.lastError;
  }

  add(usage: ShadowUsage): Promise<void> {
    this.lifetime = addUsage(this.lifetime, usage);
    this.pendingUsage = addUsage(this.pendingUsage, usage);
    this.pendingWrite = this.pendingWrite.then(
      () => this.writePending(),
      () => this.writePending(),
    ).then(
      () => {
        this.lastError = undefined;
      },
      (error: unknown) => {
        this.lastError = error instanceof Error ? error.message : String(error);
      },
    );
    return this.pendingWrite;
  }

  async flush(): Promise<void> {
    await this.pendingWrite;
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.usagePath, "utf8");
      this.lifetime = parseUsageDocument(JSON.parse(raw)).lifetime;
      this.lastError = undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.lifetime = zeroUsage();
        this.lastError = undefined;
        return;
      }
      this.lifetime = zeroUsage();
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async writePending(): Promise<void> {
    const delta = this.pendingUsage;
    if (isZeroUsage(delta)) return;
    await mkdir(dirname(this.usagePath), { recursive: true });
    const releaseLock = await acquireUsageLock(this.usagePath);
    try {
      const committed = addUsage(await readUsageLifetime(this.usagePath), delta);
      await writeUsageDocument(this.usagePath, committed);
      this.pendingUsage = subtractUsage(this.pendingUsage, delta);
      this.lifetime = addUsage(committed, this.pendingUsage);
    } finally {
      await releaseLock();
    }
  }
}

function subtractUsage(left: ShadowUsage, right: ShadowUsage): ShadowUsage {
  return {
    requests: left.requests - right.requests,
    input: left.input - right.input,
    output: left.output - right.output,
    cacheRead: left.cacheRead - right.cacheRead,
    cacheWrite: left.cacheWrite - right.cacheWrite,
    totalTokens: left.totalTokens - right.totalTokens,
    cost: {
      input: left.cost.input - right.cost.input,
      output: left.cost.output - right.cost.output,
      cacheRead: left.cost.cacheRead - right.cost.cacheRead,
      cacheWrite: left.cost.cacheWrite - right.cost.cacheWrite,
      total: left.cost.total - right.cost.total,
    },
  };
}

function isZeroUsage(usage: ShadowUsage): boolean {
  return usage.requests === 0
    && usage.input === 0
    && usage.output === 0
    && usage.cacheRead === 0
    && usage.cacheWrite === 0
    && usage.totalTokens === 0
    && usage.cost.input === 0
    && usage.cost.output === 0
    && usage.cost.cacheRead === 0
    && usage.cost.cacheWrite === 0
    && usage.cost.total === 0;
}

async function acquireUsageLock(usagePath: string): Promise<() => Promise<void>> {
  const lockPath = `${usagePath}.lock`;
  const token = randomUUID();
  while (true) {
    try {
      await mkdir(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await recoverStaleUsageLock(lockPath);
      await new Promise<void>((resolve) => setTimeout(resolve, USAGE_LOCK_RETRY_MS));
      continue;
    }

    try {
      await writeFile(join(lockPath, USAGE_LOCK_OWNER_FILE), token, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return () => releaseUsageLock(lockPath, token);
  }
}

interface UsageLockState {
  token?: string;
  mtimeMs: number;
  dev: number;
  ino: number;
}

async function recoverStaleUsageLock(lockPath: string): Promise<void> {
  const observed = await readUsageLockState(lockPath);
  if (!observed || !isStaleUsageLock(observed)) return;

  const operationPath = join(lockPath, USAGE_LOCK_OPERATION_DIRECTORY);
  if (!await claimUsageLockOperation(operationPath)) return;
  try {
    const current = await readUsageLockState(lockPath);
    const stale = current?.token === undefined ? isStaleUsageLock(observed) : isStaleUsageLock(current);
    if (!current || !sameUsageLock(current, observed) || !stale) return;

    const abandonedPath = `${lockPath}.${randomUUID()}.stale`;
    try {
      await rename(lockPath, abandonedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await rm(abandonedPath, { recursive: true, force: true });
  } finally {
    await rm(operationPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function releaseUsageLock(lockPath: string, token: string): Promise<void> {
  const operationPath = join(lockPath, USAGE_LOCK_OPERATION_DIRECTORY);
  while (true) {
    const observed = await readUsageLockState(lockPath);
    if (!observed || observed.token !== token) return;
    if (!await claimUsageLockOperation(operationPath)) {
      await new Promise<void>((resolve) => setTimeout(resolve, USAGE_LOCK_RETRY_MS));
      continue;
    }
    try {
      const current = await readUsageLockState(lockPath);
      if (!current || current.token !== token) return;

      const releasedPath = `${lockPath}.${token}.released`;
      try {
        await rename(lockPath, releasedPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      await rm(releasedPath, { recursive: true, force: true });
      return;
    } finally {
      await rm(operationPath, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function claimUsageLockOperation(operationPath: string): Promise<boolean> {
  try {
    await mkdir(operationPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  try {
    const operation = await stat(operationPath);
    if (Date.now() - operation.mtimeMs >= USAGE_LOCK_STALE_MS) {
      const abandonedPath = `${operationPath}.${randomUUID()}.stale`;
      try {
        await rename(operationPath, abandonedPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
      await rm(abandonedPath, { recursive: true, force: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return false;
}

async function readUsageLockState(lockPath: string): Promise<UsageLockState | undefined> {
  let lock;
  try {
    lock = await stat(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  try {
    const ownerPath = join(lockPath, USAGE_LOCK_OWNER_FILE);
    const [token, owner] = await Promise.all([readFile(ownerPath, "utf8"), stat(ownerPath)]);
    return { token, mtimeMs: owner.mtimeMs, dev: lock.dev, ino: lock.ino };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { mtimeMs: lock.mtimeMs, dev: lock.dev, ino: lock.ino };
  }
}

function isStaleUsageLock(lock: UsageLockState): boolean {
  return Date.now() - lock.mtimeMs >= USAGE_LOCK_STALE_MS;
}

function sameUsageLock(left: UsageLockState, right: UsageLockState): boolean {
  return left.token !== undefined && right.token !== undefined
    ? left.token === right.token
    : left.token === right.token && left.dev === right.dev && left.ino === right.ino;
}

async function readUsageLifetime(usagePath: string): Promise<ShadowUsage> {
  try {
    const raw = await readFile(usagePath, "utf8");
    return parseUsageDocument(JSON.parse(raw)).lifetime;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return zeroUsage();
    throw error;
  }
}

async function writeUsageDocument(usagePath: string, lifetime: ShadowUsage): Promise<void> {
  const temporaryPath = `${usagePath}.${randomUUID()}.tmp`;
  try {
    const document: UsageDocument = { version: USAGE_DOCUMENT_VERSION, lifetime };
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(temporaryPath, usagePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function parseUsageDocument(input: unknown): UsageDocument {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("usage must be a JSON object");
  }
  const value = input as { version?: unknown; lifetime?: unknown };
  if (value.version !== USAGE_DOCUMENT_VERSION) throw new Error("usage version is unsupported");
  return { version: USAGE_DOCUMENT_VERSION, lifetime: parseUsage(value.lifetime, "lifetime") };
}

function parseUsage(input: unknown, name: string): ShadowUsage {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${name} must be an object`);
  }
  const value = input as {
    requests?: unknown;
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
    totalTokens?: unknown;
    cost?: unknown;
  };
  const cost = value.cost;
  if (cost === null || typeof cost !== "object" || Array.isArray(cost)) {
    throw new Error(`${name}.cost must be an object`);
  }
  const costValue = cost as {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
    total?: unknown;
  };
  return {
    requests: nonNegativeInteger(value.requests, `${name}.requests`),
    input: nonNegativeNumber(value.input, `${name}.input`),
    output: nonNegativeNumber(value.output, `${name}.output`),
    cacheRead: nonNegativeNumber(value.cacheRead, `${name}.cacheRead`),
    cacheWrite: nonNegativeNumber(value.cacheWrite, `${name}.cacheWrite`),
    totalTokens: nonNegativeNumber(value.totalTokens, `${name}.totalTokens`),
    cost: {
      input: nonNegativeNumber(costValue.input, `${name}.cost.input`),
      output: nonNegativeNumber(costValue.output, `${name}.cost.output`),
      cacheRead: nonNegativeNumber(costValue.cacheRead, `${name}.cost.cacheRead`),
      cacheWrite: nonNegativeNumber(costValue.cacheWrite, `${name}.cost.cacheWrite`),
      total: nonNegativeNumber(costValue.total, `${name}.cost.total`),
    },
  };
}

function nonNegativeNumber(value: unknown, name: string): number {
  if (!isFiniteNumber(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
  const number = nonNegativeNumber(value, name);
  if (!Number.isSafeInteger(number)) throw new Error(`${name} must be a non-negative safe integer`);
  return number;
}

function formatCompact(value: number): string {
  return Number(value.toFixed(1)).toString();
}

