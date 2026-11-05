import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { parseDependencies, DependencyLink } from "./dependencyParser";

export interface GraphNode {
  id: string; // Absolute path
  name: string; // File/Folder name
  type: "file" | "folder";
  parent?: string; // Parent folder path
  size?: number;
  extension?: string;
}

export interface WorkspaceGraphData {
  nodes: GraphNode[];
  links: { source: string; target: string; type: string }[];
}

const IGNORE_PATTERNS = ["node_modules", ".git", ".vscode", "dist", "out", "build", ".DS_Store"];

export async function scanWorkspace(): Promise<WorkspaceGraphData> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return { nodes: [], links: [] };
  }

  const nodes: GraphNode[] = [];
  const links: { source: string; target: string; type: string }[] = [];
  const rootPath = folders[0].uri.fsPath;

  function walkDir(dir: string, parentId?: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (IGNORE_PATTERNS.includes(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        nodes.push({
          id: fullPath,
          name: entry.name,
          type: "folder",
          parent: parentId,
        });

        if (parentId) {
          links.push({ source: parentId, target: fullPath, type: "hierarchy" });
        }

        walkDir(fullPath, fullPath);
      } else if (entry.isFile()) {
        const stats = fs.statSync(fullPath);
        nodes.push({
          id: fullPath,
          name: entry.name,
          type: "file",
          parent: parentId,
          size: stats.size,
          extension: path.extname(entry.name),
        });

        if (parentId) {
          links.push({ source: parentId, target: fullPath, type: "hierarchy" });
        }

        // Extract cross-file references & dependencies
        const deps = parseDependencies(fullPath, rootPath);
        deps.forEach((dep) => {
          links.push({
            source: dep.source,
            target: dep.target,
            type: dep.type,
          });
        });
      }
    }
  }

  walkDir(rootPath);
  return { nodes, links };
}
