import * as path from "node:path";
import { stat, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface DependencyLink {
  source: string;
  target: string;
  type: "import" | "require" | "style" | "include" | "use";
}

export async function parseDependencies(
  filePath: string,
  workspaceRoot: string,
  maxBytes: number,
): Promise<DependencyLink[]> {
  const links: DependencyLink[] = [];
  const ext = path.extname(filePath).toLowerCase();

  try {
    const stats = await stat(filePath);
    if (stats.size > maxBytes) return links;

    const content = await readFile(filePath, "utf8");
    const dir = path.dirname(filePath);

    // 1. JavaScript & TypeScript
    if ([".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"].includes(ext)) {
      const jsRegex =
        /(?:import\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"])|(?:require\(['"]([^'"]+)['"]\))|(?:import\(['"]([^'"]+)['"]\))/g;
      let match;
      while ((match = jsRegex.exec(content)) !== null) {
        const target = match[1] || match[2] || match[3];
        if (target) {
          const resolved = resolveJsTs(target, dir, workspaceRoot);
          if (resolved)
            links.push({
              source: filePath,
              target: resolved,
              type: match[2] ? "require" : "import",
            });
        }
      }
    }
    // 2. Python
    else if (ext === ".py") {
      const pyRegex = /^\s*(?:from\s+(\.+[\w.]*|[\w.]+)\s+import|import\s+([\w.]+))/gm;
      let match;
      while ((match = pyRegex.exec(content)) !== null) {
        const rawMod = match[1] || match[2];
        if (rawMod) {
          const resolved = resolvePython(rawMod, dir, workspaceRoot);
          if (resolved) links.push({ source: filePath, target: resolved, type: "import" });
        }
      }
    }
    // 3. C / C++
    else if ([".c", ".cpp", ".cc", ".h", ".hpp"].includes(ext)) {
      const cRegex = /#include\s+["<]([^">]+)[">]/g;
      let match;
      while ((match = cRegex.exec(content)) !== null) {
        const header = match[1];
        const resolved = resolveC(header, dir, workspaceRoot);
        if (resolved) links.push({ source: filePath, target: resolved, type: "include" });
      }
    }
    // 4. Rust
    else if (ext === ".rs") {
      const rsRegex = /mod\s+([a-zA-Z0-9_]+);/g;
      let match;
      while ((match = rsRegex.exec(content)) !== null) {
        const modName = match[1];
        const resolved = resolveRust(modName, dir);
        if (resolved) links.push({ source: filePath, target: resolved, type: "use" });
      }
    }
    // 5. CSS / SCSS
    else if ([".css", ".scss", ".less"].includes(ext)) {
      const cssRegex = /@import\s+['"]([^'"]+)['"]/g;
      let match;
      while ((match = cssRegex.exec(content)) !== null) {
        const resolved = resolveGenericFile(match[1], dir);
        if (resolved) links.push({ source: filePath, target: resolved, type: "style" });
      }
    }
  } catch {
    // Ignore unreadable or locked files
  }

  return links;
}

function resolveJsTs(
  importTarget: string,
  currentDir: string,
  workspaceRoot: string,
): string | null {
  if (importTarget.startsWith(".")) {
    const fullCandidate = path.resolve(currentDir, importTarget);
    const candidates = [
      fullCandidate,
      `${fullCandidate}.ts`,
      `${fullCandidate}.tsx`,
      `${fullCandidate}.js`,
      `${fullCandidate}.jsx`,
      path.join(fullCandidate, "index.ts"),
      path.join(fullCandidate, "index.tsx"),
      path.join(fullCandidate, "index.js"),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  }
  return null;
}

function resolvePython(mod: string, currentDir: string, workspaceRoot: string): string | null {
    if (mod.startsWith(".")) {
      const normalized = mod.replace(/\./g, path.sep);
      const candidate = path.resolve(currentDir, `${normalized}.py`);
      if (existsSync(candidate)) return candidate;
    } else {
      const asPath = mod.replace(/\./g, path.sep);
      const candidates = [
        path.resolve(currentDir, `${asPath}.py`),
        path.resolve(workspaceRoot, `${asPath}.py`),
        path.resolve(workspaceRoot, asPath, "__init__.py"),
      ];
      for (const c of candidates) {
        if (existsSync(c)) return c;
      }
    }
    return null;
}

function resolveC(header: string, currentDir: string, workspaceRoot: string): string | null {
    const candidates = [
      path.resolve(currentDir, header),
      path.resolve(workspaceRoot, header),
      path.resolve(workspaceRoot, "include", header),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    return null;
}

function resolveRust(modName: string, currentDir: string): string | null {
    const candidates = [
      path.resolve(currentDir, `${modName}.rs`),
      path.resolve(currentDir, modName, "mod.rs"),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    return null;
}

function resolveGenericFile(target: string, currentDir: string): string | null {
  const candidate = path.resolve(currentDir, target);
  return existsSync(candidate) ? candidate : null;
}
