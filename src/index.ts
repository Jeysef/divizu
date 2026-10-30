import { DivizuError } from "./diagnostics.ts";
import { computeLayout } from "./layout.ts";
import { parseDocument } from "./parser.ts";
import { validateDocument, type ValidationResult } from "./validate.ts";
import type { LayoutOptions, LayoutResult } from "./ast.ts";

export { parseDSL, parseDocument } from "./parser.ts";
export { validateDocument } from "./validate.ts";
export { render, mount } from "./render.ts";
export { themeCss, THEME_CSS, FONT_STACK } from "./theme.ts";

export type {
  BlockRole,
  BlockDef,
  NeedDef,
  CandidateDef,
  SourceRef,
  Document,
  ThemeMode,
  RenderOptions,
  RenderResult,
  LayoutSocket,
  LayoutNode,
  LayoutEdge,
  LayoutResult,
  LayoutOptions,
  Point,
} from "./ast.ts";

export type { ValidationResult } from "./validate.ts";
export type { Diagnostic } from "./diagnostics.ts";
export { DivizuError } from "./diagnostics.ts";

/** Inspect the computed geometry without producing SVG. */
export function layout(
  dsl: string,
  options: LayoutOptions = {},
): LayoutResult {
  const doc = parseDocument(dsl);
  const result = validateDocument(doc);
  if (!result.ok) throw new DivizuError(result.errors[0]!);
  return computeLayout(doc, options);
}

/** Run the parser and semantic validator without laying out or rendering. */
export function validate(dsl: string): ValidationResult {
  return validateDocument(parseDocument(dsl));
}
