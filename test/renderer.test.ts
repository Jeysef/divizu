import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DivizuError,
  layout,
  mount,
  parseDSL,
  render,
  validate,
} from "../src/index.ts";

const CHECKOUT = readFileSync(
  new URL("../examples/checkout.di", import.meta.url),
  "utf8",
);

const SHARED = `
root App {
  needs A <- Svc
  needs B <- Svc
}
component Svc { provides: A, B }
`;

test("parses the v2 checkout example", () => {
  const blocks = parseDSL(CHECKOUT);

  assert.equal(blocks.size, 5);
  assert.equal(blocks.get("CheckoutApi")?.role, "root");
  assert.equal(blocks.get("OrderService")?.role, "component");
  assert.equal(blocks.get("StripePayment")?.role, "boundary");
  assert.deepEqual(blocks.get("OrderService")?.provides, ["OrderUseCase"]);
  assert.deepEqual(blocks.get("OrderService")?.needs, [
    { key: "PaymentPort", providerId: "StripePayment", fresh: false, loc: blocks.get("OrderService")!.needs[0]!.loc },
    { key: "StockPort", providerId: "PostgresStock", fresh: false, loc: blocks.get("OrderService")!.needs[1]!.loc },
    { key: "NotifyPort", providerId: "EmailNotifier", fresh: false, loc: blocks.get("OrderService")!.needs[2]!.loc },
  ]);
  assert.deepEqual(blocks.get("PostgresStock")?.modules, ["conn pool", "migrations"]);
  assert.deepEqual(blocks.get("StripePayment")?.tags, ["adapter"]);
});

test("comments only start at token boundaries", () => {
  const dsl = `
component Svc {
  provides: X
  modules: C#Parser, Go
  tag: dev
}
root App { needs X <- Svc } // trailing comment
`;
  const blocks = parseDSL(dsl);
  assert.deepEqual(blocks.get("Svc")?.modules, ["C#Parser", "Go"]);
  assert.deepEqual(blocks.get("Svc")?.tags, ["dev"]);
});

test("quoted names, escaped modules, labels and source refs", () => {
  const blocks = parseDSL(`
root "My App" {
  needs "C#" <- "Svc"
  needs HTML
}
component "Svc" {
  provides: "C#"
  modules: "say \\"hi\\", ok", C#Parser
  tag: "go", "with space"
  label: "Service <core>"
  src: "cmd/app/main.go:12"
}
`);
  const svc = blocks.get("Svc")!;
  assert.equal(svc.label, "Service <core>");
  assert.deepEqual(svc.provides, ["C#"]);
  assert.deepEqual(svc.modules, ['say "hi", ok', "C#Parser"]);
  assert.deepEqual(svc.tags, ["go", "with space"]);
  assert.deepEqual(svc.src, { file: "cmd/app/main.go", line: 12 });
});

test("module lists do not swallow the next directive", () => {
  assert.throws(
    () =>
      parseDSL(`
root App { needs X <- Svc }
component Svc {
  provides: X
  modules: A,
  candidates: P, Q
}
`),
    /Trailing comma/,
  );

  const blocks = parseDSL(`
root App { needs X <- Svc }
component Svc {
  provides: X
  modules: A,
    B
}
`);
  assert.deepEqual(blocks.get("Svc")?.modules, ["A", "B"]);
});

test("rejects loose prose and missing braces", () => {
  assert.throws(() => parseDSL("please render this nicely"), /Unknown role/);
  assert.throws(
    () => parseDSL("component Svc\n  needs X"),
    /Expected "\{"/,
  );
  assert.throws(
    () => parseDSL("component Svc { provides: X; needs }"),
    /Expected requirement key/,
  );
});

test("rejects duplicate ids, needs and providers", () => {
  assert.throws(
    () => parseDSL("component A {}\ncomponent A {}"),
    /Duplicate block/,
  );

  const duplicateNeeds = validate(`
root App { needs X <- A; needs X <- A }
component A { provides: X }
`);
  assert.equal(duplicateNeeds.ok, false);
  assert.match(duplicateNeeds.errors[0]!.code, /duplicate-need/);

  const duplicateProviders = validate(`
root App { needs X <- A; needs Y <- B }
component A { provides: X }
component B { provides: X }
`);
  assert.equal(duplicateProviders.ok, false);
  assert.ok(duplicateProviders.errors.some((item) => item.code === "duplicate-provider"));
});

test("validates references, fits and roots", () => {
  const unknown = validate(`
root App { needs X <- Servce }
component Service { provides: X }
`);
  assert.equal(unknown.ok, false);
  assert.match(unknown.errors[0]!.suggestion ?? "", /Service/);

  const mismatch = validate(`
root App { needs Y <- Service }
component Service { provides: X }
`);
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.errors.some((item) => item.code === "provider-mismatch"));

  const orphan = validate(`
root App { needs X <- A }
component A { provides: X }
component Orphan { provides: Y }
`);
  assert.equal(orphan.ok, false);
  assert.ok(orphan.errors.some((item) => item.code === "orphan"));

  const rootUsed = validate(`
root App { needs X <- A }
component A { provides: X; needs Y <- App }
`);
  assert.equal(rootUsed.ok, false);
  assert.ok(rootUsed.errors.some((item) => item.code === "root-referenced"));
});

test("validates cycles, value constraints and missing roots", () => {
  const cycle = validate(`
root App { needs X <- A }
component A { provides: X; needs Y <- B }
component B { provides: Y; needs Z <- A }
`);
  assert.equal(cycle.ok, false);
  assert.ok(cycle.errors.some((item) => item.code === "cycle"));

  const value = validate(`
root App { needs X <- Config }
value Config { provides: X; needs Something }
`);
  assert.equal(value.ok, false);
  assert.ok(value.errors.some((item) => item.code === "value-has-needs"));

  const noRoot = validate("component Only { provides: X }");
  assert.equal(noRoot.ok, false);
  assert.ok(noRoot.errors.some((item) => item.code === "root-missing"));
});

test("reports file-relative line and column", () => {
  try {
    parseDSL("\n\ncomponent Svc {\n  provides X\n}");
    assert.fail("expected a parse error");
  } catch (error) {
    assert.ok(error instanceof DivizuError);
    assert.equal(error.line, 4);
    assert.equal(error.column, 3);
  }
});

test("slot layout plugs providers directly into sockets", () => {
  const result = layout(CHECKOUT);
  assert.equal(result.nodes.length, 5);
  assert.equal(result.edges.length, 0);
  assert.ok(result.nodes.every((node) => node.role === "root" || node.plugWidth > 0));
  assert.equal(result.nodes.find((node) => node.role === "root")?.plugWidth, 0);
});

test("layers layout draws shared providers once", () => {
  const result = layout(SHARED, { layout: "layers" });
  assert.equal(result.nodes.length, 2);
  assert.equal(result.nodes.filter((node) => node.id === "Svc").length, 1);
  assert.equal(result.edges.length, 2);
  assert.deepEqual(result.roots, ["App"]);
});

test("fresh providers are duplicated per consumer", () => {
  const result = layout(
    `
root App {
  needs A <- Svc
  needs B <- fresh Svc
}
component Svc { provides: A, B }
`,
    { layout: "layers" },
  );
  assert.equal(result.nodes.filter((node) => node.id === "Svc").length, 2);
  assert.ok(result.nodes.some((node) => node.fresh));
});

test("lays out layers without node overlap", () => {
  const result = layout(CHECKOUT, { layout: "layers" });
  const byLayer = new Map<number, typeof result.nodes>();
  for (const node of result.nodes) {
    const list = byLayer.get(node.layer) ?? [];
    list.push(node);
    byLayer.set(node.layer, list);
  }

  for (const list of byLayer.values()) {
    list.sort((a, b) => a.x - b.x);
    for (let i = 1; i < list.length; i++) {
      assert.ok(
        list[i]!.x >= list[i - 1]!.x + list[i - 1]!.width - 0.01,
        `${list[i - 1]!.key} overlaps ${list[i]!.key}`,
      );
    }
  }

  for (const node of result.nodes) {
    assert.ok(node.x >= result.bounds.minX);
    assert.ok(node.x + node.width <= result.bounds.maxX);
    assert.ok(node.y >= result.bounds.minY);
    assert.ok(node.y + node.height <= result.bounds.maxY);
  }
});

test("emits deterministic, escaped, themed SVG", () => {
  const first = render(CHECKOUT);
  const second = render(CHECKOUT);
  assert.equal(first.svg, second.svg);
  assert.match(first.svg, /^<svg /);
  assert.match(first.svg, /class="di-viz"/);
  assert.match(first.svg, /di-role-root/);
  assert.match(first.svg, /di-role-component/);
  assert.match(first.svg, /di-role-boundary/);
  assert.doesNotMatch(first.svg, /class="di-edge"/);
  assert.match(first.svg, /--di-stroke-root/);

  const layers = render(CHECKOUT, { layout: "layers" }).svg;
  assert.match(layers, /di-edge/);

  const danger = render(`
root App "a & <b>" { needs X <- A }
component A { provides: X; modules: "x<y" }
`).svg;
  assert.match(danger, /a &amp; &lt;b&gt;/);
  assert.match(danger, /x&lt;y/);

  const light = render(CHECKOUT, { theme: "light" }).svg;
  assert.match(light, /data-theme="light"/);
  assert.match(light, /--di-canvas-bg: #f2ede0/);
});

test("mount writes the compiled SVG", () => {
  const host = { innerHTML: "" };
  const result = mount(host, SHARED);
  assert.equal(host.innerHTML, result.svg);
});

test("CLI check emits JSON", () => {
  const run = spawnSync(
    process.execPath,
    ["src/cli.ts", "examples/quickstart.di", "--check", "--json"],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout) as {
    ok: boolean;
    stats: { blocks: number; edges: number };
  };
  assert.equal(report.ok, true);
  assert.equal(report.stats.blocks, 5);
  assert.equal(report.stats.edges, 4);
});
