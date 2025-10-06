mermaid.initialize({
    securityLevel: 'loose',
    startOnLoad: false,
});

function parseNodesFromMMD(mmdText) {
    // Rough parser: find lines like `id[Label]` (ignores subgraph and edges)
    const nodes = new Map();
    const lines = mmdText.split(/\n/);
    const nodeRegex = /^\s*([A-Za-z][\w-]*)\s*\[(.+?)]\s*$/;
    for (const line of lines) {
        if (/^\s*subgraph\b/i.test(line)) continue;
        if (/-->|==>|-\.|\|/.test(line)) continue; // skip edges
        const m = line.match(nodeRegex);
        if (m) {
            const id = m[1];
            const label = m[2].replace(/\\n/g, ' ');
            nodes.set(id, label);
        }
    }
    return Array.from(nodes, ([id, label]) => ({id, label}));
}

function buildSidebar(nodes, onToggle, onShowAll, onHideAll, onShowDescendants, onShowAncestors) {
    const list = document.getElementById('nodesList');
    list.innerHTML = '';

    // Controls
    document.getElementById('showAllBtn').onclick = () => onShowAll();
    document.getElementById('hideAllBtn').onclick = () => onHideAll();

    for (const {id, label} of nodes) {
        const item = document.createElement('div');
        item.className = 'node-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.id = `cb-${id}`;

        const lab = document.createElement('label');
        lab.htmlFor = cb.id;
        lab.textContent = `${id} — ${label}`;

        const btnDesc = document.createElement('button');
        btnDesc.type = 'button';
        btnDesc.textContent = '⇩';
        btnDesc.title = 'Show all descendants';
        btnDesc.addEventListener('click', () => onShowDescendants(id));

        const btnAnc = document.createElement('button');
        btnAnc.type = 'button';
        btnAnc.textContent = '⇧';
        btnAnc.title = 'Show all ancestors (parents)';
        btnAnc.addEventListener('click', () => onShowAncestors(id));

        cb.addEventListener('change', () => onToggle(id, cb.checked));
        item.append(cb, lab, btnDesc, btnAnc);
        list.appendChild(item);
    }
}

function parseDiagram(mmdText) {
    const lines = mmdText.split(/\n/);

    // Front matter (--- ... ---) if present
    let i = 0;
    const headerLines = [];
    if (lines[i] && lines[i].trim() === '---') {
        headerLines.push(lines[i++]);
        while (i < lines.length && lines[i].trim() !== '---') {
            headerLines.push(lines[i++]);
        }
        if (i < lines.length) headerLines.push(lines[i++]); // closing ---
        // Skip possible blank line
        if (i < lines.length && lines[i].trim() === '') i++;
    }

    // Flowchart line
    let flowchartLine = '';
    for (; i < lines.length; i++) {
        const ln = lines[i];
        if (/^\s*flowchart\b/i.test(ln)) {
            flowchartLine = ln.trim();
            i++;
            break;
        }
    }

    const nodeRegex = /^\s*([A-Za-z][\w-]*)\s*\[(.+?)]\s*$/;
    const edgeRegex = /^\s*([A-Za-z][\w-]*)\s*([<>=.-]+)\s*([A-Za-z][\w-]*)\s*$/;
    const subgraphHeaderRegex = /^\s*subgraph\b(.*)$/i;
    const classDefRegex = /^\s*classDef\s+([A-Za-z][\w-]*)\s+(.+)$/i;
    const classAssignRegex = /^\s*class\s+([^\s].*?)\s+([A-Za-z][\w-]*)\s*$/i;

    const subgraphs = [];
    const nodesMap = new Map(); // id -> { id, label, subgraphId: string|null }
    const topNodes = [];
    const edges = [];
    const classDefs = [];
    const classAssigns = [];

    let currentSubgraph = null; // { id, headerLine, nodes: [] }

    function ensureSubgraphIdFromHeader(headerRest) {
        const rest = headerRest.trim();
        const m = rest.match(/^([A-Za-z][\w-]*)/);
        return m ? m[1] : `sg${subgraphs.length + 1}`;
    }

    for (; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line.trim() === '') continue;
        if (/^\s*%%/.test(line)) continue;

        // classDef lines
        const cdm = line.match(classDefRegex);
        if (cdm) {
            classDefs.push(line.trim());
            continue;
        }
        // class assignments
        const cam = line.match(classAssignRegex);
        if (cam) {
            const idsPart = cam[1];
            const className = cam[2];
            const ids = idsPart.split(/[\s,]+/).map(s=>s.trim()).filter(Boolean);
            if (ids.length) classAssigns.push({ids, className});
            continue;
        }

        const sgHeader = line.match(subgraphHeaderRegex);
        if (sgHeader) {
            const headerLine = line.trim();
            const id = ensureSubgraphIdFromHeader(sgHeader[1] || '');
            currentSubgraph = {id, headerLine, nodes: []};
            subgraphs.push(currentSubgraph);
            continue;
        }
        if (/^\s*end\s*$/i.test(line)) {
            currentSubgraph = null;
            continue;
        }

        const nm = line.match(nodeRegex);
        if (nm) {
            const id = nm[1];
            const label = nm[2];
            const node = {id, label};
            nodesMap.set(id, {id, label, subgraphId: currentSubgraph ? currentSubgraph.id : null});
            if (currentSubgraph) currentSubgraph.nodes.push(node); else topNodes.push(node);
            continue;
        }

        const em = line.match(edgeRegex);
        if (em) {
            edges.push({a: em[1], op: em[2], b: em[3]});
            continue;
        }
    }

    return {headerLines, flowchartLine, subgraphs, topNodes, nodesMap, edges, classDefs, classAssigns};
}

function buildFilteredMMD(model, visibleMap) {
    const isVisible = id => visibleMap.get(id) !== false;
    const out = [];

    if (model.headerLines.length) {
        out.push(...model.headerLines);
        out.push('');
    }
    out.push(model.flowchartLine || 'flowchart TD');

    // include classDefs so styles are available
    if (model.classDefs && model.classDefs.length) {
        for (const ln of model.classDefs) out.push(`    ${ln}`);
        out.push('');
    }

    // Subgraphs
    for (const sg of model.subgraphs) {
        const kept = sg.nodes.filter(n => isVisible(n.id));
        if (!kept.length) continue;
        out.push(`    ${sg.headerLine}`);
        for (const n of kept) out.push(`        ${n.id}[${n.label}]`);
        out.push('    end');
        out.push('');
    }

    // Top-level nodes
    const keptTop = model.topNodes.filter(n => isVisible(n.id));
    for (const n of keptTop) out.push(`    ${n.id}[${n.label}]`);
    if (keptTop.length) out.push('');

    // Class assignments for visible nodes
    if (model.classAssigns && model.classAssigns.length) {
        for (const ca of model.classAssigns) {
            const keptIds = ca.ids.filter(id => isVisible(id));
            if (keptIds.length) out.push(`    class ${keptIds.join(',')} ${ca.className}`);
        }
        out.push('');
    }

    // Click handlers for visible nodes (Mermaid will call window.myCallback(id))
    const visibleIds = Array.from(model.nodesMap.keys()).filter(id => isVisible(id));
    for (const id of visibleIds) {
        out.push(`    click ${id} myCallback`);
    }
    if (visibleIds.length) out.push('');

    // Edges where both ends visible
    for (const e of model.edges) {
        if (isVisible(e.a) && isVisible(e.b)) {
            out.push(`    ${e.a} ${e.op} ${e.b}`);
        }
    }
    out.push('');
    return out.join('\n');
}

async function main() {
    const diagramText = await fetch('diagram.mmd').then(res => res.text());
    const model = parseDiagram(diagramText);
    const nodes = parseNodesFromMMD(diagramText);

    const diagramEl = document.getElementById('diagram');

    // Build adjacency (directed)
    const out = new Map(); // id -> Set of children (descendants via outgoing edges)
    const inn = new Map(); // id -> Set of parents (ancestors via incoming edges)
    function ensure(map, key) { if (!map.has(key)) map.set(key, new Set()); return map.get(key); }
    for (const id of model.nodesMap.keys()) { ensure(out, id); ensure(inn, id); }
    for (const e of model.edges) {
        const op = e.op || '';
        if (op.includes('>')) {
            ensure(out, e.a).add(e.b);
            ensure(inn, e.b).add(e.a);
        }
        if (op.includes('<')) {
            ensure(out, e.b).add(e.a);
            ensure(inn, e.a).add(e.b);
        }
    }

    function bfs(startId, map) {
        const visited = new Set();
        const q = [startId];
        visited.add(startId);
        while (q.length) {
            const cur = q.shift();
            const nexts = map.get(cur) || new Set();
            for (const nx of nexts) {
                if (!visited.has(nx)) { visited.add(nx); q.push(nx); }
            }
        }
        return visited;
    }

    // State and rerender
    const state = new Map(nodes.map(n => [n.id, true]));
    const rerender = async () => {
        diagramEl.textContent = buildFilteredMMD(model, state);
        if (diagramEl.attributes.getNamedItem('data-processed')) {
            diagramEl.attributes.removeNamedItem('data-processed')
        }
        await mermaid.run();

    };

    // Initial render
    await rerender();

    // Sidebar handlers
    const onToggle = async (id, checked) => {
        state.set(id, checked);
        await rerender();
    };
    const onShowAll = async () => {
        for (const id of state.keys()) state.set(id, true);
        // sync checkboxes
        for (const id of state.keys()) {
            const cb = document.getElementById(`cb-${id}`);
            if (cb) cb.checked = true;
        }
        await rerender();
    };
    const onHideAll = async () => {
        for (const id of state.keys()) state.set(id, false);
        for (const id of state.keys()) {
            const cb = document.getElementById(`cb-${id}`);
            if (cb) cb.checked = false;
        }
        await rerender();
    };

    const onShowDescendants = async (id) => {
        const visibleSet = bfs(id, out);
        for (const vid of visibleSet) {
            state.set(vid, true);
            const cb = document.getElementById(`cb-${vid}`);
            if (cb) cb.checked = true;
        }
        await rerender();
    };

    const onShowAncestors = async (id) => {
        const visibleSet = bfs(id, inn);
        for (const vid of visibleSet) {
            state.set(vid, true);
            const cb = document.getElementById(`cb-${vid}`);
            if (cb) cb.checked = true;
        }
        await rerender();
    };

    buildSidebar(nodes, onToggle, onShowAll, onHideAll, onShowDescendants, onShowAncestors);
}

window.myCallback = (id) => {
   console.log(id);
}

main().catch(console.error);
