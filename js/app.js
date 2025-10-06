mermaid.initialize({
    securityLevel: 'loose',
    startOnLoad: false,
});

function parseNodeLine(line) {
    // Try to parse a Mermaid node with various shapes. Returns {id,label,open,close} or null
    const m = line.match(/^\s*([A-Za-z][\w-]*)\s*(.*)$/);
    if (!m) return null;
    const id = m[1];
    let rest = (m[2] || '').split('%%')[0].trim(); // strip inline comments
    if (!rest) return null;
    const pairs = [
        { open: '(', close: ')' }, // single paren (round edges)
        { open: '((', close: '))' }, // circle
        { open: '[[', close: ']]' }, // subroutine
        { open: '{{', close: '}}' }, // hexagon
        { open: '([', close: '])' }, // stadium
        { open: '[(', close: ')]' }, // database/cylinder
        { open: '[/', close: '/]' }, // parallelogram
        { open: '[\\', close: '\\]' }, // parallelogram alt
        { open: '[/', close: '\\]' }, // trapezoid variant
        { open: '[\\', close: '/]' }, // trapezoid variant alt
        { open: '>', close: ']' }, // asymmetric
        { open: '[', close: ']' }, // rectangle (default)
        { open: '{', close: '}' }, // rhombus/diamond
    ];
    // Sort by open length descending to prefer longer tokens first
    pairs.sort((a,b)=>b.open.length - a.open.length);
    for (const p of pairs) {
        if (rest.startsWith(p.open) && rest.endsWith(p.close)) {
            const label = rest.slice(p.open.length, rest.length - p.close.length).trim();
            return { id, label, open: p.open, close: p.close };
        }
    }
    return null;
}

function parseNodesFromMMD(mmdText) {
    // Parser for sidebar: find lines that define nodes with any supported shape
    const nodes = new Map();
    const lines = mmdText.split(/\n/);
    for (const line of lines) {
        if (/^\s*subgraph\b/i.test(line)) continue;
        if (/-->|==>|-\.|\|/.test(line)) continue; // skip edges
        const node = parseNodeLine(line);
        if (node) {
            const label = node.label.replace(/\\n/g, ' ');
            nodes.set(node.id, label);
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

    const edgeRegex = /^\s*([A-Za-z][\w-]*)\s*([<>=.-]+)\s*([A-Za-z][\w-]*)\s*$/;
    const subgraphHeaderRegex = /^\s*subgraph\b(.*)$/i;
    const classDefRegex = /^\s*classDef\s+([A-Za-z][\w-]*)\s+(.+)$/i;
    const classAssignRegex = /^\s*class\s+(\S.*?)\s+([A-Za-z][\w-]*)\s*$/i;

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

        const nodeParsed = parseNodeLine(line);
        if (nodeParsed) {
            const { id, label, open, close } = nodeParsed;
            const node = { id, label, open, close };
            nodesMap.set(id, { id, label, open, close, subgraphId: currentSubgraph ? currentSubgraph.id : null });
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
        for (const n of kept) {
            const open = (n && n.open) ? n.open : '[';
            const close = (n && n.close) ? n.close : ']';
            out.push(`        ${n.id}${open}${n.label}${close}`);
        }
        out.push('    end');
        out.push('');
    }

    // Top-level nodes
    const keptTop = model.topNodes.filter(n => isVisible(n.id));
    for (const n of keptTop) {
        const open = (n && n.open) ? n.open : '[';
        const close = (n && n.close) ? n.close : ']';
        out.push(`    ${n.id}${open}${n.label}${close}`);
    }
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
