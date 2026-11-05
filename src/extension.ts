import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { statSync } from "node:fs";
import { scanWorkspace } from "./workspaceScanner";
import { generateADRMarkdown } from "./adrGenerator";
import { generateStandaloneHTML } from "./htmlExporter";
import { generateCypherScript } from "./cypherExporter";
import { WorkspaceGraphData } from "./types";

let currentPanel: vscode.WebviewPanel | undefined;
let rootDirCache: string | null = null;

function getRootDir(): string {
  if (rootDirCache) return rootDirCache;
  const folder = vscode.workspace.workspaceFolders?.[0];
  rootDirCache = folder ? folder.uri.fsPath : "";
  return rootDirCache;
}

async function broadcastGraph(): Promise<void> {
  if (!currentPanel) return;
  try {
    const data: WorkspaceGraphData = await scanWorkspace();
    const config = vscode.workspace.getConfiguration("neuralGraph");
    const defaultLayout = config.get<string>("defaultLayout") || "force";
    try {
      currentPanel.webview.postMessage({
        command: "updateGraph",
        data,
        defaultLayout,
      });
    } catch (postErr: any) {
      if (currentPanel) {
        void vscode.window.showWarningMessage(
          `Failed to send graph to webview: ${postErr.message}`,
        );
      }
    }
  } catch (err: any) {
    void vscode.window.showErrorMessage(`Workspace scan failed: ${err.message}`);
  }
}

export function activate(context: vscode.ExtensionContext) {
    const openCommand = vscode.commands.registerCommand(
      "workspaceNeuralGraph.openView",
      async () => {
        if (currentPanel) {
          currentPanel.reveal(vscode.ViewColumn.One);
          return;
        }

        currentPanel = vscode.window.createWebviewPanel(
          "workspaceNeuralGraph",
          "Neural Workspace Visualizer",
          vscode.ViewColumn.One,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
              vscode.Uri.file(path.join(context.extensionPath, "media")),
            ],
          },
        );

        const scriptUri = currentPanel.webview.asWebviewUri(
          vscode.Uri.file(path.join(context.extensionPath, "media", "main.js")),
        );
        const styleUri = currentPanel.webview.asWebviewUri(
          vscode.Uri.file(path.join(context.extensionPath, "media", "style.css")),
        );

        currentPanel.webview.html = getWebviewHtml(
          scriptUri,
          styleUri,
          context.extensionPath,
        );

        currentPanel.webview.onDidReceiveMessage(async (msg) => {
          const rootDir = getRootDir();

          try {
            switch (msg.command) {
              case "ready":
              case "rescan":
                await broadcastGraph();
                break;

              case "openFile": {
              try {
                const doc = await vscode.workspace.openTextDocument(msg.path);
                await vscode.window.showTextDocument(doc);
              } catch (e: any) {
                void vscode.window.showErrorMessage(`Failed to open: ${e.message}`);
              }
              break;
            }

            case "requestCreateNode": {
              const type: "file" | "folder" = msg.type;
              let targetDir: string = msg.targetDir;

              if (!targetDir || targetDir === "__WORKSPACE_ROOT__") {
                targetDir = rootDir;
              }

              const inputName = await vscode.window.showInputBox({
                prompt: `Enter new ${type} name (creating in: ${path.basename(targetDir)})`,
                placeHolder: type === "file" ? "module.ts" : "new-folder",
              });

              if (!inputName) return;

              const fullPath = path.join(targetDir, inputName);
              try {
                if (type === "folder") {
                  await fs.mkdir(fullPath, { recursive: true });
                } else {
                  await fs.writeFile(fullPath, "", "utf8");
                }
                void vscode.window.showInformationMessage(
                  `Created ${type}: ${inputName}`,
                );
                await broadcastGraph();
              } catch (err: any) {
                void vscode.window.showErrorMessage(
                  `Error creating ${type}: ${err.message}`,
                );
              }
              break;
            }

            case "requestRename": {
              const oldPath: string = msg.oldPath;
              const oldName = path.basename(oldPath);
              const newName = await vscode.window.showInputBox({
                prompt: `Rename ${oldName} to:`,
                value: oldName,
              });

              if (!newName || newName === oldName) return;

              const newPath = path.join(path.dirname(oldPath), newName);
              try {
                await fs.rename(oldPath, newPath);
                void vscode.window.showInformationMessage(`Renamed to ${newName}`);
                await broadcastGraph();
              } catch (err: any) {
                void vscode.window.showErrorMessage(`Rename failed: ${err.message}`);
              }
              break;
            }

            case "deleteNode": {
              const target = msg.path;
              const confirm = await vscode.window.showWarningMessage(
                `Delete ${path.basename(target)}?`,
                { modal: true },
                "Delete",
              );

              if (confirm !== "Delete") return;

              try {
                const stat = statSync(target);
                if (stat.isDirectory()) {
                  await fs.rm(target, { recursive: true, force: true });
                } else {
                  await fs.unlink(target);
                }
                void vscode.window.showInformationMessage(
                  `Deleted: ${path.basename(target)}`,
                );
                await broadcastGraph();
              } catch (err: any) {
                void vscode.window.showErrorMessage(`Error deleting: ${err.message}`);
              }
              break;
            }

            case "exportData": {
              const uri = await vscode.window.showSaveDialog({
                filters: { "JSON Files": ["json"] },
              });
              if (uri) {
                await fs.writeFile(
                  uri.fsPath,
                  JSON.stringify(msg.data, null, 2),
                  "utf8",
                );
                void vscode.window.showInformationMessage(
                  "Graph exported successfully.",
                );
              }
              break;
            }

            case "exportCypher": {
              const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(
                  path.join(rootDir, "workspace-graph.cql"),
                ),
                filters: { "Neo4j Cypher": ["cql", "cypher"] },
              });
              if (uri) {
                const cypher = generateCypherScript(
                  msg.data,
                  path.basename(rootDir),
                );
                await fs.writeFile(uri.fsPath, cypher, "utf8");
                void vscode.window.showInformationMessage(
                  "Exported Neo4j Cypher queries.",
                );
              }
              break;
            }

            case "exportADR": {
              const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(
                  path.join(rootDir, "ARCHITECTURE_RECORD.md"),
                ),
                filters: { Markdown: ["md"] },
              });
              if (uri) {
                const adrContent = generateADRMarkdown(
                  msg.data,
                  path.basename(rootDir),
                );
                await fs.writeFile(uri.fsPath, adrContent, "utf8");
                void vscode.window.showInformationMessage(
                  "Generated Architecture Decision Record (ADR).",
                );
              }
              break;
            }

            case "exportHTML": {
              const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(
                  path.join(rootDir, "workspace-neural-graph.html"),
                ),
                filters: { "HTML Webpage": ["html"] },
              });
              if (uri) {
                const htmlContent = generateStandaloneHTML(
                  msg.data,
                  context.extensionPath,
                );
                await fs.writeFile(uri.fsPath, htmlContent, "utf8");
                void vscode.window.showInformationMessage(
                  "Exported self-contained interactive HTML page.",
                );
              }
              break;
            }

            case "exportImage": {
              const format: "png" | "svg" = msg.format;
              const defaultName = `workspace-graph.${format}`;
              const filters =
                format === "png"
                  ? { "PNG Image": ["png"] }
                  : { "SVG Image": ["svg"] };

              const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.join(rootDir, defaultName)),
                filters: { Image: ["png", "svg"] },
              });

              if (uri) {
                try {
                  if (format === "png") {
                    const base64Data = msg.data.replace(
                      /^data:image\/png;base64,/,
                      "",
                    );
                    await fs.writeFile(
                      uri.fsPath,
                      Buffer.from(base64Data, "base64"),
                    );
                  } else {
                    await fs.writeFile(uri.fsPath, msg.data, "utf8");
                  }
                  void vscode.window.showInformationMessage(
                    `Exported graph as ${format.toUpperCase()}`,
                  );
                } catch (err: any) {
                  void vscode.window.showErrorMessage(
                    `Export failed: ${err.message}`,
                  );
                }
              }
              break;
            }
          }
        } catch (err: any) {
          void vscode.window.showErrorMessage(`Command failed: ${err.message}`);
        }
      });

      currentPanel.onDidDispose(() => {
        currentPanel = undefined;
        rootDirCache = null;
      });

      context.subscriptions.push(openCommand);
    },
  );

  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/{src,app,lib,components,pages,public,media,*.ts,*.js,*.json,*.py,*.rs,*.c,*.cpp,*.h,*.css,*.scss,*.html}",
  );

  const isIgnored = (uri: vscode.Uri) => {
    const p = uri.fsPath;
    const sep = path.sep;
    return (
      p.includes(`${sep}out${sep}`) ||
      p.includes(`${sep}dist${sep}`) ||
      p.includes(`${sep}.git${sep}`) ||
      p.includes(`${sep}node_modules${sep}`) ||
      p.includes(`${sep}.vscode${sep}`)
    );
  };

  const handleWatchChange = (uri: vscode.Uri) => {
    if (!isIgnored(uri)) debounceScan();
  };

  watcher.onDidCreate(handleWatchChange);
  watcher.onDidDelete(handleWatchChange);
  watcher.onDidChange(handleWatchChange);

  context.subscriptions.push(openCommand, watcher);
}

export function deactivate(): void {
  if (currentPanel) {
    currentPanel.dispose();
    currentPanel = undefined;
  }
  rootDirCache = null;
}

let debounceTimer: NodeJS.Timeout | undefined;
function debounceScan() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void broadcastGraph();
  }, 700);
}

function getWebviewHtml(
  scriptUri: vscode.Uri,
  styleUri: vscode.Uri,
  extensionPath: string,
): string {
  const nonce = Array.from(
    { length: 16 },
    () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[
      Math.floor(Math.random() * 62)
    ],
  ).join("");
  let html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource(
    styleUri,
  )} 'unsafe-inline'; script-src ${cspSource(scriptUri)} 'nonce-${nonce}'; img-src data: https:; connect-src 'self';"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Neural Workspace Visualizer</title><link rel="stylesheet" href="${styleUri}"></head><body><div id="app-container"><div id="control-bar"><div class="group"><span class="brand">⚡ Neural Graph</span><span class="group" id="layout-group"><select id="layout-select"><option value="force">Force-Directed</option><option value="tree">Tree</option><option value="radial">Radial</option></select></span><input type="text" id="search-box" placeholder="Search files..."><button id="btn-rescan">🔄 Rescan</button></div><div class="group" id="export-group"><button id="btn-export-menu">⬇️ Export</button><div id="export-dropdown" class="dropdown-content hidden"><button class="dropdown-item" id="export-json">JSON</button><button class="dropdown-item" id="export-cypher">Neo4j Cypher</button><button class="dropdown-item" id="export-adr">ADR Markdown</button><button class="dropdown-item" id="export-html">Standalone HTML</button><button class="dropdown-item" id="export-svg">SVG Image</button><button class="dropdown-item" id="export-png">PNG Image</button></div></div></div><div id="physics-panel"><div class="slider-group"><label>Charge</label><input type="range" id="slider-charge" min="-500" max="0" value="-180" step="10" /></div><div class="slider-group"><label>Link Distance</label><input type="range" id="slider-link" min="20" max="200" value="60" step="10" /></div><div class="slider-group"><label>Collision</label><input type="range" id="slider-collide" min="5" max="100" value="20" step="5" /></div><div class="slider-group"><label>Bloom</label><input type="range" id="slider-bloom" min="0" max="4" value="1.5" step="0.1" /></div><button id="btn-freeze-sim" class="btn-sm">⏸️ Freeze</button><button id="btn-reset-physics" class="btn-sm">Reset</button></div><main id="stage"><svg id="viewport"></svg><div id="stage-3d" class="hidden"></div><div id="minimap-container"><svg id="minimap"></svg></div><div id="stats-badge"><span id="stat-files">0 Files</span> | <span id="stat-folders">0 Folders</span> | <span id="stat-cycles" class="cycle-warn">0 Cycles</span> | <span id="stat-maintainability">MI: 100/100</span> | <span id="stat-cache" class="cache-badge">⚡ 0 Cached</span></div><aside id="inspector" class="collapsed"><div class="inspector-header"><h3 id="node-name">Details</h3><button id="close-inspector">✕</button></div><div class="inspector-body"><div class="field"><label>Path:</label><span id="node-path">-</span></div><div class="field"><label>Primary Owner / Author:</label><span id="node-owner" class="badge-author">-</span></div><div class="field"><label>Maintainability &amp; Complexity:</label><span id="node-complexity">-</span></div><div class="field"><label>Git Status / Churn:</label><span id="node-git">-</span></div><div id="refactor-panel" class="hidden refactor-box"><h4>⚡ Automated Refactoring Recommendation</h4><p id="refactor-reason" class="refactor-desc"></p><ul id="refactor-steps" class="refactor-list"></ul><pre id="refactor-code" class="refactor-code-snippet"></pre></div><div class="dep-section"><h4>Incoming Dependencies (<span id="in-count">0</span>)</h4><ul id="incoming-list"></ul></div><div class="dep-section"><h4>Outgoing Dependencies (<span id="out-count">0</span>)</h4><ul id="outgoing-list"></ul></div><div class="panel-buttons"><button id="btn-open-code" class="btn-primary">Open Editor</button><button id="btn-rename" class="btn-secondary">Rename</button><button id="btn-delete" class="btn-danger">Delete</button></div></div></aside><button id="btn-exit-presentation" class="hidden">Exit Presentation (Esc)</button></main></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
  return html;
}

function cspSource(uri: vscode.Uri): string {
  return uri.toString();
}
