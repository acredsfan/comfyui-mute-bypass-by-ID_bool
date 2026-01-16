import { app } from "../../scripts/app.js";

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
    if(!switchW || !modeW) return;

    const targets = node.widgets.filter(w => w.type === "REMOTE_PICKER");
    const isSwitch = node.comfyClass.includes("Switch");
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
                if(w.name.includes("_A")) active = switchW.value;
                else if(w.name.includes("_B")) active = !switchW.value;
                else active = true;
            } else {
                active = switchW.value;
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
// 6. MAIN HOOKS
// =========================================================

const processNode = (node) => {
    if (!node) return;
    
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
        }
    }
});