---
name: divizu
description: Draw a codebase's architecture as a deterministic layered SVG with the divizu DSL. Use when the user asks for an architecture diagram, module wiring, dependency graph, service map, or a visual explanation of how a project fits together.
---

# divizu

divizu is a small DSL → SVG compiler for architecture diagrams. It is designed
for coding agents: read the repository, write a compact `.di` file, validate it,
and give the user a drawing they can read at a glance.

The default drawing is a **slot layout**: each provider sits directly above
its socket and its plug tab descends into the notch. A **layers** layout is
available for shared dependencies: roots sit at the bottom, providers above
their consumers, and a shared provider is drawn once with a cable to each
socket.

## Workflow

1. Inspect the repository. Find the entry points, the modules/services, the
   external systems, and the boundaries between them.
2. Write `architecture.di`. Keep it to roughly **5–25 blocks**. Split a large
   system by bounded context instead of drawing the whole monorepo at once.
3. Run `--check` before rendering. Fix the errors it reports.
4. Choose a layout: `slots` for the literal hardware view (default), or
   `layers` when shared providers should be drawn once with cables.
5. Render the SVG and/or return a playground link.
6. Explain the drawing in a few sentences, starting from the root.
7. Do not commit the `.di` or `.svg` files unless the user asks.

## Roles

There are exactly four roles. Pick the one whose test you can apply by reading
the code.

| Role | Test | Typical things |
| --- | --- | --- |
| `root` | The program that constructs and connects everything | `main()`, bootstrap, `wire.go`, `Effect.provide` |
| `component` | Internal code that gets wired in | services, handlers, use cases, repositories, layers |
| `boundary` | This code itself crosses the process boundary | DB, HTTP client, queue, filesystem, vendor SDK |
| `value` | Injected data with no behaviour | config, constants, feature flags |

`component` is the default choice for internal code. Do not invent a fifth
role. Language-specific details (`closer`, `scoped`, `singleton`, `factory`)
belong in `tag:`, not in the role.

## Syntax

```dsl
root CheckoutApp "cmd/api" {
  src: "cmd/api/main.go:24"
  needs Orders <- OrdersLive
  needs Clock
}

component OrdersLive "order use case" {
  provides: Orders
  src: "internal/orders/live.go:18"
  tag: service
  needs Db <- DbLive
  needs Logger <- LoggerLive
  modules: ValidateCart, PriceOrder
}

boundary DbLive "postgres" {
  provides: Db
  src: "internal/db/pg.go:12"
  tag: closer
  needs Config <- AppConfig
}

value AppConfig "config" {
  provides: Config
  src: "internal/config/config.go:9"
}
```

Grammar:

```dsl
file       = { block } ;
block      = role ident [ string ] "{" { NL | directive } "}" ;
role       = "root" | "component" | "boundary" | "value" ;
directive  =
    "provides"   ":" list
  | "needs"      key [ "<-" [ "fresh" ] ident ]
  | "modules"    ":" list
  | "candidates" ":" candidate { "," candidate }
  | "tag"        ":" list
  | "src"        ":" string
  | "label"      ":" name ;
list       = name { "," [ NL ] name } ;
candidate  = name [ "(" name ")" ] ;
```

Rules:

- Braces are mandatory, even for empty blocks: `component Leaf {}`.
- A directive ends at a newline or `;`.
- Comments (`#`, `//`) only start at a token boundary. `C#Parser` is a name.
- Quote names with spaces or punctuation: `provides: "@app/Users"`.
- `provides:` is optional. When present, `needs K <- P` is checked against it.
- In `layers`, `fresh` draws a separate provider instance for that consumer.
  Omit it to share one provider across all consumers. In `slots`, every
  provider is placed directly above a socket, so shared providers are
  duplicated per consumer.
- `modules:` are internal collaborators, not separate nodes.
- `candidates:` are alternatives, not graph edges.
- `src: "path:line"` is provenance. `--check --verify-src` checks the path.
- Every non-root block must be referenced; every root must be unreferenced.
- Cycles are rejected. Cut a callback/event loop with an unbound need.

## Pick the right shape

- Shared runtime dependency (logger, config, DB pool): one provider block, many
  `needs` pointing at it. Use `--layout layers` to draw it once.
- A genuinely fresh instance per consumer (request scope, prototype): use
  `<- fresh Provider` with `--layout layers`.
- Literal hardware view: leave the default `slots` layout on; shared providers
  will be slotted per consumer.
- External system not in the repo: leave the need unbound.
- Several entry points: use several `root` blocks on one plate.

Do not model dataflow, actor topologies, UI component trees or ECS world state
with this DSL. If the project is not dependency-injection-shaped, say so instead
of inventing sockets.

## Language hints

These are places to look, not rules:

- **Go:** `main`, `wire.Build`, `fx.Provide`/`fx.Invoke`, constructor params,
  interfaces with one implementation.
- **TypeScript/JavaScript:** composition roots, constructor/factory params,
  NestJS `@Injectable`/`@Module`, tsyringe/Inversify tokens, Effect `Layer`.
- **Rust:** `main`, builders, `Arc<dyn Trait>`, `impl Trait` bounds, state
  construction, `From`/factory functions.
- **Spring:** `@Configuration`, `@Bean`, constructor injection, `@Component`.
- **Python:** FastAPI `Depends`, dependency providers, composition functions.
- **Effect:** `Layer<ROut, E, RIn>`; `RIn` becomes `needs`, `ROut` becomes
  `provides`, and a shared layer is one provider.

## Validate and render

If the repository is available locally:

```bash
npm run build
node dist/cli.js architecture.di --check
node dist/cli.js architecture.di -o architecture.svg
node dist/cli.js architecture.di --layout layers -o architecture.svg
```

`--check` returns machine-readable hints:

```bash
node dist/cli.js architecture.di --check --json
node dist/cli.js architecture.di --check --verify-src
```

If divizu is not installed, clone it once:

```bash
git clone --depth 1 https://github.com/Jeysef/divizu
cd divizu
npm install
npm run build
node dist/cli.js ../architecture.di --check
node dist/cli.js ../architecture.di -o ../architecture.svg
node dist/cli.js ../architecture.di --layout layers -o ../architecture.svg
```

### Playground link (fastest delivery)

URL-encode the DSL and give the user:

```text
https://jeysef.github.io/divizu/playground.html#dsl=<encodeURIComponent(dsl)>
```

```js
const url = `https://jeysef.github.io/divizu/playground.html#dsl=${encodeURIComponent(dsl)}`;
```

## Finish

Give the user:

- the rendered SVG or playground link;
- the `.di` source;
- one short paragraph explaining how to read it, starting from the root.

Reference:

- Manual: https://jeysef.github.io/divizu/docs.html
- Quickstart: https://jeysef.github.io/divizu/examples/quickstart.di
- Shared layers example (use --layout layers): https://jeysef.github.io/divizu/examples/shared.di
- Large system map (28 blocks): https://jeysef.github.io/divizu/examples/large.di
- llms.txt: https://jeysef.github.io/divizu/llms.txt
