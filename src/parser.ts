import {
  BLOCK_ROLES,
  type BlockDef,
  type BlockRole,
  type CandidateDef,
  type Document,
  type Loc,
  type NeedDef,
  type SourceRef,
} from "./ast.ts";
import { DivizuError, diagnostic, suggest } from "./diagnostics.ts";

interface Token {
  kind: "ident" | "string" | "symbol" | "newline" | "eof";
  value: string;
  line: number;
  column: number;
  offset: number;
}

const DIRECTIVES = new Set([
  "provides",
  "needs",
  "modules",
  "candidates",
  "tag",
  "src",
  "label",
]);

const ROLE_SET = new Set<string>(BLOCK_ROLES);

class Lexer {
  private index = 0;
  private line = 1;
  private column = 1;
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  next(): Token {
    this.skipSpaces();

    if (this.index >= this.source.length) {
      return this.token("eof", "", this.line, this.column, this.index);
    }

    const startLine = this.line;
    const startColumn = this.column;
    const startOffset = this.index;
    const char = this.source[this.index]!;

    if (char === "\n") {
      this.advance();
      return this.token("newline", "\n", startLine, startColumn, startOffset);
    }

    if (char === "#" || (char === "/" && this.source[this.index + 1] === "/")) {
      while (this.index < this.source.length && this.source[this.index] !== "\n") {
        this.advance();
      }
      return this.next();
    }

    if (char === '"') {
      return this.readString(startLine, startColumn, startOffset);
    }

    if (char === "<" && this.source[this.index + 1] === "-") {
      this.advance();
      this.advance();
      return this.token("symbol", "<-", startLine, startColumn, startOffset);
    }

    if ("{}:,;()".includes(char)) {
      this.advance();
      return this.token("symbol", char, startLine, startColumn, startOffset);
    }

    if (isIdentStart(char)) {
      let value = char;
      this.advance();
      while (this.index < this.source.length) {
        const nextChar = this.source[this.index]!;
        if (!isIdentPart(nextChar)) break;
        value += nextChar;
        this.advance();
      }
      return this.token("ident", value, startLine, startColumn, startOffset);
    }

    throw this.error(
      "syntax",
      `Unexpected character "${char}".`,
      startLine,
      startColumn,
      startOffset,
    );
  }

  private readString(line: number, column: number, offset: number): Token {
    this.advance();
    let value = "";

    while (this.index < this.source.length) {
      const char = this.source[this.index]!;
      if (char === "\n") {
        throw this.error(
          "syntax",
          "Unterminated string. Strings cannot span lines.",
          line,
          column,
          offset,
        );
      }
      if (char === "\\") {
        const next = this.source[this.index + 1];
        if (next === undefined) break;
        value += unescapeChar(next);
        this.advance();
        this.advance();
        continue;
      }
      if (char === '"') {
        this.advance();
        return this.token("string", value, line, column, offset);
      }
      value += char;
      this.advance();
    }

    throw this.error("syntax", "Unterminated string.", line, column, offset);
  }

  private skipSpaces(): void {
    while (this.index < this.source.length) {
      const char = this.source[this.index]!;
      if (char === " " || char === "\t" || char === "\r") {
        this.advance();
        continue;
      }
      break;
    }
  }

  private advance(): void {
    const char = this.source[this.index];
    this.index += 1;
    if (char === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
  }

  private token(
    kind: Token["kind"],
    value: string,
    line: number,
    column: number,
    offset: number,
  ): Token {
    return { kind, value, line, column, offset };
  }

  private error(
    code: "syntax",
    message: string,
    line: number,
    column: number,
    offset: number,
  ): DivizuError {
    return new DivizuError(diagnostic(code, message, line, column, { offset }));
  }
}

function isIdentStart(char: string): boolean {
  return /[\p{L}\p{N}_@.]/u.test(char);
}

function isIdentPart(char: string): boolean {
  return /[\p{L}\p{N}_@.\-/#$+~]/u.test(char);
}

function unescapeChar(char: string): string {
  switch (char) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case '"':
      return '"';
    case "\\":
      return "\\";
    default:
      return char;
  }
}

class Parser {
  private readonly lexer: Lexer;
  private current: Token;
  private lookahead: Token | undefined;
  private readonly blocks = new Map<string, BlockDef>();
  private readonly order: string[] = [];

  constructor(source: string) {
    this.lexer = new Lexer(source);
    this.current = this.lexer.next();
  }

  parse(): Document {
    this.skipSeparators();

    while (this.kind() !== "eof") {
      if (this.kind() !== "ident") {
        throw this.error(
          "syntax",
          `Expected a block declaration beginning with root, component, boundary or value, got "${this.value()}".`,
          this.current,
          "Write: component Orders { ... }",
        );
      }

      if (!ROLE_SET.has(this.value())) {
        const hint = suggest(this.value(), BLOCK_ROLES);
        throw this.error(
          "syntax",
          `Unknown role "${this.value()}".`,
          this.current,
          `Expected root, component, boundary or value.${hint ? ` Did you mean "${hint}"?` : ""}`,
        );
      }

      this.parseBlock();
      this.skipSeparators();
    }

    if (this.blocks.size === 0) {
      throw this.error("syntax", "No blocks found.", this.current);
    }

    return { blocks: this.blocks, order: this.order };
  }

  private parseBlock(): void {
    const roleToken = this.current;
    const role = roleToken.value as BlockRole;
    this.advance();

    const idToken = this.current;
    if (idToken.kind !== "ident" && idToken.kind !== "string") {
      throw this.error(
        "syntax",
        "Expected a block name after the role.",
        idToken,
        "Example: component Orders { ... }",
      );
    }
    const id = idToken.value;
    if (!id.trim()) {
      throw this.error("syntax", "Block names cannot be empty.", idToken);
    }
    this.advance();

    let subtitle: string | undefined;
    if (this.kind() === "string") {
      subtitle = this.value();
      this.advance();
    }

    if (this.kind() !== "symbol" || this.value() !== "{") {
      throw this.error(
        "syntax",
        `Expected "{" after "${id}".`,
        this.current,
        "Blocks require braces, even when empty: Leaf {}",
      );
    }
    this.advance();

    const def: BlockDef = {
      id,
      ...(subtitle !== undefined ? { subtitle } : {}),
      role,
      provides: [],
      needs: [],
      modules: [],
      candidates: [],
      tags: [],
      loc: locOf(roleToken),
    };

    let sawProvides = false;
    let sawModules = false;
    let sawCandidates = false;
    let sawSrc = false;
    let sawLabel = false;

    this.skipSeparators();

    while (this.kind() !== "eof") {
      if (this.kind() === "symbol" && this.value() === "}") {
        break;
      }

      const directiveToken = this.current;
      if (directiveToken.kind !== "ident") {
        throw this.error(
          "syntax",
          `Expected a directive inside "${id}", got "${directiveToken.value}".`,
          directiveToken,
          "Use provides:, needs, modules:, candidates:, tag:, src: or label:.",
        );
      }

      const directive = directiveToken.value;
      if (!DIRECTIVES.has(directive)) {
        const hint = suggest(directive, DIRECTIVES);
        throw this.error(
          "syntax",
          `Unknown directive "${directive}" in "${id}".`,
          directiveToken,
          `Use one of provides:, needs, modules:, candidates:, tag:, src: or label:.${hint ? ` Did you mean "${hint}"?` : ""}`,
        );
      }
      this.advance();

      if (directive !== "needs") {
        if (this.current.kind !== "symbol" || this.current.value !== ":") {
          throw this.error(
            "syntax",
            `Expected ":" after ${directive}.`,
            directiveToken,
            `Write ${directive}: ...`,
          );
        }
        this.advance();
      }

      switch (directive) {
        case "provides": {
          if (sawProvides) {
            throw this.error(
              "syntax",
              `Duplicate provides: directive in "${id}".`,
              directiveToken,
            );
          }
          sawProvides = true;
          def.provides = this.parseList(() => this.parseName("service key"));
          break;
        }
        case "needs": {
          def.needs.push(this.parseNeed());
          break;
        }
        case "modules": {
          if (sawModules) {
            throw this.error(
              "syntax",
              `Duplicate modules: directive in "${id}".`,
              directiveToken,
            );
          }
          sawModules = true;
          def.modules = this.parseList(() => this.parseName("module name"));
          break;
        }
        case "candidates": {
          if (sawCandidates) {
            throw this.error(
              "syntax",
              `Duplicate candidates: directive in "${id}".`,
              directiveToken,
            );
          }
          sawCandidates = true;
          def.candidates = this.parseCandidates();
          break;
        }
        case "tag": {
          const values = this.parseList(() => this.parseName("tag"));
          for (const value of values) {
            if (!def.tags.includes(value)) def.tags.push(value);
          }
          break;
        }
        case "src": {
          if (sawSrc) {
            throw this.error(
              "syntax",
              `Duplicate src: directive in "${id}".`,
              directiveToken,
            );
          }
          sawSrc = true;
          def.src = this.parseSource();
          break;
        }
        case "label": {
          if (sawLabel) {
            throw this.error(
              "syntax",
              `Duplicate label: directive in "${id}".`,
              directiveToken,
            );
          }
          sawLabel = true;
          def.label = this.parseName("label");
          break;
        }
      }

      this.consumeTerminator(id);
      this.skipSeparators();
    }

    if (this.kind() === "eof") {
      throw this.error(
        "syntax",
        `Unclosed block "${id}".`,
        this.current,
        "Add a closing }.",
      );
    }

    this.advance();

    if (this.blocks.has(id)) {
      throw this.error(
        "duplicate-id",
        `Duplicate block "${id}".`,
        idToken,
        "Block ids must be unique.",
      );
    }

    this.blocks.set(id, def);
    this.order.push(id);
  }

  private parseNeed(): NeedDef {
    const keyToken = this.current;
    const key = this.parseName("requirement key");
    let providerId: string | undefined;
    let fresh = false;

    if (this.kind() === "symbol" && this.value() === "<-") {
      this.advance();
      if (this.kind() === "ident" && this.value() === "fresh") {
        fresh = true;
        this.advance();
      }
      providerId = this.parseName("provider block");
      if (!providerId.trim()) {
        throw this.error("syntax", "Expected a provider after <-.", keyToken);
      }
    }

    return {
      key,
      ...(providerId !== undefined ? { providerId } : {}),
      fresh,
      loc: locOf(keyToken),
    };
  }

  private parseCandidates(): CandidateDef[] {
    const items: CandidateDef[] = [];

    while (true) {
      const token = this.current;
      const name = this.parseName("candidate name");
      let requires: string | undefined;

      if (this.kind() === "symbol" && this.value() === "(") {
        this.advance();
        requires = this.parseName("candidate requirement");
        if (this.kind() !== "symbol" || this.value() !== ")") {
          throw this.error(
            "syntax",
            "Expected ) after candidate requirement.",
            this.current,
          );
        }
        this.advance();
      }

      items.push({
        name,
        ...(requires !== undefined ? { requires } : {}),
        loc: locOf(token),
      });

      if (!this.consumeComma()) break;
      this.skipNewlinesAfterComma();
      if (this.listEndsAfterComma()) break;
    }

    return items;
  }

  private parseSource(): SourceRef {
    if (this.kind() !== "string") {
      throw this.error(
        "syntax",
        "src: expects a quoted path, for example src: \"cmd/api/main.go:24\".",
        this.current,
      );
    }

    const value = this.value();
    this.advance();
    const match = /^(.*):(\d+)$/.exec(value);
    if (match?.[1] && match[2]) {
      return { file: match[1], line: Number(match[2]) };
    }
    return { file: value };
  }

  private parseList(parseItem: () => string): string[] {
    const items: string[] = [];

    while (true) {
      items.push(parseItem());
      if (!this.consumeComma()) break;
      this.skipNewlinesAfterComma();
      if (this.listEndsAfterComma()) break;
    }

    return items;
  }

  private consumeComma(): boolean {
    if (this.kind() === "symbol" && this.value() === ",") {
      this.advance();
      return true;
    }
    return false;
  }

  private skipNewlinesAfterComma(): void {
    while (this.kind() === "newline") this.advance();
  }

  /** A comma before a closing brace is a tolerated trailing comma. */
  private listEndsAfterComma(): boolean {
    if (this.kind() === "symbol" && this.value() === "}") return true;
    if (this.kind() === "symbol" && this.value() === ";") return true;
    if (this.kind() === "eof") return true;

    if (this.kind() === "ident" && DIRECTIVES.has(this.value())) {
      const lookahead = this.peek();
      if (lookahead.kind === "symbol" && lookahead.value === ":") {
        throw this.error(
          "syntax",
          `Trailing comma before "${this.value()}:".`,
          this.current,
          "Remove the comma, or finish the list with an item.",
        );
      }
    }

    return false;
  }

  private parseName(what: string): string {
    if (this.kind() === "ident" || this.kind() === "string") {
      const value = this.value();
      this.advance();
      return value;
    }
    throw this.error(
      "syntax",
      `Expected ${what}, got "${this.value()}".`,
      this.current,
      "Names can be unquoted, or quoted for spaces and punctuation.",
    );
  }

  private consumeTerminator(blockId: string): void {
    if (this.kind() === "newline") {
      this.advance();
      return;
    }
    if (this.kind() === "symbol" && this.value() === ";") {
      this.advance();
      return;
    }
    if (this.kind() === "symbol" && this.value() === "}") {
      return;
    }
    if (this.kind() === "eof") {
      throw this.error(
        "syntax",
        `Unclosed block "${blockId}".`,
        this.current,
        "Add a closing }.",
      );
    }
    throw this.error(
      "syntax",
      `Expected a newline or ";" after the directive in "${blockId}".`,
      this.current,
      "Put each directive on its own line.",
    );
  }

  private skipSeparators(): void {
    while (
      this.kind() === "newline" ||
      (this.kind() === "symbol" && this.value() === ";")
    ) {
      this.advance();
    }
  }

  private kind(): string {
    return this.current.kind;
  }

  private value(): string {
    return this.current.value;
  }

  private advance(): void {
    if (this.lookahead) {
      this.current = this.lookahead;
      this.lookahead = undefined;
    } else {
      this.current = this.lexer.next();
    }
  }

  private peek(): Token {
    if (!this.lookahead) {
      this.lookahead = this.lexer.next();
    }
    return this.lookahead;
  }

  private error(
    code: "syntax" | "duplicate-id",
    message: string,
    token: Token,
    suggestion?: string,
  ): DivizuError {
    return new DivizuError(
      diagnostic(code, message, token.line, token.column, {
        offset: token.offset,
        ...(suggestion ? { suggestion } : {}),
      }),
    );
  }
}

function locOf(token: Token): Loc {
  return { line: token.line, column: token.column, offset: token.offset };
}

export function parseDSL(source: string): Map<string, BlockDef> {
  return parseDocument(source).blocks;
}

export function parseDocument(source: string): Document {
  return new Parser(source).parse();
}
