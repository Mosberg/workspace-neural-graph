import * as path from "node:path";
import { GraphLink, CycleRefactorAdvice } from "./types";

function nodeId(link: GraphLink): string {
  return typeof link.source === "string" ? link.source : (link.source as any).id;
}

function linkTarget(link: GraphLink): string {
  return typeof link.target === "string" ? link.target : (link.target as any).id;
}

export function analyzeCyclesAndProposeRefactoring(
  circularLinks: GraphLink[],
): CycleRefactorAdvice[] {
  const advices: CycleRefactorAdvice[] = [];
  const directPairs = new Map<string, string>();

  // Build adjacency from circular links
  circularLinks.forEach((l) => {
    const src = typeof l.source === "string" ? l.source : (l.source as any).id;
    const tgt = typeof l.target === "string" ? l.target : (l.target as any).id;
    directPairs.set(`${src}->${tgt}`, src);
  });

  const evaluatedPairs = new Set<string>();

  circularLinks.forEach((l) => {
    const a = typeof l.source === "string" ? l.source : (l.source as any).id;
    const b = typeof l.target === "string" ? l.target : (l.target as any).id;

    const forwardKey = `${a}->${b}`;
    const reverseKey = `${b}->${a}`;
    const pairKey = [a, b].sort().join(" <-> ");

    if (directPairs.has(reverseKey) && !evaluatedPairs.has(pairKey)) {
      evaluatedPairs.add(pairKey);

      const nameA = path.basename(a);
      const nameB = path.basename(b);
      const baseTypeA = nameA.replace(/\.[^/.]+$/, "");
      const baseTypeB = nameB.replace(/\.[^/.]+$/, "");

      advices.push({
        cycleId: `cycle-${advices.length + 1}`,
        participants: [a, b],
        suggestedPattern: "extract-interface",
        reason: `Direct mutual import detected between '${nameA}' and '${nameB}'.`,
        actionableSteps: [
          `1. Extract shared TypeScript interfaces from '${nameA}' into a leaf contract: '${baseTypeA}.types.ts'.`,
          `2. Change imports in '${nameB}' to consume only '${baseTypeA}.types.ts' without referencing '${nameA}'.`,
          `3. If runtime logic is needed from '${nameA}' inside '${nameB}', pass it via constructor injection (Inversion of Control).`,
        ],
        codeTemplate: `// --- Proposed Refactoring: Extract Shared Types ---
// File: src/${baseTypeA}.types.ts
export interface I${baseTypeA}State {
    id: string;
    ready: boolean;
}

// In ${nameB}:
import type { I${baseTypeA}State } from './${baseTypeA}.types';
// Remove: import { ... } from './${baseTypeA}';`,
      });
    }
  });

  // 2. Transitive Cycles (A -> B -> C -> A)
  if (advices.length === 0 && circularLinks.length > 0) {
    const uniqueParticipants = Array.from(
      new Set(
        circularLinks.map((l) => {
          return typeof l.source === "string" ? l.source : (l.source as any).id;
        }),
      ),
    );

    advices.push({
      cycleId: `cycle-complex-1`,
      participants: uniqueParticipants,
      suggestedPattern: "extract-shared-leaf",
      reason: `Multi-file circular loop spanning ${uniqueParticipants.length} files.`,
      actionableSteps: [
        `1. Identify low-level utilities and constants duplicated along the loop.`,
        `2. Move shared logic downwards into an independent leaf utility module (e.g., 'common/' or 'shared/').`,
        `3. Use Dynamic Import 'const mod = await import("./target")' inside functions to defer execution until runtime.`,
      ],
    });
  }

  return advices;
}
