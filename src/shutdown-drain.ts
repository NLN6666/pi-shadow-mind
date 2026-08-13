export interface DrainResult {
  settled: boolean;
  durationMs: number;
}

export async function waitForSettled(options: {
  timeoutMs: number;
  isSettled: () => boolean;
  pollMs?: number;
  quietMs?: number;
  now?: () => number;
  delay?: (ms: number) => Promise<void>;
}): Promise<DrainResult> {
  const pollMs = options.pollMs ?? 25;
  const quietMs = options.quietMs ?? 50;
  const now = options.now ?? Date.now;
  const delay = options.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = now();
  let settledSince: number | undefined;

  while (now() - started < options.timeoutMs) {
    if (options.isSettled()) {
      settledSince ??= now();
      if (now() - settledSince >= quietMs) return { settled: true, durationMs: now() - started };
    } else {
      settledSince = undefined;
    }
    const remaining = options.timeoutMs - (now() - started);
    await delay(Math.min(pollMs, Math.max(1, remaining)));
  }
  return { settled: false, durationMs: now() - started };
}
