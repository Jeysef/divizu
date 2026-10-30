/** Error objects, diagnostics and small suggestion helpers. */

export type DiagnosticCode =
  | "syntax"
  | "duplicate-id"
  | "duplicate-need"
  | "duplicate-provides"
  | "duplicate-provider"
  | "unknown-provider"
  | "provider-mismatch"
  | "root-missing"
  | "root-referenced"
  | "root-provides"
  | "orphan"
  | "cycle"
  | "unreachable"
  | "value-has-needs"
  | "value-has-modules"
  | "value-has-candidates"
  | "limit"
  | "source-missing"
  | "warning";

export interface Diagnostic {
  code: DiagnosticCode;
  message: string;
  line: number;
  column: number;
  offset?: number;
  file?: string;
  suggestion?: string;
}

export class DivizuError extends Error {
  readonly code: DiagnosticCode;
  readonly line: number;
  readonly column: number;
  readonly offset?: number;
  readonly file?: string;
  readonly suggestion?: string;

  constructor(diagnostic: Diagnostic) {
    super(diagnostic.message);
    this.name = "DivizuError";
    this.code = diagnostic.code;
    this.line = diagnostic.line;
    this.column = diagnostic.column;
    this.offset = diagnostic.offset;
    this.file = diagnostic.file;
    this.suggestion = diagnostic.suggestion;
  }

  toDiagnostic(): Diagnostic {
    return {
      code: this.code,
      message: this.message,
      line: this.line,
      column: this.column,
      ...(this.offset !== undefined ? { offset: this.offset } : {}),
      ...(this.file !== undefined ? { file: this.file } : {}),
      ...(this.suggestion !== undefined
        ? { suggestion: this.suggestion }
        : {}),
    };
  }
}

export function diagnostic(
  code: DiagnosticCode,
  message: string,
  line: number,
  column: number,
  extra: Partial<Pick<Diagnostic, "offset" | "file" | "suggestion">> = {},
): Diagnostic {
  return { code, message, line, column, ...extra };
}

export function snippetFor(source: string, line: number, column: number): string {
  const lines = source.split(/\r?\n/);
  const text = lines[line - 1] ?? "";
  const safeColumn = Math.max(1, Math.min(column, text.length + 1));
  return `${text}\n${" ".repeat(safeColumn - 1)}^`;
}

export function formatDiagnostic(
  item: Diagnostic,
  source?: string,
  fallbackFile?: string,
): string {
  const file = item.file ?? fallbackFile;
  const prefix = file ? `${file}:` : "";
  const head = `${prefix}${item.line}:${item.column}: ${item.code}: ${item.message}`;
  const hint = item.suggestion ? `\n  hint: ${item.suggestion}` : "";
  const snippet =
    source !== undefined ? `\n${snippetFor(source, item.line, item.column)}` : "";
  return `${head}${hint}${snippet}`;
}

/** Returns a close match, or undefined when nothing is close enough. */
export function suggest(value: string, candidates: Iterable<string>): string | undefined {
  const needle = value.toLowerCase();
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = levenshtein(needle, candidate.toLowerCase());
    const limit = Math.max(2, Math.floor(Math.max(needle.length, candidate.length) / 3));
    if (distance < bestDistance && distance <= limit) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best !== value ? best : undefined;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + cost,
      );
    }
    previous = current;
  }

  return previous[b.length]!;
}
