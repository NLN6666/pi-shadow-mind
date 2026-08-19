import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const packageDirectory = process.argv[2];
if (!packageDirectory) {
  throw new Error("Usage: node scripts/smoke-standalone.mjs <standalone-package-directory>");
}

const sourcePackage = resolve(packageDirectory);
const sandbox = await mkdtemp(resolve(tmpdir(), "pi-shadow-mind-smoke-"));
const isolatedPackage = resolve(sandbox, "package");
const entry = resolve(isolatedPackage, "dist/index.js");
const cwd = resolve(sandbox, "workspace");
const agentDir = resolve(sandbox, "agent");

try {
  await cp(sourcePackage, isolatedPackage, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const { DefaultResourceLoader } = await import("@earendil-works/pi-coding-agent");
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalExtensionPaths: [entry],
  });

  await loader.reload();
  const result = loader.getExtensions();
  if (result.errors.length) {
    throw new Error(`Extension load errors: ${JSON.stringify(result.errors)}`);
  }

  const extension = result.extensions.find((item) => resolve(item.resolvedPath) === entry);
  if (!extension) throw new Error("Standalone extension was not loaded");

  const expectedTools = [
    "list_shadows",
    "create_shadow",
    "update_shadow",
    "enable_shadow",
    "disable_shadow",
    "delete_shadow",
    "get_shadow_config",
    "update_shadow_config",
  ];
  const missingTools = expectedTools.filter((name) => !extension.tools.has(name));
  if (missingTools.length) throw new Error(`Missing management tools: ${missingTools.join(", ")}`);
  if (!extension.commands.has("shadow")) throw new Error("Missing /shadow command");
  if (!extension.shortcuts.has("alt+s")) throw new Error("Missing Alt+S shortcut");

  console.log(JSON.stringify({
    loaded: extension.resolvedPath,
    commands: [...extension.commands.keys()],
    tools: [...extension.tools.keys()].sort(),
    shortcuts: [...extension.shortcuts.keys()],
  }, null, 2));
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
