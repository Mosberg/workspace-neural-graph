import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { execSync } from "node:child_process";
import { parseDependencies } from "./dependencyParser";

export type GitStatus = "modified" | "untracked" | "added" | "deleted" | "clean";

export interface GraphNode {
  id: string;
  name: string;
  type: "file" | "folder" | "root";
  parent?: string;
  size?: number;
  extension?: string;
  isCircular?: boolean;
  gitStatus?: GitStatus;
}

export interface GraphLink {
  source: string;
  target: string;
  type: string;
  isCircular?: boolean;
}

export interface WorkspaceGraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  rootId: string;
  stats: {
    totalFiles: number;
    totalFolders: number;
    circularCount: number;
  };
}

function getGitStatuses(rootPath: string): Map<string, GitStatus> {
  const gitMap = new Map<string, GitStatus>();
  try {
    const output = execSync("git status --porcelain -uall", {
      cwd: rootPath,
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });

    const lines = output.split("\n");
    for (const line of lines) {
      if (!line || line.length < 4) continue;
      const code = line.substring(0, 2).trim();
      const relPath = line.substring(3).trim().replace(/^"|"$/g, "");
      const absPath = path.resolve(rootPath, relPath);

      let status: GitStatus = "clean";
      if (code === "??") status = "untracked";
      else if (code === "M" || code.includes("M")) status = "modified";
      else if (code === "A") status = "added";
      else if (code === "D") status = "deleted";

      gitMap.set(absPath, status);
    }
  } catch {
    // Not a git repo or git not found; gracefully degrade
  }
  return gitMap;
}

export async function scanWorkspace(): Promise<WorkspaceGraphData> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return {
      nodes: [],
      links: [],
      rootId: "__ROOT__",
      stats: { totalFiles: 0, totalFolders: 0, circularCount: 0 },
    };
  }

  const config = vscode.workspace.getConfiguration("neuralGraph");
  const ignorePatterns: string[] = config.get("excludePatterns") || [];
  const maxKB: number = config.get("maxFileSizeKB") || 1024;
  const detectLoops: boolean = config.get("detectCircularDependencies") ?? true;

  const rootPath = folders[0].uri.fsPath;
  const gitMap = getGitStatuses(rootPath);

  // Guaranteed single virtual root to prevent D3 stratify failure
  const rootId = "__WORKSPACE_ROOT__";
  const nodes: GraphNode[] = [
    {
      id: rootId,
      name: path.basename(rootPath),
      type: "root",
      gitStatus: "clean",
    },
  ];
  const links: GraphLink[] = [];

  let totalFiles = 0;
  let totalFolders = 0;

  function walkDir(dir: string, parentId: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (ignorePatterns.includes(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        totalFolders++;
        nodes.push({
          id: fullPath,
          name: entry.name,
          type: "folder",
          parent: parentId,
          gitStatus: "clean",
        });

        links.push({ source: parentId, target: fullPath, type: "hierarchy" });
        walkDir(fullPath, fullPath);
      } else if (entry.isFile()) {
        totalFiles++;
        let stats: fs.Stats | undefined;
        try {
          stats = fs.statSync(fullPath);
        } catch {}

        const gStatus = gitMap.get(fullPath) || "clean";

        nodes.push({
          id: fullPath,
          name: entry.name,
          type: "file",
          parent: parentId,
          size: stats?.size || 0,
          extension: path.extname(entry.name).toLowerCase(),
          gitStatus: gStatus,
        });

        links.push({ source: parentId, target: fullPath, type: "hierarchy" });

        const deps = parseDependencies(fullPath, rootPath, maxKB * 1024);
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

  walkDir(rootPath, rootId);

  // Circular Dependency Analysis
  let circularCycles = 0;
  if (detectLoops) {
    const depLinks = links.filter((l) => l.type !== "hierarchy");
    const circularNodeIds = findCyclesTarjan(depLinks);
    circularCycles = circularNodeIds.size;

    nodes.forEach((n) => {
      if (circularNodeIds.has(n.id)) n.isCircular = true;
    });

    links.forEach((l) => {
      if (
        circularNodeIds.has(l.source) &&
        circularNodeIds.has(l.target) &&
        l.type !== "hierarchy"
      ) {
        l.isCircular = true;
      }
    });
  }

  return {
    nodes,
    links,
    rootId,
    stats: { totalFiles, totalFolders, circularCount: circularCycles },
  };
}

function findCyclesTarjan(links: GraphLink[]): Set<string> {
  const adj = new Map<string, string[]>();
  links.forEach((l) => {
    if (!adj.has(l.source)) adj.set(l.source, []);
    adj.get(l.source)!.push(l.target);
  });

  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cyclicNodes = new Set<string>();

  function strongConnect(v: string) {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    const neighbors = adj.get(v) || [];
    for (const w of neighbors) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);

      if (scc.length > 1 || adj.get(v)?.includes(v)) {
        scc.forEach((node) => cyclicNodes.add(node));
      }
    }
  }

  for (const node of adj.keys()) {
    if (!indices.has(node)) strongConnect(node);
  }

  return cyclicNodes;
}
