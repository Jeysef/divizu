#!/usr/bin/env node
import {
  readFileSync,
  unwatchFile,
  watchFile,
  writeFileSync,
} from "node:fs";
import { parseArgs } from "node:util";
import { layout, render } from "./renderer.ts";
import type { RenderOptions, ThemeMode } from "./renderer.ts";

const VERSION = readVersion();

const HELP = `diviz ${VERSION} — deterministic hardware-slot DI diagrams

Usage:
  diviz <input.di> [options]
  cat graph.di | diviz [options]

Options:
  -o, --out <file>       Write SVG to a file (default: stdout)
  -t, --theme <mode>     auto | dark | light (default: auto)
  -p, --padding <px>     Canvas padding (default: 56)
      --radius <px>      Corner radius (default: 10)
      --fit-gap <px>     Edge-to-edge plug gap (default: 10)
      --socket-gap <px>  Gap between socket envelopes (default: 28)
      --responsive       Fill the container (100% x 100%)
      --title <text>     Accessible SVG title
      --json             Print the computed layout as JSON instead of SVG
  -w, --watch            Re-render when the input file changes
  -h, --help             Show this help
  -v, --version          Show the version

Examples:
  diviz checkout.di -o checkout.svg
  diviz checkout.di -w -t light
  cat checkout.di | diviz > checkout.svg
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", short: "o" },
    theme: { type: "string", short: "t", default: "auto" },
    padding: { type: "string", short: "p" },
    radius: { type: "string" },
    "fit-gap": { type: "string" },
    "socket-gap": { type: "string" },
    responsive: { type: "boolean", default: false },
    title: { type: "string" },
    json: { type: "boolean", default: false },
    watch: { type: "boolean", short: "w", default: false },
    help: { type: "boolean", short: "h", default: false },
    version: { type: "boolean", short: "v", default: false },
  },
});

if (values.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

if (values.version) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

const input = positionals[0];
const useStdin = !input || input === "-";

if (useStdin && process.stdin.isTTY && positionals.length === 0) {
  process.stdout.write(HELP);
  process.exit(1);
}
if (positionals.length > 1) {
  fail(`Expected one input file, got ${positionals.length}.`);
}
if (values.watch && useStdin) {
  fail("--watch requires a file input.");
}
if (values.watch && values.json) {
  fail("--json cannot be combined with --watch.");
}

const theme = parseTheme(values.theme);
const options: RenderOptions = {
  theme,
  padding: parseNumber(values.padding, "padding", 0),
  cornerRadius: parseNumber(values.radius, "radius", 0),
  fitGap: parseNumber(values["fit-gap"], "fit-gap", 4, 20),
  socketGap: parseNumber(values["socket-gap"], "socket-gap", 0),
  responsive: values.responsive,
  title: values.title,
};

let outPath = values.out;
if (values.watch && !outPath) {
  outPath = input!.replace(/\.[^./\\]+$/, "") + ".svg";
}

if (values.watch) {
  const sourcePath = input!;

  const rebuild = (): void => {
    try {
      const dsl = readFileSync(sourcePath, "utf8");
      const result = render(dsl, options);
      writeFileSync(outPath!, result.svg + "\n", "utf8");
      process.stderr.write(
        `[diviz] ${result.width}x${result.height} -> ${outPath}\n`,
      );
    } catch (error) {
      process.stderr.write(`[diviz] ${messageOf(error)}\n`);
    }
  };

  rebuild();
  watchFile(sourcePath, { interval: 150 }, (current, previous) => {
    if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) {
      rebuild();
    }
  });

  const stop = (): void => {
    unwatchFile(sourcePath);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} else {
  try {
    const dsl = useStdin
      ? readFileSync(0, "utf8")
      : readFileSync(input!, "utf8");

    if (values.json) {
      const geometry = layout(dsl, {
        fitGap: options.fitGap,
        socketGap: options.socketGap,
      });
      const text = JSON.stringify(geometry, null, 2) + "\n";

      if (outPath && outPath !== "-") {
        writeFileSync(outPath, text, "utf8");
        process.stderr.write(`[diviz] layout JSON -> ${outPath}\n`);
      } else {
        process.stdout.write(text);
      }
    } else {
      const result = render(dsl, options);

      if (outPath && outPath !== "-") {
        writeFileSync(outPath, result.svg + "\n", "utf8");
        process.stderr.write(
          `[diviz] ${result.width}x${result.height} -> ${outPath}\n`,
        );
      } else {
        process.stdout.write(result.svg + "\n");
      }
    }
  } catch (error) {
    fail(messageOf(error));
  }
}

function parseTheme(value: string | undefined): ThemeMode {
  if (value === "auto" || value === "dark" || value === "light") {
    return value;
  }
  fail(`Invalid --theme "${value}". Expected auto, dark, or light.`);
}

function parseNumber(
  value: string | undefined,
  name: string,
  min: number,
  max = Number.POSITIVE_INFINITY,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    const range =
      max === Number.POSITIVE_INFINITY
        ? `a number >= ${min}`
        : `a number between ${min} and ${max}`;
    fail(`Invalid --${name} "${value}". Expected ${range}.`);
  }
  return parsed;
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(message: string): never {
  process.stderr.write(`diviz: ${message}\n`);
  process.exit(1);
}
