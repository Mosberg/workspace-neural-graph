import * as path from "node:path";
import { WorkspaceGraphData } from "./types";

export function generateADRMarkdown(data: WorkspaceGraphData, workspaceName: string): string {
  const timestamp = new Date().toISOString().split("T")[0];
  const circularLinks = data.links.filter((l) => l.isCircular);
  const circularNodes = data.nodes.filter((n) => n.isCircular);

  // Compute top dependencies (in-degree fan-in)
  const inDegrees = new Map<string, number>();
  data.links.forEach((l) => {
    if (l.type === "hierarchy") return;
    const target = typeof l.target === "string" ? l.target : (l.target as any).id;
    inDegrees.set(target, (inDegrees.get(target) || 0) + 1);
  });

  const topShared = Array.from(inDegrees.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, count]) => {
      const node = data.nodes.find((n) => n.id === id);
      return { name: node?.name || path.basename(id), count, path: id };
    });

  return `# Architecture Decision Record: Dependency & Churn Review

**Project:** ${workspaceName}
**Date:** ${timestamp}
**Status:** ${circularNodes.length === 0 ? "Approved / Healthy" : "Needs Review (Circular Couplings Found)"}

---

## 1. Context & Topology Metrics

A structural workspace scan was conducted across the source tree:
- **Total Tracked Files:** ${data.stats.totalFiles}
- **Total Folders:** ${data.stats.totalFolders}
- **Circular Dependency Chains:** ${data.stats.circularCount}
- **Incremental Cache Hits:** ${data.stats.cachedHits}

---

## 2. Core Architectural Backbone (Most Depended On)

The following components possess the highest inward coupling (fan-in). Modifications to these modules carry a wide blast radius:

| Component | Inward Dependents | Absolute Path |
| :--- | :--- | :--- |
${topShared.map((s) => `| \`${s.name}\` | **${s.count}** files | \`${s.path}\` |`).join("\n")}

---

## 3. High Churn Hotspots (Risk Analysis)

Files exhibiting high change velocity and modifications over recent development cycles:

| Hotspot File | Risk Factor (0.0 - 1.0) |
| :--- | :--- |
${data.stats.topHotspots.map((h) => `| \`${h.name}\` | \`${h.score}\` |`).join("\n")}

---

## 4. Coupling & Circular Dependency Audit

${
  circularNodes.length === 0
    ? "✅ **No cyclic dependency chains detected.** All modules follow a clean directed acyclic graph (DAG) structure."
    : `⚠️ **Warning:** Detected **${circularNodes.length}** nodes participating in closed cyclic imports:
\n` +
      circularLinks
        .map((l) => {
          const src = typeof l.source === "string" ? l.source : (l.source as any).id;
          const tgt = typeof l.target === "string" ? l.target : (l.target as any).id;
          return `- \`${path.basename(src)}\` ➔ \`${path.basename(tgt)}\` *(${l.type})*`;
        })
        .join("\n") +
      "\n\n**Recommendation:** Decouple these cycles using dependency inversion, event contracts, or extracting common types into independent leaf modules."
}

---

## 5. Consequences & Maintenance Actions

- Refactor critical hotspots exhibiting elevated risk scores.
- Isolate modules with circular loops to eliminate unintended runtime side-effects.
- Review components in Section 2 prior to major API breaking changes.
`;
}
