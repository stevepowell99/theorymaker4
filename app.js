// Theorymaker: minimal no-build app (Netlify static)
// - Ace editor on the left
// - DSL → validate/autocorrect → DOT
// - DOT → SVG via Graphviz WebAssembly (@hpcc-js/wasm)

import { Graphviz } from "https://cdn.jsdelivr.net/npm/@hpcc-js/wasm@2.20.0/dist/graphviz.js";

// -----------------------------
// UI wiring: tabs + splitter
// -----------------------------

function setActiveTab(tabName) {
  document.querySelectorAll(".tm-tab").forEach((a) => {
    a.classList.toggle("active", a.dataset.tab === tabName);
  });

  document.querySelectorAll(".tm-tab-panel").forEach((panel) => {
    panel.classList.toggle("d-none", panel.id !== `tab-${tabName}`);
  });
}

function initTabs() {
  document.querySelectorAll(".tm-tab").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      setActiveTab(a.dataset.tab);
    });
  });
}

function initSplitter() {
  const left = document.getElementById("tm-left");
  const splitter = document.getElementById("tm-splitter");

  let dragging = false;

  splitter.addEventListener("mousedown", (e) => {
    dragging = true;
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const rect = document.body.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = (x / rect.width) * 100;
    const clamped = Math.max(15, Math.min(75, pct));
    left.style.width = `${clamped}%`;
  });

  window.addEventListener("mouseup", () => {
    dragging = false;
    document.body.style.userSelect = "";
  });
}

// -----------------------------
// URL ↔ editor syncing (share/restore)
// - Stores MapScript in URL hash as: #m=<base64url(utf8)>
// - Uses replaceState so typing doesn't spam back-button history
// -----------------------------

function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlEncodeUtf8(text) {
  const bytes = new TextEncoder().encode(text);
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecodeUtf8(b64url) {
  const b64 = b64url.replaceAll("-", "+").replaceAll("_", "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bytes = base64ToBytes(b64 + pad);
  return new TextDecoder().decode(bytes);
}

function getMapScriptFromUrl() {
  // Accept either "#m=..." or "#...&m=..." to be flexible
  const hash = (location.hash || "").replace(/^#/, "");
  if (!hash) return null;

  const params = new URLSearchParams(hash);
  const m = params.get("m");
  if (!m) return null;

  try {
    return base64UrlDecodeUtf8(m);
  } catch {
    return null;
  }
}

function setMapScriptInUrl(mapScript) {
  const params = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  params.set("m", base64UrlEncodeUtf8(mapScript));
  const next = `${location.pathname}${location.search}#${params.toString()}`;
  history.replaceState(null, "", next);
}

// -----------------------------
// DSL → DOT
// -----------------------------

function stripComment(line) {
  const idx = line.indexOf("#");
  return (idx >= 0 ? line.slice(0, idx) : line).trim();
}

function slugId(s) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "node";
}

function parseBorder(borderText) {
  // Accept: "1px dotted green" or "1px solid blue"
  // Maps to DOT: penwidth, style, color
  const parts = borderText.trim().split(/\s+/);
  if (parts.length < 2) return {};

  const widthPart = parts[0];
  const stylePart = parts[1];
  const colorPart = parts.slice(2).join(" ");

  const widthMatch = widthPart.match(/^(\d+)(px)?$/i);
  const penwidth = widthMatch ? widthMatch[1] : null;

  const style = ["solid", "dotted", "dashed", "bold"].includes(stylePart.toLowerCase())
    ? stylePart.toLowerCase()
    : null;

  const color = colorPart ? colorPart.trim() : null;

  const out = {};
  if (penwidth) out.penwidth = penwidth;
  if (style) out.style = style;
  if (color) out.color = color;
  return out;
}

function parseBracketAttrs(text) {
  // Node form: [colour=red | border=1px solid blue]
  // Edge form: [some edgelabel | 1px solid]
  const raw = text.trim();
  const inner = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  const parts = inner.split("|").map((p) => p.trim()).filter(Boolean);

  const kv = {};
  const loose = [];

  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq >= 0) {
      const k = p.slice(0, eq).trim().toLowerCase();
      const v = p.slice(eq + 1).trim();
      kv[k] = v;
    } else {
      loose.push(p);
    }
  }

  return { kv, loose };
}

function toDotAttrs(attrs) {
  const pairs = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
    .map(([k, v]) => `${k}="${String(v).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`);
  return pairs.length ? ` [${pairs.join(", ")}]` : "";
}

function addStyle(attrs, styleToken) {
  if (!styleToken) return;
  const token = String(styleToken).trim();
  if (!token) return;
  const existing = String(attrs.style || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!existing.includes(token)) existing.push(token);
  attrs.style = existing.join(",");
}

function wrapLabelToDot(label, maxChars) {
  const n = Number(maxChars);
  if (!Number.isFinite(n) || n <= 0) return label;
  const words = String(label).split(/\s+/).filter(Boolean);
  if (!words.length) return label;

  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= n) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.join("\\n");
}

function normalizeDirection(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return null;
  if (v === "tb" || v === "top-bottom" || v === "top to bottom") return "TB";
  if (v === "bt" || v === "bottom-top" || v === "bottom to top") return "BT";
  if (v === "lr" || v === "left-right" || v === "left to right") return "LR";
  if (v === "rl" || v === "right-left" || v === "right to left") return "RL";
  return null;
}

function parseLeadingNumber(value) {
  const m = String(value || "").trim().match(/^-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function dslToDot(dslText) {
  const errors = [];
  const settings = {
    title: null,
    background: null,
    defaultBoxColour: null,
    defaultBoxShape: null,
    defaultBoxBorder: null,
    defaultBoxShadow: null,
    direction: null,
    labelWrap: null,
    rankGap: null,
    nodeGap: null,
  };

  const nodes = new Map(); // id -> { label, attrs }
  const autoLabelNodes = new Map(); // id -> label (from edges)
  const edges = []; // { fromId, toId, attrs }
  const clusters = []; // { id, label, depth, nodeIds: [], children: [] }
  const clusterStack = []; // stack of clusters (nested)

  function ensureNode(token) {
    const raw = token.trim();
    if (!raw) return null;

    const isSimpleId = /^[A-Za-z]\w*$/.test(raw);
    const id = isSimpleId ? raw : slugId(raw);

    if (!nodes.has(id)) {
      const label = isSimpleId ? raw : raw;
      nodes.set(id, { label, attrs: {} });
    }

    // If token is a free label and we previously created an auto node, keep its label.
    if (!isSimpleId) {
      autoLabelNodes.set(id, raw);
      const n = nodes.get(id);
      n.label = raw;
    }

    return id;
  }

  function applyDefaults(nodeAttrs) {
    // Defaults are interpreted in DOT terms:
    // - default box colour -> fillcolor + filled
    // - default box border -> color/style/penwidth
    if (settings.defaultBoxColour) {
      if (!nodeAttrs.fillcolor) nodeAttrs.fillcolor = settings.defaultBoxColour;
      addStyle(nodeAttrs, "filled");
    }
    if (settings.defaultBoxShape) {
      if (settings.defaultBoxShape === "rounded") addStyle(nodeAttrs, "rounded");
    }
    if (settings.defaultBoxBorder) {
      const b = parseBorder(settings.defaultBoxBorder);
      if (b.color && !nodeAttrs.color) nodeAttrs.color = b.color;
      if (b.style) addStyle(nodeAttrs, b.style);
      if (b.penwidth && !nodeAttrs.penwidth) nodeAttrs.penwidth = b.penwidth;
    }
  }

  const lines = dslText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = stripComment(raw);
    if (!line) continue;

    // Cluster / box line:
    // - "--Label" opens a level-1 cluster
    // - "----Label" opens a level-2 cluster (nested)
    // - "----" closes the current level-2 cluster (if any)
    // - "--" closes the current level-1 cluster (and anything nested)
    //
    // Rule: the number of leading '-' determines nesting depth (2 = level 1, 4 = level 2, etc).
    const clusterMatch = line.match(/^(-{2,})(.*)$/);
    if (clusterMatch) {
      const dashes = clusterMatch[1];
      const rest = (clusterMatch[2] || "").trim();
      const depth = dashes.length;

      if (depth % 2 !== 0) {
        errors.push(`Line ${i + 1}: box marker must use an even number of '-' (e.g. -- or ----)`);
        continue;
      }

      // Closing marker (no label): pop stack to one level above this depth.
      if (!rest) {
        while (clusterStack.length && clusterStack[clusterStack.length - 1].depth >= depth) {
          clusterStack.pop();
        }
        continue;
      }

      // Opening marker: ensure stack is aligned to parent level (depth-2)
      const parentDepth = depth - 2;
      while (clusterStack.length && clusterStack[clusterStack.length - 1].depth > parentDepth) {
        clusterStack.pop();
      }

      const c = {
        id: `cluster_${clusters.length}`,
        label: rest,
        depth,
        nodeIds: [],
        children: [],
      };

      const parent = clusterStack[clusterStack.length - 1] || null;
      if (parent) parent.children.push(c);
      clusters.push(c);
      clusterStack.push(c);
      continue;
    }

    // Settings line: "Key: Value"
    const settingMatch = line.match(/^([^:]+):\s*(.+)$/);
    if (settingMatch && !line.includes("->") && !line.includes("::")) {
      const key = settingMatch[1].trim().toLowerCase();
      const value = settingMatch[2].trim();
      if (key === "title") settings.title = value;
      else if (key === "background") settings.background = value;
      else if (key === "default box colour" || key === "default box color") settings.defaultBoxColour = value;
      else if (key === "default box shape") settings.defaultBoxShape = value.trim().toLowerCase();
      else if (key === "default box border") settings.defaultBoxBorder = value;
      else if (key === "default box shadow" || key === "box shadow") settings.defaultBoxShadow = value;
      else if (key === "direction") settings.direction = normalizeDirection(value);
      else if (key === "label wrap") settings.labelWrap = parseLeadingNumber(value);
      else if (key === "rank gap") settings.rankGap = parseLeadingNumber(value);
      else if (key === "node gap") settings.nodeGap = parseLeadingNumber(value);
      continue;
    }

    // Node line: "A:: Label [attrs]"
    const nodeMatch = line.match(/^(\S+)\s*::\s*(.+)$/);
    if (nodeMatch) {
      const idToken = nodeMatch[1].trim();
      let rest = nodeMatch[2].trim();

      let bracket = null;
      const bracketStart = rest.lastIndexOf("[");
      if (bracketStart >= 0 && rest.endsWith("]")) {
        bracket = rest.slice(bracketStart);
        rest = rest.slice(0, bracketStart).trim();
      }

      const id = ensureNode(idToken);
      if (!id) {
        errors.push(`Line ${i + 1}: could not parse node id`);
        continue;
      }

      const n = nodes.get(id);
      n.label = rest || n.label || id;

      // Parse node attrs
      const attrs = {};
      applyDefaults(attrs);

      if (bracket) {
        const { kv } = parseBracketAttrs(bracket);
        // Flexible parsing: accept "colour"/"color" and "border"
        if (kv.colour || kv.color) {
          attrs.fillcolor = kv.colour || kv.color;
          addStyle(attrs, "filled");
        }
        if (kv.background) {
          attrs.fillcolor = kv.background;
          addStyle(attrs, "filled");
        }
        if (kv.shape && String(kv.shape).trim().toLowerCase() === "rounded") {
          addStyle(attrs, "rounded");
        }
        if (kv.border) {
          const b = parseBorder(kv.border);
          if (b.color) attrs.color = b.color;
          if (b.penwidth) attrs.penwidth = b.penwidth;
          if (b.style) addStyle(attrs, b.style);
        }
      }

      n.attrs = { ...n.attrs, ...attrs };

      const currentCluster = clusterStack[clusterStack.length - 1] || null;
      if (currentCluster) currentCluster.nodeIds.push(id);
      continue;
    }

    // Edge line: "A -> B | C [edgeLabel | 1px solid]"
    const edgeMatch = line.match(/^(.+?)\s*->\s*(.+)$/);
    if (edgeMatch) {
      let left = edgeMatch[1].trim();
      let right = edgeMatch[2].trim();

      let bracket = null;
      const bracketStart = right.lastIndexOf("[");
      if (bracketStart >= 0 && right.endsWith("]")) {
        bracket = right.slice(bracketStart);
        right = right.slice(0, bracketStart).trim();
      }

      // Autocorrect: allow "A→B" pasted, normalize arrows in left/right
      left = left.replaceAll("→", "").trim();
      right = right.replaceAll("→", "").trim();

      // Cross product: "A | Q -> B | C" means A->B, A->C, Q->B, Q->C
      const sources = left
        .split("|")
        .map((t) => t.trim())
        .filter(Boolean);

      if (!sources.length) {
        errors.push(`Line ${i + 1}: edge has no sources`);
        continue;
      }

      // Right side can be "B | C"
      const targets = right
        .split("|")
        .map((t) => t.trim())
        .filter(Boolean);

      if (!targets.length) {
        errors.push(`Line ${i + 1}: edge has no targets`);
        continue;
      }

      const edgeAttrs = {};
      if (bracket) {
        const { loose } = parseBracketAttrs(bracket);
        // Flexible edge parsing:
        // - First loose part = label
        // - Second loose part (if present) = border-ish style "1px solid"
        if (loose[0]) edgeAttrs.label = loose[0];
        if (loose[1]) {
          const b = parseBorder(loose[1]);
          if (b.color) edgeAttrs.color = b.color;
          if (b.penwidth) edgeAttrs.penwidth = b.penwidth;
          if (b.style) addStyle(edgeAttrs, b.style);
        }
        // If only one part and it looks like a border, treat it as style instead of label
        if (loose.length === 1 && /\b(px)?\b/i.test(loose[0]) && /\b(solid|dotted|dashed)\b/i.test(loose[0])) {
          delete edgeAttrs.label;
          const b = parseBorder(loose[0]);
          if (b.color) edgeAttrs.color = b.color;
          if (b.penwidth) edgeAttrs.penwidth = b.penwidth;
          if (b.style) addStyle(edgeAttrs, b.style);
        }
      }

      for (const s of sources) {
        const fromId = ensureNode(s);
        if (!fromId) continue;
        for (const t of targets) {
          const toId = ensureNode(t);
          if (!toId) continue;
          edges.push({ fromId, toId, attrs: edgeAttrs });
        }
      }

      continue;
    }

    errors.push(`Line ${i + 1}: unrecognised syntax: ${raw}`);
  }

  // Build DOT
  const dot = [];
  dot.push("digraph G {");
  dot.push('  graph [fontname="Arial"];');
  dot.push('  node [fontname="Arial", shape="box"];');
  dot.push('  edge [fontname="Arial"];');

  if (settings.background) dot.push(`  bgcolor="${settings.background.replaceAll('"', '\\"')}";`);
  if (settings.title) dot.push(`  label="${settings.title.replaceAll('"', '\\"')}"; labelloc="t";`);
  if (settings.direction) dot.push(`  rankdir="${settings.direction}";`);
  if (Number.isFinite(settings.rankGap)) dot.push(`  ranksep="${settings.rankGap}";`);
  if (Number.isFinite(settings.nodeGap)) dot.push(`  nodesep="${settings.nodeGap}";`);

  // Emit clusters (nested)
  const clustered = new Set();
  function emitCluster(c, indent) {
    // Emit even if empty (so nested structure remains visible)
    dot.push(`${indent}subgraph ${c.id} {`);
    dot.push(`${indent}  label="${c.label.replaceAll('"', '\\"')}";`);
    dot.push(`${indent}  style="rounded";`);
    dot.push(`${indent}  color="#cccccc";`);

    for (const id of c.nodeIds) {
      clustered.add(id);
      const n = nodes.get(id);
      const attrs = { label: wrapLabelToDot(n.label, settings.labelWrap), ...n.attrs };
      dot.push(`${indent}  "${id}"${toDotAttrs(attrs)};`);
    }

    for (const child of c.children) {
      emitCluster(child, `${indent}  `);
    }

    dot.push(`${indent}}`);
  }

  // Only top-level clusters (depth === 2) start emission; children are emitted recursively.
  clusters.filter((c) => c.depth === 2).forEach((c) => emitCluster(c, "  "));

  // Emit nodes not in clusters
  for (const [id, n] of nodes.entries()) {
    if (clustered.has(id)) continue;
    const attrs = { label: wrapLabelToDot(n.label, settings.labelWrap), ...n.attrs };
    dot.push(`  "${id}"${toDotAttrs(attrs)};`);
  }

  // Emit edges
  for (const e of edges) {
    dot.push(`  "${e.fromId}" -> "${e.toId}"${toDotAttrs(e.attrs)};`);
  }

  dot.push("}");

  return { dot: dot.join("\n"), errors, settings };
}

// -----------------------------
// Render loop
// -----------------------------

function showErrors(errs) {
  const el = document.getElementById("tm-errors");
  if (!errs || !errs.length) {
    el.classList.add("d-none");
    el.textContent = "";
    return;
  }
  el.classList.remove("d-none");
  el.textContent = errs.join("\n");
}

function applyVizCssSettings(vizEl, settings) {
  // CSS-based shadow applied to rendered SVG nodes (Graphviz itself doesn't do CSS box-shadow).
  const raw = String(settings?.defaultBoxShadow || "").trim().toLowerCase();
  let filter = "none";

  if (!raw || raw === "none") filter = "none";
  else if (raw === "subtle") filter = "drop-shadow(0 1px 2px rgba(0,0,0,0.14))";
  else if (raw === "medium") filter = "drop-shadow(0 2px 6px rgba(0,0,0,0.18))";
  else if (raw === "strong") filter = "drop-shadow(0 6px 14px rgba(0,0,0,0.22))";
  else if (raw.startsWith("drop-shadow(")) filter = settings.defaultBoxShadow.trim();

  vizEl.style.setProperty("--tm-node-shadow", filter);
}

async function renderNow(graphviz, editor) {
  const dsl = editor.getValue();
  const { dot, errors, settings } = dslToDot(dsl);
  showErrors(errors);
  applyVizCssSettings(document.getElementById("tm-viz"), settings);

  try {
    const svg = await graphviz.layout(dot, "svg", "dot");
    document.getElementById("tm-viz").innerHTML = svg;
  } catch (e) {
    showErrors([...(errors || []), `Graphviz error: ${e?.message || String(e)}`]);
    document.getElementById("tm-viz").innerHTML = "";
  }
}

async function main() {
  initTabs();
  initSplitter();
  setActiveTab("viz");

  // Help panel: load from help.md (served by Live Server / Netlify)
  try {
    const r = await fetch("./help.md", { cache: "no-cache" });
    const txt = await r.text();
    const el = document.getElementById("tm-help-md");
    if (el) el.textContent = txt;
  } catch (e) {
    const el = document.getElementById("tm-help-md");
    if (el) el.textContent = `Failed to load help.md: ${e?.message || String(e)}`;
  }

  // Ace editor setup
  const editor = ace.edit("editor"); // global from ace.js
  editor.setTheme("ace/theme/textmate");
  editor.session.setMode("ace/mode/text");
  editor.setOptions({
    fontSize: "13px",
    showPrintMargin: false,
    showGutter: false, // per spec: remove Ace gutter
    wrap: true,
  });
  editor.renderer.setShowGutter(false); // ensure gutter is hidden (Ace sometimes needs this)

  // Restore editor from URL if present, otherwise seed a starter example.
  const fromUrl = getMapScriptFromUrl();
  const starter =
    `Title: My new graph
Background: White
Default box colour: red
Default box shape: rounded
Default box border: 1px dotted green
Direction: top-bottom
Label wrap: 20 characters
Rank gap: 20
Node gap: 20

A:: Actual text for A[colour=red | border=1px solid blue]  # be flexible how we parse background and border parameters
--A box containing B and C
B:: Text for B
C:: Text for C

A -> B | C            # note this creates arrows to B and to C
D -> Needs no alias   # labels can be created like this too? not sure
D -> E [some edgelabel | 1px solid]   # note edge specification
`;

  editor.setValue(fromUrl ?? starter, -1);

  // Graphviz WASM init
  const graphviz = await Graphviz.load();

  // Buttons / triggers
  document.getElementById("tm-render").addEventListener("click", () => {
    renderNow(graphviz, editor);
  });

  // Light “autocorrect/validate then render” on idle typing (kept minimal)
  let timer = null;
  editor.session.on("change", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const text = editor.getValue();
      setMapScriptInUrl(text);
      renderNow(graphviz, editor);
    }, 350);
  });

  // Initial render
  setMapScriptInUrl(editor.getValue());
  await renderNow(graphviz, editor);
}

main();


