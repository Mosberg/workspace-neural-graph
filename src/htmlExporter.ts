import * as fs from "node:fs";
import * as path from "node:path";
import { WorkspaceGraphData } from "./types";

export function generateStandaloneHTML(data: WorkspaceGraphData, extensionPath: string): string {
  const d3Script = fs.readFileSync(path.join(extensionPath, "media", "d3.min.js"), "utf8");
  const serializedData = JSON.stringify(data);

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Workspace Neural Graph - Standalone Export</title>
    <style>
        body, html { margin:0; padding:0; width:100%; height:100%; overflow:hidden; background:#0a0c10; color:#e6edf3; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
        #toolbar { height:44px; background:#161b22; border-bottom:1px solid #30363d; display:flex; align-items:center; padding:0 16px; gap:12px; }
        #stage { width:100%; height:calc(100% - 44px); position:relative; }
        svg { width:100%; height:100%; cursor:grab; }
        .node circle { stroke-width:1.5px; }
        .node text { fill:#e6edf3; font-size:9px; text-anchor:middle; pointer-events:none; }
        .link { fill:none; }
        .link-hierarchy { stroke:rgba(110,118,129,0.25); stroke-width:1px; stroke-dasharray:2,3; }
        .link-dep { stroke:#58a6ff; stroke-width:1.5px; opacity:0.6; }
        .link-circular { stroke:#f85149 !important; stroke-width:2.5px !important; }
        #inspector { position:absolute; top:12px; right:12px; width:280px; background:rgba(22,27,34,0.92); border:1px solid #30363d; border-radius:8px; padding:16px; font-size:12px; backdrop-filter:blur(8px); display:none; }
    </style>
    <script>${d3Script}<\/script>
</head>
<body>
    <div id="toolbar">
        <span style="font-weight:700; color:#2f81f7;">⚡ Standalone Neural Graph</span>
        <span>${data.stats.totalFiles} Files</span> |
        <span style="color:#f85149;">${data.stats.circularCount} Cycles</span> |
        <span>Avg Maintainability: ${data.stats.avgMaintainability}/100</span>
    </div>
    <div id="stage">
        <svg id="viewport"></svg>
        <div id="inspector">
            <h3 id="panel-title">Node</h3>
            <p><strong>Path:</strong> <span id="panel-path"></span></p>
            <p><strong>Maintainability:</strong> <span id="panel-mi"></span></p>
            <p><strong>Complexity (CC):</strong> <span id="panel-cc"></span></p>
        </div>
    </div>
    <script>
        const graphData = ${serializedData};
        const svg = d3.select('#viewport');
        const g = svg.append('g');
        svg.call(d3.zoom().scaleExtent([0.1, 4]).on('zoom', (e) => g.attr('transform', e.transform)));

        const links = graphData.links.map(d => ({ ...d }));
        const nodes = graphData.nodes.map(d => ({ ...d }));

        const simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links).id(d => d.id).distance(60))
            .force('charge', d3.forceManyBody().strength(-180))
            .force('collide', d3.forceCollide(20))
            .force('center', d3.forceCenter(window.innerWidth / 2, window.innerHeight / 2));

        const link = g.append('g').selectAll('line').data(links).enter().append('line')
            .attr('class', d => 'link link-' + (d.type === 'hierarchy' ? 'hierarchy' : 'dep') + (d.isCircular ? ' link-circular' : ''));

        const node = g.append('g').selectAll('.node').data(nodes).enter().append('g')
            .attr('class', 'node')
            .call(d3.drag()
                .on('start', (e, d) => { if(!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
                .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
                .on('end', (e, d) => { if(!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
            )
            .on('click', (e, d) => {
                const p = document.getElementById('inspector');
                p.style.display = 'block';
                document.getElementById('panel-title').innerText = d.name;
                document.getElementById('panel-path').innerText = d.id;
                document.getElementById('panel-mi').innerText = d.complexity ? d.complexity.maintainabilityIndex + '/100' : 'N/A';
                document.getElementById('panel-cc').innerText = d.complexity ? d.complexity.cyclomaticComplexity : 'N/A';
            });

        node.append('circle')
            .attr('r', d => d.type === 'folder' ? 7 : (5 + (d.complexity ? (100 - d.complexity.maintainabilityIndex) * 0.08 : 0)))
            .attr('fill', d => d.isCircular ? '#da3633' : d.type === 'folder' ? '#238636' : '#1f6feb');

        node.append('text').attr('dy', 16).text(d => d.name);

        simulation.on('tick', () => {
            link.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
            node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
        });
    <\/script>
</body>
</html>`;
}
