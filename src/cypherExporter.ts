import * as path from "node:path";
import { WorkspaceGraphData } from "./types";

export function generateCypherScript(data: WorkspaceGraphData, workspaceName: string): string {
  const lines: string[] = [];
  const sanitize = (str: string) => str.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  lines.push(`// =========================================================`);
  lines.push(`// Workspace Neural Graph - Neo4j Cypher Export`);
  lines.push(`// Project: ${workspaceName}`);
  lines.push(`// Date: ${new Date().toISOString()}`);
  lines.push(`// =========================================================\n`);

  lines.push(`// --- Constraints & Indexes ---`);
  lines.push(
    `CREATE CONSTRAINT unique_file_path IF NOT EXISTS FOR (f:File) REQUIRE f.id IS UNIQUE;`,
  );
  lines.push(
    `CREATE CONSTRAINT unique_folder_path IF NOT EXISTS FOR (d:Folder) REQUIRE d.id IS UNIQUE;`,
  );
  lines.push(
    `CREATE CONSTRAINT unique_author_name IF NOT EXISTS FOR (a:Author) REQUIRE a.name IS UNIQUE;\n`,
  );

  lines.push(`// --- Workspace Root ---`);
  lines.push(
    `MERGE (w:Workspace { id: '${sanitize(data.rootId)}', name: '${sanitize(workspaceName)}' });\n`,
  );

  lines.push(`// --- Nodes: Folders & Files ---`);
  for (const node of data.nodes) {
    if (node.type === "root") continue;

    const safeId = sanitize(node.id);
    const safeName = sanitize(node.name);

    if (node.type === "folder") {
      lines.push(`MERGE (:Folder { id: '${safeId}', name: '${safeName}' });`);
    } else {
      const ext = sanitize(node.extension || "");
      const linesOfCode = node.lineCount || 0;
      const mi = node.complexity?.maintainabilityIndex ?? 100;
      const cc = node.complexity?.cyclomaticComplexity ?? 1;
      const churnScore = node.churn?.hotspotScore ?? 0;
      const isCircular = node.isCircular ? "true" : "false";

      lines.push(
        `MERGE (f:File { id: '${safeId}' }) ` +
          `ON CREATE SET f.name = '${safeName}', f.ext = '${ext}', f.loc = ${linesOfCode}, ` +
          `f.maintainability = ${mi}, f.cyclomatic = ${cc}, f.churnScore = ${churnScore}, f.isCircular = ${isCircular};`,
      );

      // Connect Authors if available
      if (node.churn?.ownership?.primaryAuthor) {
        const authorName = sanitize(node.churn.ownership.primaryAuthor);
        lines.push(
          `MERGE (a:Author { name: '${authorName}' }) ` + `MERGE (f)-[:AUTHORED_BY]->(a);`,
        );
      }
    }
  }

  lines.push(`\n// --- Hierarchy & Dependency Relationships ---`);
  for (const link of data.links) {
    const src = sanitize(typeof link.source === "string" ? link.source : (link.source as any).id);
    const tgt = sanitize(typeof link.target === "string" ? link.target : (link.target as any).id);

    if (link.type === "hierarchy") {
      lines.push(
        `MATCH (parent { id: '${src}' }), (child { id: '${tgt}' }) ` +
          `MERGE (parent)-[:CONTAINS]->(child);`,
      );
    } else {
      const relType = link.isCircular ? "CIRCULAR_DEPENDS_ON" : "DEPENDS_ON";
      lines.push(
        `MATCH (a:File { id: '${src}' }), (b:File { id: '${tgt}' }) ` +
          `MERGE (a)-[:${relType} { importType: '${sanitize(link.type)}' }]->(b);`,
      );
    }
  }

  return lines.join("\n");
}
