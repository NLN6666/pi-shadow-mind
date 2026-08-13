import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ShadowMindRuntime } from "./runtime.js";

export default function shadowMindExtension(pi: ExtensionAPI): void {
  new ShadowMindRuntime(pi).register();
}
