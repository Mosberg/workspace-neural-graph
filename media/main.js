const vscode = acquireVsCodeApi();

let rawGraph = { nodes: [], links: [], rootId: "__WORKSPACE_ROOT__", stats: {} };
let filteredNodes = [];
let filteredLinks = [];
let selectedNode = null;
let currentLayout = "force";
let isInitialLoad = true;
let isFrozen = false;

// Physics Parameters
const physics = {
    charge: -180,
    distance: 60,
    collide: 20
};

const svg = d3.select("#viewport");
const container = svg.append("g");

// Minimap elements
const minimapSvg = d3.select('#minimap');
const minimapG = minimapSvg.append('g');
const minimapBox = minimapSvg.append('rect').attr('class', 'minimap-viewport');

// Viewport Zoom
let currentTransform = d3.zoomIdentity;
const zoomBehavior = d3.zoom()
    .scaleExtent([0.05, 5])
    .on('zoom', (event) => {
        currentTransform = event.transform;
        container.attr('transform', currentTransform);
        updateMinimap();
    });
svg.call(zoomBehavior);

// Force Simulation
const forceLink = d3.forceLink().id(d => d.id).distance(physics.distance);
const forceCharge = d3.forceManyBody().strength(physics.charge);
const forceCollide = d3.forceCollide().radius(physics.collide);

let simulation = d3.forceSimulation()
    .force('link', forceLink)
    .force('charge', forceCharge)
    .force('collide', forceCollide)
    .force('center', d3.forceCenter(window.innerWidth / 2, window.innerHeight / 2));

vscode.postMessage({ command: 'ready' });

window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.command === 'updateGraph') {
        rawGraph = msg.data;

        if (isInitialLoad) {
            if (msg.defaultLayout) currentLayout = msg.defaultLayout;
            document.getElementById('layout-select').value = currentLayout;
            isInitialLoad = false;
        }

        updateBadge(rawGraph.stats);
        applyFiltersAndRender();
    }
});

function updateBadge(stats) {
  if (!stats) return;
  document.getElementById("stat-files").innerText = `${stats.totalFiles} Files`;
  document.getElementById("stat-folders").innerText = `${stats.totalFolders} Folders`;
  document.getElementById("stat-cycles").innerText = `${stats.circularCount} In Cycles`;
}

function applyFiltersAndRender() {
  const query = document.getElementById("filter-input").value.toLowerCase().trim();
  const depsOnly = document.getElementById("chk-deps-only").checked;
  const cyclesOnly = document.getElementById("chk-circular").checked;

  if (!rawGraph.nodes || rawGraph.nodes.length === 0) return;

  if (!query && !depsOnly && !cyclesOnly) {
    filteredNodes = rawGraph.nodes;
    filteredLinks = rawGraph.links;
  } else {
    filteredNodes = rawGraph.nodes.filter((n) => {
      if (n.id === rawGraph.rootId) return true;
      if (query && !n.name.toLowerCase().includes(query)) return false;
      if (cyclesOnly && !n.isCircular) return false;
      return true;
    });

    const activeIds = new Set(filteredNodes.map((n) => n.id));
    filteredLinks = rawGraph.links.filter((l) => {
      const src = l.source.id || l.source;
      const tgt = l.target.id || l.target;
      if (!activeIds.has(src) || !activeIds.has(tgt)) return false;
      if (depsOnly && l.type === "hierarchy") return false;
      if (cyclesOnly && !l.isCircular) return false;
      return true;
    });
  }

  render();

  // Auto center camera on match
  if (query) {
    const match = filteredNodes.find(
      (n) => n.id !== rawGraph.rootId && n.name.toLowerCase().includes(query),
    );
    if (match) {
      selectNode(match);
      centerCameraOnNode(match);
    }
  }
}

function render() {
  container.selectAll("*").remove();

  if (currentLayout === "force") {
    renderForce();
  } else if (currentLayout === "tree") {
    renderTree();
  } else if (currentLayout === "radial") {
    renderRadial();
  }

  updateMinimap();
}

// 1. Force Directed
function renderForce() {
  simulation.stop();

  const oldPositions = new Map();
  simulation.nodes().forEach((n) => {
    oldPositions.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy, fx: n.fx, fy: n.fy });
  });

  const nodes = filteredNodes.map((d) => {
    const prev = oldPositions.get(d.id);
    return {
      ...d,
      x: prev ? prev.x : window.innerWidth / 2 + (Math.random() - 0.5) * 60,
      y: prev ? prev.y : window.innerHeight / 2 + (Math.random() - 0.5) * 60,
      vx: prev ? prev.vx : 0,
      vy: prev ? prev.vy : 0,
      fx: isFrozen ? (prev ? prev.x : undefined) : prev ? prev.fx : null,
      fy: isFrozen ? (prev ? prev.y : undefined) : prev ? prev.fy : null,
    };
  });

  const links = filteredLinks.map((d) => ({ ...d }));

  const link = container
    .append("g")
    .selectAll("line")
    .data(links)
    .enter()
    .append("line")
    .attr(
      "class",
      (d) =>
        `link link-${d.type === "hierarchy" ? "hierarchy" : "dep"} ${d.isCircular ? "link-circular" : ""}`,
    );

  const node = container
    .append("g")
    .selectAll(".node")
    .data(nodes)
    .enter()
    .append("g")
    .attr(
      "class",
      (d) =>
        `node node-${d.type} git-status-${d.gitStatus || "clean"} ${d.isCircular ? "circular" : ""} ${selectedNode?.id === d.id ? "selected" : ""}`,
    )
    .call(d3.drag().on("start", dragStarted).on("drag", dragged).on("end", dragEnded))
    .on("click", (event, d) => selectNode(d))
    .on("dblclick", (event, d) => {
      if (d.type === "file") vscode.postMessage({ command: "openFile", path: d.id });
    });

  node.append("circle").attr("r", (d) => (d.type === "root" ? 10 : d.type === "folder" ? 8 : 5));
  node
    .append("text")
    .attr("dy", 16)
    .text((d) => d.name);

  simulation.nodes(nodes).on("tick", () => {
    link
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);
    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    updateMinimap();
  });

  simulation.force("link").links(links);
  if (!isFrozen) {
    simulation.alpha(oldPositions.size > 0 ? 0.25 : 0.8).restart();
  }
}

// 2. Tree Hierarchy
function renderTree() {
  simulation.stop();
  const strat = buildSafeHierarchy();
  if (!strat) return;

  const treeLayout = d3.tree().nodeSize([36, 180]);
  const root = treeLayout(strat);

  const xOffset = 80;
  const yOffset = window.innerHeight / 2;

  container
    .append("g")
    .selectAll("path")
    .data(root.links())
    .enter()
    .append("path")
    .attr("class", "link link-hierarchy")
    .attr(
      "d",
      d3
        .linkHorizontal()
        .x((d) => d.y + xOffset)
        .y((d) => d.x + yOffset),
    );

  const node = container
    .append("g")
    .selectAll(".node")
    .data(root.descendants())
    .enter()
    .append("g")
    .attr(
      "class",
      (d) =>
        `node node-${d.data.type} git-status-${d.data.gitStatus || "clean"} ${selectedNode?.id === d.data.id ? "selected" : ""}`,
    )
    .attr("transform", (d) => `translate(${d.y + xOffset},${d.x + yOffset})`)
    .on("click", (event, d) => selectNode(d.data))
    .on("dblclick", (event, d) => {
      if (d.data.type === "file") vscode.postMessage({ command: "openFile", path: d.data.id });
    });

  node.append("circle").attr("r", (d) => (d.data.type === "root" ? 8 : 5));
  node
    .append("text")
    .attr("dy", 4)
    .attr("x", 8)
    .style("text-anchor", "start")
    .text((d) => d.data.name);
}

// 3. Radial Dendrogram
function renderRadial() {
  simulation.stop();
  const strat = buildSafeHierarchy();
  if (!strat) return;

  const radius = Math.min(window.innerWidth, window.innerHeight) * 0.45;
  const cluster = d3.cluster().size([360, radius]);
  const root = cluster(strat);

  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;

  container
    .append("g")
    .selectAll("path")
    .data(root.links())
    .enter()
    .append("path")
    .attr("class", "link link-hierarchy")
    .attr(
      "d",
      d3
        .linkRadial()
        .angle((d) => (d.x * Math.PI) / 180)
        .radius((d) => d.y),
    )
    .attr("transform", `translate(${cx},${cy})`);

  const node = container
    .append("g")
    .selectAll(".node")
    .data(root.descendants())
    .enter()
    .append("g")
    .attr(
      "class",
      (d) =>
        `node node-${d.data.type} git-status-${d.data.gitStatus || "clean"} ${selectedNode?.id === d.data.id ? "selected" : ""}`,
    )
    .attr(
      "transform",
      (d) => `
            translate(${cx},${cy})
            rotate(${d.x - 90})
            translate(${d.y},0)
            rotate(${d.x < 180 ? 0 : 180})
        `,
    )
    .on("click", (event, d) => selectNode(d.data))
    .on("dblclick", (event, d) => {
      if (d.data.type === "file") vscode.postMessage({ command: "openFile", path: d.data.id });
    });

  node.append("circle").attr("r", 4);
  node
    .append("text")
    .attr("dy", "0.31em")
    .attr("x", (d) => (d.x < 180 ? 6 : -6))
    .style("text-anchor", (d) => (d.x < 180 ? "start" : "end"))
    .text((d) => d.data.name);
}

function buildSafeHierarchy() {
  try {
    const idSet = new Set(filteredNodes.map((n) => n.id));
    const safeList = filteredNodes.map((n) => {
      if (n.id === rawGraph.rootId) return { ...n, parent: undefined };
      const validParent = n.parent && idSet.has(n.parent) ? n.parent : rawGraph.rootId;
      return { ...n, parent: validParent };
    });

    return d3
      .stratify()
      .id((d) => d.id)
      .parentId((d) => d.parent)(safeList);
  } catch (e) {
    console.error("Stratification error:", e);
    return null;
  }
}

// Camera auto-centering
function centerCameraOnNode(node) {
  let targetX = 0,
    targetY = 0;

  if (currentLayout === "force") {
    const simNode = simulation.nodes().find((n) => n.id === node.id);
    if (!simNode || simNode.x === undefined) return;
    targetX = simNode.x;
    targetY = simNode.y;
  } else {
    const strat = buildSafeHierarchy();
    if (!strat) return;
    const root = (
      currentLayout === "tree"
        ? d3.tree().nodeSize([36, 180])
        : d3.cluster().size([360, Math.min(window.innerWidth, window.innerHeight) * 0.45])
    )(strat);
    const match = root.descendants().find((d) => d.data.id === node.id);
    if (!match) return;

    if (currentLayout === "tree") {
      targetX = match.y + 80;
      targetY = match.x + window.innerHeight / 2;
    } else {
      const angle = ((match.x - 90) * Math.PI) / 180;
      targetX = window.innerWidth / 2 + match.y * Math.cos(angle);
      targetY = window.innerHeight / 2 + match.y * Math.sin(angle);
    }
  }

  const scale = 1.35;
  const transform = d3.zoomIdentity
    .translate(window.innerWidth / 2 - targetX * scale, window.innerHeight / 2 - targetY * scale)
    .scale(scale);

  svg.transition().duration(600).ease(d3.easeCubicOut).call(zoomBehavior.transform, transform);
}

// Minimap
function updateMinimap() {
    minimapG.selectAll('*').remove();
    const mmW = 180, mmH = 120;

    let points = [];
    if (currentLayout === 'force') {
        points = simulation.nodes().map(d => ({ x: d.x, y: d.y }));
    } else {
        const strat = buildSafeHierarchy();
        if (strat) {
            points = strat.descendants().map(d => ({
                x: d.y || window.innerWidth / 2,
                y: d.x || window.innerHeight / 2
            }));
        }
    }

    if (points.length === 0) return;

    const xExt = d3.extent(points, d => d.x);
    const yExt = d3.extent(points, d => d.y);
    const pad = 60;

    const scaleX = d3.scaleLinear().domain([(xExt[0] || 0) - pad, (xExt[1] || window.innerWidth) + pad]).range([0, mmW]);
    const scaleY = d3.scaleLinear().domain([(yExt[0] || 0) - pad, (yExt[1] || window.innerHeight) + pad]).range([0, mmH]);

    minimapG.selectAll('circle')
        .data(points)
        .enter().append('circle')
        .attr('class', 'minimap-node')
        .attr('cx', d => scaleX(d.x))
        .attr('cy', d => scaleY(d.y))
        .attr('r', 1.5);

    const k = currentTransform.k || 1;
    const x0 = -currentTransform.x / k;
    const y0 = -currentTransform.y / k;
    const x1 = x0 + window.innerWidth / k;
    const y1 = y0 + window.innerHeight / k;

    const mx = Math.max(0, scaleX(x0));
    const my = Math.max(0, scaleY(y0));
    const mw = Math.min(mmW, Math.max(10, scaleX(x1) - mx));
    const mh = Math.min(mmH, Math.max(10, scaleY(y1) - my));

    minimapBox.attr('x', mx).attr('y', my).attr('width', mw).attr('height', mh);
}

// Inspector & Node Selection
function selectNode(node) {
    selectedNode = node;
    d3.selectAll(".node").classed("selected", (d) => (d.id || d.data?.id) === node.id);

    const panel = document.getElementById("inspector");
    panel.classList.remove("collapsed");

    document.getElementById("node-name").innerText = node.name;
    document.getElementById("node-path").innerText =
      node.id === rawGraph.rootId ? "Workspace Root" : node.id;
    document.getElementById("node-git").innerText = (node.gitStatus || "clean").toUpperCase();
    document.getElementById("node-size").innerText =
      node.size !== undefined ? `${(node.size / 1024).toFixed(1)} KB` : "N/A";

    const circAlert = document.getElementById("circular-alert");
    if (node.isCircular) circAlert.classList.remove("hidden");
    else circAlert.classList.add("hidden");

    const incoming = rawGraph.links.filter(
      (l) => (l.target.id || l.target) === node.id && l.type !== "hierarchy",
    );
    const outgoing = rawGraph.links.filter(
      (l) => (l.source.id || l.source) === node.id && l.type !== "hierarchy",
    );

    document.getElementById("in-count").innerText = incoming.length;
    document.getElementById("out-count").innerText = outgoing.length;

    const renderList = (items, key) =>
      items
        .map((l) => {
          const targetPath = l[key].id || l[key];
          const base = targetPath.split(/[\\/]/).pop();
          return `<li data-path="${targetPath}">↳ ${base} <small>(${l.type})</small></li>`;
        })
        .join("");

    document.getElementById("incoming-list").innerHTML =
      renderList(incoming, "source") || "<li>None</li>";
    document.getElementById("outgoing-list").innerHTML =
      renderList(outgoing, "target") || "<li>None</li>";

    document.querySelectorAll("#inspector li[data-path]").forEach((el) => {
      el.onclick = () => {
        const target = rawGraph.nodes.find((n) => n.id === el.dataset.path);
        if (target) {
          selectNode(target);
          centerCameraOnNode(target);
        }
      };
    });
}

// Drag Handlers
function dragStarted(event) {
  if (!event.active && !isFrozen) simulation.alphaTarget(0.3).restart();
  event.subject.fx = event.subject.x;
  event.subject.fy = event.subject.y;
}
function dragged(event) {
    event.subject.fx = event.x;
    event.subject.fy = event.y;
}
function dragEnded(event) {
  if (!event.active && !isFrozen) simulation.alphaTarget(0);
  if (!isFrozen) {
    event.subject.fx = null;
    event.subject.fy = null;
  }
}

// Physics Controls Listeners
document.getElementById('btn-physics-toggle').onclick = (e) => {
    e.target.classList.toggle('active');
    document.getElementById('physics-panel').classList.toggle('hidden');
};

document.getElementById("slider-charge").oninput = (e) => {
  physics.charge = +e.target.value;
  document.getElementById("val-charge").innerText = physics.charge;
  forceCharge.strength(physics.charge);
  if (!isFrozen) simulation.alpha(0.3).restart();
};

document.getElementById("slider-distance").oninput = (e) => {
  physics.distance = +e.target.value;
  document.getElementById("val-distance").innerText = physics.distance;
  forceLink.distance(physics.distance);
  if (!isFrozen) simulation.alpha(0.3).restart();
};

document.getElementById("slider-collide").oninput = (e) => {
  physics.collide = +e.target.value;
  document.getElementById("val-collide").innerText = physics.collide;
  forceCollide.radius(physics.collide);
  if (!isFrozen) simulation.alpha(0.3).restart();
};

document.getElementById("btn-freeze-sim").onclick = (e) => {
  isFrozen = !isFrozen;
  if (isFrozen) {
    simulation.stop();
    simulation.nodes().forEach((n) => {
      n.fx = n.x;
      n.fy = n.y;
    });
    e.target.innerText = "▶️ Resume";
  } else {
    simulation.nodes().forEach((n) => {
      n.fx = null;
      n.fy = null;
    });
    simulation.alpha(0.3).restart();
    e.target.innerText = "⏸️ Freeze";
  }
};

document.getElementById("btn-reset-physics").onclick = () => {
  physics.charge = -180;
  physics.distance = 60;
  physics.collide = 20;

  document.getElementById("slider-charge").value = physics.charge;
  document.getElementById("slider-distance").value = physics.distance;
  document.getElementById("slider-collide").value = physics.collide;
  document.getElementById("val-charge").innerText = physics.charge;
  document.getElementById("val-distance").innerText = physics.distance;
  document.getElementById("val-collide").innerText = physics.collide;

  forceCharge.strength(physics.charge);
  forceLink.distance(physics.distance);
  forceCollide.radius(physics.collide);

  if (!isFrozen) simulation.alpha(0.5).restart();
};

// Layout & Filter Listeners
document.getElementById("layout-select").onchange = (e) => {
  currentLayout = e.target.value;
  render();
};

document.getElementById("filter-input").oninput = applyFiltersAndRender;
document.getElementById("chk-deps-only").onchange = applyFiltersAndRender;
document.getElementById("chk-circular").onchange = applyFiltersAndRender;
document.getElementById("close-inspector").onclick = () => {
  document.getElementById("inspector").classList.add("collapsed");
  d3.selectAll(".node").classed("selected", false);
};

// Host Dialog Actions
document.getElementById("btn-create-file").onclick = () => {
  const targetDir =
    selectedNode?.type === "folder" ? selectedNode.id : selectedNode?.parent || rawGraph.rootId;
  vscode.postMessage({ command: "requestCreateNode", type: "file", targetDir });
};

document.getElementById("btn-create-folder").onclick = () => {
  const targetDir =
    selectedNode?.type === "folder" ? selectedNode.id : selectedNode?.parent || rawGraph.rootId;
  vscode.postMessage({ command: "requestCreateNode", type: "folder", targetDir });
};

document.getElementById("btn-rename").onclick = () => {
  if (selectedNode && selectedNode.id !== rawGraph.rootId) {
    vscode.postMessage({ command: "requestRename", oldPath: selectedNode.id });
  }
};

document.getElementById("btn-delete").onclick = () => {
  if (selectedNode && selectedNode.id !== rawGraph.rootId) {
    vscode.postMessage({ command: "deleteNode", path: selectedNode.id });
    document.getElementById("inspector").classList.add("collapsed");
  }
};

document.getElementById("btn-open-code").onclick = () => {
  if (selectedNode && selectedNode.type === "file") {
    vscode.postMessage({ command: "openFile", path: selectedNode.id });
  }
};

document.getElementById("btn-rescan").onclick = () => vscode.postMessage({ command: "rescan" });

// Export Dropdown
const exportMenuBtn = document.getElementById("btn-export-menu");
const exportDropdown = document.getElementById("export-dropdown");

exportMenuBtn.onclick = (e) => {
  e.stopPropagation();
  exportDropdown.classList.toggle("hidden");
};

window.addEventListener("click", () => {
  exportDropdown.classList.add("hidden");
});

document.getElementById("export-json").onclick = () => {
  vscode.postMessage({ command: "exportData", data: rawGraph });
};

// SVG Export
document.getElementById("export-svg").onclick = () => {
  const svgEl = document.getElementById("viewport");
  const serializer = new XMLSerializer();
  let source = serializer.serializeToString(svgEl);

  if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
    source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  // Embed essential styles inline so it renders cleanly standalone
  const styleSnippet = `<style>
        .link { fill: none; }
        .link-hierarchy { stroke: rgba(110, 118, 129, 0.4); stroke-width: 1px; stroke-dasharray: 2,3; }
        .link-dep { stroke: #58a6ff; stroke-width: 1.5px; opacity: 0.7; }
        .link-circular { stroke: #f85149; stroke-width: 2.5px; }
        .node circle { stroke-width: 1.5px; }
        .node-file circle { fill: #1f6feb; stroke: #388bfd; }
        .node-folder circle { fill: #238636; stroke: #3fb950; }
        .node-root circle { fill: #8957e5; stroke: #a371f7; }
        .node text { fill: #ffffff; font-size: 9px; text-anchor: middle; font-family: sans-serif; }
    </style>`;
  source = source
    .replace(/<defs>/, `<defs>${styleSnippet}`)
    .replace(/(<svg[^>]*>)/, `$1<defs>${styleSnippet}</defs>`);

  vscode.postMessage({ command: "exportImage", format: "svg", data: source });
};

// PNG Export via Canvas
document.getElementById('export-png').onclick = () => {
    const svgEl = document.getElementById('viewport');
    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(svgEl);

    if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
        source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    const width = svgEl.clientWidth || window.innerWidth;
    const height = svgEl.clientHeight || window.innerHeight;

    const canvas = document.createElement('canvas');
    canvas.width = width * 2; // 2x DPI for crisp high-res output
    canvas.height = height * 2;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);

    // Dark backdrop fill
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, width, height);

    const img = new Image();
    const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        const pngBase64 = canvas.toDataURL('image/png');
        vscode.postMessage({ command: 'exportImage', format: 'png', data: pngBase64 });
    };
    img.src = url;
};
