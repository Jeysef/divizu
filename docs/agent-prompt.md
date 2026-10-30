# Prompt for an agent working in another codebase

Point the other agent at the **tool**, not at this prompt file:

- `/home/jeysef/Coding/DIviz/README.md` — DSL, CLI, API, limitations
- `/home/jeysef/Coding/DIviz/examples/quickstart.di` — small working example
- `/home/jeysef/Coding/DIviz/examples/shared.di` — shared-provider example
- `/home/jeysef/Coding/DIviz/examples/large.di` — 28-block system map
- `/home/jeysef/Coding/DIviz/dist/cli.js` — the renderer to execute
- `/home/jeysef/Coding/DIviz/test/renderer.test.ts` — parser and layout invariants

---

## Copy-paste prompt

```text
You are working in this repository. Produce one or more architecture diagrams
using the `divizu` renderer.

TOOL
  Location: /home/jeysef/Coding/DIviz
  Read first:
    - /home/jeysef/Coding/DIviz/README.md
    - /home/jeysef/Coding/DIviz/examples/quickstart.di
    - /home/jeysef/Coding/DIviz/examples/shared.di
  Do not modify the renderer unless explicitly asked.

RUN
  node /home/jeysef/Coding/DIviz/dist/cli.js <input.di> --check
  node /home/jeysef/Coding/DIviz/dist/cli.js <input.di> --check --json
  node /home/jeysef/Coding/DIviz/dist/cli.js <input.di> -o <output.svg>

  If dist/cli.js is missing:
    cd /home/jeysef/Coding/DIviz && npm install && npm run build

GOAL
  1. Find this repo's entry points, internal components, boundaries and values.
  2. Map them to the divizu DSL. Choose ONE of four roles for every block:
       root       — program / entry point (cannot be used as a provider)
       component  — internal code that gets wired in
       boundary   — DB, network, queue, filesystem or vendor adapter
       value      — config / injected data with no behaviour
  3. Write DSL to: docs/di/<name>.di
  4. Validate. Fix every error. Then render to: docs/di/<name>.svg
  5. Report what is intentionally omitted.

DSL GRAMMAR
  root|component|boundary|value BlockId ["subtitle"] {
    provides: ServiceKey, "Quoted/Key"
    needs ServiceKey
    needs ServiceKey <- ProviderBlockId
    needs ServiceKey <- fresh ProviderBlockId
    modules: Name, "Name, with comma"
    candidates: Name, Name(RequiredKey)
    tag: open, vocabulary
    src: "path/to/file.ts:42"
    label: "Display name"
  }

  - Braces are mandatory. Directives end at a newline or `;`.
  - Shared providers are drawn once. `fresh` opts into a separate instance.
  - `provides:` is checked against consuming needs when present.
  - `tag:` is open vocabulary: closer, scoped, singleton, factory, etc.
  - `src:` records provenance for `--check --verify-src`.
  - Comments only start at a token boundary, so C#Parser is a name.
  - Quote names with spaces or punctuation.
  - Every non-root block must be referenced. Every root must be unreferenced.
  - Cycles are rejected. Cut a callback/event loop with an unbound need.

MINIMAL EXAMPLE
  root App {
    needs Orders <- OrdersLive
    needs Clock
  }

  component OrdersLive {
    provides: Orders
    needs Logger <- LoggerLive
  }

  boundary LoggerLive {
    provides: Logger
    tag: singleton
  }

RULES
  - Use exact module/class/service names from the code. Do not invent
    dependencies.
  - Shared dependencies (Logger, Config, DB pool) are one block with many
    `needs` pointing at it. Do not duplicate them.
  - A genuinely fresh instance (request scope, prototype) uses
    `<- fresh Provider`.
  - Keep each plate readable: roughly 5–25 blocks. Split large systems by
    bounded context or feature.
  - If the project is not dependency-injection-shaped (dataflow, actors, UI
    trees, ECS), say so instead of inventing sockets.
  - Ask before committing.

WORKFLOW
  1. Inventory entry points, constructors, registrations, providers, modules.
  2. Draft docs/di/<name>.di.
  3. Run --check. Fix parse and validation errors before rendering.
  4. Run --check --json and sanity-check blocks, roots, layers and edges.
  5. Render the SVG. If you can view images, check readability; otherwise ask
     the user to look.
  6. If `src:` paths are present, run --check --verify-src from the repo root.

DELIVERABLE
  A short summary with:
    - diagram file(s) and the command to regenerate them
    - block/cable counts, roots and unbound needs
    - shared providers and any `fresh` instances
    - what is intentionally not shown
    - any cycles or ambiguous bindings you had to resolve
```

---

## Optional: make it discoverable in the target repo's `AGENTS.md`

```markdown
## Architecture diagrams

- Sources live in `docs/di/*.di`.
- Validate with:
  `node /home/jeysef/Coding/DIviz/dist/cli.js docs/di/<name>.di --check`
- Render with:
  `node /home/jeysef/Coding/DIviz/dist/cli.js docs/di/<name>.di -o docs/di/<name>.svg`
- DSL reference: `/home/jeysef/Coding/DIviz/README.md`
- Do not hand-edit the generated SVG; edit the `.di` source and re-render.
```
