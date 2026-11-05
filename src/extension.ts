import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { scanWorkspace } from "./workspaceScanner";

let currentPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  const openCommand = vscode.commands.registerCommand("workspaceNeuralGraph.openView", async () => {
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
        localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, "media"))],
      },
    );

    currentPanel.webview.html = getWebviewHtml(currentPanel.webview, context.extensionPath);

    currentPanel.webview.onDidReceiveMessage(async (msg) => {
      const rootDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";

      switch (msg.command) {
        case "ready":
        case "rescan":
          await broadcastGraph();
          break;

        case "openFile": {
          try {
            const doc = await vscode.workspace.openTextDocument(msg.path);
            vscode.window.showTextDocument(doc);
          } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to open: ${e.message}`);
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
            placeHolder: type === "file" ? "module.ts" : "my-subfolder",
          });

          if (!inputName) return;

          const fullPath = path.join(targetDir, inputName);
          try {
            if (type === "folder") {
              fs.mkdirSync(fullPath, { recursive: true });
            } else {
              fs.writeFileSync(fullPath, "", "utf8");
            }
            vscode.window.showInformationMessage(`Created ${type}: ${inputName}`);
            await broadcastGraph();
          } catch (err: any) {
            vscode.window.showErrorMessage(`Error creating ${type}: ${err.message}`);
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
            fs.renameSync(oldPath, newPath);
            vscode.window.showInformationMessage(`Renamed to ${newName}`);
            await broadcastGraph();
          } catch (err: any) {
            vscode.window.showErrorMessage(`Rename failed: ${err.message}`);
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
            const stat = fs.statSync(target);
            if (stat.isDirectory()) {
              fs.rmSync(target, { recursive: true, force: true });
            } else {
              fs.unlinkSync(target);
            }
            vscode.window.showInformationMessage(`Deleted: ${path.basename(target)}`);
            await broadcastGraph();
          } catch (err: any) {
            vscode.window.showErrorMessage(`Error deleting: ${err.message}`);
          }
          break;
        }

        case "exportData": {
          const uri = await vscode.window.showSaveDialog({
            filters: { "JSON Files": ["json"] },
          });
          if (uri) {
            fs.writeFileSync(uri.fsPath, JSON.stringify(msg.data, null, 2), "utf8");
            vscode.window.showInformationMessage("Graph exported successfully.");
          }
          break;
        }

        case "exportImage": {
          const format: "png" | "svg" = msg.format;
          const defaultName = `workspace-graph.${format}`;
          const filters: { [name: string]: string[] } =
            format === "png" ? { "PNG Image": ["png"] } : { "SVG Image": ["svg"] };

          const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(rootDir, defaultName)),
            filters,
          });

          if (uri) {
            try {
              if (format === "png") {
                const base64Data = msg.data.replace(/^data:image\/png;base64,/, "");
                fs.writeFileSync(uri.fsPath, Buffer.from(base64Data, "base64"));
              } else {
                fs.writeFileSync(uri.fsPath, msg.data, "utf8");
              }
              vscode.window.showInformationMessage(`Exported graph as ${format.toUpperCase()}`);
            } catch (err: any) {
              vscode.window.showErrorMessage(`Export failed: ${err.message}`);
            }
          }
          break;
        }
      }
    });

    currentPanel.onDidDispose(() => {
      currentPanel = undefined;
    });
  });

  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/{src,app,lib,components,pages,public,media,*.ts,*.js,*.json,*.py,*.rs,*.c,*.cpp,*.h,*.css,*.scss,*.html}",
  );

  const isIgnored = (uri: vscode.Uri) => {
    const p = uri.fsPath;
    return (
      p.includes(`${path.sep}out${path.sep}`) ||
      p.includes(`${path.sep}dist${path.sep}`) ||
      p.includes(`${path.sep}.git${path.sep}`) ||
      p.includes(`${path.sep}node_modules${path.sep}`)
    );
  };

  watcher.onDidCreate((uri) => {
    if (!isIgnored(uri)) debounceScan();
  });
  watcher.onDidDelete((uri) => {
    if (!isIgnored(uri)) debounceScan();
  });
  watcher.onDidChange((uri) => {
    if (!isIgnored(uri)) debounceScan();
  });

  context.subscriptions.push(openCommand, watcher);
}

let debounceTimer: NodeJS.Timeout | undefined;
function debounceScan() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    broadcastGraph();
  }, 700);
}

async function broadcastGraph() {
  if (!currentPanel) return;
  const graphData = await scanWorkspace();
  const config = vscode.workspace.getConfiguration("neuralGraph");
  currentPanel.webview.postMessage({
    command: "updateGraph",
    data: graphData,
    defaultLayout: config.get("defaultLayout") || "force",
  });
}

function getWebviewHtml(webview: vscode.Webview, extPath: string): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(extPath, "media", "main.js")));
  const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(extPath, "media", "style.css")));
  const d3Uri = webview.asWebviewUri(vscode.Uri.file(path.join(extPath, "media", "d3.min.js")));

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet" />
    <script src="${d3Uri}"></script>
</head>
<body>
    <div id="app-container">
        <header id="control-bar">
            <div class="group">
                <span class="brand">⚡ NeuralGraph</span>
                <select id="layout-select">
                    <option value="force">Force / Neural Network</option>
                    <option value="tree">Tree Hierarchy</option>
                    <option value="radial">Radial Dendrogram</option>
                </select>
                <button id="btn-physics-toggle" class="btn-toggle" title="Toggle Simulation Physics Settings">⚙️ Physics</button>
            </div>

            <div class="group">
                <input type="text" id="filter-input" placeholder="Search file names (centers camera)..." />
                <label><input type="checkbox" id="chk-deps-only" /> Imports Only</label>
                <label><input type="checkbox" id="chk-circular" /> Cycles Only</label>
            </div>

            <div class="group actions">
                <button id="btn-create-file">+ File</button>
                <button id="btn-create-folder">+ Folder</button>
                <button id="btn-rescan">🔄</button>
                <div class="dropdown">
                    <button id="btn-export-menu">💾 Export ▾</button>
                    <div id="export-dropdown" class="dropdown-content hidden">
                        <button id="export-json">Export JSON</button>
                        <button id="export-svg">Export SVG Image</button>
                        <button id="export-png">Export PNG Image</button>
                    </div>
                </div>
            </div>
        </header>

        <!-- Dynamic Physics Controls Subbar -->
        <div id="physics-panel" class="hidden">
            <div class="slider-group">
                <label>Charge: <span id="val-charge">-180</span></label>
                <input type="range" id="slider-charge" min="-600" max="-20" value="-180" step="10" />
            </div>
            <div class="slider-group">
                <label>Distance: <span id="val-distance">60</span></label>
                <input type="range" id="slider-distance" min="20" max="250" value="60" step="5" />
            </div>
            <div class="slider-group">
                <label>Collision: <span id="val-collide">20</span></label>
                <input type="range" id="slider-collide" min="5" max="60" value="20" step="1" />
            </div>
            <button id="btn-freeze-sim" class="btn-sm">⏸️ Freeze</button>
            <button id="btn-reset-physics" class="btn-sm">Reset</button>
        </div>

        <main id="stage">
            <svg id="viewport"></svg>

            <!-- Minimap Navigator -->
            <div id="minimap-container">
                <svg id="minimap"></svg>
            </div>

            <!-- Git Legend & Stats -->
            <div id="stats-badge">
                <span id="stat-files">0 Files</span> |
                <span id="stat-folders">0 Folders</span> |
                <span id="stat-cycles" class="cycle-warn">0 Cycles</span>
                <span class="legend-sep">|</span>
                <span class="git-tag git-modified">● Mod</span>
                <span class="git-tag git-untracked">● Untracked</span>
                <span class="git-tag git-added">● Added</span>
            </div>

            <!-- Inspector Panel -->
            <aside id="inspector" class="collapsed">
                <div class="inspector-header">
                    <h3 id="node-name">Details</h3>
                    <button id="close-inspector">✕</button>
                </div>
                <div class="inspector-body">
                    <div class="field">
                        <label>Path:</label>
                        <span id="node-path">-</span>
                    </div>
                    <div class="field">
                        <label>Git Status:</label>
                        <span id="node-git">-</span>
                    </div>
                    <div class="field">
                        <label>Size:</label>
                        <span id="node-size">-</span>
                    </div>
                    <div id="circular-alert" class="hidden alert">
                        ⚠️ Part of a Circular Dependency Chain!
                    </div>

                    <div class="dep-section">
                        <h4>Incoming Dependencies (<span id="in-count">0</span>)</h4>
                        <ul id="incoming-list"></ul>
                    </div>

                    <div class="dep-section">
                        <h4>Outgoing Dependencies (<span id="out-count">0</span>)</h4>
                        <ul id="outgoing-list"></ul>
                    </div>

                    <div class="panel-buttons">
                        <button id="btn-open-code" class="btn-primary">Open Editor</button>
                        <button id="btn-rename" class="btn-secondary">Rename</button>
                        <button id="btn-delete" class="btn-danger">Delete</button>
                    </div>
                </div>
            </aside>
        </main>
    </div>

    <script src="${scriptUri}"></script>
</body>
</html>`;
}
