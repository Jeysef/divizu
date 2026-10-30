/**
 * diviz — deterministic, zero-runtime-dependency DSL -> SVG renderer for
 * hardware-slot dependency injection diagrams.
 *
 * Pipeline: DSL -> AST -> envelope layout -> SVG.
 * No DOM, no headless browser, no text measurement APIs.
 */

export type BlockRole = "root" | "composite" | "adapter" | "service" | "port";

export interface SocketDef {
  portName: string;
  /** undefined = unbound (rendered with a dashed pill) */
  providerId?: string;
}

export interface CandidateDef {
  name: string;
  /** Internal required interface, drawn as a side notch/pill. */
  requires?: string;
}

export interface BlockDef {
  id: string;
  subtitle?: string;
  role: BlockRole;
  modules: string[];
  candidates: CandidateDef[];
  sockets: SocketDef[];
}

export type ThemeMode = "auto" | "dark" | "light";

export interface RenderOptions {
  /** Outer canvas padding in px. Default 56. */
  padding?: number;
  /** Corner radius for every orthogonal vertex. Default 10. */
  cornerRadius?: number;
  /**
   * Edge-to-edge gap between a child body and its parent socket. Default 10,
   * which leaves roughly 6px of visible clearance with the 3.5px strokes.
   */
  fitGap?: number;
  /** Gap reserved between neighbouring socket envelopes. Default 28. */
  socketGap?: number;
  /** Color theme. Default "auto" (follows prefers-color-scheme via CSS). */
  theme?: ThemeMode;
  /** Let the SVG fill its container (width/height 100%). Default false. */
  responsive?: boolean;
  /** Accessible title. Defaults to the root block id(s). */
  title?: string;
}

export interface RenderResult {
  svg: string;
  width: number;
  height: number;
}

export interface LayoutSocket {
  portName: string;
  providerId?: string;
  childKey?: string;
  /** Horizontal center in world coordinates. */
  cx: number;
  notchWidth: number;
}

export interface LayoutNode {
  /** Unique instance key. Shared providers are duplicated per socket. */
  key: string;
  id: string;
  role: BlockRole;
  parentKey?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  /** Distance from centerX to the left edge of this node's whole subtree. */
  extentLeft: number;
  /** Distance from centerX to the right edge of this node's whole subtree. */
  extentRight: number;
  plugWidth: number;
  sockets: LayoutSocket[];
}

export interface LayoutResult {
  width: number;
  height: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  roots: string[];
  nodes: LayoutNode[];
}

// --- GEOMETRY & LAYOUT CONSTANTS ---
const CHAR_W_TITLE = 9.6;
const CHAR_W_SMALL = 7.8;
const SOCKET_DEPTH = 48;
const PLUG_DEPTH = 24;
const FIT_GAP = 10;
const SOCKET_GAP = 28;
const SHOULDER_MIN = 26;
const PILL_HEIGHT = 22;
const MODULE_HEIGHT = 28;
const MODULE_GAP = 8;
const CANDIDATE_W = 52;
const CANDIDATE_H = 140;
const CANDIDATE_GAP = 16;
const CANDIDATE_PAD = 16;
const LEAF_HEIGHT = 64;
const CORNER_R = 10;
const ROOT_GAP = 72;
const MAX_INSTANCES = 5000;
const STROKE_W = 3.5;
const FONT_STACK =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

interface Point {
  x: number;
  y: number;
}

interface ComputedSocket {
  portName: string;
  providerId?: string;
  notchWidth: number;
  /** How far the socket's reserved envelope reaches left of its center. */
  envLeft: number;
  /** How far the socket's reserved envelope reaches right of its center. */
  envRight: number;
  localCx: number;
  child?: ComputedBlock;
}

interface ComputedBlock {
  key: string;
  def: BlockDef;
  width: number;
  height: number;
  extentLeft: number;
  extentRight: number;
  subtreeHeight: number;
  plugWidth: number;
  sockets: ComputedSocket[];
  x: number;
  y: number;
  cx: number;
  parentKey?: string;
}

interface LayoutConfig {
  fitGap: number;
  socketGap: number;
}

// ============================================================================
// 1. PARSER (DSL -> AST)
// ============================================================================

export function parseDSL(source: string): Map<string, BlockDef> {
  const clean = stripComments(source);
  const blocks = new Map<string, BlockDef>();
  let i = 0;

  while (i < clean.length) {
    while (i < clean.length && /\s/.test(clean[i]!)) i++;
    if (i >= clean.length) break;

    const idMatch = /^[A-Za-z0-9_.-]+/.exec(clean.slice(i));
    if (!idMatch) {
      throw new Error(
        `Unexpected "${clean[i]}" on line ${lineAt(clean, i)}. Expected a block name.`,
      );
    }

    const id = idMatch[0]!;
    i += id.length;
    i = skipInlineSpace(clean, i);

    let subtitle: string | undefined;
    if (clean[i] === '"') {
      const end = findQuoteEnd(clean, i);
      subtitle = unescape(clean.slice(i + 1, end));
      i = end + 1;
      i = skipInlineSpace(clean, i);
    }

    let body = "";
    const beforeBrace = i;
    while (i < clean.length && /\s/.test(clean[i]!)) i++;
    if (clean[i] === "{") {
      const end = findBodyEnd(clean, i);
      body = clean.slice(i + 1, end);
      i = end + 1;
    } else {
      i = beforeBrace;
    }

    if (blocks.has(id)) {
      throw new Error(`Duplicate block "${id}". Block ids must be unique.`);
    }
    blocks.set(id, parseBody(id, subtitle, body));
  }

  return blocks;
}

function skipInlineSpace(source: string, index: number): number {
  while (
    index < source.length &&
    (source[index] === " " || source[index] === "\t")
  ) {
    index++;
  }
  return index;
}

function parseBody(
  id: string,
  subtitle: string | undefined,
  body: string,
): BlockDef {
  const def: BlockDef = {
    id,
    subtitle,
    role: "composite",
    modules: [],
    candidates: [],
    sockets: [],
  };
  let hasRole = false;

  const lines = body.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!.trim();
    if (!line) continue;

    if (line.startsWith("role:")) {
      const raw = unquote(line.slice(5).trim());
      if (
        raw !== "root" &&
        raw !== "composite" &&
        raw !== "adapter" &&
        raw !== "service" &&
        raw !== "port"
      ) {
        throw new Error(
          `Unknown role "${raw}" on block "${id}" (line ${li + 1} of its body). Expected root, composite, adapter, service, or port.`,
        );
      }
      def.role = raw as BlockRole;
      hasRole = true;
      continue;
    }

    if (line.startsWith("modules:")) {
      let raw = line.slice(8).trim();
      while (raw.endsWith(",") && li + 1 < lines.length) {
        const next = lines[li + 1]!.trim();
        if (!next || /^(role:|modules:|socket\b)/.test(next)) break;
        raw += " " + next;
        li++;
      }
      def.modules = splitModules(raw, id);
      continue;
    }

    if (line.startsWith("candidates:")) {
      const raw = line.slice(11).trim();
      if (raw) def.candidates = parseCandidates(raw, id);
      continue;
    }

    if (/^socket\b/.test(line)) {
      const match =
        /^socket\s+(?:<([^>]+)>|([^\s<>]+))(?:\s*<-\s*(?:<([^>]+)>|([^\s<>]+)))?\s*$/.exec(
          line,
        );
      if (!match) {
        throw new Error(
          `Cannot parse socket on block "${id}": "${line}". Expected: socket <PortName> [<- ProviderId].`,
        );
      }

      const portName = (match[1] ?? match[2] ?? "").trim();
      const providerId = (match[3] ?? match[4] ?? "").trim() || undefined;

      if (!isIdentifier(portName)) {
        throw new Error(`Invalid port name "${portName}" on block "${id}".`);
      }
      if (providerId !== undefined && !isIdentifier(providerId)) {
        throw new Error(
          `Invalid provider id "${providerId}" for socket "${portName}" on block "${id}".`,
        );
      }

      def.sockets.push({ portName, providerId });
      continue;
    }

    throw new Error(
      `Unknown directive on block "${id}": "${line}". Expected role:, modules:, candidates:, or socket.`,
    );
  }

  // A socket-less block with no candidates and no explicit role is a leaf.
  if (!hasRole && def.sockets.length === 0 && def.candidates.length === 0) {
    def.role = "adapter";
  }

  return def;
}

function parseCandidates(raw: string, blockId: string): CandidateDef[] {
  const out: CandidateDef[] = [];
  for (const item of raw.split(",")) {
    const text = item.trim();
    if (!text) continue;
    const match = /^([A-Za-z0-9_.-]+)(?:\(([^)]+)\))?$/.exec(text);
    if (!match) {
      throw new Error(
        `Cannot parse candidate "${text}" on block "${blockId}". Expected Name or Name(RequiredInterface).`,
      );
    }
    const requires = match[2]?.trim();
    out.push({ name: match[1]!, ...(requires ? { requires } : {}) });
  }
  return out;
}

function splitModules(raw: string, blockId: string): string[] {
  const modules: string[] = [];
  let current = "";
  let quoted = false;

  for (const ch of raw) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      if (current.trim()) modules.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }

  if (quoted) {
    throw new Error(`Unterminated quoted module name on block "${blockId}".`);
  }
  if (current.trim()) modules.push(current.trim());
  return modules;
}

function stripComments(source: string): string {
  let out = "";
  let quoted = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;

    if (quoted) {
      out += ch;
      if (ch === "\\" && i + 1 < source.length) {
        out += source[++i]!;
      } else if (ch === '"') {
        quoted = false;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
      out += ch;
      continue;
    }

    if (ch === "#" || (ch === "/" && source[i + 1] === "/")) {
      while (i < source.length && source[i] !== "\n") i++;
      out += "\n";
      continue;
    }

    out += ch;
  }

  return out;
}

function findQuoteEnd(source: string, start: number): number {
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === '"') return i;
  }
  throw new Error(`Unterminated string on line ${lineAt(source, start)}.`);
}

function findBodyEnd(source: string, open: number): number {
  let quoted = false;
  for (let i = open + 1; i < source.length; i++) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === "\\") i++;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === "}") return i;
  }
  throw new Error(`Unclosed block starting on line ${lineAt(source, open)}.`);
}

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return unescape(value.slice(1, -1));
  }
  return value;
}

function unescape(value: string): string {
  return value.replace(/\\(["\\])/g, "$1");
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value);
}

// ============================================================================
// 2. ORTHOGONAL ROUNDED POLYGON GENERATOR
// ============================================================================

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
    commands.push(
      `Q ${fmt(curr.x)} ${fmt(curr.y)} ${fmt(endX)} ${fmt(endY)}`,
    );
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

function fmt(n: number): string {
  return Number(n.toFixed(1)).toString();
}

// ============================================================================
// 3. TWO-PASS ANTI-SHADOWING LAYOUT ENGINE
// ============================================================================

function computeLayout(
  blocks: Map<string, BlockDef>,
  config: LayoutConfig,
): {
  roots: ComputedBlock[];
  allNodes: ComputedBlock[];
  bounds: LayoutResult["bounds"];
} {
  if (blocks.size === 0) {
    throw new Error("No blocks found. A diagram needs at least one block.");
  }

  // Validate every reference up front so typos fail loudly.
  for (const block of blocks.values()) {
    for (const socket of block.sockets) {
      if (socket.providerId && !blocks.has(socket.providerId)) {
        throw new Error(
          `Socket "${socket.portName}" on "${block.id}" plugs into unknown block "${socket.providerId}".`,
        );
      }
    }
  }

  const referenced = new Set<string>();
  for (const block of blocks.values()) {
    for (const socket of block.sockets) {
      if (socket.providerId) referenced.add(socket.providerId);
    }
  }

  const rootIds = [...blocks.keys()].filter((id) => !referenced.has(id));
  if (rootIds.length === 0) {
    throw new Error(
      "No root block found. Every block is plugged into another block, so the graph likely contains a cycle. Dependency graphs must be acyclic.",
    );
  }

  const { fitGap, socketGap } = config;
  const measuredIds = new Set<string>();
  const allNodes: ComputedBlock[] = [];
  const roots: ComputedBlock[] = [];
  let measuredCount = 0;

  // PASS 1: Bottom-up envelope sizing (leaf adapters -> root containers).
  function measureNode(
    id: string,
    targetSocketWidth: number,
    ancestors: string[],
    key: string,
  ): ComputedBlock {
    if (ancestors.includes(id)) {
      throw new Error(
        `Cycle detected: ${[...ancestors, id].join(" -> ")}. Dependency graphs must be acyclic.`,
      );
    }

    const def = blocks.get(id);
    if (!def) {
      throw new Error(`Unknown block "${id}".`);
    }
    measuredIds.add(id);

    measuredCount++;
    if (measuredCount > MAX_INSTANCES) {
      throw new Error(
        `Diagram exceeds ${MAX_INSTANCES} block instances. Shared providers are duplicated per socket, so a heavily shared graph can grow exponentially. Split the diagram or replace shared subtrees with modules.`,
      );
    }

    const computedSockets: ComputedSocket[] = [];
    let maxChildSubtreeH = 0;

    def.sockets.forEach((socket, index) => {
      const notchWidth = Math.max(96, socket.portName.length * CHAR_W_SMALL + 44);

      let child: ComputedBlock | undefined;
      if (socket.providerId) {
        child = measureNode(
          socket.providerId,
          notchWidth,
          [...ancestors, id],
          `${key}/${index}:${socket.providerId}`,
        );
        maxChildSubtreeH = Math.max(maxChildSubtreeH, child.subtreeHeight);
      }

      // CRITICAL ANTI-SHADOWING INVARIANT:
      // A socket reserves max(notch, child subtree) on *each* side. The extents
      // are tracked independently because a child subtree can be asymmetric.
      // This is what pushes ShippingPort / ReportPort out of OrderService's
      // shadow instead of letting a wide child cover a neighbouring socket.
      const halfNotch = notchWidth / 2;
      computedSockets.push({
        portName: socket.portName,
        providerId: socket.providerId,
        notchWidth,
        envLeft: Math.max(halfNotch, child?.extentLeft ?? 0),
        envRight: Math.max(halfNotch, child?.extentRight ?? 0),
        localCx: 0,
        child,
      });
    });

    // Position socket centers so reserved envelopes never collide.
    if (computedSockets.length > 0) {
      const positions = [0];
      for (let i = 1; i < computedSockets.length; i++) {
        const prev = computedSockets[i - 1]!;
        const curr = computedSockets[i]!;
        positions.push(
          positions[i - 1]! + prev.envRight + socketGap + curr.envLeft,
        );
      }

      // Center the visible notch group (not the envelopes) on the block.
      const first = computedSockets[0]!;
      const last = computedSockets[computedSockets.length - 1]!;
      const firstNotchLeft = positions[0]! - first.notchWidth / 2;
      const lastNotchRight =
        positions[positions.length - 1]! + last.notchWidth / 2;
      const centerOffset = (firstNotchLeft + lastNotchRight) / 2;

      for (let i = 0; i < computedSockets.length; i++) {
        computedSockets[i]!.localCx = positions[i]! - centerOffset;
      }
    }

    const socketsSpanW = (() => {
      if (computedSockets.length === 0) return 0;
      const first = computedSockets[0]!;
      const last = computedSockets[computedSockets.length - 1]!;
      const leftMost = first.localCx - first.notchWidth / 2;
      const rightMost = last.localCx + last.notchWidth / 2;
      return rightMost - leftMost + SHOULDER_MIN * 2;
    })();

    const titleW = def.id.length * CHAR_W_TITLE + 44;
    const subtitleW = (def.subtitle?.length ?? 0) * CHAR_W_SMALL + 40;
    const hasCandidates = def.candidates.length > 0;
    const isLeaf =
      def.role !== "root" &&
      computedSockets.length === 0 &&
      !hasCandidates &&
      (def.role === "adapter" || def.modules.length === 0);
    const cardCount = def.modules.length + def.candidates.length;
    const cardsRowW =
      cardCount > 0
        ? cardCount * CANDIDATE_W +
          (cardCount - 1) * CANDIDATE_GAP +
          CANDIDATE_PAD * 2
        : 0;
    const contentW = Math.max(136, titleW, subtitleW, cardsRowW);

    let width: number;
    if (isLeaf) {
      // Compact cap: no wide shoulders, no struct fields, no subtitle.
      width = Math.max(targetSocketWidth > 0 ? targetSocketWidth : 136, titleW + 16);
    } else if (
      computedSockets.length === 1 &&
      def.modules.length === 0 &&
      !hasCandidates &&
      def.role !== "root"
    ) {
      width = Math.max(computedSockets[0]!.notchWidth + 24, titleW + 16);
    } else {
      width = Math.max(socketsSpanW, contentW);
    }

    const topSocketZone =
      computedSockets.length > 0 ? SOCKET_DEPTH + 14 : 18;
    const headerZone = isLeaf ? 0 : (def.subtitle ? 44 : 28);
    const cardsZone = isLeaf || cardCount === 0 ? 0 : CANDIDATE_H + CANDIDATE_PAD * 2;
    let height = isLeaf
      ? LEAF_HEIGHT
      : topSocketZone + headerZone + cardsZone + 14;
    if (def.role === "root") {
      // The root is a clean baseplate: sockets on top, title bottom-left.
      height = Math.max(topSocketZone + 18, 120);
    }

    // The subtree envelope includes all socket envelopes, which already include
    // descendants' envelopes. This is the value parents reserve.
    let minLeft = -width / 2;
    let maxRight = width / 2;
    for (const socket of computedSockets) {
      minLeft = Math.min(minLeft, socket.localCx - socket.envLeft);
      maxRight = Math.max(maxRight, socket.localCx + socket.envRight);
    }

    const node: ComputedBlock = {
      key,
      def,
      width,
      height,
      extentLeft: -minLeft,
      extentRight: maxRight,
      subtreeHeight:
        height + (maxChildSubtreeH > 0 ? maxChildSubtreeH + fitGap : 0),
      plugWidth:
        targetSocketWidth > 0
          ? Math.max(0, targetSocketWidth - fitGap * 2)
          : 0,
      sockets: computedSockets,
      x: 0,
      y: 0,
      cx: 0,
    };

    return node;
  }

  // PASS 2: Top-down snap positioning (root containers -> plugged children).
  function placeNode(
    node: ComputedBlock,
    cx: number,
    bottomY: number,
    parentKey?: string,
  ): void {
    node.cx = cx;
    node.x = cx - node.width / 2;
    node.y = bottomY - node.height;
    node.parentKey = parentKey;
    allNodes.push(node);

    for (const socket of node.sockets) {
      if (socket.child) {
        // The child body sits fitGap px above the parent's top edge; its tab
        // protrudes down into the notch, stopping just above the interface pill.
        placeNode(
          socket.child,
          node.cx + socket.localCx,
          node.y - fitGap,
          node.key,
        );
      }
    }
  }

  // Measure every unreferenced block. Multiple roots form a left-to-right shelf.
  const measuredRoots = rootIds.map((id) => measureNode(id, 0, [], id));

  const missing = [...blocks.keys()].filter((id) => !measuredIds.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Unreachable block${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. The graph likely contains a cycle.`,
    );
  }

  // Every container must be wider than its children, not just the root.
  // Expand bottom-up so a parent sees its children's final bodies.
  function expandContainers(root: ComputedBlock): void {
    const visit = (node: ComputedBlock): void => {
      for (const socket of node.sockets) {
        if (socket.child) visit(socket.child);
      }
      let minX = node.x;
      let maxX = node.x + node.width;
      let hasChild = false;
      for (const socket of node.sockets) {
        if (!socket.child) continue;
        hasChild = true;
        minX = Math.min(minX, socket.child.x);
        maxX = Math.max(maxX, socket.child.x + socket.child.width);
      }
      if (!hasChild) return;
      const pad = node === root ? 40 : 8;
      const left = Math.min(node.x, minX - pad);
      const right = Math.max(node.x + node.width, maxX + pad);
      node.x = left;
      node.width = right - left;
    };
    visit(root);
  }

  let cursor = 0;
  for (const root of measuredRoots) {
    const cx = cursor + root.extentLeft;
    placeNode(root, cx, 0);
    expandContainers(root);
    roots.push(root);
    cursor = root.x + root.width + ROOT_GAP;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of allNodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  return { roots, allNodes, bounds: { minX, minY, maxX, maxY } };
}

/**
 * Inspect the computed geometry without producing SVG. Useful for tests,
 * agent self-checks, and host-side hit testing.
 */
export function layout(
  dsl: string,
  options: Pick<RenderOptions, "fitGap" | "socketGap"> = {},
): LayoutResult {
  const blocks = parseDSL(dsl);
  const fitGap = clamp(options.fitGap ?? FIT_GAP, 4, 20);
  const socketGap = Math.max(0, options.socketGap ?? SOCKET_GAP);
  const { roots, allNodes, bounds } = computeLayout(blocks, {
    fitGap,
    socketGap,
  });

  return {
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    bounds,
    roots: roots.map((root) => root.key),
    nodes: allNodes.map((node) => ({
      key: node.key,
      id: node.def.id,
      role: node.def.role,
      parentKey: node.parentKey,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      centerX: node.cx,
      extentLeft: node.extentLeft,
      extentRight: node.extentRight,
      plugWidth: node.plugWidth,
      sockets: node.sockets.map((socket) => ({
        portName: socket.portName,
        providerId: socket.providerId,
        childKey: socket.child?.key,
        cx: node.cx + socket.localCx,
        notchWidth: socket.notchWidth,
      })),
    })),
  };
}

// ============================================================================
// 4. SVG COMPILER
// ============================================================================

export function render(
  dsl: string,
  options: RenderOptions = {},
): RenderResult {
  const padding = Math.max(0, options.padding ?? 56);
  const cornerRadius = Math.max(0, options.cornerRadius ?? CORNER_R);
  const fitGap = clamp(options.fitGap ?? FIT_GAP, 4, 20);
  const socketGap = Math.max(0, options.socketGap ?? SOCKET_GAP);
  const theme =
    options.theme === "light" || options.theme === "dark"
      ? options.theme
      : "auto";
  const responsive = options.responsive ?? false;
  // Concrete colors are emitted as attributes so renderers without CSS variable
  // support (librsvg, ImageMagick, some SVG-to-PNG pipelines) still get a fully
  // colored diagram. The embedded stylesheet re-applies the same properties via
  // --di-* variables, so browsers can re-theme without re-rendering.
  const palette = theme === "light" ? LIGHT : DARK;

  const blocks = parseDSL(dsl);
  const { roots, allNodes, bounds } = computeLayout(blocks, {
    fitGap,
    socketGap,
  });

  const contentW = bounds.maxX - bounds.minX;
  const contentH = bounds.maxY - bounds.minY;

  const svgWidth = Math.ceil(contentW + padding * 2);
  const svgHeight = Math.ceil(contentH + padding * 2);
  const offsetX = -bounds.minX + (svgWidth - contentW) / 2;
  const offsetY = -bounds.minY + padding;

  const elements: string[] = [];

  for (const node of allNodes) {
    elements.push(renderBlock(node, offsetX, offsetY, cornerRadius, palette));
  }

  const ariaTitle =
    options.title ??
    `${roots.map((root) => root.def.id).join(" + ")} dependency injection diagram`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${responsive ? "100%" : svgWidth}" height="${responsive ? "100%" : svgHeight}" class="di-viz" data-theme="${theme}"${responsive ? ' data-responsive="true"' : ""} role="img" font-family="${FONT_STACK}">
  <title>${escapeXml(ariaTitle)}</title>
  <style>${THEME_CSS}</style>
  <rect class="di-canvas" x="0" y="0" width="${svgWidth}" height="${svgHeight}" fill="${palette.canvasBg}" />
  ${elements.join("\n  ")}
</svg>`;

  return { svg, width: svgWidth, height: svgHeight };
}

function renderBlock(
  node: ComputedBlock,
  offsetX: number,
  offsetY: number,
  cornerRadius: number,
  palette: Palette,
): string {
  const left = node.x + offsetX;
  const right = left + node.width;
  const top = node.y + offsetY;
  const bottom = top + node.height;
  const cx = node.cx + offsetX;

  const points: Point[] = [{ x: left, y: top }];

  for (const socket of node.sockets) {
    const socketCx = cx + socket.localCx;
    const socketLeft = socketCx - socket.notchWidth / 2;
    const socketRight = socketCx + socket.notchWidth / 2;
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

  const stroke =
    node.def.role === "adapter"
      ? palette.strokeAdapter
      : node.def.role === "service" || node.def.role === "composite"
        ? palette.strokeService
        : node.def.role === "port"
          ? palette.strokePort
          : palette.strokeContainer;

  const parts: string[] = [];
  parts.push(
    `<g class="di-block di-role-${node.def.role}" data-block-id="${escapeXml(node.def.id)}" data-key="${escapeXml(node.key)}">`,
  );
  parts.push(
    `<path class="di-body" d="${roundedPolygonPath(points, cornerRadius)}" fill="${palette.surface}" stroke="${stroke}" stroke-width="${STROKE_W}" stroke-linejoin="round" />`,
  );

  // Interface pills live on the socket floor.
  for (const socket of node.sockets) {
    const socketCx = cx + socket.localCx;
    const pillW = socket.notchWidth - 16;
    const pillX = socketCx - pillW / 2;
    const pillY = top + SOCKET_DEPTH - PILL_HEIGHT - 6;
    const bound = socket.providerId !== undefined;

    parts.push(
      `<g class="di-socket ${bound ? "di-socket-bound" : "di-socket-unbound"}">`,
    );
    parts.push(
      `<title>${escapeXml(socket.portName)}${bound ? ` ← ${escapeXml(socket.providerId!)}` : " (unbound)"}</title>`,
    );

    if (bound) {
      parts.push(
        `<rect class="di-pill" x="${fmt(pillX)}" y="${fmt(pillY)}" width="${fmt(pillW)}" height="${PILL_HEIGHT}" rx="11" fill="${palette.pillBg}" />`,
      );
    } else {
      parts.push(
        `<rect class="di-pill di-pill-unbound" x="${fmt(pillX)}" y="${fmt(pillY)}" width="${fmt(pillW)}" height="${PILL_HEIGHT}" rx="11" fill="${palette.pillUnboundBg}" stroke="${palette.pillUnbound}" stroke-width="1.5" stroke-dasharray="4 3" />`,
      );
    }

    parts.push(
      `<text class="di-pill-label" x="${fmt(socketCx)}" y="${fmt(pillY + 15)}" text-anchor="middle" fill="${bound ? palette.pillText : palette.pillUnboundText}" font-size="11.5">${escapeXml(socket.portName)}</text>`,
    );
    parts.push("</g>");
  }

  const isLeaf =
    node.def.role !== "root" &&
    node.sockets.length === 0 &&
    node.def.candidates.length === 0 &&
    (node.def.role === "adapter" || node.def.modules.length === 0);

  // Leaves are compact caps: no shoulders, no fields, no subtitle.
  if (isLeaf) {
    parts.push(
      `<text class="di-title" x="${fmt(cx)}" y="${fmt(top + node.height / 2 + 5)}" text-anchor="middle" fill="${palette.fg}" font-size="13" font-weight="600">${escapeXml(node.def.id)}</text>`,
    );
    parts.push("</g>");
    return parts.join("");
  }

  // Container titles live in the bottom-left corner, hardware-label style.
  const titleY = bottom - 14;
  parts.push(
    `<text class="di-title" x="${fmt(left + 16)}" y="${fmt(titleY)}" text-anchor="start" fill="${palette.fg}" font-size="15" font-weight="600">${escapeXml(node.def.id)}</text>`,
  );

  if (node.def.subtitle) {
    parts.push(
      `<text class="di-subtitle" x="${fmt(left + 16)}" y="${fmt(titleY - 17)}" text-anchor="start" fill="${palette.muted}" font-size="11.5">${escapeXml(node.def.subtitle)}</text>`,
    );
  }

  const bodyTop = top + (node.sockets.length > 0 ? SOCKET_DEPTH + 18 : 18);

  // Internal modules and candidate implementations are the same hardware:
  // tall vertical cards in a row, with rotated labels and optional side pills.
  const cards: CandidateDef[] = [
    ...node.def.modules.map((name) => ({ name })),
    ...node.def.candidates,
  ];
  if (cards.length > 0) {
    const n = cards.length;
    const rowW = n * CANDIDATE_W + (n - 1) * CANDIDATE_GAP;
    const startX = left + (node.width - rowW) / 2;
    const startY = bodyTop;

    cards.forEach((candidate, index) => {
      const x = startX + index * (CANDIDATE_W + CANDIDATE_GAP);
      const y = startY;
      const w = CANDIDATE_W;
      const h = CANDIDATE_H;
      const notchH = 72;
      const notchDepth = 16;
      const notchY = y + (h - notchH) / 2;

      parts.push(`<g class="di-candidate">`);
      parts.push(`<title>${escapeXml(candidate.name)}${candidate.requires ? ` requires ${escapeXml(candidate.requires)}` : ""}</title>`);

      if (candidate.requires) {
        const pts: Point[] = [
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
          `<path class="di-candidate-body" d="${roundedPolygonPath(pts, 8)}" fill="${palette.moduleBg}" stroke="${palette.moduleBorder}" stroke-width="1.4" />`,
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
        `<text class="di-candidate-label" x="${fmt(x + 14)}" y="${fmt(y + 10)}" transform="rotate(90 ${fmt(x + 14)} ${fmt(y + 10)})" text-anchor="start" fill="${palette.moduleFg}" font-size="11">${escapeXml(candidate.name)}</text>`,
      );
      parts.push("</g>");
    });
  }


  parts.push("</g>");
  return parts.join("");
}

/**
 * Mount the compiled SVG into a DOM-like host. Kept dependency-free so the same
 * code works in browsers, SolidJS, React effect callbacks, and SSR-ish shims.
 */
export function mount(
  el: { innerHTML: string },
  dsl: string,
  options: RenderOptions = {},
): RenderResult {
  const result = render(dsl, options);
  el.innerHTML = result.svg;
  return result;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ============================================================================
// 5. THEME
// ============================================================================

interface Palette {
  canvasBg: string;
  surface: string;
  strokeContainer: string;
  strokeAdapter: string;
  strokeService: string;
  strokePort: string;
  fg: string;
  muted: string;
  moduleBg: string;
  moduleBorder: string;
  moduleFg: string;
  pillBg: string;
  pillText: string;
  pillUnbound: string;
  pillUnboundBg: string;
  pillUnboundText: string;
}

const DARK: Palette = {
  canvasBg: "#18191c",
  surface: "#26272b",
  strokeContainer: "#ea580c",
  strokeAdapter: "#f59e0b",
  strokeService: "#3b82f6",
  strokePort: "#10b981",
  fg: "#f4f4f6",
  muted: "#9ca3af",
  moduleBg: "#2e3036",
  moduleBorder: "#4b5563",
  moduleFg: "#d1d5db",
  pillBg: "#6d5dfc",
  pillText: "#f4f4f6",
  pillUnbound: "#7c6df2",
  pillUnboundBg: "#241f3d",
  pillUnboundText: "#d6ccff",
};

const LIGHT: Palette = {
  canvasBg: "#f6f7fb",
  surface: "#ffffff",
  strokeContainer: "#c2410c",
  strokeAdapter: "#b45309",
  strokeService: "#2563eb",
  strokePort: "#047857",
  fg: "#111827",
  muted: "#6b7280",
  moduleBg: "#f3f4f6",
  moduleBorder: "#d1d5db",
  moduleFg: "#374151",
  pillBg: "#5b4bdb",
  pillText: "#ffffff",
  pillUnbound: "#6d5df2",
  pillUnboundBg: "#f0edff",
  pillUnboundText: "#4338ca",
};

const VAR_NAMES: ReadonlyArray<[keyof Palette, string]> = [
  ["canvasBg", "--di-canvas-bg"],
  ["surface", "--di-surface"],
  ["strokeContainer", "--di-stroke-container"],
  ["strokeAdapter", "--di-stroke-adapter"],
  ["strokeService", "--di-stroke-service"],
  ["strokePort", "--di-stroke-port"],
  ["fg", "--di-fg"],
  ["muted", "--di-muted"],
  ["moduleBg", "--di-module-bg"],
  ["moduleBorder", "--di-module-border"],
  ["moduleFg", "--di-module-fg"],
  ["pillBg", "--di-pill-bg"],
  ["pillText", "--di-pill-text"],
  ["pillUnbound", "--di-pill-unbound"],
  ["pillUnboundBg", "--di-pill-unbound-bg"],
  ["pillUnboundText", "--di-pill-unbound-text"],
];

function paletteVars(palette: Palette, indent: string): string {
  return VAR_NAMES.map(
    ([key, name]) => `${indent}${name}: ${palette[key]};`,
  ).join("\n");
}

/**
 * Self-contained theme CSS. Uses :where() so host stylesheets can override every
 * --di-* variable with ordinary specificity. Also exported as dist/theme.css.
 */
export const THEME_CSS = [
  ":where(.di-viz) {",
  paletteVars(DARK, "  "),
  `  --di-font: ${FONT_STACK};`,
  "  display: block;",
  "}",
  ":where(.di-viz:not([data-responsive=\"true\"])) {",
  "  max-width: 100%;",
  "  height: auto;",
  "}",
  "@media (prefers-color-scheme: light) {",
  '  :where(.di-viz[data-theme="auto"]) {',
  paletteVars(LIGHT, "    "),
  "  }",
  "}",
  ':where(.di-viz[data-theme="light"]) {',
  paletteVars(LIGHT, "  "),
  "}",
  ':where(.di-viz[data-theme="dark"]) {',
  paletteVars(DARK, "  "),
  "}",
  ":where(.di-viz) .di-canvas {",
  "  fill: var(--di-canvas-bg);",
  "}",
  ":where(.di-viz) .di-body {",
  "  fill: var(--di-surface);",
  "}",
  ":where(.di-viz) .di-role-adapter .di-body {",
  "  stroke: var(--di-stroke-adapter);",
  "}",
  ":where(.di-viz) .di-role-root .di-body {",
  "  stroke: var(--di-stroke-container);",
  "}",
  ":where(.di-viz) .di-role-composite .di-body,",
  ":where(.di-viz) .di-role-service .di-body {",
  "  stroke: var(--di-stroke-service);",
  "}",
  ":where(.di-viz) .di-role-port .di-body {",
  "  stroke: var(--di-stroke-port);",
  "}",
  ":where(.di-viz) .di-pill {",
  "  fill: var(--di-pill-bg);",
  "}",
  ":where(.di-viz) .di-pill-unbound {",
  "  fill: var(--di-pill-unbound-bg);",
  "  stroke: var(--di-pill-unbound);",
  "}",
  ":where(.di-viz) .di-pill-label {",
  "  fill: var(--di-pill-text);",
  "}",
  ":where(.di-viz) .di-socket-unbound .di-pill-label {",
  "  fill: var(--di-pill-unbound-text);",
  "}",
  ":where(.di-viz) .di-title {",
  "  fill: var(--di-fg);",
  "}",
  ":where(.di-viz) .di-subtitle {",
  "  fill: var(--di-muted);",
  "}",
  ":where(.di-viz) .di-module rect {",
  "  fill: var(--di-module-bg);",
  "  stroke: var(--di-module-border);",
  "}",
  ":where(.di-viz) .di-module text {",
  "  fill: var(--di-module-fg);",
  "}",
  ":where(.di-viz) text {",
  `  font-family: var(--di-font, ${FONT_STACK});`,
  "}",
].join("\n");

export function themeCss(): string {
  return THEME_CSS;
}
