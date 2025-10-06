mermaid.initialize({
    securityLevel: 'loose',
    startOnLoad: false,
    logLevel: 'trace'
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

function buildSidebar(nodes, onToggle, onShowAll, onHideAll) {
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
        cb.addEventListener('change', () => onToggle(id, cb.checked));
        item.append(cb, lab);
        list.appendChild(item);
    }
}

function cssEscapeSafe(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return value.replace(/[^\w-]/g, s => `\\${s}`);
}

function findNodeElements(svgRoot, nodeId) {
    const id = cssEscapeSafe(nodeId);
    const selectors = [
        `#${id}`,
        `[id$="-${id}"]`,
        `g.node#${id}`,
        `g[id*="${id}"]`,
        `[data-id="${id}"]`
    ];
    const set = new Set();
    for (const sel of selectors) {
        svgRoot.querySelectorAll(sel).forEach(el => set.add(el));
    }
    // Also include shapes inside group that carries data-id attribute
    const group = svgRoot.querySelector(`g[data-id="${id}"]`);
    if (group) group.querySelectorAll('*').forEach(el => set.add(el));
    return Array.from(set);
}

function findEdgeElements(svgRoot, nodeId) {
    const id = cssEscapeSafe(nodeId);
    const selectors = [
        `.edgePath.LS-${id}`,
        `.edgePath.LE-${id}`,
        `.edge.LS-${id}`,
        `.edge.LE-${id}`,
        `[class*="LS-${id}"]`,
        `[class*="LE-${id}"]`,
        `.flowchart-link.LS-${id}`,
        `.flowchart-link.LE-${id}`
    ];
    const set = new Set();
    for (const sel of selectors) svgRoot.querySelectorAll(sel).forEach(el => set.add(el));
    return Array.from(set);
}

function toggleNode(svgRoot, nodeId, visible) {
    const method = visible ? 'remove' : 'add';
    for (const el of findNodeElements(svgRoot, nodeId)) el.classList[method]('hidden');
    for (const el of findEdgeElements(svgRoot, nodeId)) el.classList[method]('hidden');
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
    const edgeRegex = /^\s*([A-Za-z][\w-]*)\s*([\-=.]*>+)\s*([A-Za-z][\w-]*)\s*$/;
    const subgraphHeaderRegex = /^\s*subgraph\b(.*)$/i;

    const subgraphs = [];
    const nodesMap = new Map(); // id -> { id, label, subgraphId: string|null }
    const topNodes = [];
    const edges = [];

    let currentSubgraph = null; // { id, headerLine, nodes: [] }

    function ensureSubgraphIdFromHeader(headerRest) {
        const rest = headerRest.trim();
        const m = rest.match(/^([A-Za-z][\w-]*)/);
        return m ? m[1] : `sg${subgraphs.length + 1}`;
    }

    for (; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line.trim() === '') continue;

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

    return {headerLines, flowchartLine, subgraphs, topNodes, nodesMap, edges};
}

function buildFilteredMMD(model, visibleMap) {
    const isVisible = id => visibleMap.get(id) !== false;
    const out = [];

    if (model.headerLines.length) {
        out.push(...model.headerLines);
        out.push('');
    }
    out.push(model.flowchartLine || 'flowchart TD');

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

    buildSidebar(nodes, onToggle, onShowAll, onHideAll);
}

main().catch(console.error);
