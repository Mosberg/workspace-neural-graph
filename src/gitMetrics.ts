import { exec } from "node:child_process";
import * as path from "node:path";
import { GitMetrics, GitStatus, AuthorOwnership } from "./types";

function execPromise(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = exec(command, { cwd, encoding: "utf8", timeout: timeoutMs }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

export async function getGitMetrics(rootPath: string): Promise<{
  metrics: Map<string, GitMetrics>;
  statuses: Map<string, GitStatus>;
  authorCounts: Map<string, number>;
}> {
  const metrics = new Map<string, GitMetrics>();
  const statuses = new Map<string, GitStatus>();
  const authorCounts = new Map<string, number>();

  // 1. Status
  try {
    const statusOutput = await execPromise(
      "git status --porcelain -uall",
      rootPath,
      3000,
    );

    for (const line of statusOutput.split("\n")) {
      if (!line || line.length < 4) continue;
      const code = line.substring(0, 2).trim();
      const relPath = line.substring(3).trim().replace(/^"|"$/g, "");
      const absPath = path.resolve(rootPath, relPath);

      let s: GitStatus = "clean";
      if (code === "??") s = "untracked";
      else if (code.includes("M")) s = "modified";
      else if (code === "A") s = "added";
      else if (code === "D") s = "deleted";
      statuses.set(absPath, s);
    }
  } catch {
    // Not a git repository or git not available
  }

  // 2. Churn commits & lines (last 90 days)
  try {
    const logOutput = await execPromise(
      'git log --since="90 days ago" --numstat --pretty=format:"--%h|%an"',
      rootPath,
      10000,
    );

    let maxChurn = 1;
    const fileAuthorCommits = new Map<string, Map<string, number>>();

    for (const block of logOutput.split("--")) {
      if (!block.trim()) continue;
      const lines = block.split("\n");
      const header = lines[0];
      const author = header.split("|")[1] || "Unknown";

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].trim().split(/\s+/);
        if (parts.length >= 3) {
          const added = parseInt(parts[0], 10) || 0;
          const deleted = parseInt(parts[1], 10) || 0;
          const relPath = parts[2];
          const absPath = path.resolve(rootPath, relPath);

          const existing = metrics.get(absPath) || {
            commitCount: 0,
            linesChanged: 0,
            hotspotScore: 0,
          };

          existing.commitCount += 1;
          existing.linesChanged += added + deleted;
          metrics.set(absPath, existing);

          if (existing.commitCount > maxChurn) maxChurn = existing.commitCount;

          if (!fileAuthorCommits.has(absPath)) fileAuthorCommits.set(absPath, new Map());
          const authorMap = fileAuthorCommits.get(absPath)!;
          authorMap.set(author, (authorMap.get(author) || 0) + 1);
        }
      }
    }

    // Build Author Ownership Details
    metrics.forEach((m, absPath) => {
      m.hotspotScore = parseFloat((m.commitCount / maxChurn).toFixed(2));

      const authorMap = fileAuthorCommits.get(absPath);
      if (authorMap && authorMap.size > 0) {
        let dominantAuthor = "Unknown";
        let topCommits = 0;
        let totalCommits = 0;
        const contributors: { name: string; commits: number; percent: number }[] = [];

        authorMap.forEach((commits, author) => {
          totalCommits += commits;
          if (commits > topCommits) {
            topCommits = commits;
            dominantAuthor = author;
          }
        });

        authorMap.forEach((commits, author) => {
          contributors.push({
            name: author,
            commits,
            percent: Math.round((commits / Math.max(1, totalCommits)) * 100),
          });
        });

        contributors.sort((a, b) => b.commits - a.commits);

        m.ownership = {
          primaryAuthor: dominantAuthor,
          authorsCount: authorMap.size,
          topContributors: contributors,
        };

        authorCounts.set(dominantAuthor, (authorCounts.get(dominantAuthor) || 0) + 1);
      }
    });
  } catch {
    // Git log failed
  }

  return { metrics, statuses, authorCounts };
}
