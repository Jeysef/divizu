import type {
  BlockDef,
  Document,
  LayoutEdge,
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
const PILL_HEIGHT = 22;
const SHOULDER = 24;
const MODULE_HEIGHT = 28;
const MODULE_GAP = 8;
const CANDIDATE_W = 52;
const CANDIDATE_H = 140;
const CANDIDATE_GAP = 16;
const CANDIDATE_PAD = 16;
const LEAF_HEIGHT = 64;
const MIN_WIDTH = 136;
const DEFAULT_LAYER_GAP = 78;
const DEFAULT_SOCKET_GAP = 28;
const DUMMY_WIDTH = 12;
const MAX_INSTANCES = 5000;
const MAX_LAYERS = 4096;

interface BlockMetrics {
  width: number;
  height: number;
  sockets: Array<{ key: string; width: number; localX: number }>;
  isLeaf: boolean;
}

interface Instance {
  key: string;
  def: BlockDef;
  fresh: boolean;
  metrics: BlockMetrics;
  layer: number;
  x: number;
  y: number;
  centerX: number;
  plugWidth: number;
  outgoing: number;
}

interface PendingEdge {
  id: string;
  from: string;
  to: string;
  key: string;
  needIndex: number;
  chain: string[];
}

interface Dummy {
  key: string;
  layer: number;
  centerX: number;
  width: number;
}

export function computeLayout(
  doc: Document,
  options: LayoutOptions = {},
): LayoutResult {
  const layerGap = Math.max(24, options.layerGap ?? DEFAULT_LAYER_GAP);
  const socketGap = Math.max(8, options.socketGap ?? DEFAULT_SOCKET_GAP);

  const metrics = new Map<string, BlockMetrics>();
  for (const [id, def] of doc.blocks) {
    metrics.set(id, measureBlock(def, socketGap));
  }

  const instances = new Map<string, Instance>();
  const order: string[] = [];

  const addInstance = (key: string, def: BlockDef, fresh: boolean): Instance => {
    const existing = instances.get(key);
    if (existing) return existing;
    if (instances.size >= MAX_INSTANCES) {
      throw new DivizuError(
        diagnostic(
          "limit",
          `Diagram exceeds ${MAX_INSTANCES} block instances. Split it by bounded context.`,
          1,
          1,
        ),
      );
    }
    const instance: Instance = {
      key,
      def,
      fresh,
      metrics: metrics.get(def.id)!,
      layer: 0,
      x: 0,
      y: 0,
      centerX: 0,
      plugWidth: 0,
      outgoing: 0,
    };
    instances.set(key, instance);
    order.push(key);
    return instance;
  };

  for (const id of doc.order) {
    addInstance(id, doc.blocks.get(id)!, false);
  }

  const edges: PendingEdge[] = [];
  let edgeCounter = 0;

  const addEdge = (
    from: string,
    to: string,
    key: string,
    needIndex: number,
  ): void => {
    edgeCounter += 1;
    edges.push({
      id: `e${edgeCounter}:${from}->${to}:${key}`,
      from,
      to,
      key,
      needIndex,
      chain: [],
    });
  };

  const addNeeds = (consumerKey: string, def: BlockDef, freshPath: string): void => {
    def.needs.forEach((need, index) => {
      if (!need.providerId) return;
      const providerDef = doc.blocks.get(need.providerId);
      if (!providerDef) return;

      let providerKey: string;
      if (need.fresh) {
        providerKey = `${need.providerId}~fresh~${consumerKey}~${index}~${freshPath}`;
        if (!instances.has(providerKey)) {
          addInstance(providerKey, providerDef, true);
          addNeeds(
            providerKey,
            providerDef,
            `${freshPath}/${providerKey}`,
          );
        }
      } else {
        providerKey = need.providerId;
        addInstance(providerKey, providerDef, false);
      }

      addEdge(providerKey, consumerKey, need.key, index);
      instances.get(providerKey)!.outgoing += 1;
    });
  };

  for (const id of doc.order) {
    addNeeds(id, doc.blocks.get(id)!, id);
  }

  const roots = doc.order.filter((id) => doc.blocks.get(id)!.role === "root");

  const incoming = new Map<string, Set<string>>();
  for (const edge of edges) {
    const set = incoming.get(edge.to) ?? new Set<string>();
    set.add(edge.from);
    incoming.set(edge.to, set);
  }

  const layer = new Map<string, number>();
  for (const root of roots) layer.set(root, 0);
  const queue = [...roots];
  let guard = 0;

  while (queue.length > 0) {
    guard += 1;
    if (guard > MAX_INSTANCES * 8) {
      throw new DivizuError(
        diagnostic(
          "limit",
          "Layer assignment did not converge. The graph likely contains a cycle.",
          1,
          1,
        ),
      );
    }

    const consumer = queue.shift()!;
    const consumerLayer = layer.get(consumer) ?? 0;
    for (const provider of incoming.get(consumer) ?? []) {
      const next = consumerLayer + 1;
      const current = layer.get(provider);
      if (current === undefined || next > current) {
        if (next > MAX_LAYERS) {
          throw new DivizuError(
            diagnostic(
              "limit",
              `Dependency depth exceeds ${MAX_LAYERS} layers. Split the graph by context.`,
              1,
              1,
            ),
          );
        }
        layer.set(provider, next);
        queue.push(provider);
      }
    }
  }

  for (const key of instances.keys()) {
    if (!layer.has(key)) {
      const instance = instances.get(key)!;
      throw new DivizuError(
        diagnostic(
          "unreachable",
          `Block "${instance.def.id}" is not reachable from a root.`,
          instance.def.loc.line,
          instance.def.loc.column,
        ),
      );
    }
  }

  for (const node of instances.values()) {
    node.layer = layer.get(node.key)!;
  }

  const maxLayer = Math.max(0, ...[...instances.values()].map((node) => node.layer));
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  const declarationIndex = new Map(doc.order.map((id, index) => [id, index]));

  for (const instance of instances.values()) {
    layers[instance.layer]!.push(instance.key);
  }
  for (const list of layers) {
    list.sort((a, b) => {
      const defA = instances.get(a)!.def;
      const defB = instances.get(b)!.def;
      return (
        (declarationIndex.get(defA.id) ?? 0) -
          (declarationIndex.get(defB.id) ?? 0) ||
        a.localeCompare(b)
      );
    });
  }

  const dummies = new Map<string, Dummy>();
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();

  const connect = (upper: string, lower: string): void => {
    const d = down.get(upper) ?? [];
    d.push(lower);
    down.set(upper, d);
    const u = up.get(lower) ?? [];
    u.push(upper);
    up.set(lower, u);
  };

  for (const edge of edges) {
    const fromLayer = layer.get(edge.from)!;
    const toLayer = layer.get(edge.to)!;
    if (fromLayer <= toLayer) {
      throw new DivizuError(
        diagnostic(
          "cycle",
          `Edge ${edge.from} -> ${edge.to} does not go upward.`,
          1,
          1,
        ),
      );
    }

    const chain = [edge.from];
    let previous = edge.from;
    for (let l = fromLayer - 1; l > toLayer; l--) {
      const key = `${edge.id}~d${l}`;
      const dummy: Dummy = {
        key,
        layer: l,
        centerX: 0,
        width: DUMMY_WIDTH,
      };
      dummies.set(key, dummy);
      layers[l]!.push(key);
      connect(previous, key);
      previous = key;
      chain.push(key);
    }
    connect(previous, edge.to);
    chain.push(edge.to);
    edge.chain = chain;
  }

  for (const list of layers) {
    list.sort((a, b) => {
      const da = dummies.get(a);
      const db = dummies.get(b);
      if (da && db) return a.localeCompare(b);
      if (da) return 1;
      if (db) return -1;
      const defA = instances.get(a)!.def;
      const defB = instances.get(b)!.def;
      return (
        (declarationIndex.get(defA.id) ?? 0) -
          (declarationIndex.get(defB.id) ?? 0) ||
        a.localeCompare(b)
      );
    });
  }

  const widthOf = (key: string): number =>
    dummies.get(key)?.width ?? instances.get(key)!.metrics.width;

  const orderLayers = (rounds: number): void => {
    for (let round = 0; round < rounds; round++) {
      const ascending = round % 2 === 0;
      const sequence = Array.from({ length: layers.length }, (_, i) => i);
      if (!ascending) sequence.reverse();

      for (const l of sequence) {
        if (ascending && l === 0) continue;
        if (!ascending && l === layers.length - 1) continue;
        const neighborLayer = ascending ? l - 1 : l + 1;
        if (neighborLayer < 0 || neighborLayer >= layers.length) continue;

        const position = new Map(
          layers[neighborLayer]!.map((key, index) => [key, index]),
        );
        const current = new Map(
          layers[l]!.map((key, index) => [key, index]),
        );
        const neighbors = ascending ? down : up;

        layers[l]!.sort((a, b) => {
          const avg = (key: string): number => {
            const connected = neighbors.get(key) ?? [];
            if (connected.length === 0) return current.get(key) ?? 0;
            let total = 0;
            let count = 0;
            for (const other of connected) {
              const pos = position.get(other);
              if (pos === undefined) continue;
              total += pos;
              count += 1;
            }
            return count > 0 ? total / count : (current.get(key) ?? 0);
          };
          return avg(a) - avg(b) || (current.get(a) ?? 0) - (current.get(b) ?? 0);
        });
      }
    }
  };

  orderLayers(8);

  const centers = new Map<string, number>();
  const gap = Math.max(18, socketGap);

  for (const list of layers) {
    const total =
      list.reduce((sum, key) => sum + widthOf(key), 0) +
      gap * Math.max(0, list.length - 1);
    let cursor = -total / 2;
    for (const key of list) {
      centers.set(key, cursor + widthOf(key) / 2);
      cursor += widthOf(key) + gap;
    }
  }

  const neighbors = (key: string): string[] => [
    ...(up.get(key) ?? []),
    ...(down.get(key) ?? []),
  ];

  for (let round = 0; round < 10; round++) {
    const sequence = Array.from({ length: layers.length }, (_, i) => i);
    if (round % 2 === 1) sequence.reverse();

    for (const l of sequence) {
      const list = layers[l]!;
      const desired = new Map<string, number>();

      for (const key of list) {
        const connected = neighbors(key);
        if (connected.length === 0) {
          desired.set(key, centers.get(key) ?? 0);
          continue;
        }
        let total = 0;
        let count = 0;
        for (const other of connected) {
          const center = centers.get(other);
          if (center === undefined) continue;
          total += center;
          count += 1;
        }
        desired.set(
          key,
          count > 0 ? total / count : (centers.get(key) ?? 0),
        );
      }

      let cursor = Number.NEGATIVE_INFINITY;
      for (const key of list) {
        const width = widthOf(key);
        const half = width / 2;
        const x = Math.max(desired.get(key) ?? 0, cursor + half);
        centers.set(key, x);
        cursor = x + half + gap;
      }

      const first = list[0];
      const last = list[list.length - 1];
      if (first && last) {
        const min = (centers.get(first) ?? 0) - widthOf(first) / 2;
        const max = (centers.get(last) ?? 0) + widthOf(last) / 2;
        const shift = (min + max) / 2;
        for (const key of list) {
          centers.set(key, (centers.get(key) ?? 0) - shift);
        }
      }
    }
  }

  const maxHeights: number[] = Array.from({ length: layers.length }, (_, l) => {
    let max = 0;
    for (const key of layers[l]!) {
      const instance = instances.get(key);
      if (instance) max = Math.max(max, instance.metrics.height);
    }
    return max;
  });

  const layerBottom: number[] = Array.from({ length: layers.length }, () => 0);
  const layerTop: number[] = Array.from({ length: layers.length }, () => 0);
  layerTop[0] = -maxHeights[0]!;
  for (let l = 1; l < layers.length; l++) {
    layerBottom[l] = layerTop[l - 1]! - layerGap;
    layerTop[l] = layerBottom[l]! - maxHeights[l]!;
  }

  for (const instance of instances.values()) {
    const l = instance.layer;
    instance.centerX = centers.get(instance.key) ?? 0;
    instance.y = layerBottom[l]! - instance.metrics.height;
    instance.x = instance.centerX - instance.metrics.width / 2;
  }

  for (const dummy of dummies.values()) {
    dummy.centerX = centers.get(dummy.key) ?? 0;
  }

  const gapCenterAbove = (l: number): number => {
    if (l >= layers.length - 1) {
      return layerTop[l]! - layerGap / 2;
    }
    return (layerBottom[l + 1]! + layerTop[l]!) / 2;
  };

  const socketWorldX = (consumerKey: string, needIndex: number): number => {
    const instance = instances.get(consumerKey)!;
    const socket = instance.metrics.sockets[needIndex];
    return instance.centerX + (socket?.localX ?? 0);
  };

  const outgoing = new Map<string, PendingEdge[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }
  for (const [key, list] of outgoing) {
    list.sort(
      (a, b) =>
        socketWorldX(a.to, a.needIndex) - socketWorldX(b.to, b.needIndex) ||
        a.id.localeCompare(b.id),
    );
    const node = instances.get(key)!;
    node.plugWidth = Math.max(
      24,
      Math.min(node.metrics.width - 24, 14 + list.length * 14),
    );
  }

  const layoutEdges: LayoutEdge[] = [];

  for (const edge of edges) {
    const provider = instances.get(edge.from)!;
    const consumer = instances.get(edge.to)!;
    const siblings = outgoing.get(edge.from)!;
    const siblingIndex = siblings.indexOf(edge);
    const spread = provider.plugWidth - 12;
    const offset =
      siblings.length <= 1
        ? 0
        : -spread / 2 + (spread * siblingIndex) / (siblings.length - 1);

    const startX = provider.centerX + offset;
    const startY = provider.y + provider.metrics.height + PLUG_DEPTH;
    const endX = socketWorldX(edge.to, edge.needIndex);
    const endY = consumer.y + SOCKET_DEPTH - PILL_HEIGHT - 8;

    const points: Point[] = [{ x: startX, y: startY }];
    let currentX = startX;

    for (const key of edge.chain.slice(1, -1)) {
      const dummy = dummies.get(key);
      if (!dummy) continue;
      const y = gapCenterAbove(dummy.layer);
      points.push({ x: currentX, y });
      points.push({ x: dummy.centerX, y });
      currentX = dummy.centerX;
    }

    const finalGap = gapCenterAbove(consumer.layer);
    points.push({ x: currentX, y: finalGap });
    points.push({ x: endX, y: finalGap });
    points.push({ x: endX, y: endY });

    layoutEdges.push({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      key: edge.key,
      points: dedupePoints(points),
    });
  }

  const layoutNodes: LayoutNode[] = [];
  for (const instance of instances.values()) {
    const sockets = instance.def.needs.map((need, index) => {
      const socket = instance.metrics.sockets[index]!;
      const providerKey =
        need.providerId === undefined
          ? undefined
          : need.fresh
            ? edges.find(
                (edge) =>
                  edge.to === instance.key &&
                  edge.needIndex === index &&
                  edge.key === need.key,
              )?.from
            : need.providerId;
      return {
        key: need.key,
        ...(need.providerId !== undefined
          ? { providerId: need.providerId }
          : {}),
        ...(providerKey !== undefined ? { providerKey } : {}),
        fresh: need.fresh,
        x: instance.centerX + socket.localX,
        width: socket.width,
      };
    });

    layoutNodes.push({
      key: instance.key,
      id: instance.def.id,
      label: instance.def.label ?? instance.def.id,
      ...(instance.def.subtitle !== undefined
        ? { subtitle: instance.def.subtitle }
        : {}),
      role: instance.def.role,
      tags: instance.def.tags,
      modules: instance.def.modules,
      candidates: instance.def.candidates,
      ...(instance.def.src !== undefined ? { src: instance.def.src } : {}),
      layer: instance.layer,
      x: instance.x,
      y: instance.y,
      width: instance.metrics.width,
      height: instance.metrics.height,
      centerX: instance.centerX,
      sockets,
      plugWidth: instance.plugWidth,
      outgoing: outgoing.get(instance.key)?.length ?? 0,
      fresh: instance.fresh,
    });
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of layoutNodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height + (node.plugWidth > 0 ? PLUG_DEPTH : 0));
  }
  for (const edge of layoutEdges) {
    for (const point of edge.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  return {
    width: maxX - minX,
    height: maxY - minY,
    bounds: { minX, minY, maxX, maxY },
    roots,
    layers: layers.length,
    nodes: layoutNodes,
    edges: layoutEdges,
  };
}

function measureBlock(def: BlockDef, socketGap: number): BlockMetrics {
  const label = def.label ?? def.id;
  const tagText = def.tags.join(" · ");
  const sockets = def.needs.map((need) => ({
    key: need.key,
    width: Math.max(94, need.key.length * CHAR_W_SMALL + 42),
    localX: 0,
  }));

  if (sockets.length > 0) {
    const positions = [0];
    for (let i = 1; i < sockets.length; i++) {
      const previous = sockets[i - 1]!;
      const current = sockets[i]!;
      positions.push(
        positions[i - 1]! + (previous.width + current.width) / 2 + socketGap,
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

  const titleW =
    label.length * CHAR_W_TITLE +
    44 +
    (tagText.length > 0 ? tagText.length * CHAR_W_TAG + 22 : 0);
  const subtitleW = def.subtitle ? def.subtitle.length * CHAR_W_SMALL + 40 : 0;
  const modulesW =
    def.modules.length > 0
      ? Math.max(...def.modules.map((module) => module.length * CHAR_W_SMALL + 48)) +
        44
      : 0;
  const candidatesW =
    def.candidates.length > 0
      ? def.candidates.length * CANDIDATE_W +
        (def.candidates.length - 1) * CANDIDATE_GAP +
        CANDIDATE_PAD * 2
      : 0;

  const isLeaf =
    def.role !== "root" &&
    def.needs.length === 0 &&
    def.modules.length === 0 &&
    def.candidates.length === 0;

  const contentW = Math.max(MIN_WIDTH, titleW, subtitleW, modulesW, candidatesW);
  const width = isLeaf ? Math.max(MIN_WIDTH, titleW + 16) : Math.max(socketsSpan, contentW);

  const topZone = def.needs.length > 0 ? SOCKET_DEPTH + 14 : 18;
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

  return { width, height, sockets, isLeaf };
}

function dedupePoints(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - point.x) < 0.01 && Math.abs(last.y - point.y) < 0.01) {
      continue;
    }
    out.push(point);
  }
  return out;
}
