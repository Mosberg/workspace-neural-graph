import * as path from "path";
import * as fs from "fs";

export interface DependencyLink {
  source: string; // Absolute path
  target: string; // Absolute path or resolved virtual identifier
  type: "import" | "require" | "style" | "generic";
}

export function parseDependencies(filePath: string, workspaceRoot: string): DependencyLink[] {
  const links: DependencyLink[] = [];
  const ext = path.extname(filePath).toLowerCase();

  // Only parse text-based code/config files
  if (
    ![".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".css", ".scss", ".json", ".md"].includes(ext)
  ) {
    return links;
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");

    // Regex patterns for JS/TS/CSS
    const importRegex =
      /(?:import\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"])|(?:require\(['"]([^'"]+)['"]\))/g;
    let match;

    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1] || match[2];
      if (!importPath) continue;

      const resolved = resolveImport(importPath, path.dirname(filePath), workspaceRoot);
      if (resolved) {
        links.push({
          source: filePath,
          target: resolved,
          type: match[1] ? "import" : "require",
        });
      }
    }
  } catch {
    // Skip unreadable / binary files
  }

  return links;
}

function resolveImport(
  importTarget: string,
  currentDir: string,
  workspaceRoot: string,
): string | null {
  // Relative path resolution
  if (importTarget.startsWith(".")) {
    const fullCandidate = path.resolve(currentDir, importTarget);
    const candidates = [
      fullCandidate,
      `${fullCandidate}.ts`,
      `${fullCandidate}.js`,
      `${fullCandidate}.tsx`,
      `${fullCandidate}.jsx`,
      path.join(fullCandidate, "index.ts"),
      path.join(fullCandidate, "index.js"),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
  }
  return null;
}
