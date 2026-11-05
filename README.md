# ⚡ Workspace Neural Graph

> Transform your VS Code workspace into an interactive neural graph. Inspect dependency meshes, trace bi-directional imports, and execute disk-level file operations directly inside an intuitive, force-directed canvas.

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/your-publisher.workspace-neural-graph?style=flat-square&color=blue)](https://marketplace.visualstudio.com/items?itemName=your-publisher.workspace-neural-graph)
[![Build Status](https://img.shields.io/github/actions/workflow/status/your-org/workspace-neural-graph/ci.yml?branch=main&style=flat-square)](https://github.com/your-org/workspace-neural-graph/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](CONTRIBUTING.md)

---

## 🧭 Overview

Understanding monolithic codebases or deeply nested directories can be overwhelming. **Workspace Neural Graph** parses your project's file structure and module dependency links in real time, rendering them as an interactive force-directed graph.

* **Force-Directed Neural Canvas**: Physics-simulated node graphs powered by D3.js.
* **Deep Dependency Resolution**: Automatic tracking of ES modules, CommonJS `require()`, CSS `@import`, and file hierarchies.
* **Direct Workspace CRUD**: Create, rename, edit, and delete files directly within the visualization.
* **Full Data Portability**: Export your project's node/edge relationship data as structured JSON.

---

## 📸 Demo

![Workspace Neural Graph Demo](assets/demo.png)

---

## 🚀 Quick Start

### Installation

1. Open **Visual Studio Code**.
2. Press `Ctrl+P` (or `Cmd+P` on macOS) and run:
   ```bash
   ext install your-publisher.workspace-neural-graph

```

3. Alternatively, search for `Workspace Neural Graph` in the VS Code Extensions tab.

### Usage

1. Open any workspace or multi-root folder in VS Code.
2. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
3. Run:
```text
Neural Graph: Open Workspace Visualizer

```


4. Click any node to inspect incoming and outgoing dependency edges, or double-click to open the source file in your editor.

---

## 🛠️ Keyboard & Mouse Controls

| Action           | Control                  | Description                                   |
| ---------------- | ------------------------ | --------------------------------------------- |
| **Pan Canvas**   | `Left Click + Drag`      | Pan across the network space.                 |
| **Zoom**         | `Scroll Wheel` / `Pinch` | Scale between 0.1× and 4× zoom.               |
| **Inspect Node** | `Left Click`             | Open dependencies in the inspector sidebar.   |
| **Open File**    | `Double Click`           | Focus and open the file in the active editor. |
| **Reposition**   | `Drag Node`              | Pin a node to a custom physics coordinate.    |

---

## 🏗️ Architecture

```text
workspace-neural-graph/
├── src/
│   ├── extension.ts            # Extension activation, IPC router, FS operations
│   ├── workspaceScanner.ts     # Directory walker & node metadata collector
│   └── dependencyParser.ts     # AST / Regex token scanner for import relations
└── media/
    ├── main.js                 # D3.js Webview simulation & event listeners
    └── style.css               # Webview styles & VS Code color token integration

```

---

## 💻 Development Setup

### Prerequisites

* Node.js `>= 18.x`
* npm `>= 9.x`
* VS Code `>= 1.80.0`

### Build Steps

```bash
# 1. Clone repository
git clone [https://github.com/your-org/workspace-neural-graph.git](https://github.com/your-org/workspace-neural-graph.git)
cd workspace-neural-graph

# 2. Install dependencies
npm install

# 3. Start TypeScript compiler in watch mode
npm run watch

```

Press `F5` in VS Code to launch an Extension Development Host window with the extension loaded.

---

## 🤝 Contributing

Contributions make the open-source community thrive. Please review our [Contributing Guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before submitting pull requests.

---

## 📄 License

Distributed under the MIT License. See [`LICENSE`](https://www.google.com/search?q=LICENSE) for details.
