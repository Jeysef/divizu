import { parseDSL, render } from "./dist/index.js";
import { gutterNumbers, highlightDsl, lineCount } from "./highlight.js";

const SAMPLE = `root CheckoutApi "root" {
  needs Orders <- OrderService
  needs Telemetry
  needs Catalog <- PostgresCatalog
  needs Config <- AppConfig
}

component OrderService "application service" {
  provides: Orders
  modules: ValidateCart, PriceOrder
  needs Payments <- StripeGateway
}

boundary StripeGateway "payments" {
  provides: Payments
  tag: adapter
}

boundary PostgresCatalog "catalog database" {
  provides: Catalog
  modules: "conn pool"
  tag: adapter
}

value AppConfig "context" {
  provides: Config
  tag: config
}
`;

const OPTIONS = {
  theme: "dark",
  padding: 32,
  cornerRadius: 4,
  socketGap: 28,
};

const editor = document.querySelector("#home-editor");
const highlight = document.querySelector("#home-highlight");
const gutter = document.querySelector("#home-gutter");
const preview = document.querySelector("#home-preview");
const errorBox = document.querySelector("#home-error");
const statusLine = document.querySelector("#home-status");
const state = document.querySelector("#home-state");
const dims = document.querySelector("#home-dims");
const view = document.querySelector("#home-view");
const lines = document.querySelector("#home-lines");
const blocksOut = document.querySelector("#home-blocks");
const timeOut = document.querySelector("#home-time");
const reset = document.querySelector("#home-reset");
const openLink = document.querySelector("#home-open");
const copyAgent = document.querySelector("#copy-agent");
const agentPrompt = document.querySelector("#agent-prompt-text");

let timer = 0;
let copyTimer = 0;

function fallbackCopy(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  try {
    document.execCommand("copy");
  } finally {
    area.remove();
  }
}

async function copyAgentPrompt() {
  if (!agentPrompt) return;
  const text = agentPrompt.textContent.trim();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    fallbackCopy(text);
  }
  window.clearTimeout(copyTimer);
  copyAgent.textContent = "Copied — paste it";
  copyAgent.dataset.copied = "";
  copyTimer = window.setTimeout(() => {
    copyAgent.textContent = "Copy agent prompt";
    delete copyAgent.dataset.copied;
  }, 1900);
}

function setState(kind, label) {
  state.dataset.state = kind;
  state.textContent = label;
}

function setError(message) {
  if (!message) {
    errorBox.hidden = true;
    errorBox.textContent = "";
    return;
  }
  errorBox.hidden = false;
  errorBox.textContent = message;
}

function syncScroll() {
  highlight.scrollTop = editor.scrollTop;
  highlight.scrollLeft = editor.scrollLeft;
  gutter.scrollTop = editor.scrollTop;
}

function updateSource() {
  const count = lineCount(editor.value);
  gutter.textContent = gutterNumbers(editor.value);
  lines.textContent = `${count} ${count === 1 ? "line" : "lines"}`;
  highlight.innerHTML = highlightDsl(editor.value);
  openLink.href = `./playground.html#dsl=${encodeURIComponent(editor.value)}`;
  syncScroll();
}

function renderNow() {
  const dsl = editor.value;

  if (!dsl.trim()) {
    preview.innerHTML =
      '<div class="viz-empty"><strong>Empty source</strong>Write a block to begin.</div>';
    setError(null);
    setState("empty", "empty");
    statusLine.textContent = "Waiting for source";
    dims.textContent = "—";
    view.textContent = "SVG / —";
    blocksOut.textContent = "0";
    timeOut.textContent = "—";
    return;
  }

  const started = performance.now();

  try {
    const result = render(dsl, OPTIONS);
    const blocks = parseDSL(dsl).size;
    const elapsed = performance.now() - started;

    preview.innerHTML = result.svg;
    setError(null);
    setState("ready", "ready");
    statusLine.textContent = "Compiled clean";
    dims.textContent = `${result.width} × ${result.height}`;
    view.textContent = "SVG / dark";
    blocksOut.textContent = String(blocks);
    timeOut.textContent =
      elapsed < 0.1 ? "<0.1 ms" : `${elapsed.toFixed(1)} ms`;
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
    setState("error", "error");
    statusLine.textContent = "Render failed";
    dims.textContent = "—";
    view.textContent = "SVG / error";
    blocksOut.textContent = "0";
    timeOut.textContent = "—";
  }
}

function scheduleRender() {
  window.clearTimeout(timer);
  timer = window.setTimeout(renderNow, 100);
}

if (editor) {
  editor.value = SAMPLE;
  updateSource();
  renderNow();

  editor.addEventListener("input", () => {
    setState("ready", "editing");
    updateSource();
    scheduleRender();
  });

  editor.addEventListener("scroll", syncScroll, { passive: true });

  editor.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.setRangeText("  ", start, end, "end");
      editor.dispatchEvent(new Event("input"));
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      renderNow();
    }
  });

  reset.addEventListener("click", () => {
    editor.value = SAMPLE;
    editor.scrollTop = 0;
    editor.scrollLeft = 0;
    updateSource();
    renderNow();
    editor.focus();
  });

  copyAgent.addEventListener("click", copyAgentPrompt);
}
