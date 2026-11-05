import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { scanWorkspace } from "./workspaceScanner";

let currentPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand("workspaceNeuralGraph.openView", async () => {
    if (currentPanel) {
      currentPanel.reveal(vscode.ViewColumn.One);
      return;
    }

    currentPanel = vscode.window.createWebviewPanel(
      "workspaceNeuralGraph",
      "Workspace Neural Graph",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, "media"))],
      },
    );

    currentPanel.webview.html = getWebviewHtml(currentPanel.webview, context.extensionPath);

    // Handle messages from the Webview
    currentPanel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "ready": {
            await refreshGraph();
            break;
          }
          case "openFile": {
            const doc = await vscode.workspace.openTextDocument(message.path);
            vscode.window.showTextDocument(doc);
            break;
          }
          case "createNode": {
            const { targetDir, name, type } = message;
            const fullPath = path.join(targetDir, name);
            if (type === "folder") {
              fs.mkdirSync(fullPath, { recursive: true });
            } else {
              fs.writeFileSync(fullPath, "", "utf8");
            }
            await refreshGraph();
            vscode.window.showInformationMessage(`Created: ${name}`);
            break;
          }
          case "deleteNode": {
            const target = message.path;
            const stat = fs.statSync(target);
            if (stat.isDirectory()) {
              fs.rmSync(target, { recursive: true, force: true });
            } else {
              fs.unlinkSync(target);
            }
            await refreshGraph();
            vscode.window.showInformationMessage(`Deleted: ${path.basename(target)}`);
            break;
          }
          case "renameNode": {
            const { oldPath, newName } = message;
            const newPath = path.join(path.dirname(oldPath), newName);
            fs.renameSync(oldPath, newPath);
            await refreshGraph();
            break;
          }
          case "exportGraph": {
            const uri = await vscode.window.showSaveDialog({
              filters: { "JSON Files": ["json"] },
            });
            if (uri) {
              fs.writeFileSync(uri.fsPath, JSON.stringify(message.data, null, 2), "utf8");
              vscode.window.showInformationMessage("Graph exported successfully.");
            }
            break;
          }
        }
      },
      undefined,
      context.subscriptions,
    );

    currentPanel.onDidDispose(() => {
      currentPanel = undefined;
    });
  });

  context.subscriptions.push(disposable);
}

async function refreshGraph() {
  if (!currentPanel) return;
  const data = await scanWorkspace();
  currentPanel.webview.postMessage({ command: "updateGraph", data });
}

function getWebviewHtml(webview: vscode.Webview, extensionPath: string): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extensionPath, "media", "main.js")),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(extensionPath, "media", "style.css")),
  );
  const d3Uri = "https://cdn.jsdelivr.net/npm/d3@7";

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet" />
    <script src="${d3Uri}"></script>
</head>
<body>
    <div id="toolbar">
        <button id="btn-layout-force">Force/Neural</button>
        <button id="btn-layout-tree">Tree View</button>
        <button id="btn-refresh">Refresh Scan</button>
        <button id="btn-create-file">+ New File</button>
        <button id="btn-create-folder">+ New Folder</button>
        <button id="btn-export">Export Graph</button>
        <span id="selected-info">Select a node to inspect dependencies</span>
    </div>

    <div id="viewport-container">
        <svg id="graph-svg"></svg>
        <div id="inspector-panel" class="hidden">
            <h3 id="panel-title">Node Details</h3>
            <p><strong>Path:</strong> <span id="panel-path"></span></p>
            <p><strong>Type:</strong> <span id="panel-type"></span></p>
            <hr/>
            <h4>Incoming (Referred by):</h4>
            <ul id="panel-incoming"></ul>
            <h4>Outgoing (Depends on):</h4>
            <ul id="panel-outgoing"></ul>
            <hr/>
            <button id="panel-open-editor">Open in VS Code</button>
            <button id="panel-delete-file" class="danger">Delete</button>
        </div>
    </div>

    <script src="${scriptUri}"></script>
</body>
</html>`;
}
