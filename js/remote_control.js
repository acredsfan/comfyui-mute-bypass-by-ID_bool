import { app } from "../../scripts/app.js";

const RC_STATUS_SYNC_EVENT = "pixelpainter.remote_control.status";

// =========================================================
// 1. CSS & STYLING
// =========================================================
const REMOTE_CSS = `
.remote-picker-overlay {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.6); z-index: 9999;
    display: flex; align-items: center; justify-content: center;
}
.remote-picker-modal {
    background: #1e1e1e; border: 1px solid #444; box-shadow: 0 10px 30px rgba(0,0,0,0.8);
    width: 500px; max-height: 80vh; display: flex; flex-direction: column;
    border-radius: 6px; font-family: sans-serif; overflow: hidden;
}
.remote-picker-header {
    padding: 12px; border-bottom: 1px solid #333; background: #252525;
    display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.remote-picker-search {
    width: 100%; background: #111; border: 1px solid #444; color: #eee;
    padding: 8px 12px; border-radius: 4px; font-size: 14px; outline: none;
    box-sizing: border-box; 
}
.remote-picker-search:focus { border-color: #66afef; background: #000; }
.remote-picker-list {
    flex: 1; overflow-y: auto; padding: 0; margin: 0; list-style: none;
}
.remote-group-header {
    padding: 10px 15px; background: #2a2a2a; border-bottom: 1px solid #333;
    color: #ddd; font-weight: bold; font-size: 13px; cursor: pointer;
    display: flex; justify-content: space-between; align-items: center;
    transition: background 0.1s;
    user-select: none;
}
.remote-group-header:hover { background: #333; color: #fff; }
.remote-group-header .arrow { font-size: 10px; color: #777; transition: transform 0.2s; }
.remote-group-header.active { background: #333; border-left: 3px solid #66afef; }
.remote-group-header.active .arrow { transform: rotate(90deg); color: #66afef; }
.remote-group-content { 
    background: #151515; display: none; padding: 5px 0; 
}
.remote-group-content.open { display: block; }
.remote-picker-item {
    padding: 6px 15px 6px 25px; border-bottom: 1px solid #222; cursor: pointer;
    display: flex; align-items: center; justify-content: space-between;
}
.remote-picker-item:hover { background: #2a3a4a; }
.remote-picker-item.selected { background: #2a4a6a; }
.remote-item-title { color: #ccc; font-size: 13px; }
.remote-item-meta { font-size: 11px; color: #555; font-family: monospace; }
.remote-picker-list::-webkit-scrollbar { width: 8px; }
.remote-picker-list::-webkit-scrollbar-track { background: #111; }
.remote-picker-list::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
`;

const styleEl = document.createElement("style");
styleEl.innerHTML = REMOTE_CSS;
document.head.appendChild(styleEl);

if (CanvasRenderingContext2D.prototype.roundRect === undefined) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
        if (w < 2 * r) r = w / 2; if (h < 2 * r) r = h / 2;
        this.beginPath(); this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r);
        this.arcTo(x + w, y + h, x, y + h, r); this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r);
        this.closePath(); return this;
    };
}

// =========================================================
// 2. GRAPH DATA HELPERS
// =========================================================

function _rcGetInnerGraph(n) {
    if (!n) return null;
    return n.getInnerGraph ? n.getInnerGraph() : (n.innerGraph || n.subgraph || null);
}

function _rcGetNode(graph, id) {
    if (graph && graph.getNodeById) {
        const n = graph.getNodeById(id);
        if(n) return n;
    }
    const nodes = graph ? (graph._nodes || graph.nodes) : null;
    if (nodes && Array.isArray(nodes)) {
        return nodes.find(n => n.id == id);
    }
    if (app.graph && app.graph.getNodeById) {
        return app.graph.getNodeById(id);
    }
    return null;
}

function _rcNormalizeLink(l) {
    if (!l) return null;
    if (Array.isArray(l)) {
        return {
            id: l[0],
            origin_id: l[1],
            origin_slot: l[2],
            target_id: l[3],
            target_slot: l[4],
            type: l[5]
        };
    }
    return l;
}

function _rcFindLinkInGraph(graph, linkId) {
    if (!graph) return null;
    if (graph.links && !Array.isArray(graph.links) && graph.links[linkId]) {
        return _rcNormalizeLink(graph.links[linkId]);
    }
    if (graph.links && Array.isArray(graph.links)) {
        const l = graph.links.find(x => x[0] == linkId);
        if(l) return _rcNormalizeLink(l);
    }
    if (app.graph && app.graph.links && app.graph.links[linkId]) {
        return _rcNormalizeLink(app.graph.links[linkId]);
    }
    return null;
}

// HELPER: Read a boolean value from a linked input slot (e.g. node_status connected via wire)
function _rcReadInputBool(graph, node, inputName) {
    if (!node || !node.inputs) return null;
    const inp = node.inputs.find(i => i.name === inputName);
    if (!inp || inp.link == null) return null;

    const link = _rcFindLinkInGraph(graph, inp.link);
    if (!link) return null;

    const srcNode = _rcGetNode(graph, link.origin_id);
    if (!srcNode) return null;

    // For Primitive / simple widget nodes the value lives in a widget.
    // Prefer the widget that matches the output slot index; fall back to widgets[0].
    if (srcNode.widgets && srcNode.widgets.length > 0) {
        const w = (link.origin_slot < srcNode.widgets.length)
            ? srcNode.widgets[link.origin_slot]
            : srcNode.widgets[0];
        if (w && w.value !== undefined) return !!w.value;
    }
    return null;
}

// HELPER: Fuzzy Name Matcher (Ignores Case, Spaces, Underscores)
function _rcNamesMatch(nameA, nameB) {
    if (!nameA || !nameB) return false;
    const cleanA = String(nameA).toLowerCase().replace(/[\s_]/g, "");
    const cleanB = String(nameB).toLowerCase().replace(/[\s_]/g, "");
    return cleanA === cleanB;
}

// =========================================================
// 3. RECURSIVE CONNECTION TRACER
// =========================================================

function _rcLeadsToRemote(graph, node, outputIndex, visited = new Set()) {
    if (!node || !node.outputs || !node.outputs[outputIndex]) return false;
    
    const outSlot = node.outputs[outputIndex];
    if (!outSlot.links || outSlot.links.length === 0) return false;

    for (const linkId of outSlot.links) {
        if (visited.has(linkId)) continue;
        visited.add(linkId);

        const link = _rcFindLinkInGraph(graph, linkId);
        if (!link) continue;

        const targetNode = _rcGetNode(graph, link.target_id);
        if (!targetNode) continue;

        // CHECK 1: Is this a Remote Control Node?
        const cc = (targetNode.comfyClass || "").toLowerCase();
        const tt = (targetNode.title || "").toLowerCase();
        if (cc.startsWith("remote") || tt.startsWith("remote")) {
            if (targetNode.inputs && targetNode.inputs[link.target_slot]) {
                const inpName = (targetNode.inputs[link.target_slot].name || "").toLowerCase();
                if (inpName.includes("target")) return true;
            }
        }

        // CHECK 2: Reroute Node
        if (targetNode.type === "Reroute") {
            if (_rcLeadsToRemote(graph, targetNode, 0, visited)) return true;
        }

        // CHECK 3: Subgraph / Group
        const inner = _rcGetInnerGraph(targetNode);
        if (inner) {
            const inputIdx = link.target_slot;
            const innerNodes = inner._nodes || inner.nodes || [];
            const groupInput = innerNodes.find(n => n.type === "GroupInput" || n.type === "Primitive");
            
            if (groupInput) {
                if (_rcLeadsToRemote(inner, groupInput, inputIdx, new Set())) return true;
            }
        }
    }
    return false;
}

// =========================================================
// 4. UI COMPONENTS
// =========================================================

function _rcFindNodeGlobal(key) {
    if (!key) return null;
    const parts = String(key).split(":");
    let currentGraph = app.graph;
    let node = null;
    for (const pid of parts) {
        if (!currentGraph) return null;
        node = _rcGetNode(currentGraph, parseInt(pid));
        if (!node) return null;
        currentGraph = _rcGetInnerGraph(node);
    }
    return node;
}

function _rcFindNodeByExecutionId(uniqueId) {
    if (uniqueId == null) return null;

    const key = String(uniqueId).trim();
    if (!key) return null;

    if (key.includes(":")) {
        const chainNode = _rcFindNodeGlobal(key);
        if (chainNode) return chainNode;
    }

    const numericId = Number(key);
    if (!Number.isNaN(numericId)) {
        const direct = _rcGetNode(app.graph, numericId);
        if (direct) return direct;
    }

    const entries = [];
    _rcTraverseGlobal(app.graph, [], "Root", entries);
    return entries.find(entry => String(entry.node?.id) === key)?.node || null;
}

function _rcApplyRuntimeStatusUpdate(detail) {
    const node = _rcFindNodeByExecutionId(detail?.node_id);
    if (!node || !node.widgets) return;

    const statusName = detail?.status_name || "node_status";
    const statusWidget = node.widgets.find(w => w.name === statusName || w.name?.endsWith(`:${statusName}`));
    const modeWidget = node.widgets.find(w => w.name === "mode_select" || w.name?.endsWith(":mode_select"));

    if (statusWidget) {
        statusWidget.value = !!detail.active;
        if (statusWidget.callback) {
            try { statusWidget.callback(statusWidget.value); } catch (err) { console.error("Remote status callback error:", err); }
        }
    }

    if (modeWidget && typeof detail.mode_select === "boolean") {
        modeWidget.value = !!detail.mode_select;
        if (modeWidget.callback) {
            try { modeWidget.callback(modeWidget.value); } catch (err) { console.error("Remote mode callback error:", err); }
        }
    }

    _rcEnforceLogic(node);
    if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
    if (app.canvas) app.canvas.setDirty(true, true);
}

function _rcTraverseGlobal(graph, chain, pathLabel, outList) {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
        if (!n.id) continue;
        const title = n.title || n.type || ("Node " + n.id);
        const myChain = [...chain, n.id];
        const uniqueKey = myChain.join(":");
        const inner = _rcGetInnerGraph(n);
        
        const t = (n.type || "").toLowerCase();
        const ignore = t === "primitive" || t === "reroute" || t.includes("note") || t.startsWith("set") || t.startsWith("get");
        
        if (!inner && !ignore) {
            outList.push({ node: n, title: title, path: pathLabel, key: uniqueKey });
        }
        if (inner) {
            const nextPath = (pathLabel === "Root") ? title : `${pathLabel} > ${title}`;
            _rcTraverseGlobal(inner, myChain, nextPath, outList);
        }
    }
}

function _rcShowPickerModal(currentVal, onSelect) {
    try { if (window._rcPickerClosingUntil && performance.now() < window._rcPickerClosingUntil) return; } catch(e) {}

    const entries = [];
    _rcTraverseGlobal(app.graph, [], "Root", entries);
    
    const groups = {};
    for (const e of entries) {
        if (!groups[e.path]) groups[e.path] = [];
        groups[e.path].push(e);
    }
    const paths = Object.keys(groups).sort((a,b) => a==="Root" ? -1 : a.localeCompare(b));

    const overlay = document.createElement("div"); overlay.className = "remote-picker-overlay";
    const modal = document.createElement("div"); modal.className = "remote-picker-modal";
    const header = document.createElement("div"); header.className = "remote-picker-header";
    const search = document.createElement("input"); search.className = "remote-picker-search"; search.placeholder = "Search...";
    const list = document.createElement("div"); list.className = "remote-picker-list";
    
    header.appendChild(search); modal.appendChild(header); modal.appendChild(list); overlay.appendChild(modal);
    
    let activeGroup = null;
    if (currentVal) {
        const found = entries.find(e => e.key === currentVal);
        if (found) activeGroup = found.path;
    }

    const render = () => {
        list.innerHTML = "";
        const term = search.value.toLowerCase().trim();
        if (term) {
            const hits = entries.filter(e => e.title.toLowerCase().includes(term) || String(e.node.id).includes(term));
            if (hits.length === 0) list.innerHTML = `<div style="padding:20px;text-align:center;color:#666">No results</div>`;
            else hits.forEach(e => addItem(e, list));
            return;
        }
        for (const p of paths) {
            const grp = document.createElement("div"); grp.className = "remote-group-header";
            if (p === activeGroup) grp.classList.add("active");
            grp.innerHTML = `<span>${p}</span><span class="arrow">${p===activeGroup?'▼':'▶'}</span>`;
            grp.onclick = () => { activeGroup = (activeGroup===p ? null : p); render(); };
            const content = document.createElement("div"); content.className = "remote-group-content";
            if (p === activeGroup) content.classList.add("open");
            groups[p].sort((a,b)=>a.title.localeCompare(b.title));
            groups[p].forEach(e => addItem(e, content));
            list.appendChild(grp); list.appendChild(content);
        }
    };

    const addItem = (entry, parent) => {
        const item = document.createElement("div"); item.className = "remote-picker-item";
        if (entry.key === currentVal) item.classList.add("selected");
        item.innerHTML = `<div class="remote-item-title">${entry.title}</div><div class="remote-item-meta">ID: ${entry.node.id}</div>`;
        item.onclick = (e) => {
    e.preventDefault();
    if(e.stopImmediatePropagation) e.stopImmediatePropagation();
    e.stopPropagation();
    try { window._rcPickerClosingUntil = performance.now() + 250; } catch(err) {}

    try {
        onSelect(entry.key);
    } catch(err) {
        console.error("Remote picker onSelect error (ignored so menu can close):", err);
    } finally {
        setTimeout(()=>{ try{ document.body.removeChild(overlay);}catch(err2){} }, 0);
    }
};
        parent.appendChild(item);
    };

    search.oninput = render;
    overlay.onclick = (e) => { if(e.target===overlay) document.body.removeChild(overlay); };
    document.body.appendChild(overlay);
    render();
    setTimeout(()=>search.focus(), 50);
}

// =========================================================
// 5. WIDGET TRANSFORMERS
// =========================================================

const _rcReplaceWithPicker = (node, widget) => {
    if (widget.type === "REMOTE_PICKER") return;

    const newW = {
        name: widget.name,
        label: (widget.label ?? (widget.options && widget.options.label)),
        type: "REMOTE_PICKER",
        value: widget.value,
        options: widget.options || { serialize: true },
        y: widget.y,
        callback: widget.callback,
        computeSize: () => [0, 26],
    };

    newW.draw = function(ctx, node, wWidth, y, wHeight) {
        // Display label should follow user renames (ComfyUI typically stores that in widget.label)
        // while internal behavior should continue to rely on widget.name.
        let label = (this.label ?? this.name).split(":").pop().trim();
        const lLow = label.toLowerCase();

        // Label Mapping (ONLY when user hasn't renamed the label)
        const map = {
            "target_node_a": "target_a", "target_node_b": "target_b",
            "target_node_a1": "target_a1", "target_node_a2": "target_a2",
            "target_node_b1": "target_b1", "target_node_b2": "target_b2",
            "target_node": "target",
            "target_node_1": "target_1", "target_node_2": "target_2", "target_node_3": "target_3"
        };
        if (!this.label && map[lLow]) label = map[lLow];
        if(this.value) label += ` [${this.value}]`;

        const isPrim = (node.type === "Primitive" || node.comfyClass === "PrimitiveNode");
        const margin = isPrim ? 5 : 14.5;
        const H = 22;
        const boxY = y + (wHeight - H)/2;
        const textY = boxY + H/2 + 1;

        ctx.fillStyle = "#222"; ctx.beginPath();
        ctx.roundRect(margin, boxY, wWidth - margin*2, H, H/2);
        ctx.fill(); ctx.strokeStyle = "#666"; ctx.lineWidth = 1; ctx.stroke();

        ctx.fillStyle = "#888"; ctx.font = "12px Arial"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(label, margin+10, textY);

        let valTxt = "None";
        ctx.fillStyle = "#555";
        if(this.value) {
            const t = _rcFindNodeGlobal(this.value);
            if(t) {
                valTxt = t.title || t.type || ("Node "+t.id);
                ctx.fillStyle = "#DDD";
            } else {
                valTxt = "Missing";
            }
        }
        ctx.textAlign = "right";
        ctx.fillText(valTxt, wWidth - margin - 10, textY);
        this._hitY = boxY; this._hitH = wHeight;
    };

    newW.mouse = function(e, pos, n) {
        try { if (window._rcPickerClosingUntil && performance.now() < window._rcPickerClosingUntil) return true; } catch(e) {}

        const t = e && e.type;

        // Allow right-click to reach widget context menu
        if (e && e.button === 2) return false;

        // Open picker on pointerdown/mousedown/click (linked LegacyWidgets often dispatch click)
        if(t === "pointerdown" || t === "mousedown" || t === "click") {
            _rcShowPickerModal(this.value, (k)=>{
                this.value = k;
                if(this.callback) { try { this.callback(k); } catch(err) { console.error('Remote picker callback error:', err); } }
                n.setDirtyCanvas(true, true);
            });
            if(e.stopImmediatePropagation) e.stopImmediatePropagation();
            if(e.stopPropagation) e.stopPropagation();
            return true;
        }

        // Consume mouseup so the default value editor doesn't open
        if(t === "mouseup") {
            if(e.stopImmediatePropagation) e.stopImmediatePropagation();
            if(e.stopPropagation) e.stopPropagation();
            return true;
        }

        return false;
    };

// Some linked/promoted widgets are wrapped as LegacyWidgets and trigger onClick instead of mouse events.
newW.onClick = function(pos, n) {
        try { if (window._rcPickerClosingUntil && performance.now() < window._rcPickerClosingUntil) return true; } catch(e) {}

    _rcShowPickerModal(this.value, (k)=>{
        this.value = k;
        if(this.callback) { try { this.callback(k); } catch(err) { console.error('Remote picker callback error:', err); } }
        n.setDirtyCanvas(true, true);
    });
    return true;
};


    newW.getOptions = function(n) { return [{content: "Convert to Input", callback: () => { if(n.convertWidgetToInput) n.convertWidgetToInput(newW); }}]; };

    const idx = node.widgets.indexOf(widget);
    node.widgets[idx] = newW;
    
    if(!node._rcClickFixed) {
        const oldDown = node.onMouseDown;
        node.onMouseDown = function(e, pos, c) {
            if(this.widgets) {
                for(const w of this.widgets) {
                    if(w.type === "REMOTE_PICKER" && w._hitY !== undefined) {
                        if(pos[1] >= w._hitY && pos[1] <= w._hitY + w._hitH) {
                            w.mouse(e, pos, this);
                            return true;
                        }
                    }
                }
            }
            if(oldDown) return oldDown.apply(this, arguments);
        };
        node._rcClickFixed = true;
    }
};

const _rcFixToggleDraw = (w) => {
    if(w._rcFixed) return;
    w.draw = function(ctx, node, wWidth, y, wHeight) {
        // Display label should follow user renames (widget.label), but logic keys off internal name.
        let label = (this.label ?? this.name).split(":").pop().trim();
        const lLow = label.toLowerCase();

        const _internal = (this.name || "").split(":").pop().trim().toLowerCase();
        const lBase = _internal.replace(/_\d+$/, "");
        
        const isPrim = (node.type === "Primitive" || node.comfyClass === "PrimitiveNode");
        const margin = isPrim ? 5 : 14.5;
        const H = 22;
        const boxY = y + (wHeight - H)/2;
        const textY = boxY + H/2 + 1;

        ctx.fillStyle = "#222"; ctx.beginPath();
        ctx.roundRect(margin, boxY, wWidth - margin*2, H, H/2);
        ctx.fill(); ctx.strokeStyle = "#666"; ctx.lineWidth = 1; ctx.stroke();

        ctx.fillStyle = "#888"; ctx.font = "12px Arial"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(label, margin+10, textY);

        let valStr = String(this.value);
        let dot = "#777";

        if(lBase === "node_status") {
            if(String(this.value)==="true" || String(this.value).toLowerCase()==="active") {
                valStr = "Active"; dot = "#66afef";
            } else {
                valStr = "Mute/Bypass"; dot = "#777";
            }
        } else if(lBase === "switch_status") {
            valStr = this.value ? "A Active B Inactive" : "B Active A Inactive";
            dot = "#66afef";
        } else if(lBase === "mode_select") {
            valStr = this.value ? "Mute" : "Bypass";
            dot = (String(this.value).toLowerCase() === "true") ? "#66afef" : "#777";
        }

        const dotX = wWidth - margin - 10;
        ctx.beginPath(); ctx.arc(dotX - 5, textY, 4, 0, Math.PI*2); ctx.fillStyle = dot; ctx.fill();
        ctx.textAlign = "right"; ctx.fillStyle = "#DDD"; ctx.fillText(valStr, dotX - 15, textY);
    };
    w._rcFixed = true;
};

const _rcEnforceLogic = (node) => {
    if(!node.widgets) return;
    const switchW = node.widgets.find(w => w.name === "node_status" || w.name === "switch_status");
    const modeW = node.widgets.find(w => w.name === "mode_select");
    if(!modeW) return;

    // Determine active state: from widget value, or from a wired boolean input connection.
    // A connected True = active; connected False = mute/bypass.
    let switchActive;
    if (switchW) {
        switchActive = switchW.value;
    } else {
        const boolFromInput = _rcReadInputBool(app.graph, node, "node_status")
                           ?? _rcReadInputBool(app.graph, node, "switch_status");
        if (boolFromInput === null) return;
        switchActive = boolFromInput;
    }

    const targets = node.widgets.filter(w => w.type === "REMOTE_PICKER");
    const isSwitch = (node.comfyClass || "").includes("Switch");
    let changed = false;

    const getMode = (active) => {
        if(active) return 0; 
        const m = typeof modeW.value === "boolean" ? (modeW.value ? "Mute" : "Bypass") : modeW.value;
        return (m === "Mute") ? 2 : 4; 
    };

    for(const w of targets) {
        if(!w.value) continue;
        const target = _rcFindNodeGlobal(w.value);
        if(target) {
            let active = false;
            if(isSwitch) {
                if(w.name.includes("_A")) active = switchActive;
                else if(w.name.includes("_B")) active = !switchActive;
                else active = true;
            } else {
                active = switchActive;
            }
            const mode = getMode(active);
            if(target.mode !== mode) {
                target.mode = mode;
                if(target.setDirtyCanvas) target.setDirtyCanvas(true, true);
                changed = true;
            }
        }
    }
    if(changed) app.canvas.setDirty(true, true);
};

// =========================================================
// 5b. STACKER — Constants & Helpers
// =========================================================

const _STACKER_COLORS = {
    active:   { dot: "#84a484", dotBorder: "#6a8a6a", text: "#b8ccb8" },
    muted:    { dot: "#4a4a4a", dotBorder: "#3a3a3a", textOpacity: 0.35 },
    bypassed: { dot: "#8a7aaa", dotBorder: "#6a5a8a", text: "#a090c0" },
};

const _STACKER_REMOTE_CLASSES = ["remotecontrol", "remotecontrolmulti", "remoteswitch", "remoteswitchmulti"];

function _rcIsRemoteNode(node) {
    if (!node) return false;
    const cc = (node.comfyClass || "").toLowerCase();
    return _STACKER_REMOTE_CLASSES.includes(cc);
}

/** Recursively traverse all graphs (root + subgraphs) and return Remote Control
 *  nodes as { node, key (chain key), title, path } entries. */
function _rcFindAllRemoteEntries() {
    const entries = [];
    const _traverse = (graph, chain, pathLabel) => {
        if (!graph) return;
        const nodes = graph._nodes || graph.nodes || [];
        for (const n of nodes) {
            if (!n.id) continue;
            const myChain = [...chain, n.id];
            const uniqueKey = myChain.join(":");
            const inner = _rcGetInnerGraph(n);

            if (_rcIsRemoteNode(n)) {
                const title = n.title || n.type || ("Node " + n.id);
                entries.push({ node: n, key: uniqueKey, title: title, path: pathLabel });
            }

            if (inner) {
                const nextPath = (pathLabel === "Root") ? (n.title || n.type || "Subgraph") : `${pathLabel} > ${n.title || n.type || "Subgraph"}`;
                _traverse(inner, myChain, nextPath);
            }
        }
    };
    _traverse(app.graph, [], "Root");
    return entries;
}

function _rcGetAllStackerNodes() {
    if (!app.graph || !app.graph._nodes) return [];
    return app.graph._nodes.filter(n => (n.comfyClass || "").toLowerCase() === "remotestacker");
}

/** Resolve a chain key to a node, using _rcFindNodeGlobal (handles subgraphs). */
function _rcResolveKey(key) {
    return _rcFindNodeGlobal(key);
}

function _rcGetRemoteNodeState(remoteNode) {
    if (!remoteNode || (!remoteNode.widgets && !remoteNode.inputs)) return { active: true, mode: "bypass" };
    const statusW = remoteNode.widgets ? remoteNode.widgets.find(w => w.name === "node_status" || w.name === "switch_status") : null;
    const modeW = remoteNode.widgets ? remoteNode.widgets.find(w => w.name === "mode_select") : null;
    let active;
    if (statusW) {
        active = !!statusW.value;
    } else {
        const fromInput = _rcReadInputBool(app.graph, remoteNode, "node_status")
                       ?? _rcReadInputBool(app.graph, remoteNode, "switch_status");
        active = fromInput !== null ? fromInput : true;
    }
    const mode = modeW ? (modeW.value ? "mute" : "bypass") : "bypass";
    return { active, mode };
}

function _rcSetRemoteNodeState(remoteNode, active, mode) {
    if (!remoteNode || !remoteNode.widgets) return;
    const statusW = remoteNode.widgets.find(w => w.name === "node_status" || w.name === "switch_status");
    const modeW = remoteNode.widgets.find(w => w.name === "mode_select");
    if (statusW) {
        statusW.value = active;
        if (statusW.callback) try { statusW.callback(active); } catch(e) {}
    }
    if (modeW) {
        const mVal = (mode === "mute");
        modeW.value = mVal;
        if (modeW.callback) try { modeW.callback(mVal); } catch(e) {}
    }
    _rcEnforceLogic(remoteNode);
    if (remoteNode.setDirtyCanvas) remoteNode.setDirtyCanvas(true, true);
}

// =========================================================
// 5c. STACKER — Core Logic
// =========================================================

/** Initial scan: claim all unowned Remote nodes (runs once on first creation). */
function _rcStackerInitialScan(stackerNode) {
    if (stackerNode.properties._rcInitialScanDone) return;
    stackerNode.properties._rcInitialScanDone = true;

    const allEntries = _rcFindAllRemoteEntries();
    const allStackers = _rcGetAllStackerNodes();

    const ownedByOthers = new Set();
    for (const s of allStackers) {
        if (s.id === stackerNode.id) continue;
        const sKeys = (s.properties && s.properties._rcOwnedKeys) || [];
        for (const k of sKeys) ownedByOthers.add(k);
    }

    for (const entry of allEntries) {
        if (ownedByOthers.has(entry.key)) continue;
        if (stackerNode.properties._rcOwnedKeys.includes(entry.key)) continue;
        stackerNode.properties._rcOwnedKeys.push(entry.key);
    }
}

/** Validate owned keys: fix broken chain keys from node relocation between subgraphs. */
function _rcStackerValidateKeys(stackerNode) {
    const ownedKeys = stackerNode.properties._rcOwnedKeys || [];
    if (ownedKeys.length === 0) return;

    let anyChanged = false;
    const allEntries = null; // lazy-load only if needed
    const updatedKeys = [];

    for (let i = 0; i < ownedKeys.length; i++) {
        const key = ownedKeys[i];
        const resolved = _rcResolveKey(key);
        if (resolved && _rcIsRemoteNode(resolved)) {
            updatedKeys.push(key);
            continue;
        }

        // Key broken — attempt relocation recovery
        // Lazy-load traversal results
        const entries = allEntries || _rcFindAllRemoteEntries();

        // Gather keys owned by other stackers
        const allStackers = _rcGetAllStackerNodes();
        const ownedByOthers = new Set();
        for (const s of allStackers) {
            if (s.id === stackerNode.id) continue;
            const sKeys = (s.properties && s.properties._rcOwnedKeys) || [];
            for (const k of sKeys) ownedByOthers.add(k);
        }

        // Strategy: find an unowned entry whose node has the same comfyClass
        // and title as what we had. Since we stored the key, extract what info we can.
        // The node might have a new chain key after relocation.
        let newKey = null;
        const alreadyClaimed = new Set(updatedKeys);
        for (const entry of entries) {
            if (ownedByOthers.has(entry.key)) continue;
            if (alreadyClaimed.has(entry.key)) continue;
            if (ownedKeys.includes(entry.key) && entry.key !== key) continue;
            // This entry is unclaimed — accept it as the relocated node
            // We can't do perfect matching without the old node ref, so
            // just match any unclaimed Remote node not already in our list
            newKey = entry.key;
            break;
        }

        if (newKey) {
            updatedKeys.push(newKey);
            // Migrate saved state
            if (stackerNode.properties._rcSavedStates && stackerNode.properties._rcSavedStates[key]) {
                stackerNode.properties._rcSavedStates[newKey] = stackerNode.properties._rcSavedStates[key];
                delete stackerNode.properties._rcSavedStates[key];
            }
            anyChanged = true;
        } else {
            // Node truly gone — keep the broken key so user sees "(missing)" and can remove
            updatedKeys.push(key);
        }
    }

    if (anyChanged) {
        stackerNode.properties._rcOwnedKeys = updatedKeys;
    }
}

/** Get all unstacked Remote node entries (not owned by any stacker). */
function _rcGetUnstackedEntries() {
    const allEntries = _rcFindAllRemoteEntries();
    const allStackers = _rcGetAllStackerNodes();
    const ownedByAll = new Set();
    for (const s of allStackers) {
        const sKeys = (s.properties && s.properties._rcOwnedKeys) || [];
        for (const k of sKeys) ownedByAll.add(k);
    }
    return allEntries.filter(e => !ownedByAll.has(e.key));
}

function _rcStackerAddNode(stackerNode, remoteKey) {
    if (!stackerNode.properties._rcOwnedKeys) stackerNode.properties._rcOwnedKeys = [];
    if (!stackerNode.properties._rcOwnedKeys.includes(remoteKey)) {
        stackerNode.properties._rcOwnedKeys.push(remoteKey);
    }
}

function _rcStackerRemoveNode(stackerNode, remoteKey) {
    if (!stackerNode.properties || !stackerNode.properties._rcOwnedKeys) return;
    stackerNode.properties._rcOwnedKeys = stackerNode.properties._rcOwnedKeys.filter(k => k !== remoteKey);
    if (stackerNode.properties._rcSavedStates) {
        delete stackerNode.properties._rcSavedStates[remoteKey];
    }
}

function _rcStackerMoveNode(fromStacker, toStacker, remoteKey) {
    // Migrate saved state if present
    if (fromStacker.properties._rcSavedStates && fromStacker.properties._rcSavedStates[remoteKey]) {
        if (!toStacker.properties._rcSavedStates) toStacker.properties._rcSavedStates = {};
        toStacker.properties._rcSavedStates[remoteKey] = fromStacker.properties._rcSavedStates[remoteKey];
    }
    _rcStackerRemoveNode(fromStacker, remoteKey);
    _rcStackerAddNode(toStacker, remoteKey);
    if (fromStacker.setDirtyCanvas) fromStacker.setDirtyCanvas(true, true);
    if (toStacker.setDirtyCanvas) toStacker.setDirtyCanvas(true, true);
}

function _rcStackerApplyGlobal(stackerNode) {
    if (!stackerNode.properties) return;
    const globalMode = stackerNode.properties._rcStackerMode || "user";
    const ownedKeys = stackerNode.properties._rcOwnedKeys || [];

    if (globalMode === "user") {
        const saved = stackerNode.properties._rcSavedStates || {};
        for (const key of ownedKeys) {
            const rn = _rcResolveKey(key);
            if (!rn || !_rcIsRemoteNode(rn)) continue;
            if (saved[key]) {
                _rcSetRemoteNodeState(rn, saved[key].active, saved[key].mode);
            }
        }
        return;
    }

    if (!stackerNode.properties._rcSavedStates) stackerNode.properties._rcSavedStates = {};
    for (const key of ownedKeys) {
        const rn = _rcResolveKey(key);
        if (!rn || !_rcIsRemoteNode(rn)) continue;
        if (!stackerNode.properties._rcSavedStates[key]) {
            stackerNode.properties._rcSavedStates[key] = _rcGetRemoteNodeState(rn);
        }
        _rcSetRemoteNodeState(rn, false, globalMode);
    }
}

function _rcStackerSetMode(stackerNode, mode) {
    if (!stackerNode.properties) stackerNode.properties = {};
    const prev = stackerNode.properties._rcStackerMode || "user";

    if (mode === "user") {
        stackerNode.properties._rcStackerMode = "user";
        _rcStackerApplyGlobal(stackerNode);
        stackerNode.properties._rcSavedStates = {};
    } else {
        if (prev === "user") {
            stackerNode.properties._rcSavedStates = {};
        }
        stackerNode.properties._rcStackerMode = mode;
        _rcStackerApplyGlobal(stackerNode);
    }

    if (stackerNode.setDirtyCanvas) stackerNode.setDirtyCanvas(true, true);
    app.canvas.setDirty(true, true);
}

// =========================================================
// 5d. STACKER — Add Picker & Move Dropdown
// =========================================================

/** Show picker modal for adding unstacked Remote nodes to a stacker. */
function _rcShowAddPicker(stackerNode) {
    const unstacked = _rcGetUnstackedEntries();

    if (unstacked.length === 0) {
        const overlay = document.createElement("div");
        overlay.className = "remote-picker-overlay";
        overlay.innerHTML = `<div class="remote-picker-modal" style="padding:30px;text-align:center;">
            <div style="color:#999;font-size:14px;">No unstacked Remote nodes found</div>
            <div style="color:#666;font-size:12px;margin-top:8px;">All Remote Control nodes are already in a stacker</div>
        </div>`;
        overlay.onclick = () => document.body.removeChild(overlay);
        document.body.appendChild(overlay);
        return;
    }

    // Build groups by path
    const groups = {};
    for (const e of unstacked) {
        if (!groups[e.path]) groups[e.path] = [];
        groups[e.path].push(e);
    }
    const paths = Object.keys(groups).sort((a, b) => a === "Root" ? -1 : a.localeCompare(b));

    const overlay = document.createElement("div");
    overlay.className = "remote-picker-overlay";
    const modal = document.createElement("div");
    modal.className = "remote-picker-modal";
    const header = document.createElement("div");
    header.className = "remote-picker-header";
    header.innerHTML = `<div style="color:#ccc;font-size:14px;font-weight:bold;">Add to Stacker</div>`;
    const search = document.createElement("input");
    search.className = "remote-picker-search";
    search.placeholder = "Search nodes...";
    const list = document.createElement("div");
    list.className = "remote-picker-list";

    header.appendChild(search);
    modal.appendChild(header);
    modal.appendChild(list);
    overlay.appendChild(modal);

    let activeGroup = paths.length === 1 ? paths[0] : null;

    const addItem = (entry, parent) => {
        const item = document.createElement("div");
        item.className = "remote-picker-item";
        const typeName = entry.node ? (entry.node.comfyClass || entry.node.type || "") : "";
        const pathInfo = entry.path !== "Root" ? ` <span style="color:#555;font-size:10px;">[${entry.path}]</span>` : "";
        item.innerHTML = `<div class="remote-item-title">${entry.title}${pathInfo}</div><div class="remote-item-meta">${typeName}</div>`;
        item.onclick = (ev) => {
            ev.stopPropagation();
            _rcStackerAddNode(stackerNode, entry.key);
            // Apply global override if active
            const globalMode = stackerNode.properties._rcStackerMode || "user";
            if (globalMode !== "user") {
                const rn = _rcResolveKey(entry.key);
                if (rn && _rcIsRemoteNode(rn)) {
                    if (!stackerNode.properties._rcSavedStates) stackerNode.properties._rcSavedStates = {};
                    stackerNode.properties._rcSavedStates[entry.key] = _rcGetRemoteNodeState(rn);
                    _rcSetRemoteNodeState(rn, false, globalMode);
                }
            }
            stackerNode.setDirtyCanvas(true, true);
            document.body.removeChild(overlay);
        };
        parent.appendChild(item);
    };

    const render = () => {
        list.innerHTML = "";
        const term = search.value.toLowerCase().trim();
        if (term) {
            const hits = unstacked.filter(e =>
                e.title.toLowerCase().includes(term) ||
                e.key.includes(term) ||
                e.path.toLowerCase().includes(term)
            );
            if (hits.length === 0) {
                list.innerHTML = `<div style="padding:20px;text-align:center;color:#666">No results</div>`;
            } else {
                hits.forEach(e => addItem(e, list));
            }
            return;
        }
        for (const p of paths) {
            const grp = document.createElement("div");
            grp.className = "remote-group-header";
            if (p === activeGroup) grp.classList.add("active");
            grp.innerHTML = `<span>${p}</span><span class="arrow">${p === activeGroup ? '▼' : '▶'}</span>`;
            grp.onclick = () => { activeGroup = (activeGroup === p ? null : p); render(); };
            const content = document.createElement("div");
            content.className = "remote-group-content";
            if (p === activeGroup) content.classList.add("open");
            groups[p].sort((a, b) => a.title.localeCompare(b.title));
            groups[p].forEach(e => addItem(e, content));
            list.appendChild(grp);
            list.appendChild(content);
        }
    };

    search.addEventListener("input", render);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) document.body.removeChild(overlay); });

    document.body.appendChild(overlay);
    render();
    setTimeout(() => search.focus(), 50);
}

/** Show move dropdown at a specific position on the canvas. */
function _rcShowMoveDropdown(fromStacker, remoteKey, screenX, screenY) {
    const otherStackers = _rcGetAllStackerNodes().filter(s => s.id !== fromStacker.id);

    // Remove any existing dropdown
    const existing = document.querySelector(".rc-move-dropdown");
    if (existing) existing.remove();

    const dropdown = document.createElement("div");
    dropdown.className = "rc-move-dropdown";
    dropdown.style.cssText = `
        position: fixed; z-index: 10000;
        left: ${screenX}px; top: ${screenY}px;
        background: #2a2d35; border: 1px solid #4a4d55;
        border-radius: 6px; padding: 4px 0;
        min-width: 180px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    `;

    if (otherStackers.length === 0) {
        const item = document.createElement("div");
        item.style.cssText = "padding:10px 16px;color:#999;font-size:12px;text-align:center;";
        item.textContent = "Add a stacker to move nodes";
        dropdown.appendChild(item);
    } else {
        for (const target of otherStackers) {
            const item = document.createElement("div");
            item.style.cssText = `
                padding: 8px 16px; color: #ddd; font-size: 12px;
                cursor: pointer; transition: background 0.15s;
            `;
            item.textContent = "Move to " + (target.title || "Stacker") + " #" + target.id;
            item.onmouseenter = () => { item.style.background = "#3a3d4a"; };
            item.onmouseleave = () => { item.style.background = "transparent"; };
            item.onclick = (ev) => {
                ev.stopPropagation();
                _rcStackerMoveNode(fromStacker, target, remoteKey);
                dropdown.remove();
                overlay.remove();
            };
            dropdown.appendChild(item);
        }
    }

    // Overlay to catch clicks outside dropdown
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;";
    overlay.onclick = () => { dropdown.remove(); overlay.remove(); };

    document.body.appendChild(overlay);
    document.body.appendChild(dropdown);
}

// =========================================================
// 5e. STACKER — Custom Drawing
// =========================================================

function _rcStackerDraw(stackerNode, ctx) {
    if (!stackerNode.properties) stackerNode.properties = {};
    if (!stackerNode.properties._rcOwnedKeys) stackerNode.properties._rcOwnedKeys = [];
    if (!stackerNode.properties._rcStackerMode) stackerNode.properties._rcStackerMode = "user";

    const globalMode = stackerNode.properties._rcStackerMode;
    const ownedKeys = stackerNode.properties._rcOwnedKeys;
    const margin = 14.5;
    const rowH = 28;
    const btnH = 22;
    const headerH = 30;
    const addBtnH = 26;
    const pad = 6;

    // Compute required height
    const totalH = headerH + (ownedKeys.length * rowH) + addBtnH + pad * 2;
    const nodeW = stackerNode.size[0];

    if (Math.abs(stackerNode.size[1] - totalH) > 2) {
        stackerNode.size[1] = totalH;
    }

    if (!stackerNode._rcHitAreas) stackerNode._rcHitAreas = {};
    stackerNode._rcHitAreas = {};

    let y = 0;

    // --- HEADER: User / Mute / Bypass buttons ---
    const btnLabels = ["User", "Mute", "Bypass"];
    const btnModes = ["user", "mute", "bypass"];
    const btnColors = {
        user:   { bg: "#4a6b4a", border: "#6a9a6a", text: "#c8e6c8" },
        mute:   { bg: "#333", border: "#555", text: "#aaa", opacity: 0.35 },
        bypass: { bg: "#554a6b", border: "#7a6a9a", text: "#d8c8e6" },
    };
    const inactiveBtnColor = { bg: "#333", border: "#666", text: "#aaa" };

    const totalBtnWidth = btnLabels.reduce((sum, lbl) => sum + ctx.measureText(lbl).width + 16, 0) + (btnLabels.length - 1) * 3;
    let btnX = nodeW - margin - totalBtnWidth;
    const btnY = y + (headerH - btnH) / 2;

    ctx.font = "bold 10px Arial";

    for (let i = 0; i < btnLabels.length; i++) {
        const lbl = btnLabels[i];
        const mode = btnModes[i];
        const isActive = (globalMode === mode);
        const col = isActive ? btnColors[mode] : inactiveBtnColor;
        const bw = ctx.measureText(lbl).width + 16;

        ctx.fillStyle = col.bg;
        if (col.opacity) ctx.globalAlpha = col.opacity;
        ctx.beginPath();
        ctx.roundRect(btnX, btnY, bw, btnH, 3);
        ctx.fill();
        ctx.strokeStyle = col.border;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = col.text;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(lbl, btnX + bw / 2, btnY + btnH / 2);
        if (col.opacity) ctx.globalAlpha = 1.0;

        stackerNode._rcHitAreas["btn_" + mode] = { x: btnX, y: btnY, w: bw, h: btnH };
        btnX += bw + 3;
    }

    y += headerH;

    // --- DIVIDER ---
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, y);
    ctx.lineTo(nodeW - margin, y);
    ctx.stroke();

    // --- ROWS ---
    const isGlobalOverride = (globalMode !== "user");

    for (let ri = 0; ri < ownedKeys.length; ri++) {
        const remoteKey = ownedKeys[ri];
        const remoteNode = _rcResolveKey(remoteKey);
        const rowY = y + ri * rowH;
        const rowCenterY = rowY + rowH / 2;

        if (!remoteNode || !_rcIsRemoteNode(remoteNode)) {
            // Dead reference — draw dimmed
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = "#888";
            ctx.font = "12px Arial";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText("(missing node " + remoteKey + ")", margin + 8, rowCenterY);
            ctx.globalAlpha = 1.0;

            // Move + Remove buttons even for missing nodes
            const moveX = nodeW - margin - 36;
            ctx.fillStyle = "#555";
            ctx.font = "11px Arial";
            ctx.textAlign = "center";
            ctx.fillText("→", moveX + 8, rowCenterY);
            stackerNode._rcHitAreas["move_" + ri] = { x: moveX, y: rowY, w: 16, h: rowH, remoteKey: remoteKey };

            const xBtnX = nodeW - margin - 16;
            ctx.fillStyle = "#666";
            ctx.fillText("✕", xBtnX + 8, rowCenterY);
            stackerNode._rcHitAreas["remove_" + ri] = { x: xBtnX, y: rowY, w: 16, h: rowH, remoteKey: remoteKey };
            continue;
        }

        const state = _rcGetRemoteNodeState(remoteNode);
        let rowState;
        if (isGlobalOverride) {
            rowState = (globalMode === "mute") ? "muted" : "bypassed";
        } else {
            rowState = state.active ? "active" : (state.mode === "mute" ? "muted" : "bypassed");
        }

        const colors = _STACKER_COLORS[rowState === "active" ? "active" : rowState];
        const isMuted = (rowState === "muted");

        // --- Row title (always reflects actual state) ---
        if (isMuted) ctx.globalAlpha = colors.textOpacity;
        const title = remoteNode.title || remoteNode.type || ("Node " + remoteKey);
        ctx.fillStyle = isMuted ? "#ccc" : colors.text;
        ctx.font = "12px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";

        const maxTitleW = nodeW - margin * 2 - 104; // room for M/B + dot + move + X
        let displayTitle = title;
        if (ctx.measureText(displayTitle).width > maxTitleW) {
            while (displayTitle.length > 3 && ctx.measureText(displayTitle + "…").width > maxTitleW) {
                displayTitle = displayTitle.slice(0, -1);
            }
            displayTitle += "…";
        }
        ctx.fillText(displayTitle, margin + 8, rowCenterY);
        if (isMuted) ctx.globalAlpha = 1.0;

        // --- M/B mini toggle ---
        const mbW = 18;
        const mbX = nodeW - margin - 84;
        const mbY = rowCenterY - btnH / 2 + 3;
        const mbLabel = state.mode === "mute" ? "M" : "B";

        if (isMuted) ctx.globalAlpha = colors.textOpacity;
        ctx.fillStyle = "#2a2a2a";
        ctx.beginPath();
        ctx.roundRect(mbX, mbY, mbW, 16, 3);
        ctx.fill();
        ctx.strokeStyle = isMuted ? "#444" : (rowState === "bypassed" ? colors.dotBorder : "#555");
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = isMuted ? "#ccc" : colors.text;
        ctx.font = "bold 9px Arial";
        ctx.textAlign = "center";
        ctx.fillText(mbLabel, mbX + mbW / 2, mbY + 9);
        if (isMuted) ctx.globalAlpha = 1.0;

        if (!isGlobalOverride) {
            stackerNode._rcHitAreas["mb_" + ri] = { x: mbX, y: rowY, w: mbW, h: rowH, remoteKey: remoteKey };
        }

        // --- State dot ---
        const dotR = 6;
        const dotX = nodeW - margin - 54;

        if (isMuted) ctx.globalAlpha = colors.textOpacity;
        ctx.beginPath();
        ctx.arc(dotX, rowCenterY, dotR, 0, Math.PI * 2);
        ctx.fillStyle = colors.dot;
        ctx.fill();
        ctx.strokeStyle = colors.dotBorder;
        ctx.lineWidth = 1;
        ctx.stroke();
        if (isMuted) ctx.globalAlpha = 1.0;

        if (!isGlobalOverride) {
            stackerNode._rcHitAreas["dot_" + ri] = { x: dotX - dotR - 2, y: rowY, w: dotR * 2 + 4, h: rowH, remoteKey: remoteKey };
        }

        // --- Move arrow →  ---
        const moveX = nodeW - margin - 36;
        ctx.fillStyle = "#666";
        ctx.font = "11px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("→", moveX + 8, rowCenterY);
        stackerNode._rcHitAreas["move_" + ri] = { x: moveX, y: rowY, w: 16, h: rowH, remoteKey: remoteKey };

        // --- Remove ✕ ---
        const xBtnX = nodeW - margin - 16;
        ctx.fillStyle = "#666";
        ctx.fillText("✕", xBtnX + 8, rowCenterY);
        stackerNode._rcHitAreas["remove_" + ri] = { x: xBtnX, y: rowY, w: 16, h: rowH, remoteKey: remoteKey };

        // --- Row separator ---
        if (ri < ownedKeys.length - 1) {
            ctx.strokeStyle = "#2a2a2a";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(margin, rowY + rowH);
            ctx.lineTo(nodeW - margin, rowY + rowH);
            ctx.stroke();
        }
    }

    // --- ADD BUTTON ---
    const addY = y + ownedKeys.length * rowH + pad;
    const addX = margin;
    const addW = nodeW - margin * 2;

    ctx.fillStyle = "#2a2a2a";
    ctx.beginPath();
    ctx.roundRect(addX, addY, addW, addBtnH - 4, 4);
    ctx.fill();
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#888";
    ctx.font = "11px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("+ Add", nodeW / 2, addY + (addBtnH - 4) / 2);

    stackerNode._rcHitAreas["add"] = { x: addX, y: addY, w: addW, h: addBtnH };
}

// =========================================================
// 5f. STACKER — Click Handling
// =========================================================

function _rcStackerMouseDown(stackerNode, e, pos) {
    if (!stackerNode._rcHitAreas) return false;
    const [px, py] = pos;

    for (const [key, area] of Object.entries(stackerNode._rcHitAreas)) {
        if (px >= area.x && px <= area.x + area.w && py >= area.y && py <= area.y + area.h) {

            // Header buttons
            if (key === "btn_user") { _rcStackerSetMode(stackerNode, "user"); return true; }
            if (key === "btn_mute") { _rcStackerSetMode(stackerNode, "mute"); return true; }
            if (key === "btn_bypass") { _rcStackerSetMode(stackerNode, "bypass"); return true; }

            // Add button — opens picker
            if (key === "add") {
                _rcShowAddPicker(stackerNode);
                return true;
            }

            // Remove button
            if (key.startsWith("remove_")) {
                _rcStackerRemoveNode(stackerNode, area.remoteKey);
                stackerNode.setDirtyCanvas(true, true);
                return true;
            }

            // Move button — opens dropdown
            if (key.startsWith("move_")) {
                // Convert canvas pos to screen coordinates for the dropdown
                const canvasRect = app.canvas.canvas.getBoundingClientRect();
                const scale = app.canvas.ds.scale || 1;
                const offset = app.canvas.ds.offset || [0, 0];
                const screenX = canvasRect.left + (stackerNode.pos[0] + area.x + area.w) * scale + offset[0] * scale;
                const screenY = canvasRect.top + (stackerNode.pos[1] + area.y + area.h) * scale + offset[1] * scale;
                _rcShowMoveDropdown(stackerNode, area.remoteKey, screenX, screenY);
                return true;
            }

            // State dot toggle
            if (key.startsWith("dot_")) {
                const globalMode = stackerNode.properties._rcStackerMode || "user";
                if (globalMode !== "user") return true;
                const rn = _rcResolveKey(area.remoteKey);
                if (rn && _rcIsRemoteNode(rn)) {
                    const st = _rcGetRemoteNodeState(rn);
                    _rcSetRemoteNodeState(rn, !st.active, st.mode);
                    stackerNode.setDirtyCanvas(true, true);
                }
                return true;
            }

            // M/B toggle
            if (key.startsWith("mb_")) {
                const globalMode = stackerNode.properties._rcStackerMode || "user";
                if (globalMode !== "user") return true;
                const rn = _rcResolveKey(area.remoteKey);
                if (rn && _rcIsRemoteNode(rn)) {
                    const st = _rcGetRemoteNodeState(rn);
                    const newMode = (st.mode === "mute") ? "bypass" : "mute";
                    _rcSetRemoteNodeState(rn, st.active, newMode);
                    stackerNode.setDirtyCanvas(true, true);
                }
                return true;
            }

            return true;
        }
    }
    return false;
}

// =========================================================
// 5g. STACKER — Node Setup
// =========================================================

function _rcInitStacker(node) {
    if (node._rcStackerInit) return;
    node._rcStackerInit = true;

    if (!node.properties) node.properties = {};
    if (!node.properties._rcOwnedKeys) node.properties._rcOwnedKeys = [];
    if (!node.properties._rcStackerMode) node.properties._rcStackerMode = "user";
    if (!node.properties._rcSavedStates) node.properties._rcSavedStates = {};

    // Migrate legacy _rcOwnedIds → _rcOwnedKeys
    if (node.properties._rcOwnedIds) {
        if (!node.properties._rcOwnedKeys.length) {
            node.properties._rcOwnedKeys = node.properties._rcOwnedIds.map(id => String(id));
        }
        delete node.properties._rcOwnedIds;
    }

    // Set minimum size
    node.size[0] = Math.max(node.size[0], 280);

    // Remove default widgets
    if (node.widgets) node.widgets.length = 0;

    // Key validation interval: fixes broken chain keys from node relocation (no auto-add)
    node._rcValidateInterval = setInterval(() => {
        try {
            _rcStackerValidateKeys(node);
        } catch(e) {}
    }, 500);

    // Custom draw
    const origDraw = node.onDrawForeground;
    node.onDrawForeground = function(ctx) {
        try { _rcStackerDraw(node, ctx); } catch(e) { console.error("Stacker draw error:", e); }
        if (origDraw) origDraw.apply(this, arguments);
    };

    // Custom click
    const origDown = node.onMouseDown;
    node.onMouseDown = function(e, pos, canvas) {
        try {
            if (_rcStackerMouseDown(node, e, pos)) return true;
        } catch(err) { console.error("Stacker click error:", err); }
        if (origDown) return origDown.apply(this, arguments);
    };

    // Initial scan: claim all unowned Remote nodes (deferred for subgraph readiness)
    setTimeout(() => {
        try { _rcStackerInitialScan(node); } catch(e) {}
        if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
    }, 300);
    // Second attempt for deeper subgraphs
    setTimeout(() => {
        try {
            // Only re-run if we might have missed some
            const prev = node.properties._rcInitialScanDone;
            node.properties._rcInitialScanDone = false;
            _rcStackerInitialScan(node);
            node.properties._rcInitialScanDone = prev;
        } catch(e) {}
        if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
    }, 1500);
}

// =========================================================
// 6. MAIN HOOKS
// =========================================================

const processNode = (node) => {
    if (!node) return;
    
    // 0. Stacker Node
    if ((node.comfyClass || "").toLowerCase() === "remotestacker") {
        _rcInitStacker(node);
        return;
    }

    // 1. Linked Primitive
    if (node.type === "Primitive" || node.comfyClass === "PrimitiveNode") {
        if (node.outputs && node.outputs[0].links && node.outputs[0].links.length > 0) {
            if (_rcLeadsToRemote(app.graph, node, 0, new Set())) {
                if (node.widgets && node.widgets[0]) _rcReplaceWithPicker(node, node.widgets[0]);
            }
        }
    }
    // 2. Remote Node
    const cc = (node.comfyClass || "").toLowerCase();
    const tt = (node.title || "").toLowerCase();
    if (cc.startsWith("remote") || tt.startsWith("remote")) {
        if (node.widgets) {
            for (const w of node.widgets) {
                const n = w.name.toLowerCase();
                if (n.includes("mode") || n.includes("status")) {
                    _rcFixToggleDraw(w);
                    if (!w._hooked) {
                        const cb = w.callback;
                        w.callback = function(v) { if(cb) cb(v); _rcEnforceLogic(node); };
                        w._hooked = true;
                    }
                }
                if (n.includes("target")) _rcReplaceWithPicker(node, w);
            }
            _rcEnforceLogic(node);
        }
    }
    // 3. Subgraph Outer Node
    const inner = _rcGetInnerGraph(node);
    if (inner && node.widgets) {
        const innerNodes = inner._nodes || inner.nodes || [];
        
        node.widgets.forEach((w) => {

// Ensure outer Subgraph node control toggles keep custom labels
try {
    const _lname0 = (w && w.name ? w.name.split(":").pop().trim().toLowerCase().replace(/_\d+$/, "") : "");
    if (_lname0 === "mode_select" || _lname0 === "switch_status" || _lname0 === "node_status") {
        _rcFixToggleDraw(w);
    }
} catch(e) {}

            if (w.type === "REMOTE_PICKER") return;

            let matchFound = false;

            // STRATEGY A: Check for Input Slots (Wires)
            const inputIdx = node.inputs ? node.inputs.findIndex(inp => inp.name === w.name) : -1;
            if (inputIdx !== -1) {
                const gi = innerNodes.find(n => n.type === "GroupInput" || n.type === "Primitive");
                if (gi) {
                    if (_rcLeadsToRemote(inner, gi, inputIdx, new Set())) {
                        matchFound = true;
                    }
                }
            }

            // STRATEGY B: Check for Fuzzy Widget Name Match (FIXED)
            // Loops through inner nodes and fuzzy matches names to the outer widget
            if (!matchFound) {
                for (const inNode of innerNodes) {
                    const inCC = (inNode.comfyClass || "").toLowerCase();
                    const inTT = (inNode.title || "").toLowerCase();
                    const isRemote = (inCC.startsWith("remote") || inTT.startsWith("remote"));

                    if (isRemote && inNode.widgets) {
                        // FUZZY MATCH CHECK
                        const hasMatchingWidget = inNode.widgets.some(inW => _rcNamesMatch(inW.name, w.name));
                        if (hasMatchingWidget) {
                            matchFound = true;
                            break;
                        }
                    }
                    
                    // Also check for Primitives inside that are named similarly to the widget
                    if (inNode.type === "Primitive" && _rcNamesMatch(inNode.title, w.name)) {
                        if (_rcLeadsToRemote(inner, inNode, 0, new Set())) {
                            matchFound = true;
                            break;
                        }
                    }
                }
            }

            if (matchFound) {
                // Only target pickers should become REMOTE_PICKER on the outer Subgraph node.
                // Never convert control toggles (mode_select / switch_status / node_status).
                const _lname = (w.name || "").split(":").pop().trim().toLowerCase().replace(/_\d+$/, "");
                if (_lname === "mode_select" || _lname === "switch_status" || _lname === "node_status") {
                    // Keep toggle visuals consistent (avoid True/False labels when linked)
                    try { _rcFixToggleDraw(w); } catch(e) {}
                } else {
                    _rcReplaceWithPicker(node, w);
                }
            }
        });
    }
};

app.registerExtension({
    name: "Comfy.RemoteControl",

    async setup() {
        app.api.addEventListener(RC_STATUS_SYNC_EVENT, (event) => {
            try {
                _rcApplyRuntimeStatusUpdate(event.detail);
            } catch (err) {
                console.error("Remote runtime status sync error:", err);
            }
        });
    },
    
    // Runtime Hook
    async nodeCreated(node) {
        const origDraw = node.onDrawForeground;
        node.onDrawForeground = function(ctx) {
            try { processNode(node); } catch(e) {}
            if (origDraw) origDraw.apply(this, arguments);
        };
        setTimeout(() => { try { processNode(node); } catch(e) {} }, 100);
    },

    // Global Load Hook
    async afterConfigureGraph(missingNodeTypes) {
        if(app.graph && app.graph._nodes) {
            for(const node of app.graph._nodes) {
                try { processNode(node); } catch(e) {}
            }
            // Re-apply stacker global overrides after all nodes are processed
            setTimeout(() => {
                for(const node of app.graph._nodes) {
                    if ((node.comfyClass || "").toLowerCase() === "remotestacker") {
                        try {
                            const mode = (node.properties && node.properties._rcStackerMode) || "user";
                            if (mode !== "user") {
                                _rcStackerApplyGlobal(node);
                            }
                        } catch(e) {}
                    }
                }
            }, 300);
        }
    }
});