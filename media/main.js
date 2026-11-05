const vscode = acquireVsCodeApi();
let graphData = { nodes: [], links: [] };
let selectedNode = null;
let currentMode = "force"; // 'force' | 'tree'

const svg = d3.select("#graph-svg");
const width = window.innerWidth;
const height = window.innerHeight - 42;

const g = svg.append("g");
const zoom = d3
  .zoom()
  .scaleExtent([0.1, 4])
  .on("zoom", (event) => g.attr("transform", event.transform));
svg.call(zoom);

let simulation = d3
  .forceSimulation()
  .force(
    "link",
    d3
      .forceLink()
      .id((d) => d.id)
      .distance(70),
  )
  .force("charge", d3.forceManyBody().strength(-200))
  .force("center", d3.forceCenter(width / 2, height / 2))
  .force("collision", d3.forceCollide().radius(25));

// Notify host we are ready
vscode.postMessage({ command: "ready" });

window.addEventListener("message", (event) => {
  const message = event.data;
  if (message.command === "updateGraph") {
    graphData = message.data;
    renderGraph();
  }
});

function renderGraph() {
  g.selectAll("*").remove();

  // Map link strings to objects for D3
  const links = graphData.links.map((d) => Object.assign({}, d));
  const nodes = graphData.nodes.map((d) => Object.assign({}, d));

  const link = g
    .append("g")
    .selectAll("line")
    .data(links)
    .enter()
    .append("line")
    .attr("class", (d) => `link link-${d.type}`);

  const node = g
    .append("g")
    .selectAll(".node")
    .data(nodes)
    .enter()
    .append("g")
    .attr("class", (d) => `node node-${d.type}`)
    .call(d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended))
    .on("click", (event, d) => selectNode(d))
    .on("dblclick", (event, d) => {
      if (d.type === "file") {
        vscode.postMessage({ command: "openFile", path: d.id });
      }
    });

  node.append("circle").attr("r", (d) => (d.type === "folder" ? 9 : 6));

  node
    .append("text")
    .attr("dy", 18)
    .text((d) => d.name);

  simulation.nodes(nodes).on("tick", () => {
    link
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);

    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
  });

  simulation.force("link").links(links);
  simulation.alpha(1).restart();
}

function selectNode(node) {
  selectedNode = node;
  const panel = document.getElementById("inspector-panel");
  panel.classList.remove("hidden");

  document.getElementById("panel-title").innerText = node.name;
  document.getElementById("panel-path").innerText = node.id;
  document.getElementById("panel-type").innerText = node.type;

  // Resolve incoming vs outgoing dependencies
  const outgoing = graphData.links.filter((l) => (l.source.id || l.source) === node.id);
  const incoming = graphData.links.filter((l) => (l.target.id || l.target) === node.id);

  const formatList = (items, key) =>
    items
      .map((i) => {
        const targetId = i[key].id || i[key];
        return `<li>${targetId.split(/[\\/]/).pop()} <em>(${i.type})</em></li>`;
      })
      .join("");

  document.getElementById("panel-outgoing").innerHTML =
    formatList(outgoing, "target") || "<li>None</li>";
  document.getElementById("panel-incoming").innerHTML =
    formatList(incoming, "source") || "<li>None</li>";

  // Highlight linked nodes
  d3.selectAll(".node circle").style("opacity", (n) => {
    const isLinked =
      outgoing.some((o) => (o.target.id || o.target) === n.id) ||
      incoming.some((i) => (i.source.id || i.source) === n.id) ||
      n.id === node.id;
    return isLinked ? 1 : 0.2;
  });

  d3.selectAll(".link").style("opacity", (l) => {
    return (l.source.id || l.source) === node.id || (l.target.id || l.target) === node.id
      ? 1
      : 0.05;
  });
}

function dragstarted(event) {
  if (!event.active) simulation.alphaTarget(0.3).restart();
  event.subject.fx = event.subject.x;
  event.subject.fy = event.subject.y;
}

function dragged(event) {
  event.subject.fx = event.x;
  event.subject.fy = event.y;
}

function dragended(event) {
  if (!event.active) simulation.alphaTarget(0);
  event.subject.fx = null;
  event.subject.fy = null;
}

// UI Actions
document.getElementById("btn-refresh").onclick = () => vscode.postMessage({ command: "ready" });

document.getElementById("btn-create-file").onclick = () => {
  const parentDir =
    selectedNode?.type === "folder"
      ? selectedNode.id
      : selectedNode
        ? selectedNode.parent
        : graphData.nodes[0]?.parent || "";
  const name = prompt("Enter new file name:");
  if (name && parentDir) {
    vscode.postMessage({ command: "createNode", targetDir: parentDir, name, type: "file" });
  }
};

document.getElementById("btn-create-folder").onclick = () => {
  const parentDir =
    selectedNode?.type === "folder"
      ? selectedNode.id
      : selectedNode
        ? selectedNode.parent
        : graphData.nodes[0]?.parent || "";
  const name = prompt("Enter new folder name:");
  if (name && parentDir) {
    vscode.postMessage({ command: "createNode", targetDir: parentDir, name, type: "folder" });
  }
};

document.getElementById("panel-delete-file").onclick = () => {
  if (selectedNode && confirm(`Delete ${selectedNode.name}?`)) {
    vscode.postMessage({ command: "deleteNode", path: selectedNode.id });
    document.getElementById("inspector-panel").classList.add("hidden");
  }
};

document.getElementById("panel-open-editor").onclick = () => {
  if (selectedNode && selectedNode.type === "file") {
    vscode.postMessage({ command: "openFile", path: selectedNode.id });
  }
};

document.getElementById("btn-export").onclick = () => {
  vscode.postMessage({ command: "exportGraph", data: graphData });
};
