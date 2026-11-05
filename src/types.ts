export type GitStatus = "modified" | "untracked" | "added" | "deleted" | "clean";

export interface AuthorOwnership {
  primaryAuthor: string;
  authorsCount: number;
  topContributors: { name: string; commits: number; percent: number }[];
}

export interface GitMetrics {
  commitCount: number;
  linesChanged: number;
  lastCommitDate?: string;
  hotspotScore: number;
  ownership?: AuthorOwnership;
}

export interface CodeComplexity {
  cyclomaticComplexity: number;
  maintainabilityIndex: number;
  halstead: {
    vocabulary: number;
    length: number;
    volume: number;
    difficulty: number;
    effort: number;
  };
  riskLevel: "low" | "moderate" | "high" | "critical";
}

export interface CycleRefactorAdvice {
  cycleId: string;
  participants: string[];
  suggestedPattern:
    | "extract-interface"
    | "extract-shared-leaf"
    | "dependency-injection"
    | "dynamic-import";
  reason: string;
  actionableSteps: string[];
  codeTemplate?: string;
}

export interface GraphNode {
  id: string;
  name: string;
  type: "file" | "folder" | "root";
  parent?: string;
  size?: number;
  extension?: string;
  isCircular?: boolean;
  gitStatus?: GitStatus;
  churn?: GitMetrics;
  lineCount?: number;
  complexity?: CodeComplexity;
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
  cycleAdvices?: CycleRefactorAdvice[];
  stats: {
    totalFiles: number;
    totalFolders: number;
    circularCount: number;
    cachedHits: number;
    topHotspots: { name: string; score: number }[];
    avgMaintainability: number;
    authorStats?: { name: string; filesOwned: number }[];
  };
}
