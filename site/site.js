/* Shared site behaviour: inline example plates, copy buttons, docs scrollspy. */

const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/* Inline the example SVGs so the host palette can be applied with CSS.
   If the fetch fails the <img> fallback is left in place. */
async function inlineExamples() {
  const hosts = $$("[data-svg]");
  await Promise.all(
    hosts.map(async (host) => {
      const src = host.getAttribute("data-svg");
      if (!src) return;
      try {
        const response = await fetch(src, { cache: "force-cache" });
        if (!response.ok) return;
        const markup = await response.text();
        const holder = document.createElement("div");
        holder.innerHTML = markup.trim();
        const svg = holder.querySelector("svg");
        if (!svg) return;
        svg.setAttribute("data-theme", "dark");
        host.replaceChildren(svg);
        host.classList.add("is-inline");
      } catch {
        /* Keep the fallback image. */
      }
    }),
  );
}

function fallbackCopy(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.inset = "0 auto auto -9999px";
  document.body.append(area);
  area.select();
  try {
    document.execCommand("copy");
  } finally {
    area.remove();
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    fallbackCopy(text);
  }
}

function wireCopyButtons() {
  $$("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const root = button.closest(
        ".code, .doc-figure, .settings-panel, .home-cli",
      );
      const source = root?.querySelector("pre, code");
      if (!source) return;
      const original = button.textContent;
      await copyText(source.textContent);
      button.textContent = "copied";
      button.dataset.copied = "";
      window.setTimeout(() => {
        button.textContent = original;
        delete button.dataset.copied;
      }, 1500);
    });
  });
}

function wireDocs() {
  const sections = $$(".doc-section[id]");
  const links = $$(".doc-nav a[href^='#']");
  const progress = document.querySelector(".progress");
  if (!sections.length && !progress) return;

  let ticking = false;

  const update = () => {
    ticking = false;

    if (progress) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      progress.style.width = `${ratio * 100}%`;
    }

    if (!sections.length) return;
    let current = sections[0].id;
    const marker =
      window.scrollY + Math.min(window.innerHeight * 0.35, 320);
    for (const section of sections) {
      if (section.offsetTop <= marker) current = section.id;
    }
    for (const link of links) {
      link.classList.toggle(
        "is-active",
        link.getAttribute("href") === `#${current}`,
      );
    }
  };

  const requestUpdate = () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  };

  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", requestUpdate);
  update();
}

function wireYear() {
  $$("[data-year]").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });
}

inlineExamples();
wireCopyButtons();
wireDocs();
wireYear();
