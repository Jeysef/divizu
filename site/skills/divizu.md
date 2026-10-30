---
name: divizu
description: Draw a codebase's architecture as a deterministic hardware-slot SVG with the divizu DSL. Use when the user asks for an architecture diagram, module wiring, dependency graph, service map, or a visual explanation of how a project fits together.
---

# divizu

divizu is a small, deterministic DSL → SVG compiler for architecture diagrams.
It is designed for coding agents: you read the repository, write a compact `.di`
file, and give the user a drawing they can understand at a glance.

The layout reads **bottom-up**: the composition root sits at the bottom, sockets
open upward, and implementations sit above them.

## Workflow

1. Inspect the repository. Find the entry point, the main services, the
   external systems, and the boundaries between them.
2. Write `architecture.di`. Keep it to roughly **5–25 blocks**. Split a large
   system by bounded context instead of drawing the whole monorepo at once.
3. Render it. If the user wants a file, use the CLI. If they just want to see
   it, construct a playground link.
4. Show the result and explain the drawing in a few sentences.
5. Do not commit the `.di` or `.svg` files unless the user asks.

## DSL

```dsl
CheckoutApi "composition root" {
  role: root
  socket Orders <- OrderService
  socket Telemetry
  socket Config <- AppConfig
}

OrderService "application service" {
  role: composite
  modules: ValidateCart, PriceOrder
  socket Payments <- StripeAdapter
}

StripeAdapter { role: adapter }

AppConfig "context" { role: context }
```

Grammar:

```dsl
BlockId ["subtitle"] {
  role: root | composite | service | adapter | port | layer | context
  modules: name, "name, with comma", name
  candidates: Name, Name(RequiredInterface), Name
  socket PortName
  socket PortName <- ProviderBlockId
}
```

Guidance:

- `root` — the application entry point or composition root. Use one per diagram.
- `composite` — a service/container that owns other dependencies.
- `service` — a live implementation with methods.
- `adapter` — a concrete leaf: database, HTTP client, queue, filesystem.
- `layer` — a constructor/wiring recipe (Effect-style `Layer`).
- `context` — plain injected values such as config. No methods, no live implementation.
- `port` — an interface boundary when that distinction is useful.
- `modules:` — internal collaborators that are **not** separately plugged.
- `candidates:` — alternative implementations. `Name(RequiredInterface)` adds a
  side notch.
- An unbound socket (`socket PortName`) means the dependency lives outside the
  diagram. Use it intentionally.
- Never invent modules or dependencies. Derive the graph from the repository.
- Prefer a readable diagram over completeness. A drawing with 8 real blocks is
  better than 40 guessed ones.

## Render

### Playground link (fastest, no install)

URL-encode the DSL and give the user:

```text
https://jeysef.github.io/divizu/playground.html#dsl=<encodeURIComponent(dsl)>
```

In JavaScript:

```js
const url = `https://jeysef.github.io/divizu/playground.html#dsl=${encodeURIComponent(dsl)}`;
```

### SVG file

If the divizu repository is available locally:

```bash
npm run build
node dist/cli.js architecture.di -o architecture.svg
```

If it is not available:

```bash
git clone --depth 1 https://github.com/Jeysef/divizu
cd divizu
npm install
npm run build
node dist/cli.js ../architecture.di -o ../architecture.svg
```

Useful options:

```text
-t, --theme dark|light|auto   palette
-p, --padding <px>            canvas padding
--radius <px>                 corner radius
--title <text>                accessible SVG title
```

The output is deterministic and self-contained. The same DSL produces the same
SVG on every machine.

## Finish

Give the user:

- the rendered SVG or playground link;
- the `.di` source;
- one short paragraph explaining how to read it, starting from the root.

Reference:

- Manual: https://jeysef.github.io/divizu/docs.html
- Quickstart: https://jeysef.github.io/divizu/examples/quickstart.di
- llms.txt: https://jeysef.github.io/divizu/llms.txt
