import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { UsageStore } from "../../src/usage-store.js";
import { zeroUsage } from "../../src/usage.js";

const [agentDir, writerId, inputText] = process.argv.slice(2);
if (!agentDir || !writerId || !inputText) throw new Error("usage writer arguments are required");

const input = Number(inputText);
const store = new UsageStore(agentDir);
await store.initialize();
await writeFile(join(agentDir, `ready-${writerId}`), "", "utf8");
while (!existsSync(join(agentDir, "start"))) {
  await new Promise<void>((resolve) => setTimeout(resolve, 5));
}

const usage = zeroUsage();
usage.requests = 1;
usage.input = input;
usage.totalTokens = input;
usage.cost.input = input / 100;
usage.cost.total = input / 100;
await store.add(usage);
await store.flush();
