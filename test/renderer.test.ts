import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  layout,
  mount,
  parseDSL,
  render,
  type LayoutNode,
  type LayoutResult,
} from "../src/index.ts";

const CHECKOUT = readFileSync(
  new URL("../examples/checkout.di", import.meta.url),
  "utf8",
);

const SHADOW_DSL = `
Root {
  socket LeftPort
  socket MiddlePort <- WideService
  socket RightPort
}

WideService {
  socket AlphaPort <- AlphaImpl
  socket BetaPort <- BetaImpl
  socket GammaPort <- GammaImpl
}

AlphaImpl {}
BetaImpl {}
GammaImpl {}
`;

// The right-hand subtree is much deeper than the left-hand one, so the node's
// subtree is strongly asymmetric. A symmetric envelope reservation would let it
// intrude over RightPort.
const ASYMMETRIC_DSL = `
Root {
  socket LeftPort
  socket MiddlePort <- Lopsided
  socket RightPort
}

Lopsided {
  socket TinyPort
  socket HugePort <- Huge
}

Huge {
  socket AlphaPort <- AlphaImpl
  socket BetaPort <- BetaImpl
  socket GammaPort <- GammaImpl
  socket DeltaPort <- DeltaImpl
}

AlphaImpl {}
BetaImpl {}
GammaImpl {}
DeltaImpl {}
`;

function subtreeBounds(result: LayoutResult, key: string) {
  const nodes = new Map(result.nodes.map((node) => [node.key, node]));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const visit = (nodeKey: string): void => {
    const node = nodes.get(nodeKey);
    if (!node) return;
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
    for (const child of result.nodes) {
      if (child.parentKey === nodeKey) visit(child.key);
    }
  };

  visit(key);
  return { minX, minY, maxX, maxY };
}

function directChildren(result: LayoutResult, parentKey: string): LayoutNode[] {
  return result.nodes.filter((node) => node.parentKey === parentKey);
}

function assertNoBodyOverlap(result: LayoutResult): void {
  const eps = 0.01;
  for (let i = 0; i < result.nodes.length; i++) {
    for (let j = i + 1; j < result.nodes.length; j++) {
      const a = result.nodes[i]!;
      const b = result.nodes[j]!;
      const overlapX =
        Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY =
        Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      assert.ok(
        overlapX <= eps || overlapY <= eps,
        `${a.id} [${a.key}] overlaps ${b.id} [${b.key}] by ${overlapX}x${overlapY}px`,
      );
    }
  }
}

function assertSiblingSubtreesSeparated(result: LayoutResult): void {
  const parents = new Set(
    result.nodes
      .map((node) => node.parentKey)
      .filter((key): key is string => key !== undefined),
  );

  for (const parentKey of parents) {
    const groups = directChildren(result, parentKey)
      .map((child) => ({
        key: child.key,
        ...subtreeBounds(result, child.key),
      }))
      .sort((a, b) => a.minX - b.minX);

    for (let i = 1; i < groups.length; i++) {
      const previous = groups[i - 1]!;
      const current = groups[i]!;
      assert.ok(
        current.minX - previous.maxX >= 5.9,
        `subtrees of ${previous.key} and ${current.key} are only ${current.minX - previous.maxX}px apart`,
      );
    }
  }
}

function assertNoSocketShadowing(result: LayoutResult): void {
  for (const parent of result.nodes) {
    for (const socket of parent.sockets) {
      if (!socket.childKey) continue;
      const bounds = subtreeBounds(result, socket.childKey);

      for (const other of parent.sockets) {
        if (other === socket) continue;
        const notchLeft = other.cx - other.notchWidth / 2;
        const notchRight = other.cx + other.notchWidth / 2;
        assert.ok(
          bounds.maxX <= notchLeft + 0.001 ||
            bounds.minX >= notchRight - 0.001,
          `${socket.portName} subtree [${bounds.minX}, ${bounds.maxX}] shadows ${other.portName} notch [${notchLeft}, ${notchRight}]`,
        );
      }
    }
  }
}

function assertLayoutInvariants(result: LayoutResult): void {
  assertNoBodyOverlap(result);
  assertSiblingSubtreesSeparated(result);
  assertNoSocketShadowing(result);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

test("parses the checkout example", () => {
  const blocks = parseDSL(CHECKOUT);

  assert.equal(blocks.size, 5);
  assert.equal(blocks.get("CheckoutApi")?.role, "root");
  assert.equal(blocks.get("CheckoutApi")?.subtitle, "DI container (root)");
  assert.deepEqual(blocks.get("CheckoutApi")?.modules, []);
  assert.deepEqual(blocks.get("CheckoutApi")?.sockets, [
    { portName: "ShippingPort", providerId: undefined },
    { portName: "OrderUseCase", providerId: "OrderService" },
    { portName: "ReportPort", providerId: undefined },
  ]);
  assert.equal(blocks.get("StripePayment")?.role, "adapter");
  assert.deepEqual(blocks.get("PostgresStock")?.modules, [
    "conn pool",
    "migrations",
  ]);
});

test("comments, angle brackets, quoted modules and continuations", () => {
  const blocks = parseDSL(`
    # a top-level comment
    Root { // trailing comment
      role: root
      modules: "a, b", c,
        d
      socket <PortOne> <- <ImplOne>
      socket PortTwo # unbound
    }

    ImplOne { role: adapter }
  `);

  assert.deepEqual(blocks.get("Root")?.modules, ["a, b", "c", "d"]);
  assert.deepEqual(blocks.get("Root")?.sockets, [
    { portName: "PortOne", providerId: "ImplOne" },
    { portName: "PortTwo", providerId: undefined },
  ]);
});

test("socket-less blocks default to adapter, socket-bearing blocks to composite", () => {
  const blocks = parseDSL(`
    Root { socket A <- Leaf }
    Leaf {}
  `);
  assert.equal(blocks.get("Root")?.role, "composite");
  assert.equal(blocks.get("Leaf")?.role, "adapter");
});

test("module continuations stop at the next directive", () => {
  const blocks = parseDSL(`
    A {
      modules: a,
      role: root
    }
  `);
  assert.deepEqual(blocks.get("A")?.modules, ["a"]);
  assert.equal(blocks.get("A")?.role, "root");
});

test("parses candidates and renders vertical cards with side notches", () => {
  const dsl = `
    Root { socket P <- Factory }
    Factory {
      role: service
      candidates: DocumentPreview, ImagePreview(ImageScaler), VideoPreview
    }
  `;
  const blocks = parseDSL(dsl);
  assert.deepEqual(blocks.get("Factory")?.candidates, [
    { name: "DocumentPreview" },
    { name: "ImagePreview", requires: "ImageScaler" },
    { name: "VideoPreview" },
  ]);

  const svg = render(dsl).svg;
  assert.match(svg, /class="di-candidate"/);
  assert.match(svg, /rotate\(90 /);
  assert.match(svg, /di-candidate-pill/);
  assert.match(svg, />ImageScaler</);
});

test("rejects duplicate ids and unknown roles", () => {
  assert.throws(() => parseDSL("A {}\nA {}"), /Duplicate block/);
  assert.throws(
    () => parseDSL("A { role: singleton }"),
    /Unknown role "singleton"/,
  );
  assert.throws(
    () => parseDSL("A { socket P <- }"),
    /Cannot parse socket/,
  );
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

test("lays out the checkout example without body overlap", () => {
  const result = layout(CHECKOUT);

  assert.deepEqual(result.roots, ["CheckoutApi"]);
  assert.equal(result.nodes.length, 5);

  const root = result.nodes.find((node) => node.id === "CheckoutApi")!;
  assert.equal(root.role, "root");
  assert.equal(root.sockets.length, 3);
  assert.equal(root.plugWidth, 0);

  const order = result.nodes.find((node) => node.id === "OrderService")!;
  assert.ok(order.plugWidth > 0);
  assert.equal(order.parentKey, "CheckoutApi");
  assert.equal(order.sockets.length, 3);

  // The root's unbound ports stay on the outside of the wide composite.
  const left = root.sockets[0]!;
  const middle = root.sockets[1]!;
  const right = root.sockets[2]!;
  assert.ok(left.cx < middle.cx);
  assert.ok(middle.cx < right.cx);

  assertLayoutInvariants(result);
});

test("wide composite subtrees push sibling sockets outwards", () => {
  const result = layout(SHADOW_DSL);
  const root = result.nodes.find((node) => node.id === "Root")!;
  const wide = result.nodes.find((node) => node.id === "WideService")!;

  const wideBounds = subtreeBounds(result, wide.key);
  const left = root.sockets[0]!;
  const right = root.sockets[2]!;

  assert.ok(
    wideBounds.minX > left.cx,
    "wide subtree should sit to the right of the left socket",
  );
  assert.ok(
    wideBounds.maxX < right.cx + root.sockets[2]!.notchWidth / 2,
    "wide subtree should sit to the left of the right socket",
  );

  // Sanity: without envelope reservation, the three grandchildren would be
  // much wider than the 96px middle notch and cover both neighbours.
  assert.ok(wideBounds.maxX - wideBounds.minX > 400);
  assertLayoutInvariants(result);
});

test("asymmetric subtrees reserve independent left/right extents", () => {
  const result = layout(ASYMMETRIC_DSL);
  const root = result.nodes.find((node) => node.id === "Root")!;
  const lopsided = result.nodes.find((node) => node.id === "Lopsided")!;
  const lopsidedBounds = subtreeBounds(result, lopsided.key);
  const rightPort = root.sockets[2]!;

  // The deep right-hand branch makes the subtree strongly one-sided.
  assert.ok(lopsided.extentRight > lopsided.extentLeft + 100);

  // The right socket must clear the *actual* right edge, not a symmetric
  // half-width approximation of this subtree.
  assert.ok(
    lopsidedBounds.maxX + 6 <= rightPort.cx - rightPort.notchWidth / 2,
    "the right socket sits inside the asymmetric subtree envelope",
  );

  assertLayoutInvariants(result);
});

test("shared providers are duplicated per socket", () => {
  const dsl = `
    Root {
      socket First <- Shared
      socket Second <- Shared
    }
    Shared { modules: payload }
  `;
  const result = layout(dsl);

  const instances = result.nodes.filter((node) => node.id === "Shared");
  assert.equal(instances.length, 2);
  assert.notEqual(instances[0]!.key, instances[1]!.key);
  assert.deepEqual(
    instances.map((node) => node.parentKey),
    ["Root", "Root"],
  );
  assertLayoutInvariants(result);

  const svg = render(dsl).svg;
  assert.equal(svg.match(/data-block-id="Shared"/g)?.length, 2);
});

test("multiple roots are placed side by side", () => {
  const dsl = `
    RootA { socket P <- Shared }
    RootB { socket Q <- Shared }
    Shared {}
  `;
  const result = layout(dsl);

  assert.deepEqual(result.roots, ["RootA", "RootB"]);
  assert.equal(result.nodes.filter((node) => node.id === "Shared").length, 2);
  assertLayoutInvariants(result);

  const rootA = result.nodes.find((node) => node.id === "RootA")!;
  const rootB = result.nodes.find((node) => node.id === "RootB")!;
  assert.ok(rootB.x > rootA.x + rootA.width);
});

test("guards against exponential shared-subtree expansion", () => {
  const lines: string[] = [];
  for (let i = 0; i < 14; i++) {
    lines.push(`B${i} {`);
    lines.push(`  socket L <- B${i + 1}`);
    lines.push(`  socket R <- B${i + 1}`);
    lines.push(`}`);
  }
  lines.push("B14 {}");

  assert.throws(() => layout(lines.join("\n")), /exceeds 5000/);
});

test("rejects unknown providers, cycles, and unreachable cycles", () => {
  assert.throws(
    () => layout("Root { socket P <- Missing }"),
    /unknown block "Missing"/i,
  );
  assert.throws(
    () => layout("A { socket P <- B }\nB { socket Q <- A }"),
    /cycle|root/i,
  );
  assert.throws(
    () =>
      layout(`
        Root { socket P <- A }
        A { socket Q <- B }
        B { socket R <- A }
      `),
    /Cycle detected/,
  );
});

test("reports layout bounds that contain every node", () => {
  const result = layout(CHECKOUT);
  for (const node of result.nodes) {
    assert.ok(node.x >= result.bounds.minX);
    assert.ok(node.y >= result.bounds.minY);
    assert.ok(node.x + node.width <= result.bounds.maxX);
    assert.ok(node.y + node.height <= result.bounds.maxY);
  }
});

// ---------------------------------------------------------------------------
// SVG compiler
// ---------------------------------------------------------------------------

test("emits a self-contained, deterministic SVG", () => {
  const first = render(CHECKOUT);
  const second = render(CHECKOUT);

  assert.equal(first.svg, second.svg);
  assert.match(first.svg, /^<svg /);
  assert.match(first.svg, /viewBox="0 0 \d+ \d+"/);
  assert.match(first.svg, /class="di-viz"/);
  assert.match(first.svg, /<style>/);
  assert.match(first.svg, /--di-canvas-bg/);
  assert.match(first.svg, /data-theme="auto"/);
  assert.match(first.svg, /role="img"/);
  assert.match(first.svg, /<title>/);

  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(first.svg);
  assert.ok(viewBox);
  assert.equal(Number(viewBox[1]), first.width);
  assert.equal(Number(viewBox[2]), first.height);
});

test("renders bound and unbound sockets differently", () => {
  const svg = render(CHECKOUT).svg;
  assert.match(svg, /di-socket-bound/);
  assert.match(svg, /di-socket-unbound/);
  assert.match(svg, /stroke-dasharray="4 3"/);
  assert.match(svg, /--di-pill-unbound-text/);
  assert.match(svg, /ShippingPort/);
  assert.match(svg, /ReportPort/);
});

test("renders modules and subtitles", () => {
  const svg = render(CHECKOUT).svg;
  assert.match(svg, />OrderValidator</);
  assert.match(svg, />PricingEngine</);
  assert.match(svg, />OrderMapper</);
  assert.match(svg, />DI container \(root\)</);
  assert.match(svg, />composite</);

  // Leaf adapters are compact caps: their struct fields are not rendered.
  assert.doesNotMatch(svg, />conn pool</);
});

test("escapes XML in ids, subtitles, and modules", () => {
  const svg = render(`
    Root { socket Port <- Composite }
    Composite "a & <b>" {
      role: composite
      modules: "x<y", d&e
    }
  `).svg;

  assert.match(svg, /a &amp; &lt;b&gt;/);
  assert.match(svg, /x&lt;y/);
  assert.match(svg, /d&amp;e/);
});

test("emits concrete color fallbacks for renderers without CSS variables", () => {
  const svg = render(CHECKOUT).svg;

  // librsvg / ImageMagick / some SVG-to-PNG pipelines do not resolve var() in
  // presentation attributes. The attributes must therefore be real colors.
  assert.doesNotMatch(svg, /fill="var\(/);
  assert.doesNotMatch(svg, /stroke="var\(/);
  assert.match(svg, /fill="#18191c"/); // dark canvas fallback
  assert.match(svg, /fill="#26272b"/); // surface
  assert.match(svg, /stroke="#ea580c"/); // container stroke
  assert.match(svg, /stroke="#f59e0b"/); // adapter stroke

  const light = render(CHECKOUT, { theme: "light" }).svg;
  assert.match(light, /fill="#f6f7fb"/);
  assert.match(light, /fill="#ffffff"/);
});

test("theme, padding, and responsive options", () => {
  const light = render(CHECKOUT, { theme: "light" }).svg;
  assert.match(light, /data-theme="light"/);
  assert.match(light, /--di-canvas-bg: #f6f7fb/);

  const padded = render(CHECKOUT, { padding: 100 });
  assert.ok(padded.width > render(CHECKOUT, { padding: 10 }).width);

  const responsive = render(CHECKOUT, { responsive: true }).svg;
  assert.match(responsive, /width="100%"/);
  assert.match(responsive, /height="100%"/);
  assert.match(responsive, /data-responsive="true"/);
});

test("does not render an in-SVG legend", () => {
  const svg = render(CHECKOUT).svg;
  assert.doesNotMatch(svg, /di-legend/);
  assert.doesNotMatch(svg, /notch = socket/);
  assert.doesNotMatch(svg, /orange = composition root/);
});

test("renders a custom accessible title", () => {
  const svg = render(CHECKOUT, { title: "Checkout wiring" }).svg;
  assert.match(svg, /<title>Checkout wiring<\/title>/);
});

test("places the root title bottom-left", () => {
  const result = render('Solo "root" { role: root }');
  const title = /class="di-title" x="([\d.]+)"/.exec(result.svg);

  assert.ok(title);
  assert.ok(result.width > 200);
  assert.ok(Number(title[1]) < result.width / 2);
});

test("mount writes the compiled SVG into the host element", () => {
  const host = { innerHTML: "" };
  const result = mount(host, CHECKOUT);

  assert.equal(host.innerHTML, result.svg);
  assert.match(host.innerHTML, /<svg /);
});

test("corner radius is configurable", () => {
  const sharp = render(CHECKOUT, { cornerRadius: 0 }).svg;
  const round = render(CHECKOUT, { cornerRadius: 10 }).svg;
  assert.notEqual(sharp, round);
  assert.match(sharp, /Q /); // Q at radius 0 is still emitted as a degenerate corner
});
