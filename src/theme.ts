import type { ThemeMode } from "./ast.ts";

export interface Palette {
  canvasBg: string;
  surface: string;
  strokeRoot: string;
  strokeComponent: string;
  strokeBoundary: string;
  strokeValue: string;
  wire: string;
  fg: string;
  muted: string;
  tag: string;
  moduleBg: string;
  moduleBorder: string;
  moduleFg: string;
  pillBg: string;
  pillText: string;
  pillUnbound: string;
  pillUnboundBg: string;
  pillUnboundText: string;
}

export const DARK: Palette = {
  canvasBg: "#0f0f0c",
  surface: "#191914",
  strokeRoot: "#f1602f",
  strokeComponent: "#6f9fce",
  strokeBoundary: "#d7a24a",
  strokeValue: "#2dd4bf",
  wire: "#5b574c",
  fg: "#ece7da",
  muted: "#918b7d",
  tag: "#b0aa9b",
  moduleBg: "#22221c",
  moduleBorder: "#454338",
  moduleFg: "#d2ccbe",
  pillBg: "#345b78",
  pillText: "#edf2f0",
  pillUnbound: "#b28a42",
  pillUnboundBg: "#211d13",
  pillUnboundText: "#e6c88e",
};

export const LIGHT: Palette = {
  canvasBg: "#f2ede0",
  surface: "#fffdf7",
  strokeRoot: "#c2410c",
  strokeComponent: "#2b5e98",
  strokeBoundary: "#9a6b12",
  strokeValue: "#0f766e",
  wire: "#9a9180",
  fg: "#17150f",
  muted: "#6f6a5d",
  tag: "#5f5a4e",
  moduleBg: "#f1ede1",
  moduleBorder: "#c9c3b2",
  moduleFg: "#343128",
  pillBg: "#285c7a",
  pillText: "#f7fbfc",
  pillUnbound: "#8a6a1f",
  pillUnboundBg: "#f6efd9",
  pillUnboundText: "#6d520f",
};

export const FONT_STACK =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

const VAR_NAMES: ReadonlyArray<[keyof Palette, string]> = [
  ["canvasBg", "--di-canvas-bg"],
  ["surface", "--di-surface"],
  ["strokeRoot", "--di-stroke-root"],
  ["strokeComponent", "--di-stroke-component"],
  ["strokeBoundary", "--di-stroke-boundary"],
  ["strokeValue", "--di-stroke-value"],
  ["wire", "--di-wire"],
  ["fg", "--di-fg"],
  ["muted", "--di-muted"],
  ["tag", "--di-tag"],
  ["moduleBg", "--di-module-bg"],
  ["moduleBorder", "--di-module-border"],
  ["moduleFg", "--di-module-fg"],
  ["pillBg", "--di-pill-bg"],
  ["pillText", "--di-pill-text"],
  ["pillUnbound", "--di-pill-unbound"],
  ["pillUnboundBg", "--di-pill-unbound-bg"],
  ["pillUnboundText", "--di-pill-unbound-text"],
];

function vars(palette: Palette, indent: string): string {
  return VAR_NAMES.map(
    ([key, name]) => `${indent}${name}: ${palette[key]};`,
  ).join("\n");
}

export function paletteFor(theme: ThemeMode): Palette {
  return theme === "light" ? LIGHT : DARK;
}

export const THEME_CSS = [
  ":where(.di-viz) {",
  vars(DARK, "  "),
  `  --di-font: ${FONT_STACK};`,
  "  display: block;",
  "}",
  ':where(.di-viz:not([data-responsive="true"])) {',
  "  max-width: 100%;",
  "  height: auto;",
  "}",
  "@media (prefers-color-scheme: light) {",
  '  :where(.di-viz[data-theme="auto"]) {',
  vars(LIGHT, "    "),
  "  }",
  "}",
  ':where(.di-viz[data-theme="light"]) {',
  vars(LIGHT, "  "),
  "}",
  ':where(.di-viz[data-theme="dark"]) {',
  vars(DARK, "  "),
  "}",
  ":where(.di-viz) .di-canvas {",
  "  fill: var(--di-canvas-bg);",
  "}",
  ":where(.di-viz) .di-body {",
  "  fill: var(--di-surface);",
  "}",
  ":where(.di-viz) .di-role-root .di-body {",
  "  stroke: var(--di-stroke-root);",
  "}",
  ":where(.di-viz) .di-role-component .di-body {",
  "  stroke: var(--di-stroke-component);",
  "}",
  ":where(.di-viz) .di-role-boundary .di-body {",
  "  stroke: var(--di-stroke-boundary);",
  "}",
  ":where(.di-viz) .di-role-value .di-body {",
  "  stroke: var(--di-stroke-value);",
  "}",
  ":where(.di-viz) .di-edge {",
  "  fill: none;",
  "  stroke: var(--di-wire);",
  "  stroke-width: 1.5;",
  "  stroke-linecap: square;",
  "  stroke-linejoin: round;",
  "}",
  ":where(.di-viz) .di-pill {",
  "  fill: var(--di-pill-bg);",
  "}",
  ":where(.di-viz) .di-pill-unbound {",
  "  fill: var(--di-pill-unbound-bg);",
  "  stroke: var(--di-pill-unbound);",
  "}",
  ":where(.di-viz) .di-pill-fresh {",
  "  fill: var(--di-surface);",
  "  stroke: var(--di-stroke-value);",
  "  stroke-dasharray: 2 2;",
  "}",
  ":where(.di-viz) .di-pill-label {",
  "  fill: var(--di-pill-text);",
  "}",
  ":where(.di-viz) .di-socket-unbound .di-pill-label {",
  "  fill: var(--di-pill-unbound-text);",
  "}",
  ":where(.di-viz) .di-socket-fresh .di-pill-label {",
  "  fill: var(--di-stroke-value);",
  "}",
  ":where(.di-viz) .di-title {",
  "  fill: var(--di-fg);",
  "}",
  ":where(.di-viz) .di-subtitle {",
  "  fill: var(--di-muted);",
  "}",
  ":where(.di-viz) .di-tags {",
  "  fill: var(--di-tag);",
  "}",
  ":where(.di-viz) .di-module rect {",
  "  fill: var(--di-module-bg);",
  "  stroke: var(--di-module-border);",
  "}",
  ":where(.di-viz) .di-module text {",
  "  fill: var(--di-module-fg);",
  "}",
  ":where(.di-viz) .di-candidate-body {",
  "  fill: var(--di-module-bg);",
  "  stroke: var(--di-module-border);",
  "}",
  ":where(.di-viz) .di-candidate-pill {",
  "  fill: var(--di-surface);",
  "  stroke: var(--di-module-border);",
  "}",
  ":where(.di-viz) .di-candidate text {",
  "  fill: var(--di-module-fg);",
  "}",
  ":where(.di-viz) text {",
  "  font-family: var(--di-font);",
  "}",
].join("\n");

export function themeCss(): string {
  return THEME_CSS;
}
