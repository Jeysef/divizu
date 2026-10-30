import type {
  CandidateDef,
  LayoutNode,
  LayoutResult,
  Point,
  RenderOptions,
  RenderResult,
  ThemeMode,
} from "./ast.ts";
import { DivizuError } from "./diagnostics.ts";
import { computeLayout } from "./layout.ts";
import { parseDocument } from "./parser.ts";
import { DARK, FONT_STACK, THEME_CSS, paletteFor, type Palette } from "./theme.ts";
import { validateDocument } from "./validate.ts";

const SOCKET_DEPTH = 48;
const PLUG_DEPTH = 14;
const PILL_HEIGHT = 22;
const STROKE_W = 3.2;
const MODULE_HEIGHT = 28;
const MODULE_GAP = 8;
const CANDIDATE_W = 52;
const CANDIDATE_H = 140;
const CANDIDATE_GAP = 16;
const CANDIDATE_PAD = 16;

export function render(dsl: string, options: RenderOptions = {}): RenderResult {
  const doc = parseDocument(dsl);
  const validation = validateDocument(doc);
  if (!validation.ok) {
    const first = validation.errors[0]!;
    throw new DivizuError(first);
  }

  const layout = computeLayout(doc, {
    layerGap: options.layerGap,
    socketGap: options.socketGap,
  });

  return renderLayout(layout, options);
}

function renderLayout(
  layout: LayoutResult,
  options: RenderOptions,
): RenderResult {
  const padding = Math.max(0, options.padding ?? 56);
  const cornerRadius = Math.max(0, options.cornerRadius ?? 8);
  const theme: ThemeMode =
    options.theme === "light" || options.theme === "dark"
      ? options.theme
      : "auto";
  const palette = paletteFor(theme);
  const responsive = options.responsive ?? false;

  const svgWidth = Math.ceil(layout.width + padding * 2);
  const svgHeight = Math.ceil(layout.height + padding * 2);
  const offsetX = padding - layout.bounds.minX;
  const offsetY = padding - layout.bounds.minY;

  const parts: string[] = [];

  for (const edge of layout.edges) {
    const d = edge.points
      .map((point, index) => {
        const x = fmt(point.x + offsetX);
        const y = fmt(point.y + offsetY);
        return `${index === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");
    parts.push(
      `<path class="di-edge" d="${d}" fill="none" stroke="${palette.wire}" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="round"><title>${escapeXml(edge.key)}</title></path>`,
    );
  }

  for (const node of layout.nodes) {
    parts.push(renderBlock(node, offsetX, offsetY, cornerRadius, palette));
  }

  const title =
    options.title ??
    (layout.roots
      .map((key) => layout.nodes.find((node) => node.key === key)?.label)
      .filter(Boolean)
      .join(" + ") || "divizu");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${responsive ? "100%" : svgWidth}" height="${responsive ? "100%" : svgHeight}" class="di-viz" data-theme="${theme}"${responsive ? ' data-responsive="true"' : ""} role="img" font-family="${FONT_STACK}">
  <title>${escapeXml(title)} architecture diagram</title>
  <style>${THEME_CSS}</style>
  <rect class="di-canvas" x="0" y="0" width="${svgWidth}" height="${svgHeight}" fill="${palette.canvasBg}" />
  ${parts.join("\n  ")}
</svg>`;

  return { svg, width: svgWidth, height: svgHeight };
}

function renderBlock(
  node: LayoutNode,
  offsetX: number,
  offsetY: number,
  cornerRadius: number,
  palette: Palette,
): string {
  const left = node.x + offsetX;
  const right = left + node.width;
  const top = node.y + offsetY;
  const bottom = top + node.height;
  const cx = node.centerX + offsetX;

  const points: Point[] = [{ x: left, y: top }];

  for (const socket of node.sockets) {
    const socketLeft = socket.x + offsetX - socket.width / 2;
    const socketRight = socket.x + offsetX + socket.width / 2;
    points.push({ x: socketLeft, y: top });
    points.push({ x: socketLeft, y: top + SOCKET_DEPTH });
    points.push({ x: socketRight, y: top + SOCKET_DEPTH });
    points.push({ x: socketRight, y: top });
  }

  points.push({ x: right, y: top });
  points.push({ x: right, y: bottom });

  if (node.plugWidth > 0) {
    const plugRight = cx + node.plugWidth / 2;
    const plugLeft = cx - node.plugWidth / 2;
    points.push({ x: plugRight, y: bottom });
    points.push({ x: plugRight, y: bottom + PLUG_DEPTH });
    points.push({ x: plugLeft, y: bottom + PLUG_DEPTH });
    points.push({ x: plugLeft, y: bottom });
  }

  points.push({ x: left, y: bottom });

  const stroke = strokeFor(node.role, palette);
  const parts: string[] = [];

  parts.push(
    `<g class="di-block di-role-${node.role}${node.fresh ? " di-fresh-copy" : ""}" data-block-id="${escapeXml(node.id)}" data-key="${escapeXml(node.key)}" data-layer="${node.layer}">`,
  );
  const source = node.src
    ? ` — ${node.src.file}${node.src.line ? `:${node.src.line}` : ""}`
    : "";
  const tags = node.tags.length > 0 ? ` — tags: ${node.tags.join(", ")}` : "";
  parts.push(
    `<title>${escapeXml(node.label)}${node.subtitle ? ` — ${escapeXml(node.subtitle)}` : ""}${escapeXml(source)}${escapeXml(tags)}</title>`,
  );
  parts.push(
    `<path class="di-body" d="${roundedPolygonPath(points, cornerRadius)}" fill="${palette.surface}" stroke="${stroke}" stroke-width="${STROKE_W}" stroke-linejoin="round" />`,
  );

  for (const socket of node.sockets) {
    const pillW = Math.max(48, socket.width - 16);
    const pillX = socket.x + offsetX - pillW / 2;
    const pillY = top + SOCKET_DEPTH - PILL_HEIGHT - 6;
    const bound = socket.providerId !== undefined;

    parts.push(
      `<g class="di-socket ${bound ? "di-socket-bound" : "di-socket-unbound"}${socket.fresh ? " di-socket-fresh" : ""}">`,
    );
    parts.push(
      `<title>${escapeXml(socket.key)}${bound ? ` ← ${escapeXml(socket.providerId!)}${socket.fresh ? " (fresh)" : ""}` : " (unbound)"}</title>`,
    );

    if (socket.fresh) {
      parts.push(
        `<rect class="di-pill di-pill-fresh" x="${fmt(pillX)}" y="${fmt(pillY)}" width="${fmt(pillW)}" height="${PILL_HEIGHT}" rx="11" fill="${palette.surface}" stroke="${palette.strokeValue}" stroke-width="1.5" stroke-dasharray="2 2" />`,
      );
    } else if (bound) {
      parts.push(
        `<rect class="di-pill" x="${fmt(pillX)}" y="${fmt(pillY)}" width="${fmt(pillW)}" height="${PILL_HEIGHT}" rx="11" fill="${palette.pillBg}" />`,
      );
    } else {
      parts.push(
        `<rect class="di-pill di-pill-unbound" x="${fmt(pillX)}" y="${fmt(pillY)}" width="${fmt(pillW)}" height="${PILL_HEIGHT}" rx="11" fill="${palette.pillUnboundBg}" stroke="${palette.pillUnbound}" stroke-width="1.5" stroke-dasharray="4 3" />`,
      );
    }

    parts.push(
      `<text class="di-pill-label" x="${fmt(socket.x + offsetX)}" y="${fmt(pillY + 15)}" text-anchor="middle" fill="${socket.fresh ? palette.strokeValue : bound ? palette.pillText : palette.pillUnboundText}" font-size="11.5">${escapeXml(socket.key)}</text>`,
    );
    parts.push("</g>");
  }

  const isLeaf =
    node.role !== "root" &&
    node.sockets.length === 0 &&
    node.modules.length === 0 &&
    node.candidates.length === 0;

  if (isLeaf) {
    if (node.subtitle) {
      parts.push(
        `<text class="di-title" x="${fmt(cx)}" y="${fmt(top + node.height / 2 - 1)}" text-anchor="middle" fill="${palette.fg}" font-size="13" font-weight="600">${escapeXml(node.label)}</text>`,
        `<text class="di-subtitle" x="${fmt(cx)}" y="${fmt(top + node.height / 2 + 15)}" text-anchor="middle" fill="${palette.muted}" font-size="10.5">${escapeXml(node.subtitle)}</text>`,
      );
    } else {
      parts.push(
        `<text class="di-title" x="${fmt(cx)}" y="${fmt(top + node.height / 2 + 5)}" text-anchor="middle" fill="${palette.fg}" font-size="13" font-weight="600">${escapeXml(node.label)}</text>`,
      );
    }

    if (node.tags.length > 0) {
      parts.push(
        `<text class="di-tags" x="${fmt(right - 12)}" y="${fmt(bottom - 7)}" text-anchor="end" fill="${palette.tag}" font-size="8">${escapeXml(node.tags.join(" · "))}</text>`,
      );
    }
  } else {
    const titleY = bottom - 14;
    parts.push(
      `<text class="di-title" x="${fmt(left + 16)}" y="${fmt(titleY)}" text-anchor="start" fill="${palette.fg}" font-size="15" font-weight="600">${escapeXml(node.label)}</text>`,
    );

    if (node.subtitle) {
      parts.push(
        `<text class="di-subtitle" x="${fmt(left + 16)}" y="${fmt(titleY - 17)}" text-anchor="start" fill="${palette.muted}" font-size="11.5">${escapeXml(node.subtitle)}</text>`,
      );
    }

    if (node.tags.length > 0) {
      parts.push(
        `<text class="di-tags" x="${fmt(right - 16)}" y="${fmt(titleY)}" text-anchor="end" fill="${palette.tag}" font-size="8.5">${escapeXml(node.tags.join(" · "))}</text>`,
      );
    }

    const bodyTop = top + (node.sockets.length > 0 ? SOCKET_DEPTH + 18 : 18);
    const modules = node.role === "root" ? [] : node.modules;
    const candidates = node.role === "root" ? [] : node.candidates;

    if (modules.length > 0) {
      const moduleW = Math.min(node.width - 36, 420);
      const moduleX = left + (node.width - moduleW) / 2;
      modules.forEach((moduleName, index) => {
        const moduleY = bodyTop + index * (MODULE_HEIGHT + MODULE_GAP);
        parts.push(
          `<g class="di-module">`,
          `<rect x="${fmt(moduleX)}" y="${fmt(moduleY)}" width="${fmt(moduleW)}" height="${MODULE_HEIGHT}" rx="5" fill="${palette.moduleBg}" stroke="${palette.moduleBorder}" stroke-width="1" />`,
          `<text x="${fmt(moduleX + 12)}" y="${fmt(moduleY + 18.5)}" text-anchor="start" fill="${palette.moduleFg}" font-size="12">${escapeXml(moduleName)}</text>`,
          `</g>`,
        );
      });
    }

    if (candidates.length > 0) {
      const modulesH =
        modules.length * MODULE_HEIGHT +
        Math.max(0, modules.length - 1) * MODULE_GAP;
      const n = candidates.length;
      const rowW = n * CANDIDATE_W + (n - 1) * CANDIDATE_GAP;
      const startX = left + (node.width - rowW) / 2;
      const startY = bodyTop + (modules.length > 0 ? modulesH + 16 : 0);

      candidates.forEach((candidate, index) => {
        parts.push(
          renderCandidate(candidate, {
            x: startX + index * (CANDIDATE_W + CANDIDATE_GAP),
            y: startY,
            palette,
          }),
        );
      });
    }
  }

  parts.push("</g>");
  return parts.join("");
}

function renderCandidate(
  candidate: CandidateDef,
  options: { x: number; y: number; palette: Palette },
): string {
  const { x, y, palette } = options;
  const w = CANDIDATE_W;
  const h = CANDIDATE_H;
  const notchH = 72;
  const notchDepth = 16;
  const notchY = y + (h - notchH) / 2;
  const parts: string[] = [];

  parts.push(`<g class="di-candidate">`);
  parts.push(
    `<title>${escapeXml(candidate.name)}${candidate.requires ? ` requires ${escapeXml(candidate.requires)}` : ""}</title>`,
  );

  if (candidate.requires) {
    const points: Point[] = [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: notchY },
      { x: x + w - notchDepth, y: notchY },
      { x: x + w - notchDepth, y: notchY + notchH },
      { x: x + w, y: notchY + notchH },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
    parts.push(
      `<path class="di-candidate-body" d="${roundedPolygonPath(points, 8)}" fill="${palette.moduleBg}" stroke="${palette.moduleBorder}" stroke-width="1.4" />`,
    );
    const pillX = x + w - notchDepth + 1;
    const pillY = notchY + 2;
    const pillW = notchDepth - 2;
    const pillH = notchH - 4;
    parts.push(
      `<rect class="di-candidate-pill" x="${fmt(pillX)}" y="${fmt(pillY)}" width="${fmt(pillW)}" height="${fmt(pillH)}" rx="5" fill="${palette.surface}" stroke="${palette.moduleBorder}" stroke-width="1" />`,
      `<text x="${fmt(pillX + 10)}" y="${fmt(pillY + 8)}" transform="rotate(90 ${fmt(pillX + 10)} ${fmt(pillY + 8)})" text-anchor="start" fill="${palette.muted}" font-size="10">${escapeXml(candidate.requires)}</text>`,
    );
  } else {
    parts.push(
      `<rect class="di-candidate-body" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="8" fill="${palette.moduleBg}" stroke="${palette.moduleBorder}" stroke-width="1.4" />`,
    );
  }

  parts.push(
    `<text x="${fmt(x + 14)}" y="${fmt(y + 10)}" transform="rotate(90 ${fmt(x + 14)} ${fmt(y + 10)})" text-anchor="start" fill="${palette.moduleFg}" font-size="11">${escapeXml(candidate.name)}</text>`,
  );
  parts.push("</g>");
  return parts.join("");
}

function strokeFor(role: LayoutNode["role"], palette: Palette): string {
  switch (role) {
    case "root":
      return palette.strokeRoot;
    case "boundary":
      return palette.strokeBoundary;
    case "value":
      return palette.strokeValue;
    default:
      return palette.strokeComponent;
  }
}

function roundedPolygonPath(points: Point[], radius: number): string {
  const pts = normalizePolygon(points);
  const n = pts.length;
  if (n < 3) return "";

  const commands: string[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!;
    const curr = pts[i]!;
    const next = pts[(i + 1) % n]!;

    const dx1 = prev.x - curr.x;
    const dy1 = prev.y - curr.y;
    const len1 = Math.hypot(dx1, dy1);
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    const len2 = Math.hypot(dx2, dy2);
    if (len1 === 0 || len2 === 0) continue;

    const r = Math.min(radius, len1 / 2, len2 / 2);
    const startX = curr.x + (dx1 / len1) * r;
    const startY = curr.y + (dy1 / len1) * r;
    const endX = curr.x + (dx2 / len2) * r;
    const endY = curr.y + (dy2 / len2) * r;
    commands.push(`${i === 0 ? "M" : "L"} ${fmt(startX)} ${fmt(startY)}`);
    commands.push(`Q ${fmt(curr.x)} ${fmt(curr.y)} ${fmt(endX)} ${fmt(endY)}`);
  }

  commands.push("Z");
  return commands.join(" ");
}

function normalizePolygon(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (
      last &&
      Math.abs(last.x - point.x) < 1e-9 &&
      Math.abs(last.y - point.y) < 1e-9
    ) {
      continue;
    }
    out.push(point);
  }
  if (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (
      Math.abs(first.x - last.x) < 1e-9 &&
      Math.abs(first.y - last.y) < 1e-9
    ) {
      out.pop();
    }
  }
  return out;
}

function fmt(value: number): string {
  return Number(value.toFixed(1)).toString();
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"\n\r\t]/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      case "\n":
        return "&#10;";
      case "\r":
        return "&#13;";
      case "\t":
        return "&#9;";
      default:
        return char;
    }
  });
}

export function mount(
  el: { innerHTML: string },
  dsl: string,
  options: RenderOptions = {},
): RenderResult {
  const result = render(dsl, options);
  el.innerHTML = result.svg;
  return result;
}

// Kept for callers that only need the theme.
export { DARK, THEME_CSS, FONT_STACK };
