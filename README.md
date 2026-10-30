# diviz

Deterministic, zero-runtime-dependency **DSL → SVG** renderer for
hardware-slot / puzzle-piece dependency-injection diagrams.

Inspired by [`obsidianmd/pele`](https://github.com/obsidianmd/pele)'s
sub-millisecond compiler pipeline and the declarative geometry of D2 / Pikchr.
No DOM, no headless browser, no text-measurement API: the same DSL always
produces byte-identical SVG.

![Checkout DI example](examples/checkout.svg)

Try the [live sample](https://jeysef.github.io/divizu/), open the
[full playground](https://jeysef.github.io/divizu/playground.html), or read the
[documentation](https://jeysef.github.io/divizu/docs.html).

## For agents

Point a coding agent at the [skill](https://jeysef.github.io/divizu/skills/divizu.md)
or the [llms.txt](https://jeysef.github.io/divizu/llms.txt) context file. The
agent can write a `.di` file, render it with the CLI, or hand back a playground
link without installing anything.

## Why

| Problem with hand-written / AI-generated SVGs | What diviz does |
| --- | --- |
| A wide composite service covers its sibling ports | Each socket reserves `max(own notch, child subtree)` on **each side**; wide subtrees push neighbours outward |
| Full-width stretched boxes | Width comes from `max(socket span, content)`, never from the canvas |
| Overlapping borders and plugs | Children snap above their parent socket with a uniform visible clearance |
| Inconsistent corners | Every block is one orthogonal polygon rounded by a single `Q`-curve pass |
| Re-rendering changes the layout | Pure integer/float geometry, no randomness, no runtime measurement |

The layout is read **bottom-up**: the root container sits at the bottom, its
sockets open upward, and implementation blocks plug down into them.

## Quick start

Requirements:

- Node **18+** to consume the built package / CLI.
- Node **22.18+** to run `src/*.ts` directly (tests, dev CLI).

```bash
npm install
npm run build

# compile the example
node dist/cli.js examples/checkout.di -o examples/checkout.svg

# or during development
node src/cli.ts examples/checkout.di -o examples/checkout.svg
```

## DSL

```dsl
CheckoutApi "DI container (root)" {
  role: root
  socket ShippingPort
  socket OrderUseCase <- OrderService
  socket ReportPort
}

OrderService "composite" {
  role: composite
  modules: OrderValidator, PricingEngine, OrderMapper
  socket PaymentPort <- StripePayment
  socket StockPort <- PostgresStock
  socket NotifyPort <- EmailNotifier
}

StripePayment "adapter" {
  role: adapter
}

PostgresStock "adapter" {
  role: adapter
  modules: "conn pool", migrations
}

EmailNotifier "adapter" {}
```

Grammar:

```
BlockId ["subtitle"] {
  role: root | composite | adapter | service | port | layer | context
  modules: name, "name, with comma", name
  candidates: Name, Name(RequiredInterface), Name
  socket PortName
  socket PortName <- ProviderBlockId
}
```

- `socket PortName` is unbound → dashed purple pill.
- `socket PortName <- Provider` is wired → solid pill + provider plug.
- `role:` is optional. Socket-less blocks infer `adapter`; socket-bearing
  blocks infer `composite`.
- `candidates:` renders alternative implementations as tall vertical cards with
  rotated labels. `Name(RequiredInterface)` adds a U-shaped side notch and a
  rotated interface pill (see `examples/candidates.di`).
- Role colors: orange = composition root, blue = service / composite container,
  yellow = adapter, green = port, purple = layer, teal = context. See the
  [documentation](https://jeysef.github.io/divizu/docs.html) for the visual
  legend, socket/plug semantics, and candidate cards.
- Use `layer` for a constructor/wiring recipe (Effect-style `Layer`), and
  `context` for plain injected values with no methods and no live
  implementation (config, `Context.Reference`).
- `#` and `//` comments are supported (outside quoted strings).
- Modules may continue onto the next line when the line ends with `,`.
- `<PortName>` / `<Provider>` angle brackets are tolerated.
- Blank bodies (`Leaf {}`) are valid.

Validation is intentionally strict: duplicate ids, unknown roles, unknown
providers, unreachable blocks, and cycles all fail with a readable error.
Multiple unplugged components are rendered side by side as a forest.

## CLI

```
diviz <input.di> [options]
cat graph.di | diviz [options]
```

| Option | Description |
| --- | --- |
| `-o, --out <file>` | Write SVG to a file (default: stdout) |
| `-t, --theme <mode>` | `auto` \| `dark` \| `light` (default `auto`) |
| `-p, --padding <px>` | Canvas padding (default 56) |
| `--radius <px>` | Corner radius (default 10) |
| `--fit-gap <px>` | Edge-to-edge plug gap, 4–20 (default 10) |
| `--socket-gap <px>` | Space between socket envelopes (default 28) |
| `--responsive` | Emit `width="100%" height="100%"` |
| `--title <text>` | Accessible SVG title |
| `--json` | Print computed layout geometry as JSON instead of SVG |
| `-w, --watch` | Re-render on file change; writes `<input>.svg` by default |

Examples:

```bash
diviz checkout.di -o checkout.svg
diviz checkout.di -w --theme dark
diviz checkout.di --json | jq '.nodes[] | {id, x, y, width}'
cat checkout.di | diviz > checkout.svg
```

## Library

```ts
import { render, mount, layout, parseDSL, themeCss } from "diviz";

const { svg, width, height } = render(dsl, {
  theme: "dark",
  padding: 48,
});

// Browser / SolidJS / React effect:
mount(document.querySelector("#di")!, dsl, { theme: "light" });

// Inspect geometry (tests, hit testing, agent self-checks):
const geometry = layout(dsl);
for (const node of geometry.nodes) {
  console.log(node.id, node.x, node.y, node.width, node.height);
}
```

`mount` accepts any object with an `innerHTML` string, so the package does not
require DOM types in Node projects.

Exports:

- `render(dsl, options) → { svg, width, height }`
- `mount(host, dsl, options) → RenderResult`
- `layout(dsl, options) → LayoutResult` (world-space boxes, socket centers,
  parent/child keys, subtree extents)
- `parseDSL(source) → Map<string, BlockDef>`
- `themeCss() / THEME_CSS`

## Theming

The SVG embeds a self-contained `<style>` block and uses low-specificity
`:where()` selectors, so host CSS can override any variable without
`!important`.

Colors are also written as **concrete attributes** on every element. This is
important for rasterizers and viewers that do not resolve CSS variables inside
SVG presentation attributes (librsvg, ImageMagick, some SVG-to-PNG pipelines).
Those viewers render the baked palette instead of black; browsers still apply
`--di-*` overrides. In a non-CSS renderer `theme: "auto"` bakes the **dark**
palette — use `--theme light` / `theme: "light"` for a static light SVG.

| Variable | Dark | Light |
| --- | --- | --- |
| `--di-canvas-bg` | `#0f0f0c` | `#f2ede0` |
| `--di-surface` | `#191914` | `#fffdf7` |
| `--di-stroke-container` | `#f1602f` | `#c2410c` |
| `--di-stroke-adapter` | `#d7a24a` | `#9a6b12` |
| `--di-stroke-service` | `#6f9fce` | `#2b5e98` |
| `--di-stroke-port` | `#a9c46a` | `#4f6f13` |
| `--di-stroke-layer` | `#a78bfa` | `#7c3aed` |
| `--di-stroke-context` | `#2dd4bf` | `#0f766e` |
| `--di-fg` | `#ece7da` | `#17150f` |
| `--di-muted` | `#918b7d` | `#6f6a5d` |
| `--di-module-bg` | `#22221c` | `#f1ede1` |
| `--di-module-border` | `#454338` | `#c9c3b2` |
| `--di-module-fg` | `#d2ccbe` | `#343128` |
| `--di-pill-bg` | `#345b78` | `#285c7a` |
| `--di-pill-text` | `#edf2f0` | `#f7fbfc` |
| `--di-pill-unbound` | `#b28a42` | `#8a6a1f` |
| `--di-pill-unbound-bg` | `#211d13` | `#f6efd9` |
| `--di-pill-unbound-text` | `#e6c88e` | `#6d520f` |
| `--di-font` | monospace stack | monospace stack |

```css
.my-diagram .di-viz {
  --di-canvas-bg: #0b1020;
  --di-stroke-container: #22d3ee;
}
```

`diviz/theme.css` is also generated at build time if you prefer an external
stylesheet. `theme: "auto"` follows `prefers-color-scheme`; `dark` / `light`
pin the palette via `data-theme`.

## Using it from another codebase

### Option A — link the package

```bash
# once, in this repo
npm install && npm run build && npm link

# in the app repo
npm link diviz
npx diviz docs/di.dsl -o docs/di.svg
```

### Option B — path dependency

```json
{
  "devDependencies": {
    "diviz": "file:../DIviz"
  }
}
```

Run `npm run build` in this repo before installing, because `file:` installs do
not run this package's build automatically. Or import the source directly on
Node 22.18+:

```js
import { render } from "../DIviz/src/index.ts";
```

> `package.json` is marked `private` so it cannot be published accidentally.
> Remove that flag (and choose a license) if you want to push it to a registry.

### Option C — agent workflow

Give an LLM only the DSL grammar above — not SVG coordinates. A typical loop:

1. The agent reads the DI registrations in the target repo and writes
   `docs/di.dsl`.
2. It runs `diviz docs/di.dsl -o docs/di.svg` (or `--watch` while editing).
3. `diviz` deterministically rejects missing providers, cycles, and bad syntax.
4. If you need assertions, call `layout(dsl)` and check boxes/socket centers in
   a test. `test/renderer.test.ts` contains the anti-overlap and
   anti-shadowing checks as a reference.

## How the layout works

**Pass 1 — bottom-up envelope sizing.** For every socket:

```
envLeft  = max(notchWidth / 2, child.extentLeft)
envRight = max(notchWidth / 2, child.extentRight)
```

The two extents are tracked independently. This matters: a child subtree can
be asymmetric, and a symmetric envelope would still let it intrude on a
neighbour. Socket centers are then placed with:

```
gap between centres = previous.envRight + socketGap + current.envLeft
```

so the reserved envelopes can never overlap, at any depth.

**Pass 2 — top-down snap positioning.** Roots are bottom-aligned, then each
plugged child is centred on its parent socket and its body bottom is placed
`fitGap` above the parent's top edge. Its tab protrudes down into the notch and
stops just above the interface pill.

**Rounded orthogonal polygon.** Each block's perimeter — top notches, body,
bottom tab — is emitted as one clockwise point array, deduplicated, and rounded
with a `Q` Bézier at every 90° vertex. No hand-written arc commands.

## Deliberate limitations

- **Shared providers are duplicated per socket.** A provider referenced by two
  sockets is drawn twice, with a unique instance key. This keeps the physical
  plug metaphor honest, but a true DAG with one shared singleton needs a
  link/edge notation — not implemented yet. A 5,000-instance safety limit guards
  against exponential growth in heavily shared graphs.
- **Graphs must be acyclic.** Cycles and unreachable blocks are rejected with a
  descriptive error.
- **One parent per block.** A block is either a root or plugged into exactly one
  socket.
- **Text width is heuristic.** Monospace character-width estimates are used
  (no DOM). CJK or emoji-heavy labels can still overflow.
- **No side notches / vertical module columns yet.** Modules are stacked
  vertically inside the body; all sockets are on the top edge.

## Development

```bash
npm test           # node:test, TypeScript via Node type stripping
npm run typecheck  # includes tests
npm run build      # tsc → dist + generated dist/theme.css
npm run render:example
npm run site:build # build dist + copy assets into site/ for Pages
npm run site:serve # serve site/ at http://localhost:8000
```

Project layout:

```
src/renderer.ts   parser, layout, SVG compiler, theme
src/index.ts      public exports
src/cli.ts        CLI (render, stdin, watch)
test/             parser, layout invariants, SVG, options
examples/         canonical diagram + generated SVG
site/             static sample, playground and documentation (GitHub Pages)
scripts/          build-time CSS generation
```

## Next steps

The renderer is the stable core. Natural extensions, in rough order of value:

1. **DAG edges for shared singletons** instead of duplicated blocks.
2. **Side notches / vertical module columns** for `ImagePreview`-style internal
   components.
3. **Framework scanners** (NestJS / tsyringe / Inversify / TS decorators) that
   emit the DSL from a real codebase.
4. **Agent skill wrapper** so the DSL contract, render, and validation loop are
   one command in any repo.
