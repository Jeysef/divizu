import { parseDSL, render } from "./dist/index.js";

const EXAMPLES = {
  checkout: "examples/checkout.di",
  candidates: "examples/candidates.di",
};

const FALLBACK_DSL = `Root "composition root" {
  role: root
  socket LoggerPort
  socket PaymentPort <- StripePayment
}

StripePayment "adapter" {
  role: adapter
}
`;

const editor = document.querySelector("#editor");
const preview = document.querySelector("#preview");
const dims = document.querySelector("#dims");
const statusLine = document.querySelector("#status");
const blocksOut = document.querySelector("#blocks");
const errorBox = document.querySelector("#error");
const exampleSelect = document.querySelector("#example");
const themeSelect = document.querySelector("#theme");
const downloadButton = document.querySelector("#download");
const copyButton = document.querySelector("#copy");
const gutter = document.querySelector("#gutter");
const fileName = document.querySelector("#file-name");

let currentSvg = "";
let currentFile = "diagram";
let lastValidDsl = "";
let renderTimer = 0;
let loadingExample = false;

copyButton.disabled = true;

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function updateGutter() {
  if (!gutter) return;
  const lines = editor.value.split("\n").length;
  let out = "";
  for (let i = 1; i <= lines; i++) out += i + (i < lines ? "\n" : "");
  gutter.textContent = out || "1";
  gutter.scrollTop = editor.scrollTop;
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
  const hash = "#dsl=" + encodeURIComponent(dsl);
  if (window.location.hash === hash) return;
  window.history.replaceState(null, "", hash);
}

function shareUrl(dsl) {
  const url = new URL(window.location.href);
  url.hash = "dsl=" + encodeURIComponent(dsl);
  return url.toString();
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

function placeholder(text, kind = "empty") {
  const box = document.createElement("div");
  box.className = kind === "error" ? "preview-error" : "preview-empty";
  box.textContent = text;
  preview.replaceChildren(box);
}

function renderNow({ updateHash = true } = {}) {
  const dsl = editor.value;

  if (!dsl.trim()) {
    currentSvg = "";
    lastValidDsl = "";
    setError(null);
    placeholder("Write some DSL to render a diagram.");
    dims.textContent = "—";
    statusLine.textContent = "Empty source";
    blocksOut.textContent = "0";
    downloadButton.disabled = true;
    copyButton.disabled = true;
    return;
  }

  let result;
  let blockCount;
  try {
    result = render(dsl, { theme: themeSelect.value, padding: 36 });
    blockCount = parseDSL(dsl).size;
  } catch (error) {
    const message = messageOf(error);
    currentSvg = "";
    setError(message);
    placeholder(message, "error");
    dims.textContent = "error";
    statusLine.textContent = "Render failed — fix the DSL and try again";
    blocksOut.textContent = "0";
    downloadButton.disabled = true;
    copyButton.disabled = true;
    return;
  }

  setError(null);
  currentSvg = result.svg;
  lastValidDsl = dsl;
  preview.innerHTML = result.svg;
  dims.textContent = `${result.width} × ${result.height}`;
  statusLine.textContent = `Rendered ${result.width} × ${result.height}`;
  blocksOut.textContent = String(blockCount);
  downloadButton.disabled = false;
  copyButton.disabled = false;

  if (updateHash) writeHash(dsl);
}

function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => renderNow(), 120);
}

async function loadExample(id) {
  const file = EXAMPLES[id];
  if (!file) return;

  loadingExample = true;
  exampleSelect.value = id;
  statusLine.textContent = `Loading ${file}…`;

  try {
    const response = await fetch(new URL(file, import.meta.url));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    editor.value = text;
    editor.scrollTop = 0;
    currentFile = id;
    if (fileName) fileName.textContent = `${id}.di`;
    updateGutter();
    renderNow();
  } catch (error) {
    const message = `Could not load ${file}: ${messageOf(error)}`;
    setError(message);
    if (!editor.value.trim()) {
      editor.value = FALLBACK_DSL;
      currentFile = "diagram";
      renderNow();
    }
    statusLine.textContent = "Using the built-in fallback example";
  } finally {
    loadingExample = false;
  }
}

function downloadSvg() {
  if (!currentSvg) return;
  const blob = new Blob([currentSvg, "\n"], { type: "image/svg+xml" });
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
  copyButton.textContent = "Copied!";
  copyReset = window.setTimeout(() => {
    copyButton.textContent = "Copy link";
  }, 1600);
}

exampleSelect.addEventListener("change", () => {
  if (exampleSelect.value === "custom") return;
  loadExample(exampleSelect.value);
});

themeSelect.addEventListener("change", () => {
  renderNow();
});

editor.addEventListener("input", () => {
  if (!loadingExample) {
    exampleSelect.value = "custom";
    if (fileName) fileName.textContent = "custom.di";
  }
  updateGutter();
  scheduleRender();
});

editor.addEventListener("scroll", () => {
  if (gutter) gutter.scrollTop = editor.scrollTop;
});

editor.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText("  ", start, end, "end");
    scheduleRender();
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    renderNow();
  }
});

downloadButton.addEventListener("click", downloadSvg);
copyButton.addEventListener("click", copyShareLink);

window.addEventListener("hashchange", () => {
  const dsl = readHash();
  if (dsl === null || dsl === editor.value) return;
  editor.value = dsl;
  exampleSelect.value = "custom";
  renderNow({ updateHash: false });
});

updateGutter();
const initial = readHash();
if (initial !== null) {
  editor.value = initial;
  exampleSelect.value = "custom";
  currentFile = "shared-link";
  renderNow();
} else {
  loadExample("checkout");
}
