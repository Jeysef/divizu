import { parseDSL, render } from "./dist/index.js";
import {
  gutterNumbers,
  highlightDsl,
  lineCount as countLines,
} from "./highlight.js";

const EXAMPLES = {
  quickstart: "examples/quickstart.di",
  shared: "examples/shared.di",
  checkout: "examples/checkout.di",
  candidates: "examples/candidates.di",
  large: "examples/large.di",
};

const FALLBACK_DSL = `root CheckoutApi "DI container" {
  needs ShippingPort
  needs OrderUseCase <- OrderService
  needs ReportPort
}

component OrderService "application service" {
  provides: OrderUseCase
  modules: OrderValidator, PricingEngine, OrderMapper
  needs PaymentPort <- StripePayment
}

boundary StripePayment "payments" {
  provides: PaymentPort
  tag: adapter
}
`;

const DEFAULTS = {
  cornerRadius: 4,
  padding: 40,
  socketGap: 28,
};

const STORE_SETTINGS = "divizu:settings";
const STORE_SPLIT = "divizu:split";

const editor = document.querySelector("#editor");
const highlight = document.querySelector("#highlight");
const gutter = document.querySelector("#gutter");
const preview = document.querySelector("#preview");
const errorBox = document.querySelector("#error");
const statusLine = document.querySelector("#status");
const blocksOut = document.querySelector("#blocks");
const renderTimeOut = document.querySelector("#render-time");
const dims = document.querySelector("#dims");
const viewTag = document.querySelector("#view-tag");
const sourceState = document.querySelector("#source-state");
const lineCount = document.querySelector("#line-count");
const fileName = document.querySelector("#file-name");
const exampleSelect = document.querySelector("#example");
const downloadButton = document.querySelector("#download");
const copyButton = document.querySelector("#copy");

const themeButtons = [...document.querySelectorAll("[data-theme-value]")];
const panelButtons = [...document.querySelectorAll("[data-panel-value]")];
const settings = document.querySelector("#settings");
const resetSettings = document.querySelector("#settings-reset");
const split = document.querySelector("#split");
const splitHandle = document.querySelector("#split-handle");
const vizScroll = preview.parentElement;
const zoomOut = document.querySelector("#zoom-out");
const zoomIn = document.querySelector("#zoom-in");
const zoomReset = document.querySelector("#zoom-reset");

const layoutSelect = document.querySelector("#layout-mode");
const radiusInput = document.querySelector("#corner-radius");
const paddingInput = document.querySelector("#padding");
const gapInput = document.querySelector("#socket-gap");
const radiusOut = document.querySelector("#corner-radius-value");
const paddingOut = document.querySelector("#padding-value");
const gapOut = document.querySelector("#socket-gap-value");

let theme = "dark";
let layoutMode = "slots";
let currentFile = "checkout";
let currentSvg = "";
let lastValidDsl = "";
let renderTimer = 0;
let loadingExample = false;
let splitRatio = 0.5;
let zoom = 1;
let currentSize = null;

copyButton.disabled = true;

/* ------------------------------------------------------------------ helpers */

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function updateGutter(source) {
  const count = countLines(source);
  gutter.textContent = gutterNumbers(source);
  lineCount.textContent = `${count} ${count === 1 ? "line" : "lines"}`;
}

function syncScroll() {
  highlight.scrollTop = editor.scrollTop;
  highlight.scrollLeft = editor.scrollLeft;
  gutter.scrollTop = editor.scrollTop;
}

function updateEditor() {
  updateGutter(editor.value);
  highlight.innerHTML = highlightDsl(editor.value);
  syncScroll();
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

function setSourceState(state, label) {
  sourceState.dataset.state = state;
  sourceState.textContent = label;
}

function placeholder(title, detail) {
  preview.classList.remove("is-stale");
  const box = document.createElement("div");
  box.className = "viz-empty";
  const strong = document.createElement("strong");
  strong.textContent = title;
  box.append(strong, document.createTextNode(detail));
  preview.replaceChildren(box);
}

function paintZoom() {
  const svg = preview.querySelector("svg");
  const available = Math.max(150, vizScroll.clientWidth - 48);

  zoomOut.disabled = !svg || !currentSize || zoom <= 1;
  zoomIn.disabled = !svg || !currentSize || zoom >= 4;
  zoomReset.disabled = !svg || !currentSize;

  if (!svg || !currentSize) {
    zoomReset.textContent = "Fit";
    return;
  }

  if (zoom === 1) {
    preview.classList.remove("is-zoomed");
    preview.style.width = "";
    preview.style.height = "";
    svg.style.width = "";
    svg.style.height = "";
    svg.style.maxWidth = "";
    zoomReset.textContent = "Fit";
    return;
  }

  const base = Math.min(currentSize.width, available);
  const ratio = base / currentSize.width;
  const width = Math.round(base * zoom);
  const height = Math.round(currentSize.height * ratio * zoom);

  preview.classList.add("is-zoomed");
  preview.style.width = `${width + 48}px`;
  preview.style.height = `${height + 48}px`;
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.maxWidth = "none";
  zoomReset.textContent = `${Math.round(zoom * 100)}%`;
}

function resetZoom() {
  zoom = 1;
  paintZoom();
}

function readNumber(input, fallback) {
  const value = Number(input?.value);
  return Number.isFinite(value) ? value : fallback;
}

function currentOptions() {
  return {
    theme,
    layout: layoutMode,
    padding: readNumber(paddingInput, DEFAULTS.padding),
    cornerRadius: readNumber(radiusInput, DEFAULTS.cornerRadius),
    socketGap: readNumber(gapInput, DEFAULTS.socketGap),
  };
}

function readHash() {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return null;
  const value = raw.startsWith("dsl=") ? raw.slice(4) : raw;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function writeHash(dsl) {
  const next = `#dsl=${encodeURIComponent(dsl)}`;
  if (window.location.hash === next) return;
  window.history.replaceState(null, "", next);
}

function shareUrl(dsl) {
  const url = new URL(window.location.href);
  url.hash = `dsl=${encodeURIComponent(dsl)}`;
  return url.toString();
}

/* ------------------------------------------------------------------- render */

function renderNow({ updateHash = true } = {}) {
  const dsl = editor.value;

  if (!dsl.trim()) {
    currentSvg = "";
    lastValidDsl = "";
    currentSize = null;
    zoom = 1;
    setError(null);
    placeholder("Empty source", "Write a block to begin.");
    paintZoom();
    dims.textContent = "—";
    viewTag.textContent = "SVG";
    statusLine.textContent = "Waiting for source";
    blocksOut.textContent = "0";
    renderTimeOut.textContent = "—";
    setSourceState("empty", "empty");
    downloadButton.disabled = true;
    copyButton.disabled = true;
    return;
  }

  const started = performance.now();

  try {
    const result = render(dsl, currentOptions());
    const blocks = parseDSL(dsl).size;
    const elapsed = performance.now() - started;

    currentSvg = result.svg;
    lastValidDsl = dsl;
    setError(null);
    preview.classList.remove("is-stale");
    preview.innerHTML = result.svg;
    currentSize = { width: result.width, height: result.height };
    zoom = 1;
    paintZoom();
    dims.textContent = `${result.width} × ${result.height}`;
    viewTag.textContent = `SVG / ${theme} / ${layoutMode}`;
    statusLine.textContent = "Compiled clean";
    blocksOut.textContent = String(blocks);
    renderTimeOut.textContent =
      elapsed < 0.1 ? "<0.1 ms" : `${elapsed.toFixed(1)} ms`;
    setSourceState("ready", "ready");
    downloadButton.disabled = false;
    copyButton.disabled = false;

    if (updateHash) writeHash(dsl);
  } catch (error) {
    const message = messageOf(error);
    currentSvg = "";
    setError(message);
    setSourceState("error", "error");
    statusLine.textContent = "Render failed";
    viewTag.textContent = "SVG / error";
    blocksOut.textContent = "0";
    renderTimeOut.textContent = "—";
    dims.textContent = "—";
    downloadButton.disabled = true;
    copyButton.disabled = true;

    if (lastValidDsl && preview.querySelector("svg")) {
      preview.classList.add("is-stale");
    } else {
      currentSize = null;
      zoom = 1;
      placeholder("Render failed", "Fix the DSL and try again.");
      paintZoom();
    }
  }
}

function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => renderNow(), 110);
}

/* ----------------------------------------------------------------- examples */

async function loadExample(id) {
  const file = EXAMPLES[id];
  if (!file) return;

  loadingExample = true;
  exampleSelect.value = id;
  layoutMode = id === "shared" ? "layers" : "slots";
  layoutSelect.value = layoutMode;
  statusLine.textContent = `Loading ${file}…`;
  setSourceState("ready", "loading");

  try {
    const response = await fetch(new URL(file, import.meta.url));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    editor.value = text;
    editor.scrollTop = 0;
    editor.scrollLeft = 0;
    currentFile = id;
    fileName.textContent = `${id}.di`;
    updateEditor();
    renderNow();
  } catch (error) {
    const message = `Could not load ${file}: ${messageOf(error)}`;
    setError(message);
    setSourceState("error", "load error");
    if (!editor.value.trim()) {
      editor.value = FALLBACK_DSL;
      currentFile = "diagram";
      fileName.textContent = "diagram.di";
      updateEditor();
      renderNow();
    }
    statusLine.textContent = "Using the built-in fallback";
  } finally {
    loadingExample = false;
  }
}

/* ------------------------------------------------------------------ actions */

function downloadSvg() {
  if (!currentSvg) return;
  const blob = new Blob([`${currentSvg}\n`], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${currentFile || "diagram"}.svg`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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

let copyReset = 0;

async function copyShareLink() {
  if (!lastValidDsl) return;
  const url = shareUrl(lastValidDsl);

  try {
    await navigator.clipboard.writeText(url);
  } catch {
    fallbackCopy(url);
  }

  window.clearTimeout(copyReset);
  copyButton.textContent = "Copied";
  copyReset = window.setTimeout(() => {
    copyButton.textContent = "Copy link";
  }, 1600);
}

/* ----------------------------------------------------------------- settings */

function updateSettingOutputs() {
  radiusOut.textContent = radiusInput.value;
  paddingOut.textContent = paddingInput.value;
  gapOut.textContent = gapInput.value;
}

function saveSettings() {
  try {
    const settingsValue = {
      theme,
      layout: layoutMode,
      cornerRadius: radiusInput.value,
      padding: paddingInput.value,
      socketGap: gapInput.value,
    };
    localStorage.setItem(STORE_SETTINGS, JSON.stringify(settingsValue));
  } catch {
    /* Storage is optional. */
  }
}

function restoreSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_SETTINGS) ?? "null");
    if (!saved || typeof saved !== "object") return;
    if (saved.theme === "dark" || saved.theme === "light") theme = saved.theme;
    if (saved.layout === "slots" || saved.layout === "layers") {
      layoutMode = saved.layout;
    }
    for (const [key, input] of [
      ["cornerRadius", radiusInput],
      ["padding", paddingInput],
      ["socketGap", gapInput],
    ]) {
      if (saved[key] === undefined) continue;
      const value = Number(saved[key]);
      if (!Number.isFinite(value)) continue;
      const min = Number(input.min);
      const max = Number(input.max);
      if (value < min || value > max) continue;
      input.value = String(value);
    }
  } catch {
    /* Keep the defaults. */
  }
}

function paintTheme() {
  document.body.dataset.renderTheme = theme;
  for (const button of themeButtons) {
    button.setAttribute(
      "aria-pressed",
      button.dataset.themeValue === theme ? "true" : "false",
    );
  }
}

/* -------------------------------------------------------------------- split */

function applySplit() {
  if (!window.matchMedia("(min-width: 961px)").matches) {
    split.style.gridTemplateColumns = "";
    paintZoom();
    return;
  }
  const total = split.getBoundingClientRect().width - 8;
  if (total <= 0) return;
  const min = 280;
  const left = Math.min(Math.max(total * splitRatio, min), total - min);
  split.style.gridTemplateColumns = `${left}px 8px minmax(0, 1fr)`;
  paintZoom();
}

function saveSplit() {
  try {
    localStorage.setItem(STORE_SPLIT, String(splitRatio));
  } catch {
    /* Storage is optional. */
  }
}

function restoreSplit() {
  try {
    const saved = Number(localStorage.getItem(STORE_SPLIT));
    if (Number.isFinite(saved) && saved > 0.2 && saved < 0.8) {
      splitRatio = saved;
    }
  } catch {
    /* Keep the default. */
  }
}

function beginResize(event) {
  if (event.button !== 0) return;
  split.classList.add("is-resizing");
  splitHandle.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function resizeSplit(event) {
  if (!split.classList.contains("is-resizing")) return;
  const rect = split.getBoundingClientRect();
  const total = rect.width - 8;
  const left = event.clientX - rect.left;
  splitRatio = Math.min(Math.max(left / total, 0.2), 0.8);
  applySplit();
}

function endResize(event) {
  if (!split.classList.contains("is-resizing")) return;
  split.classList.remove("is-resizing");
  try {
    splitHandle.releasePointerCapture(event.pointerId);
  } catch {
    /* The pointer may already be released. */
  }
  saveSplit();
}

function moveSplitWithKeyboard(event) {
  const step = event.shiftKey ? 0.08 : 0.02;
  if (event.key === "ArrowLeft") splitRatio -= step;
  else if (event.key === "ArrowRight") splitRatio += step;
  else if (event.key === "Home") splitRatio = 0.25;
  else if (event.key === "End") splitRatio = 0.75;
  else return;
  event.preventDefault();
  splitRatio = Math.min(Math.max(splitRatio, 0.2), 0.8);
  applySplit();
  saveSplit();
}

/* ------------------------------------------------------------------- events */

exampleSelect.addEventListener("change", () => {
  if (exampleSelect.value === "custom") return;
  loadExample(exampleSelect.value);
});

for (const button of themeButtons) {
  button.addEventListener("click", () => {
    theme = button.dataset.themeValue;
    paintTheme();
    saveSettings();
    renderNow();
  });
}

for (const button of panelButtons) {
  button.addEventListener("click", () => {
    const panel = button.dataset.panelValue;
    document.body.dataset.panel = panel;
    for (const other of panelButtons) {
      other.setAttribute(
        "aria-pressed",
        other.dataset.panelValue === panel ? "true" : "false",
      );
    }
    paintZoom();
  });
}

layoutSelect.addEventListener("change", () => {
  layoutMode = layoutSelect.value === "layers" ? "layers" : "slots";
  saveSettings();
  renderNow();
});

for (const input of [radiusInput, paddingInput, gapInput]) {
  input.addEventListener("input", () => {
    updateSettingOutputs();
    saveSettings();
    scheduleRender();
  });
}

resetSettings.addEventListener("click", () => {
  layoutMode = "slots";
  layoutSelect.value = "slots";
  radiusInput.value = String(DEFAULTS.cornerRadius);
  paddingInput.value = String(DEFAULTS.padding);
  gapInput.value = String(DEFAULTS.socketGap);
  updateSettingOutputs();
  saveSettings();
  renderNow();
});

editor.addEventListener("input", () => {
  if (!loadingExample) {
    exampleSelect.value = "custom";
    fileName.textContent = "custom.di";
    currentFile = "custom";
  }
  setSourceState("ready", "editing");
  updateGutter(editor.value);
  highlight.innerHTML = highlightDsl(editor.value);
  syncScroll();
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

downloadButton.addEventListener("click", downloadSvg);
copyButton.addEventListener("click", copyShareLink);

zoomOut.addEventListener("click", () => {
  zoom = Math.max(1, zoom - 0.25);
  paintZoom();
});

zoomIn.addEventListener("click", () => {
  zoom = Math.min(4, zoom + 0.25);
  paintZoom();
});

zoomReset.addEventListener("click", resetZoom);

preview.addEventListener("dblclick", () => {
  if (!currentSize) return;
  zoom = zoom === 1 ? 2 : 1;
  paintZoom();
});

splitHandle.addEventListener("pointerdown", beginResize);
splitHandle.addEventListener("pointermove", resizeSplit);
splitHandle.addEventListener("pointerup", endResize);
splitHandle.addEventListener("pointercancel", endResize);
splitHandle.addEventListener("keydown", moveSplitWithKeyboard);

window.addEventListener("resize", applySplit);

document.addEventListener("click", (event) => {
  if (settings.open && !settings.contains(event.target)) settings.open = false;
});

window.addEventListener("hashchange", () => {
  const dsl = readHash();
  if (dsl === null || dsl === editor.value) return;
  editor.value = dsl;
  exampleSelect.value = "custom";
  currentFile = "shared-link";
  fileName.textContent = "shared-link.di";
  updateEditor();
  renderNow({ updateHash: false });
});

/* --------------------------------------------------------------------- boot */

restoreSettings();
restoreSplit();
updateSettingOutputs();
layoutSelect.value = layoutMode;
paintTheme();
updateEditor();
applySplit();

const initial = readHash();
if (initial !== null) {
  editor.value = initial;
  exampleSelect.value = "custom";
  currentFile = "shared-link";
  fileName.textContent = "shared-link.di";
  updateEditor();
  renderNow();
} else {
  loadExample("checkout");
}
