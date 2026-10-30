/** Public AST and layout types for divizu v2. */

export const BLOCK_ROLES = ["root", "component", "boundary", "value"] as const;
export type BlockRole = (typeof BLOCK_ROLES)[number];

export interface Loc {
  line: number;
  column: number;
  offset: number;
}

export interface SourceRef {
  file: string;
  line?: number;
}

export interface NeedDef {
  key: string;
  providerId?: string;
  fresh: boolean;
  loc: Loc;
}

export interface CandidateDef {
  name: string;
  requires?: string;
  loc: Loc;
}

export interface BlockDef {
  id: string;
  label?: string;
  subtitle?: string;
  role: BlockRole;
  provides: string[];
  needs: NeedDef[];
  modules: string[];
  candidates: CandidateDef[];
  tags: string[];
  src?: SourceRef;
  loc: Loc;
}

export interface Document {
  blocks: Map<string, BlockDef>;
  order: string[];
}

export type ThemeMode = "auto" | "dark" | "light";

export interface RenderOptions {
  /** Outer canvas padding in px. Default 56. */
  padding?: number;
  /** Corner radius for every orthogonal vertex. Default 8. */
  cornerRadius?: number;
  /** Vertical space between layout layers. Default 76. */
  layerGap?: number;
  /** Horizontal space between sockets and between nodes. Default 28. */
  socketGap?: number;
  /** Color theme. Default "auto". */
  theme?: ThemeMode;
  /** Let the SVG fill its container. Default false. */
  responsive?: boolean;
  /** Accessible title. Defaults to the root block id(s). */
  title?: string;
}

export interface RenderResult {
  svg: string;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface LayoutSocket {
  key: string;
  providerId?: string;
  providerKey?: string;
  fresh: boolean;
  /** Center in world coordinates. */
  x: number;
  width: number;
}

export interface LayoutNode {
  /** Unique instance key. Fresh providers get a suffix. */
  key: string;
  id: string;
  label: string;
  subtitle?: string;
  role: BlockRole;
  tags: string[];
  modules: string[];
  candidates: CandidateDef[];
  src?: SourceRef;
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  sockets: LayoutSocket[];
  plugWidth: number;
  /** Outgoing cable count. */
  outgoing: number;
  fresh: boolean;
}

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  key: string;
  points: Point[];
}

export interface LayoutResult {
  width: number;
  height: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  roots: string[];
  layers: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export interface LayoutOptions {
  layerGap?: number;
  socketGap?: number;
}
