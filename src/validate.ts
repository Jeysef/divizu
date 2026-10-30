import type { BlockDef, Document } from "./ast.ts";
import {
  diagnostic,
  suggest,
  type Diagnostic,
} from "./diagnostics.ts";

export interface ValidationResult {
  ok: boolean;
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

interface Reference {
  providerId: string;
  block: BlockDef;
  key: string;
  line: number;
  column: number;
}

export function validateDocument(doc: Document): ValidationResult {
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const blocks = doc.order.map((id) => doc.blocks.get(id)!);
  const ids = new Set(doc.order);

  const addError = (item: Diagnostic): void => {
    errors.push(item);
  };
  const addWarning = (item: Diagnostic): void => {
    warnings.push(item);
  };

  const referenced = new Map<string, Reference[]>();

  for (const block of blocks) {
    const seenNeeds = new Set<string>();
    const seenProvides = new Set<string>();

    if (block.role === "value") {
      if (block.needs.length > 0) {
        addError(
          diagnostic(
            "value-has-needs",
            `Value "${block.id}" cannot declare needs. Values are injected data.`,
            block.loc.line,
            block.loc.column,
          ),
        );
      }
      if (block.modules.length > 0) {
        addError(
          diagnostic(
            "value-has-modules",
            `Value "${block.id}" cannot declare modules.`,
            block.loc.line,
            block.loc.column,
          ),
        );
      }
      if (block.candidates.length > 0) {
        addError(
          diagnostic(
            "value-has-candidates",
            `Value "${block.id}" cannot declare candidates.`,
            block.loc.line,
            block.loc.column,
          ),
        );
      }
    }

    if (block.role === "root" && block.provides.length > 0) {
      addError(
        diagnostic(
          "root-provides",
          `Root "${block.id}" cannot provide services. Put the services on components.`,
          block.loc.line,
          block.loc.column,
        ),
      );
    }

    for (const key of block.provides) {
      if (!key.trim()) {
        addError(
          diagnostic(
            "syntax",
            `Empty service key in "${block.id}".`,
            block.loc.line,
            block.loc.column,
          ),
        );
      } else if (seenProvides.has(key)) {
        addError(
          diagnostic(
            "duplicate-provides",
            `"${block.id}" declares provides: ${key} more than once.`,
            block.loc.line,
            block.loc.column,
          ),
        );
      } else {
        seenProvides.add(key);
      }
    }

    for (const need of block.needs) {
      if (!need.key.trim()) {
        addError(
          diagnostic(
            "syntax",
            `Empty requirement key in "${block.id}".`,
            need.loc.line,
            need.loc.column,
          ),
        );
        continue;
      }

      if (seenNeeds.has(need.key)) {
        addError(
          diagnostic(
            "duplicate-need",
            `"${block.id}" declares needs ${need.key} more than once.`,
            need.loc.line,
            need.loc.column,
          ),
        );
        continue;
      }
      seenNeeds.add(need.key);

      if (need.providerId === undefined) continue;

      if (need.providerId === block.id) {
        addError(
          diagnostic(
            "cycle",
            `"${block.id}" needs itself through ${need.key}.`,
            need.loc.line,
            need.loc.column,
          ),
        );
        continue;
      }

      if (!ids.has(need.providerId)) {
        const hint = suggest(need.providerId, ids);
        addError(
          diagnostic(
            "unknown-provider",
            `Unknown provider "${need.providerId}" for ${need.key} on "${block.id}".`,
            need.loc.line,
            need.loc.column,
            { suggestion: hint ? `Did you mean "${hint}"?` : undefined },
          ),
        );
        continue;
      }

      const provider = doc.blocks.get(need.providerId)!;
      if (provider.role === "root") {
        addError(
          diagnostic(
            "root-referenced",
            `Root "${provider.id}" is used as a provider by "${block.id}".`,
            need.loc.line,
            need.loc.column,
            {
              suggestion:
                "A root is the program. Move the provided service to a component, boundary or value.",
            },
          ),
        );
      }

      if (provider.provides.length > 0 && !provider.provides.includes(need.key)) {
        const hint = suggest(need.key, provider.provides);
        addError(
          diagnostic(
            "provider-mismatch",
            `"${provider.id}" does not provide ${need.key}.`,
            need.loc.line,
            need.loc.column,
            {
              suggestion: hint
                ? `It provides ${provider.provides.join(", ")}. Did you mean "${hint}"?`
                : `It provides ${provider.provides.join(", ")}.`,
            },
          ),
        );
      }

      const list = referenced.get(need.providerId) ?? [];
      list.push({
        providerId: need.providerId,
        block,
        key: need.key,
        line: need.loc.line,
        column: need.loc.column,
      });
      referenced.set(need.providerId, list);
    }
  }

  // A key may only be provided by one block in a graph.
  const providedBy = new Map<string, BlockDef>();
  for (const block of blocks) {
    for (const key of block.provides) {
      const existing = providedBy.get(key);
      if (existing && existing.id !== block.id) {
        addError(
          diagnostic(
            "duplicate-provider",
            `Service ${key} is provided by both "${existing.id}" and "${block.id}".`,
            block.loc.line,
            block.loc.column,
            {
              suggestion: `Remove one provider, or make one of them an alternative with candidates:.`,
            },
          ),
        );
      } else {
        providedBy.set(key, block);
      }
    }
  }

  const roots = blocks.filter((block) => block.role === "root");
  if (roots.length === 0) {
    addError(
      diagnostic(
        "root-missing",
        "No root block found.",
        1,
        1,
        {
          suggestion:
            "Mark the program or entry point with root, for example: root Main { ... }",
        },
      ),
    );
  }

  for (const root of roots) {
    if (referenced.has(root.id)) {
      addError(
        diagnostic(
          "root-referenced",
          `Root "${root.id}" is also used as a provider.`,
          root.loc.line,
          root.loc.column,
          {
            suggestion:
              "A root is the consumer at the bottom of the drawing; it cannot also be plugged in.",
          },
        ),
      );
    }
  }

  const orphaned = new Set<string>();
  for (const block of blocks) {
    if (block.role === "root") continue;
    if (!referenced.has(block.id)) {
      orphaned.add(block.id);
      addError(
        diagnostic(
          "orphan",
          `Unreferenced block "${block.id}".`,
          block.loc.line,
          block.loc.column,
          {
            suggestion:
              "Add a need that points at it, or mark it as root if it is an entry point.",
          },
        ),
      );
    }
  }

  // Iterative DFS from roots. This catches cycles and unreachable subgraphs
  // without overflowing the call stack on deep graphs.
  const state = new Map<string, 0 | 1 | 2>();
  const path: string[] = [];
  const cycleReported = new Set<string>();

  const visit = (start: string): void => {
    const stack: Array<{ id: string; index: number }> = [{ id: start, index: 0 }];
    state.set(start, 1);
    path.push(start);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const block = doc.blocks.get(frame.id)!;
      const needs = block.needs.filter((need) => need.providerId !== undefined);

      if (frame.index >= needs.length) {
        state.set(frame.id, 2);
        stack.pop();
        path.pop();
        continue;
      }

      const need = needs[frame.index]!;
      frame.index += 1;
      const providerId = need.providerId!;
      if (!doc.blocks.has(providerId)) continue;
      if (orphaned.has(providerId)) continue;
      const providerState = state.get(providerId) ?? 0;

      if (providerState === 1) {
        const cycleStart = path.indexOf(providerId);
        const cycle = [...path.slice(cycleStart), providerId];
        const key = [...cycle].sort().join("|");
        if (!cycleReported.has(key)) {
          cycleReported.add(key);
          const location = doc.blocks.get(providerId)!;
          addError(
            diagnostic(
              "cycle",
              `Cycle detected: ${cycle.join(" -> ")}.`,
              location.loc.line,
              location.loc.column,
              {
                suggestion:
                  "Dependency graphs must be acyclic. Cut the back-reference with an unbound need.",
              },
            ),
          );
        }
        continue;
      }

      if (providerState === 2) continue;
      state.set(providerId, 1);
      path.push(providerId);
      stack.push({ id: providerId, index: 0 });
    }
  };

  for (const root of roots) {
    if ((state.get(root.id) ?? 0) === 0) visit(root.id);
  }

  for (const block of blocks) {
    if (orphaned.has(block.id)) continue;
    if ((state.get(block.id) ?? 0) === 0) {
      addError(
        diagnostic(
          "unreachable",
          `Block "${block.id}" is not reachable from a root.`,
          block.loc.line,
          block.loc.column,
          {
            suggestion:
              "Connect it through a need, or mark it as root if it is a separate entry point.",
          },
        ),
      );
    }
  }

  if (blocks.length > 60) {
    addWarning(
      diagnostic(
        "warning",
        `This plate has ${blocks.length} blocks. Consider splitting it by bounded context.`,
        1,
        1,
      ),
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}
