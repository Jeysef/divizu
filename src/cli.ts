#!/usr/bin/env node
import {
  existsSync,
  readFileSync,
  statSync,
  unwatchFile,
  watchFile,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { DivizuError, formatDiagnostic, diagnostic } from "./diagnostics.ts";
import { computeLayout } from "./layout.ts";
import { parseDocument } from "./parser.ts";
import { render } from "./render.ts";
import { validateDocument } from "./validate.ts";
import type { Document, RenderOptions, ThemeMode } from "./ast.ts";
import type { Diagnostic } from "./diagnostics.ts";

const VERSION = readVersion();

const HELP = `divizu ${VERSION} — deterministic architecture diagrams

Usage:
  divizu <input.di> [options]
  cat graph.di | divizu [options]

Options:
  -o, --out <file>       Write SVG to a file (default: stdout)
  -t, --theme <mode>     auto | dark | light (default: auto)
  -p, --padding <px>     Canvas padding (default: 56)
      --radius <px>      Corner radius (default: 8)
      --layer-gap <px>   Space between dependency layers (default: 78)
      --socket-gap <px>  Space between sockets and nodes (default: 28)
      --responsive       Fill the container (100% x 100%)
      --title <text>     Accessible SVG title
      --check            Validate without rendering
      --json             Layout JSON; with --check, a validation report
      --verify-src       With --check, verify src: paths exist
  -w, --watch            Re-render when the input file changes
  -h, --help             Show this help
  -v, --version          Show the version

Examples:
  divizu architecture.di -o architecture.svg
  divizu architecture.di --check
  divizu architecture.di --check --json
  divizu architecture.di --check --verify-src
  cat architecture.di | divizu > architecture.svg
`;

interface Args {
  out?: string;
  theme: ThemeMode;
  padding?: number;
  radius?: number;
  layerGap?: number;
  socketGap?: number;
  responsive: boolean;
  title?: string;
  check: boolean;
  json: boolean;
  verifySrc: boolean;
  watch: boolean;
  help: boolean;
  version: boolean;
  positionals: string[];
}

const args = parseCli();

if (args.help) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (args.version) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

const input = args.positionals[0];
const useStdin = !input || input === "-";

if (useStdin && process.stdin.isTTY && args.positionals.length === 0) {
  process.stdout.write(HELP);
  process.exit(1);
}
if (args.positionals.length > 1) {
  fail(`Expected one input file, got ${args.positionals.length}.`);
}
if (args.watch && useStdin) fail("--watch requires a file input.");
if (args.watch && (args.check || args.json)) {
  fail("--watch cannot be combined with --check or --json.");
}
if (args.verifySrc && !args.check) {
  fail("--verify-src requires --check.");
}
if (args.check && args.out && !args.json) {
  // Human-readable reports are useful in CI logs, but writing them to a file is
  // still acceptable. Keep the option rather than forbidding it.
}

const options: RenderOptions = {
  theme: args.theme,
  ...(args.padding !== undefined ? { padding: args.padding } : {}),
  ...(args.radius !== undefined ? { cornerRadius: args.radius } : {}),
  ...(args.layerGap !== undefined ? { layerGap: args.layerGap } : {}),
  ...(args.socketGap !== undefined ? { socketGap: args.socketGap } : {}),
  responsive: args.responsive,
  ...(args.title !== undefined ? { title: args.title } : {}),
};

const fileLabel = useStdin ? "<stdin>" : input;

if (args.watch) {
  const sourcePath = input!;
  const outPath = args.out ?? sourcePath.replace(/\.[^./\\]+$/, "") + ".svg";

  const rebuild = (): void => {
    try {
      const dsl = readFileSync(sourcePath, "utf8");
      const result = render(dsl, options);
      writeFileSync(outPath, `${result.svg}\n`, "utf8");
      process.stderr.write(
        `[divizu] ${result.width}x${result.height} -> ${outPath}\n`,
      );
    } catch (error) {
      process.stderr.write(`${formatCaught(error, sourcePath)}\n`);
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
  let source: string;
  try {
    source = useStdin
      ? readFileSync(0, "utf8")
      : readFileSync(input!, "utf8");
  } catch (error) {
    fail(`Cannot read ${fileLabel}: ${messageOf(error)}`);
  }

  if (args.check) {
    process.exit(runCheck(source, fileLabel, args));
  }

  try {
    if (args.json) {
      const doc = parseDocument(source);
      const validation = validateDocument(doc);
      if (!validation.ok) throw new DivizuError(validation.errors[0]!);
      const geometry = computeLayout(doc, {
        layerGap: args.layerGap,
        socketGap: args.socketGap,
      });
      writeOutput(JSON.stringify(geometry, null, 2) + "\n", args.out, "layout JSON");
    } else {
      const result = render(source, options);
      writeOutput(`${result.svg}\n`, args.out, `${result.width}x${result.height}`);
    }
  } catch (error) {
    process.stderr.write(
      `${formatCaught(error, useStdin ? undefined : input, source)}\n`,
    );
    process.exit(1);
  }
}

function runCheck(source: string, file: string, args: Args): number {
  let doc: Document;
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];

  try {
    doc = parseDocument(source);
  } catch (error) {
    if (error instanceof DivizuError) {
      errors.push(error.toDiagnostic());
    } else {
      errors.push(diagnostic("syntax", messageOf(error), 1, 1));
    }
    return reportCheck({ file, errors, warnings, source, args });
  }

  const validation = validateDocument(doc);
  errors.push(...validation.errors);
  warnings.push(...validation.warnings);

  if (args.verifySrc) {
    verifySources(doc, errors);
  }

  if (errors.length === 0) {
    try {
      computeLayout(doc, {
        layerGap: args.layerGap,
        socketGap: args.socketGap,
      });
    } catch (error) {
      if (error instanceof DivizuError) errors.push(error.toDiagnostic());
      else errors.push(diagnostic("syntax", messageOf(error), 1, 1));
    }
  }

  return reportCheck({ file, errors, warnings, source, args, doc });
}

function reportCheck(input: {
  file: string;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  source: string;
  args: Args;
  doc?: Document;
}): number {
  const { file, errors, warnings, source, args, doc } = input;
  const ok = errors.length === 0;
  let stats: Record<string, number> | undefined;

  if (ok && doc) {
    try {
      const layout = computeLayout(doc, {
        layerGap: args.layerGap,
        socketGap: args.socketGap,
      });
      stats = {
        blocks: doc.blocks.size,
        edges: layout.edges.length,
        roots: layout.roots.length,
        layers: layout.layers,
        width: Math.ceil(layout.width),
        height: Math.ceil(layout.height),
      };
    } catch {
      // The report already has the relevant error.
    }
  }

  if (args.json) {
    const report = {
      ok,
      file,
      errors,
      warnings,
      ...(stats ? { stats } : {}),
    };
    writeOutput(JSON.stringify(report, null, 2) + "\n", args.out, "check report");
  } else {
    const lines: string[] = [];
    for (const item of errors) {
      lines.push(formatDiagnostic(item, source, file));
    }
    for (const item of warnings) {
      lines.push(formatDiagnostic(item, source, file));
    }
    if (ok) {
      const summary = stats
        ? ` (${stats.blocks} blocks, ${stats.edges} edges, ${stats.width}x${stats.height})`
        : "";
      lines.push(`${file}: ok${summary}`);
    }
    writeOutput(`${lines.join("\n")}\n`, args.out, "check report");
  }

  return ok ? 0 : 1;
}

function verifySources(doc: Document, errors: Diagnostic[]): void {
  for (const id of doc.order) {
    const block = doc.blocks.get(id)!;
    if (!block.src) continue;
    const path = resolve(process.cwd(), block.src.file);
    if (!existsSync(path) || !statSync(path).isFile()) {
      errors.push(
        diagnostic(
          "source-missing",
          `Source for "${block.id}" does not exist: ${block.src.file}`,
          block.loc.line,
          block.loc.column,
          {
            suggestion:
              "Fix src:, or run --check --verify-src from the repository root.",
          },
        ),
      );
    }
  }
}

function parseCli(): Args {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        out: { type: "string", short: "o" },
        theme: { type: "string", short: "t", default: "auto" },
        padding: { type: "string", short: "p" },
        radius: { type: "string" },
        "layer-gap": { type: "string" },
        "socket-gap": { type: "string" },
        responsive: { type: "boolean", default: false },
        title: { type: "string" },
        check: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        "verify-src": { type: "boolean", default: false },
        watch: { type: "boolean", short: "w", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });

    return {
      out: values.out,
      theme: parseTheme(values.theme),
      padding: parseNumber(values.padding, "padding", 0),
      radius: parseNumber(values.radius, "radius", 0),
      layerGap: parseNumber(values["layer-gap"], "layer-gap", 24),
      socketGap: parseNumber(values["socket-gap"], "socket-gap", 8),
      responsive: values.responsive,
      title: values.title,
      check: values.check,
      json: values.json,
      verifySrc: values["verify-src"],
      watch: values.watch,
      help: values.help,
      version: values.version,
      positionals,
    };
  } catch (error) {
    fail(`${messageOf(error)}\n\nRun divizu --help for usage.`);
  }
}

function writeOutput(text: string, out: string | undefined, label: string): void {
  if (out && out !== "-") {
    writeFileSync(out, text, "utf8");
    process.stderr.write(`[divizu] ${label} -> ${out}\n`);
  } else {
    process.stdout.write(text);
  }
}

function parseTheme(value: string | undefined): ThemeMode {
  if (value === "auto" || value === "dark" || value === "light") return value;
  fail(`Invalid --theme "${value}". Expected auto, dark or light.`);
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

function formatCaught(error: unknown, file?: string, source?: string): string {
  if (error instanceof DivizuError) {
    return formatDiagnostic(error.toDiagnostic(), source, file);
  }
  return `divizu: ${messageOf(error)}`;
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
  process.stderr.write(`divizu: ${message}\n`);
  process.exit(1);
}
