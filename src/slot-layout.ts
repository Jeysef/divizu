import type {
  BlockDef,
  Document,
  LayoutNode,
  LayoutOptions,
  LayoutResult,
  Point,
} from "./ast.ts";
import { DivizuError, diagnostic } from "./diagnostics.ts";

const CHAR_W_TITLE = 9.6;
const CHAR_W_SMALL = 7.8;
const CHAR_W_TAG = 6.2;
const SOCKET_DEPTH = 48;
const PLUG_DEPTH = 14;
const FIT_GAP = 10;
const SOCKET_GAP = 28;
const SHOULDER = 26;
const MODULE_HEIGHT = 28;
const MODULE_GAP = 8;
const CANDIDATE_W = 52;
const CANDIDATE_H = 140;
const CANDIDATE_GAP = 16;
const CANDIDATE_PAD = 16;
const LEAF_HEIGHT = 64;
const MIN_WIDTH = 136;
const ROOT_GAP = 72;
const MAX_DEPTH = 500;
const MAX_INSTANCES = 5000;

interface Slot {
  key: string;
  width: number;
  envLeft: number;
  envRight: number;
  localX: number;
  providerId?: string;
  providerKey?: string;
  fresh: boolean;
  child?: Node;
}

interface Node {
  key: string;
  def: BlockDef;
  width: number;
  height: number;
  extentLeft: number;
  extentRight: number;
  subtreeHeight: number;
  sockets: Slot[];
  x: number;
  y: number;
  cx: number;
  parentKey?: string;
  plugWidth: number;
  fresh: boolean;
}

interface Config {
  socketGap: number;
  fitGap: number;
}

export function computeSlotLayout(
  doc: Document,
  options: LayoutOptions = {},
): LayoutResult {
  const config: Config = {
    socketGap: Math.max(8, options.socketGap ?? SOCKET_GAP),
    fitGap: FIT_GAP,
  };

  const roots = doc.order.filter((id) => doc.blocks.get(id)!.role === "root");
  if (roots.length === 0) {
    throw new DivizuError(
      diagnostic("root-missing", "No root block found.", 1, 1),
    );
  }

  const allNodes: Node[] = [];
  let instanceCount = 0;

  const measure = (
    id: string,
    targetSocketWidth: number,
    ancestors: string[],
    key: string,
    depth: number,
    fresh: boolean,
  ): Node => {
    if (depth > MAX_DEPTH) {
      throw new DivizuError(
        diagnostic(
          "limit",
          "Dependency chain is too deep for the slot layout. Use --layout layers.",
          1,
          1,
        ),
      );
    }
    if (ancestors.includes(id)) {
      throw new DivizuError(
        diagnostic(
          "cycle",
          `Cycle detected: ${[...ancestors, id].join(" -> ")}.`,
          1,
          1,
        ),
      );
    }
    instanceCount += 1;
    if (instanceCount > MAX_INSTANCES) {
      throw new DivizuError(
        diagnostic(
          "limit",
          `Diagram exceeds ${MAX_INSTANCES} block instances. Use --layout layers, or split the diagram.`,
          1,
          1,
        ),
      );
    }

    const def = doc.blocks.get(id);
    if (!def) {
      throw new DivizuError(
        diagnostic("unknown-provider", `Unknown block "${id}".`, 1, 1),
      );
    }

    const sockets: Slot[] = [];
    let maxChildSubtreeH = 0;

    def.needs.forEach((need, index) => {
      const notchWidth = Math.max(94, need.key.length * CHAR_W_SMALL + 42);
      let child: Node | undefined;

      if (need.providerId) {
        child = measure(
          need.providerId,
          notchWidth,
          [...ancestors, id],
          `${key}/${index}:${need.providerId}${need.fresh ? "~fresh" : ""}`,
          depth + 1,
          need.fresh,
        );
        maxChildSubtreeH = Math.max(maxChildSubtreeH, child.subtreeHeight);
      }

      const half = notchWidth / 2;
      const envLeft = Math.max(half, child?.extentLeft ?? 0);
      const envRight = Math.max(half, child?.extentRight ?? 0);
      sockets.push({
        key: need.key,
        width: notchWidth,
        envLeft,
        envRight,
        localX: 0,
        ...(need.providerId !== undefined
          ? { providerId: need.providerId }
          : {}),
        ...(child !== undefined ? { providerKey: child.key, child } : {}),
        fresh: need.fresh,
      });
    });

    if (sockets.length > 0) {
      const positions = [0];
      for (let i = 1; i < sockets.length; i++) {
        const previous = sockets[i - 1]!;
        const current = sockets[i]!;
        positions.push(
          positions[i - 1]! +
            previous.envRight +
            config.socketGap +
            current.envLeft,
        );
      }
      const first = sockets[0]!;
      const last = sockets[sockets.length - 1]!;
      const firstLeft = positions[0]! - first.width / 2;
      const lastRight = positions[positions.length - 1]! + last.width / 2;
      const shift = (firstLeft + lastRight) / 2;
      for (let i = 0; i < sockets.length; i++) {
        sockets[i]!.localX = positions[i]! - shift;
      }
    }

    const socketsSpan =
      sockets.length === 0
        ? 0
        : (() => {
            const first = sockets[0]!;
            const last = sockets[sockets.length - 1]!;
            return (
              last.localX +
              last.width / 2 -
              (first.localX - first.width / 2) +
              SHOULDER * 2
            );
          })();

    const label = def.label ?? def.id;
    const tagText = def.tags.join(" · ");
    const titleW =
      label.length * CHAR_W_TITLE +
      44 +
      (tagText.length > 0 ? tagText.length * CHAR_W_TAG + 22 : 0);
    const subtitleW = def.subtitle ? def.subtitle.length * CHAR_W_SMALL + 40 : 0;
    const modulesW =
      def.modules.length > 0
        ? Math.max(
            ...def.modules.map((module) => module.length * CHAR_W_SMALL + 48),
          ) + 44
        : 0;
    const candidatesW =
      def.candidates.length > 0
        ? def.candidates.length * CANDIDATE_W +
          (def.candidates.length - 1) * CANDIDATE_GAP +
          CANDIDATE_PAD * 2
        : 0;

    const isLeaf =
      def.role !== "root" &&
      sockets.length === 0 &&
      def.modules.length === 0 &&
      def.candidates.length === 0;

    const contentW = Math.max(
      MIN_WIDTH,
      titleW,
      subtitleW,
      modulesW,
      candidatesW,
    );

    let width: number;
    if (isLeaf) {
      width = Math.max(
        targetSocketWidth > 0 ? targetSocketWidth : MIN_WIDTH,
        titleW + 16,
      );
    } else if (
      sockets.length === 1 &&
      def.modules.length === 0 &&
      def.candidates.length === 0 &&
      def.role !== "root"
    ) {
      width = Math.max(sockets[0]!.width + 24, titleW + 16);
    } else {
      width = Math.max(socketsSpan, contentW);
    }

    const topZone = sockets.length > 0 ? SOCKET_DEPTH + 14 : 18;
    const headerZone = isLeaf ? 0 : def.subtitle ? 44 : 30;
    const modulesZone =
      isLeaf || def.role === "root" || def.modules.length === 0
        ? 0
        : def.modules.length * MODULE_HEIGHT +
          (def.modules.length - 1) * MODULE_GAP +
          16;
    const candidateZone =
      isLeaf || def.role === "root" || def.candidates.length === 0
        ? 0
        : CANDIDATE_H + CANDIDATE_PAD * 2;

    let height = isLeaf
      ? LEAF_HEIGHT
      : topZone + headerZone + modulesZone + candidateZone + 18;
    if (def.role === "root") {
      height = Math.max(topZone + 18, 120);
    }

    let minLeft = -width / 2;
    let maxRight = width / 2;
    for (const socket of sockets) {
      minLeft = Math.min(minLeft, socket.localX - socket.envLeft);
      maxRight = Math.max(maxRight, socket.localX + socket.envRight);
    }

    const node: Node = {
      key,
      def,
      width,
      height,
      extentLeft: -minLeft,
      extentRight: maxRight,
      subtreeHeight:
        height + (maxChildSubtreeH > 0 ? maxChildSubtreeH + config.fitGap : 0),
      sockets,
      x: 0,
      y: 0,
      cx: 0,
      plugWidth: 0,
      fresh,
    };

    return node;
  };

  const place = (
    node: Node,
    cx: number,
    bottomY: number,
    parentKey: string | undefined,
    targetSocketWidth: number,
  ): void => {
    node.cx = cx;
    node.x = cx - node.width / 2;
    node.y = bottomY - node.height;
    node.parentKey = parentKey;
    node.plugWidth =
      targetSocketWidth > 0
        ? Math.max(
            0,
            Math.min(
              targetSocketWidth - config.fitGap * 2,
              node.width - 24,
            ),
          )
        : 0;
    allNodes.push(node);

    for (const socket of node.sockets) {
      if (!socket.child) continue;
      place(
        socket.child,
        node.cx + socket.localX,
        node.y - config.fitGap,
        node.key,
        socket.width,
      );
    }
  };

  const measuredRoots = roots.map((id) =>
    measure(id, 0, [], id, 0, false),
  );

  const expandContainers = (root: Node): void => {
    const visit = (node: Node): void => {
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
      const pad = node.def.role === "root" ? 40 : 8;
      const left = Math.min(node.x, minX - pad);
      const right = Math.max(node.x + node.width, maxX + pad);
      node.x = left;
      node.width = right - left;
    };
    visit(root);
  };

  let cursor = 0;
  for (const root of measuredRoots) {
    place(root, cursor + root.extentLeft, 0, undefined, 0);
    expandContainers(root);
    cursor = root.x + root.width + ROOT_GAP;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  let depth = 0;
  for (const node of allNodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
    depth = Math.max(depth, countDepth(node));
  }

  const nodes: LayoutNode[] = allNodes.map((node) => ({
    key: node.key,
    id: node.def.id,
    label: node.def.label ?? node.def.id,
    ...(node.def.subtitle !== undefined
      ? { subtitle: node.def.subtitle }
      : {}),
    role: node.def.role,
    tags: node.def.tags,
    modules: node.def.modules,
    candidates: node.def.candidates,
    ...(node.def.src !== undefined ? { src: node.def.src } : {}),
    layer: countDepth(node),
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    centerX: node.cx,
    sockets: node.sockets.map((socket) => ({
      key: socket.key,
      ...(socket.providerId !== undefined
        ? { providerId: socket.providerId }
        : {}),
      ...(socket.providerKey !== undefined
        ? { providerKey: socket.providerKey }
        : {}),
      fresh: socket.fresh,
      x: node.cx + socket.localX,
      width: socket.width,
    })),
    plugWidth: node.plugWidth,
    outgoing: node.sockets.filter((socket) => socket.child).length,
    fresh: node.fresh,
  }));

  return {
    width: maxX - minX,
    height: maxY - minY,
    bounds: { minX, minY, maxX, maxY },
    roots: measuredRoots.map((root) => root.key),
    layers: depth + 1,
    nodes,
    edges: [],
  };
}

function countDepth(node: Node, depth = 0): number {
  let max = depth;
  for (const socket of node.sockets) {
    if (socket.child) max = Math.max(max, countDepth(socket.child, depth + 1));
  }
  return max;
}
