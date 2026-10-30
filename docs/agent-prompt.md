# Prompt for an agent working in another codebase

Point the other agent at the **tool**, not at this prompt file:

- `/home/jeysef/Coding/DIviz/README.md` — DSL, CLI, API, limitations
- `/home/jeysef/Coding/DIviz/examples/checkout.di` — canonical working example
- `/home/jeysef/Coding/DIviz/examples/checkout-preview.png` — what the output looks like
- `/home/jeysef/Coding/DIviz/dist/cli.js` — the renderer to execute
- `/home/jeysef/Coding/DIviz/test/renderer.test.ts` — layout invariants, if it needs to verify geometry

---

## Copy-paste prompt

```text
You are working in this repository. Your task is to produce one or more
dependency-injection diagrams using the `diviz` renderer.

TOOL
  Location: /home/jeysef/Coding/DIviz
  Read first:
    - /home/jeysef/Coding/DIviz/README.md          (DSL + CLI + limits)
    - /home/jeysef/Coding/DIviz/examples/checkout.di
    - /home/jeysef/Coding/DIviz/examples/checkout-preview.png
  Do not modify the renderer unless explicitly asked.

RUN
  node /home/jeysef/Coding/DIviz/dist/cli.js <input.di> -o <output.svg>
  node /home/jeysef/Coding/DIviz/dist/cli.js <input.di> --json > <layout.json>

  If dist/cli.js is missing:
    cd /home/jeysef/Coding/DIviz && npm install && npm run build

GOAL
  1. Find this repo's DI composition root(s) and registrations.
  2. Map them to the diviz DSL:
       block   = a container, module, service, or adapter
       socket  = an injection point / constructor dependency
       plug    = the implementation bound to that socket
       modules = internal collaborators that are NOT separately plugged
  3. Write DSL to: docs/di/<name>.di
  4. Render to:    docs/di/<name>.svg
  5. Validate with --json and report the result.

DSL GRAMMAR
  BlockId ["optional subtitle"] {
    role: root | composite | adapter
    modules: Name, "Name, with comma", Name
    socket PortName
    socket PortName <- ProviderBlockId
  }

  - `socket PortName`            = unbound (dashed pill)
  - `socket PortName <- X`       = wired to block X
  - role is optional. Socket-less blocks infer `adapter`; socket-bearing
    blocks infer `composite`.
  - `#` and `//` comments are supported.
  - Modules may continue on the next line when the line ends with `,`.
  - Prefer one dependency per `socket` line.

MINIMAL EXAMPLE
  Root {
    socket PaymentPort <- StripePayment
  }

  StripePayment {}

RULES
  - Use exact class / module / token names from the code. Do not invent
    dependencies that are not in the repository.
  - One parent per block. A block is either a root or plugged into exactly
    one socket.
  - The graph must be acyclic. If the code has a cycle, break it with an
    unbound socket and list the cycle in your report.
  - Shared providers are duplicated per socket by the renderer. If a
    singleton is used in many places, pick the most representative socket(s)
    and mention the duplication in the report.
  - Keep each diagram readable: roughly 5–25 blocks. Split large systems by
    bounded context or feature instead of drawing the whole monorepo.
  - Prefer `role: root` for the application/composition root, `composite`
    for services that own dependencies, and `adapter` for leaves.
  - Do not hand-write SVG coordinates.
  - Do not commit unless the user asks.

WORKFLOW
  1. Inventory registrations (providers, modules, factories, decorators,
     constructors).
  2. Draft docs/di/<name>.di.
  3. Run the CLI. Fix parser errors first (unknown role/provider, duplicate
     ids, cycles).
  4. Run with --json and sanity-check:
       - roots[] is what you expect
       - nodes[] has the expected block count
       - bounds/width/height are finite
  5. Render the SVG.
  6. If you can view images, open the SVG/PNG and check for readability.
     If you cannot, ask the user to look at the generated SVG.

DEFINITION OF DONE
  - CLI exits 0.
  - docs/di/<name>.di and docs/di/<name>.svg exist.
  - --json returns the expected roots and node count.
  - Report contains: files written, exact command used, block/socket counts,
    unbound sockets, duplicated shared providers, and intentional omissions.

DELIVERABLE
  A short summary with:
    - diagram file(s)
    - the command to regenerate them
    - what is intentionally not shown
    - any cycles or ambiguous bindings you had to resolve
```

---

## Optional: make it discoverable in the target repo's `AGENTS.md`

```markdown
## Dependency injection diagrams

- Sources live in `docs/di/*.di`.
- Render with:
  `node /home/jeysef/Coding/DIviz/dist/cli.js docs/di/<name>.di -o docs/di/<name>.svg`
- Validate geometry with:
  `node /home/jeysef/Coding/DIviz/dist/cli.js docs/di/<name>.di --json`
- DSL reference: `/home/jeysef/Coding/DIviz/README.md`
- Do not hand-edit the generated SVG; edit the `.di` source and re-render.
```
