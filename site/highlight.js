const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function span(className, value) {
  return `<span class="${className}">${escapeHtml(value)}</span>`;
}

/* Small, dependency-free highlighter for the divizu DSL. */
export function highlightDsl(source) {
  const keywords =
    /^(root|component|boundary|value|needs|provides|modules|candidates|tag|src|label|fresh)\b/;
  const roleKeywords = new Set(["root", "component", "boundary", "value"]);

  const lines = source.split("\n").map((line) => {
    let out = "";
    let i = 0;
    let firstToken = true;
    let afterRole = false;

    while (i < line.length) {
      const rest = line.slice(i);

      if (line[i] === "#" || (line[i] === "/" && line[i + 1] === "/")) {
        out += span("tk-com", rest);
        break;
      }

      if (line[i] === '"') {
        let end = i + 1;
        while (end < line.length) {
          if (line[end] === "\\") {
            end += 2;
            continue;
          }
          if (line[end] === '"') {
            end += 1;
            break;
          }
          end += 1;
        }
        out += span("tk-str", line.slice(i, end));
        i = end;
        firstToken = false;
        afterRole = false;
        continue;
      }

      const keyword = keywords.exec(rest);
      if (keyword) {
        out += span("tk-key", keyword[0]);
        afterRole = roleKeywords.has(keyword[0]);
        i += keyword[0].length;
        firstToken = false;
        continue;
      }

      if (rest.startsWith("<-")) {
        out += span("tk-op", "<-");
        i += 2;
        firstToken = false;
        continue;
      }

      const word = /^[A-Za-z0-9_.\-/@#$+~]+/.exec(rest);
      if (word) {
        const value = word[0];
        if (firstToken || afterRole) out += span("tk-block", value);
        else out += escapeHtml(value);
        afterRole = false;
        i += value.length;
        firstToken = false;
        continue;
      }

      const number = /^\d+(?:\.\d+)?/.exec(rest);
      if (number) {
        out += span("tk-num", number[0]);
        i += number[0].length;
        firstToken = false;
        continue;
      }

      if (/[{}:(),<>]/.test(line[i])) {
        out += span("tk-punc", line[i]);
        i += 1;
        firstToken = false;
        continue;
      }

      out += escapeHtml(line[i]);
      i += 1;
      if (!/\s/.test(line[i - 1])) firstToken = false;
    }

    return out;
  });

  return `${lines.join("\n")}\n `;
}

export function gutterNumbers(source) {
  const count = Math.max(1, source.split("\n").length);
  return Array.from({ length: count }, (_, index) => index + 1).join("\n");
}

export function lineCount(source) {
  return Math.max(1, source.split("\n").length);
}
