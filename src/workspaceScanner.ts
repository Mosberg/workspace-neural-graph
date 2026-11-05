import * as vscode from "vscode";
import * as path from "node:path";
import { stat, readdir, readFile } from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import { parseDependencies, DependencyLink } from "./dependencyParser";
import { getGitMetrics } from "./gitMetrics";
import { analyzeCodeMetrics } from "./astMetrics";
import { analyzeCyclesAndProposeRefactoring } from "./cycleBreaker";
import { GraphNode, GraphLink, WorkspaceGraphData, CodeComplexity } from "./types";

interface FileCacheEntry {
  mtimeMs: number;
  size: number;
  lineCount: number;
  dependencies: DependencyLink[];
  complexity?: CodeComplexity;
}

const fileCache = new Map<string, FileCacheEntry>();
const MAX_NODES_ALLOWED = 4000;
const CHUNK_SIZE = 50;

function isIgnored(name: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.includes(name);
}

export async function scanWorkspace(): Promise<WorkspaceGraphData> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return {
        nodes: [],
        links: [],
        rootId: "__WORKSPACE_ROOT__",
        stats: {
          totalFiles: 0,
          totalFolders: 0,
          circularCount: 0,
          cachedHits: 0,
          topHotspots: [],
          avgMaintainability: 100,
        },
      };
    }

    const config = vscode.workspace.getConfiguration("neuralGraph");
    const ignorePatterns: string[] = config.get("excludePatterns") || [
      "node_modules",
      ".git",
      ".vscode",
      "dist",
      "out",
      "build",
      ".cache",
      "__pycache__",
      "target",
      "vendor",
    ];
    const maxKB: number = config.get("maxFileSizeKB") || 1024;
    const detectLoops: boolean = config.get("detectCircularDependencies") ?? true;

    const rootPath = folders[0].uri.fsPath;
    const { metrics: gitMetrics, statuses: gitMap, authorCounts } = await getGitMetrics(rootPath);

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
    let cachedHits = 0;
    let totalMaintainability = 0;
    let scoredFiles = 0;
    const seenPaths = new Set<string>();

    async function walkDir(dir: string, parentId: string): Promise<void> {
      if (nodes.length >= MAX_NODES_ALLOWED) return;

      let entries: Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
        if (nodes.length >= MAX_NODES_ALLOWED) break;

        const chunk = entries.slice(i, i + CHUNK_SIZE);
        await Promise.all(
          chunk.map(async (entry) => {
            if (nodes.length >= MAX_NODES_ALLOWED) return;
            if (isIgnored(entry.name, ignorePatterns)) return;

            const fullPath = path.join(dir, entry.name);
            seenPaths.add(fullPath);

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
              await walkDir(fullPath, fullPath);
            } else if (entry.isFile()) {
              totalFiles++;
              let stats: Stats | undefined;
              try {
                stats = await stat(fullPath);
              } catch {}

              const gStatus = gitMap.get(fullPath) || "clean";
              const churnData = gitMetrics.get(fullPath);
              const ext = path.extname(entry.name).toLowerCase();
              const fileSize = stats?.size || 0;
              const mtime = stats?.mtimeMs || 0;

              let deps: DependencyLink[];
              let linesOfCode = 0;
              let complexityData: CodeComplexity | undefined;

              const cached = fileCache.get(fullPath);
              if (cached && cached.mtimeMs === mtime && cached.size === fileSize) {
                deps = cached.dependencies;
                linesOfCode = cached.lineCount;
                complexityData = cached.complexity;
                cachedHits++;
              } else {
                deps = await parseDependencies(fullPath, rootPath, maxKB * 1024);
                try {
                  const content = await readFile(fullPath, "utf8");
                  linesOfCode = content.split("\n").length;
                } catch {
                  linesOfCode = 0;
                }
                complexityData = await analyzeCodeMetrics(fullPath);
            fileCache.set(fullPath, {
              mtimeMs: mtime,
              size: fileSize,
              lineCount: linesOfCode,
              dependencies: deps,
              complexity: complexityData,
            });
          }

          if (complexityData) {
            totalMaintainability += complexityData.maintainabilityIndex;
            scoredFiles++;
          }

          nodes.push({
            id: fullPath,
            name: entry.name,
            type: "file",
            parent: parentId,
            size: fileSize,
            extension: ext,
            gitStatus: gStatus,
            churn: churnData,
            lineCount: linesOfCode,
            complexity: complexityData,
          });

          links.push({ source: parentId, target: fullPath, type: "hierarchy" });

          deps.forEach((dep) => {
            links.push({
              source: dep.source,
              target: dep.target,
              type: dep.type,
            });
          });
        }
      }),
      );
    }
  }

  await walkDir(rootPath, rootId);

    for (const cachedPath of fileCache.keys()) {
      if (!seenPaths.has(cachedPath)) fileCache.delete(cachedPath);
    }

    // Circular Dependency Analysis (iterative Tarjan's SCC)
    let circularCycles = 0;
    let cycleAdvices;
    if (detectLoops) {
      const depLinks = links.filter((l) => l.type !== "hierarchy");
      const circularNodeIds = findCyclesTarjanIterative(depLinks);
      circularCycles = circularNodeIds.size;

      nodes.forEach((n) => {
        if (circularNodeIds.has(n.id)) n.isCircular = true;
      });

      const circularLinks: GraphLink[] = [];
      links.forEach((l) => {
        if (
          circularNodeIds.has(l.source) &&
          circularNodeIds.has(l.target) &&
          l.type !== "hierarchy"
        ) {
          l.isCircular = true;
          circularLinks.push(l);
        }
      });

      cycleAdvices = analyzeCyclesAndProposeRefactoring(circularLinks);
    }

    const topHotspots = nodes
      .filter((n) => n.churn && n.churn.hotspotScore > 0)
      .sort((a, b) => (b.churn?.hotspotScore || 0) - (a.churn?.hotspotScore || 0))
      .slice(0, 6)
      .map((n) => ({ name: n.name, score: n.churn!.hotspotScore }));

    const authorStats = Array.from(authorCounts.entries())
      .map(([name, filesOwned]) => ({ name, filesOwned }))
      .sort((a, b) => b.filesOwned - a.filesOwned);

    return {
      nodes,
      links,
      rootId,
      cycleAdvices,
      stats: {
        totalFiles,
        totalFolders,
        circularCount: circularCycles,
        cachedHits,
        topHotspots,
        avgMaintainability: scoredFiles > 0 ? Math.round(totalMaintainability / scoredFiles) : 100,
        authorStats,
      },
    };
}

function findCyclesTarjanIterative(links: GraphLink[]): Set<string> {
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
  const callStack: { v: string; neighborIdx: number }[] = [];

  for (const startNode of adj.keys()) {
    if (indices.has(startNode)) continue;

    callStack.push({ v: startNode, neighborIdx: 0 });

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1];
      const { v } = frame;

      if (frame.neighborIdx === 0) {
        indices.set(v, index);
        lowlink.set(v, index);
        index++;
        stack.push(v);
        onStack.add(v);
      }

      const neighbors = adj.get(v) || [];
      let advanced = false;

      while (frame.neighborIdx < neighbors.length) {
        const w = neighbors[frame.neighborIdx];
        frame.neighborIdx++;

        if (!indices.has(w)) {
          callStack.push({ v: w, neighborIdx: 0 });
          advanced = true;
          break;
        } else if (onStack.has(w)) {
          lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
        }
      }

      if (advanced) continue;

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

      callStack.pop();

      if (callStack.length > 0) {
        const parent = callStack[callStack.length - 1];
        lowlink.set(
          parent.v,
          Math.min(lowlink.get(parent.v)!, lowlink.get(v)!),
        );
      }
    }
  }

  return cyclicNodes;
}
