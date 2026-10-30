#!/usr/bin/env node
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { themeCss } from "../src/renderer.ts";

const dist = new URL("../dist/", import.meta.url);
mkdirSync(dist, { recursive: true });
writeFileSync(new URL("theme.css", dist), themeCss() + "\n", "utf8");

try {
  chmodSync(new URL("cli.js", dist), 0o755);
} catch {
  // Best effort: npm also marks bin entries executable on install.
}
