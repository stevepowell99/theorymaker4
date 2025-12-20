// Theorymaker: minimal no-build app (Netlify static)
// - Ace editor on the left
// - DSL → validate/autocorrect → DOT
// - DOT → SVG via Graphviz WebAssembly (@hpcc-js/wasm)

import { Graphviz } from "https://cdn.jsdelivr.net/npm/@hpcc-js/wasm@2.20.0/dist/graphviz.js";
import { GALLERY_EXAMPLES } from "./examples.js";
import { initHelpFromMarkdown } from "./help.js";

// -----------------------------
// Browser history (back/forward) + discrete undo/redo buttons
// - Uses History API entries to store editor states
// - Pushes ONE new entry at the start of an edit "burst", then replaces within that entry while typing
// -----------------------------
const TM_HISTORY_STATE_MARK = "tm_history_v1";
let suppressHistorySync = false; // prevents loops while restoring editor from popstate or doing batch operations
let historyBurstActive = false;
let historyBurstTimer = null;

// -----------------------------
// Diagram styles
// Source of truth: editor text (MapScript "Key: Value" lines), then URL (#m=...)
// -----------------------------
//
// NOTE: "title" is intentionally NOT here: title remains user-facing editor text.
const STYLE_SETTING_KEYS = [
  "background",
  "textColour",
  "defaultNodeTextColour",
  "defaultBoxTextColour",
  "titleSize",
  "titlePosition",
  "defaultBoxColour",
  "defaultBoxShape",
  "defaultBoxBorder",
  "defaultBoxShadow",
  "defaultLinkColour",
  "defaultLinkStyle",
  "defaultLinkWidth",
  "direction",
  "labelWrap",
  "spacingAlong",
  "spacingAcross",
];

// -----------------------------
// Ace: incremental (undo-friendly) edits
// -----------------------------

function replaceEditorLine(editor, idx, nextLineText) {
  // Purpose: update a single line without resetting the whole editor text (preserves undo better).
  if (!editor || !editor.session) return false;
  const i = Number(idx);
  if (!Number.isFinite(i) || i < 0) return false;

  const old = editor.session.getLine(i);
  if (old == null) return false;
  const next = String(nextLineText ?? "");
  if (old === next) return false;

  // Ace Range is available via ace.require (ace is global; this file is an ES module).
  const Range = globalThis.ace?.require?.("ace/range")?.Range;
  if (!Range) return false;

  editor.session.replace(new Range(i, 0, i, old.length), next);
  return true;
}

function afterEditorMutation({ editor, graphviz }) {
  // Purpose: keep URL + diagram in sync after an editor text change.
  setMapScriptInUrl(editor.getValue());
  renderNow(graphviz, editor);
}

function positionVizDrawerAgainstDiagram(drawerEl, { topOffsetPx = 100 } = {}) {
  // Purpose: use the same positioning as the quick-link drawer:
  // - slide in from the far left
  // - stop with the drawer's RIGHT edge flush against the diagram's LEFT edge
  // - place it ~100px below the top of the diagram panel (so it doesn't collide with tabs/toolbars)
  const el = drawerEl || null;
  if (!el) return;

  const vizWrap = document.querySelector(".tm-viz-wrap");
  if (!vizWrap) return;

  const w = el.offsetWidth || 360;
  const vizRect = vizWrap.getBoundingClientRect();
  const openX = Math.max(0, Math.round(vizRect.left - w));

  el.style.setProperty("--tm-viz-drawer-open-x", `${openX}px`);
  el.style.setProperty("--tm-viz-drawer-top", `${Math.round(vizRect.top + Number(topOffsetPx || 0))}px`);
  el.style.setProperty("--tm-viz-drawer-h", `${Math.round(vizRect.height)}px`);
}

function closeOtherVizDrawers(exceptEl) {
  // Purpose: ensure only ONE drawer is open at a time (opening one replaces the previous).
  const except = exceptEl || null;
  document.querySelectorAll(".tm-viz-drawer.tm-open").forEach((el) => {
    if (except && el === except) return;
    el.classList.remove("tm-open");
  });
}

function cssColorToEditorToken(value) {
  // Purpose: avoid "#rrggbb" in MapScript (because "#" starts comments).
  const raw = String(value ?? "").trim();
  if (!raw) return raw;
  if (!raw.startsWith("#")) return raw; // already "rgb(...)" or a named colour
  const rgb = hexToRgb(raw);
  if (!rgb) return raw;
  return `rgb(${rgb.r},${rgb.g},${rgb.b})`;
}

function buildEditorStyleLinesFromUiStyleSettings(sIn) {
  // Purpose: write global styles into the editor so changes are saved in MapScript too.
  const s = sIn && typeof sIn === "object" ? sIn : {};
  const lines = [];

  if (s.background) lines.push(`Background: ${cssColorToEditorToken(s.background)}`);
  if (s.textColour) lines.push(`Text colour: ${cssColorToEditorToken(s.textColour)}`);
  if (s.defaultNodeTextColour) lines.push(`Default node text colour: ${cssColorToEditorToken(s.defaultNodeTextColour)}`);
  if (s.defaultBoxTextColour) lines.push(`Default group text colour: ${cssColorToEditorToken(s.defaultBoxTextColour)}`);
  if (Number.isFinite(Number(s.titleSize))) lines.push(`Title size: ${Math.round(Number(s.titleSize))}`);
  if (s.titlePosition) lines.push(`Title position: ${String(s.titlePosition).trim()}`);
  if (s.defaultBoxColour) lines.push(`Default node colour: ${cssColorToEditorToken(s.defaultBoxColour)}`);
  if (s.defaultBoxShape) lines.push(`Default node shape: ${String(s.defaultBoxShape).trim()}`);
  if (s.defaultBoxShadow) lines.push(`Default node shadow: ${String(s.defaultBoxShadow).trim()}`);
  if (s.defaultBoxBorder) lines.push(`Default node border: ${String(s.defaultBoxBorder).trim()}`);
  if (s.defaultLinkColour) lines.push(`Default link colour: ${cssColorToEditorToken(s.defaultLinkColour)}`);
  if (s.defaultLinkStyle) lines.push(`Default link style: ${String(s.defaultLinkStyle).trim()}`);
  if (Number.isFinite(Number(s.defaultLinkWidth))) lines.push(`Default link width: ${Math.round(Number(s.defaultLinkWidth))}`);
  if (s.direction) lines.push(`Direction: ${String(s.direction).trim()}`);
  if (Number.isFinite(Number(s.labelWrap))) lines.push(`Label wrap: ${Math.round(Number(s.labelWrap))}`);
  if (Number.isFinite(Number(s.spacingAlong))) lines.push(`Spacing along: ${Math.round(Number(s.spacingAlong))}`);
  if (Number.isFinite(Number(s.spacingAcross))) lines.push(`Spacing across: ${Math.round(Number(s.spacingAcross))}`);

  return lines;
}

function editorHasStyleLines(text) {
  const split = splitMapScriptStylesAndContents(text);
  return Boolean(split?.styles);
}

function upsertEditorStyleBlockFromUiStyleSettings(editor, uiStyles) {
  // Purpose: replace only the *settings lines* in the initial "styles" section; keep any blank/comment lines there.
  const text = editor.getValue();
  const split = splitMapScriptStylesAndContents(text);

  const styleLines = (split.styles ? split.styles.split(/\r?\n/) : []).slice(0);
  const contentText = String(split.contents || "").trimStart();

  const isSettingLine = (raw) => {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return false;
    if (trimmed.startsWith("#")) return false;
    if (trimmed.includes("->") || trimmed.includes("::")) return false;
    const m = trimmed.match(/^([^:]+):\s*(.+)$/);
    if (!m) return false;
    const key = m[1].trim().toLowerCase();
    return SUPPORTED_SETTING_LINE_KEYS.has(key);
  };

  const keptStyleLines = styleLines.filter((l) => !isSettingLine(l));
  const nextSettingLines = buildEditorStyleLinesFromUiStyleSettings(uiStyles);

  // Also remove any settings lines that appear later in the document (outside the initial style block),
  // so we never end up with multiple lines for the same setting.
  const contentLines = contentText.split(/\r?\n/);
  const keptContentText = contentLines.filter((l) => !isSettingLine(l)).join("\n").trimStart();

  // Keep the style section tidy: drop trailing blanks before appending new settings.
  while (keptStyleLines.length && String(keptStyleLines[keptStyleLines.length - 1] || "").trim() === "") keptStyleLines.pop();

  const nextStylesText = [...keptStyleLines, ...(keptStyleLines.length ? [""] : []), ...nextSettingLines].join("\n").trimEnd();
  const nextText = nextStylesText ? `${nextStylesText}\n\n${keptContentText}`.trimEnd() : keptContentText;

  // Preserve cursor position as best effort (adjust row by style-section line count delta).
  const cursor = editor.getCursorPosition();
  const oldStyleCount = split.styles ? split.styles.split(/\r?\n/).length : 0;
  const newStyleCount = nextStylesText ? nextStylesText.split(/\r?\n/).length : 0;
  const delta = newStyleCount - oldStyleCount;
  const nextCursorRow = cursor.row >= oldStyleCount ? Math.max(0, cursor.row + delta) : cursor.row;

  editor.setValue(nextText, -1);
  editor.moveCursorToPosition({ row: nextCursorRow, column: cursor.column });
  editor.clearSelection();
}

// Supported *editor* settings line keys (eg "Background: ...") used by:
// - splitMapScriptStylesAndContents()
// - the cursor-adjacent "Style" button (so it can act on global style lines too)
const SUPPORTED_SETTING_LINE_KEYS = new Set([
  "background",
  "text colour",
  "text color",
  "default node text colour",
  "default node text color",
  "default group text colour",
  "default group text color",
  "title size",
  "title position",
  "default node colour",
  "default node color",
  "default node shape",
  "default node border",
  "default link colour",
  "default link color",
  "default link style",
  "default link width",
  "default node shadow",
  "direction",
  "label wrap",
  "spacing along",
  "spacing across",
]);

// -----------------------------
// Admin/dev mode: when running locally via Live Server (localhost)
// -----------------------------

function isLocalLiveServer() {
  // Live Server typically serves from http://localhost:<port>/ (or 127.0.0.1)
  const h = String(globalThis.location?.hostname || "");
  const p = String(globalThis.location?.protocol || "");
  return p === "http:" && (h === "localhost" || h === "127.0.0.1");
}

const IS_ADMIN = isLocalLiveServer();

// -----------------------------
// Ace helpers: line style popover (styles the current line and writes/updates [...] inline)
// -----------------------------

function initAceLineStylePopover({ editor, graphviz }) {
  // Main UI trigger + preview: the cursor-adjacent style button.
  const btn = document.getElementById("tm-ace-cursor-style-btn");
  const pop = document.getElementById("tm-ace-style-popover");
  const cursorBtn = btn; // same element: keep naming for readability in positioning logic
  const editorDetailsEl = document.getElementById("tm-editor-details");
  const meta = document.getElementById("tm-ace-style-meta");
  const none = document.getElementById("tm-ace-style-none");
  const nodeBox = document.getElementById("tm-ace-style-node");
  const clusterBox = document.getElementById("tm-ace-style-cluster");
  const edgeBox = document.getElementById("tm-ace-style-edge");
  const apply = document.getElementById("tm-ace-style-apply");
  const close = document.getElementById("tm-ace-style-close"); // optional (we now only have one button)

  // Single setting-line modal (focused UI for "Key: Value" lines)
  const settingModalEl = document.getElementById("tm-setting-line-modal");
  const settingModalTitle = document.getElementById("tm-setting-line-modal-title");
  const settingModalMeta = document.getElementById("tm-setting-line-modal-meta");
  const settingModalBody = document.getElementById("tm-setting-line-modal-body");
  const settingModalCloseX = document.getElementById("tm-setting-line-close-x");
  const settingModalCloseBtn = document.getElementById("tm-setting-line-close");

  // Node fields
  const nodeFillEnabled = document.getElementById("tm-ace-style-node-fill-enabled");
  const nodeFill = document.getElementById("tm-ace-style-node-fill");
  const nodeBorderEnabled = document.getElementById("tm-ace-style-node-border-enabled");
  const nodeBw = document.getElementById("tm-ace-style-node-border-width");
  const nodeBs = document.getElementById("tm-ace-style-node-border-style");
  const nodeBc = document.getElementById("tm-ace-style-node-border-color");
  const nodeRounded = document.getElementById("tm-ace-style-node-rounded");
  const nodeTextSizeEnabled = document.getElementById("tm-ace-style-node-text-size-enabled");
  const nodeTextSize = document.getElementById("tm-ace-style-node-text-size");

  // Cluster fields
  const clusterFillEnabled = document.getElementById("tm-ace-style-cluster-fill-enabled");
  const clusterFill = document.getElementById("tm-ace-style-cluster-fill");
  const clusterBorderEnabled = document.getElementById("tm-ace-style-cluster-border-enabled");
  const clusterBw = document.getElementById("tm-ace-style-cluster-border-width");
  const clusterBs = document.getElementById("tm-ace-style-cluster-border-style");
  const clusterBc = document.getElementById("tm-ace-style-cluster-border-color");
  const clusterTextColourEnabled = document.getElementById("tm-ace-style-cluster-text-colour-enabled");
  const clusterTextColour = document.getElementById("tm-ace-style-cluster-text-colour");
  const clusterTextSizeEnabled = document.getElementById("tm-ace-style-cluster-text-size-enabled");
  const clusterTextSize = document.getElementById("tm-ace-style-cluster-text-size");

  // Edge fields
  const edgeLabel = document.getElementById("tm-ace-style-edge-label");
  const edgeBorderEnabled = document.getElementById("tm-ace-style-edge-border-enabled");
  const edgeBw = document.getElementById("tm-ace-style-edge-border-width");
  const edgeBs = document.getElementById("tm-ace-style-edge-border-style");
  const edgeBc = document.getElementById("tm-ace-style-edge-border-color");

  if (!btn || !pop || !apply) return;
  const closeBtn = close || apply; // single-button UI: Apply is the close button
  let suppressLiveApply = false; // prevents feedback loops while we populate widgets

  function setBtnLabelText(el, text) {
    // Cursor button has an icon + a dedicated label span; avoid overwriting the icon DOM.
    const labelEl = el.querySelector("[data-tm-label]");
    if (labelEl) labelEl.textContent = String(text || "");
    else el.textContent = String(text || "");
  }

  function getBtnBaseLabel(el) {
    // Cache the original label so we can append "· custom/default" without drifting.
    if (el.dataset.tmBaseLabel) return el.dataset.tmBaseLabel;
    const labelEl = el.querySelector("[data-tm-label]");
    const base = (labelEl ? labelEl.textContent : el.textContent) || "Style";
    el.dataset.tmBaseLabel = String(base || "Style");
    return el.dataset.tmBaseLabel;
  }

  function setStyleButtonPreview({ enabled, fillHex, borderUi, rounded }) {
    // Visual preview on the button itself (keep it simple, no extra DOM).
    if (!enabled) {
      btn.style.backgroundColor = "";
      btn.style.borderColor = "";
      btn.style.borderWidth = "";
      btn.style.borderStyle = "";
      btn.style.borderRadius = "";
      btn.style.color = "";
      return;
    }

    // Background (nodes only)
    if (fillHex) btn.style.backgroundColor = String(fillHex);
    else btn.style.backgroundColor = ""; // edges/default

    // Border (nodes + edges)
    const b = borderUi && typeof borderUi === "object" ? borderUi : null;
    const w = b && Number.isFinite(Number(b.width)) ? Math.max(0, Number(b.width)) : 1;
    const sRaw = String(b?.style || "solid").trim().toLowerCase();
    const s = sRaw === "bold" ? "solid" : sRaw; // CSS doesn't have "bold" border-style
    const c = String(b?.colorHex || "#999999").trim() || "#999999";
    btn.style.borderWidth = `${Math.round(w || 1)}px`;
    btn.style.borderStyle = ["solid", "dotted", "dashed"].includes(s) ? s : "solid";
    btn.style.borderColor = c;

    // Rounded nodes
    btn.style.borderRadius = rounded ? "999px" : "";

    // Keep label readable: if there's a background, let Bootstrap decide text colour unless it becomes illegible.
    // (No heavy contrast logic; users can still read the tooltip.)
    btn.style.color = "";
  }

  function setStyleButtonState({ enabled, isCustom, title, preview }) {
    // Keep the UI simple:
    // - disabled if the cursor line isn't a node/link
    // - outline-primary if the line has custom inline styling, outline-secondary otherwise
    // - text suffix makes the state obvious even if colours are subtle on some displays
    btn.disabled = !enabled;
    btn.classList.remove("btn-outline-primary", "btn-outline-secondary");
    btn.classList.add(enabled && isCustom ? "btn-outline-primary" : "btn-outline-secondary");
    btn.title = String(title || "").trim();

    const baseLabel = getBtnBaseLabel(btn);
    if (!enabled) setBtnLabelText(btn, baseLabel);
    else setBtnLabelText(btn, `${baseLabel} · ${isCustom ? "custom" : "default"}`);

    setStyleButtonPreview({
      enabled,
      fillHex: preview?.fillHex || "",
      borderUi: preview?.borderUi || null,
      rounded: Boolean(preview?.rounded),
    });
  }

  function hide() {
    pop.classList.add("d-none");
    // Cursor button can reappear once the popover is closed.
    positionCursorStyleButton();
  }

  function showAtCursor() {
    const pos = editor.getCursorPosition(); // { row, column }
    const xy = editor.renderer.textToScreenCoordinates(pos.row, pos.column);
    pop.style.left = `${Math.round(xy.pageX + 10)}px`;
    pop.style.top = `${Math.round(xy.pageY + 18)}px`;
    pop.classList.remove("d-none");
    // Hide the cursor button while the popover is open (avoids overlapping click targets).
    if (cursorBtn) cursorBtn.classList.add("d-none");
  }

  function positionCursorStyleButton() {
    if (!cursorBtn) return;
    // If the editor is hidden behind the chevron, never show the floating button.
    if (editorDetailsEl && editorDetailsEl.tagName === "DETAILS" && !editorDetailsEl.open) {
      cursorBtn.classList.add("d-none");
      return;
    }
    // If Ace container is effectively hidden (e.g. details closed), don't show.
    const aceRect = editor?.container?.getBoundingClientRect?.();
    if (aceRect && (aceRect.width <= 1 || aceRect.height <= 1)) {
      cursorBtn.classList.add("d-none");
      return;
    }
    // Don't show the button while the popover is open.
    if (!pop.classList.contains("d-none")) {
      cursorBtn.classList.add("d-none");
      return;
    }

    const info = getCursorLineInfo();
    if (info.type === "none") {
      cursorBtn.classList.add("d-none");
      return;
    }

    const pos = editor.getCursorPosition();
    const xy = editor.renderer.textToScreenCoordinates(pos.row, pos.column);
    cursorBtn.style.left = `${Math.round(xy.pageX + 12)}px`;
    cursorBtn.style.top = `${Math.round(xy.pageY - 10)}px`;
    cursorBtn.classList.remove("d-none");
  }

  function getCursorLineInfo() {
    const pos = editor.getCursorPosition(); // { row, column }
    const row = pos.row;
    const raw = editor.session.getLine(row) || "";
    const { code } = stripCommentKeepSuffix(raw);
    const trimmed = code.trim();
    const lineNo = row + 1;

    if (!trimmed) return { type: "none", row, lineNo };

    // Global style setting line, eg "Background: white"
    // (Keep these enabled: the button should open the Styles modal for quick edits.)
    const settingMatch = (() => {
      if (trimmed.includes("->") || trimmed.includes("::")) return null;
      const m = trimmed.match(/^([^:]+):\s*(.+)$/);
      if (!m) return null;
      const keyLower = m[1].trim().toLowerCase();
      if (!SUPPORTED_SETTING_LINE_KEYS.has(keyLower)) return null;
      return { keyLower, keyRaw: m[1].trim(), valueRaw: m[2].trim() };
    })();
    if (settingMatch) return { type: "setting", row, lineNo, ...settingMatch };

    const nodeMatch = trimmed.match(/^(\S+)\s*::\s*(.+)$/);
    if (nodeMatch) return { type: "node", row, lineNo, nodeId: nodeMatch[1].trim() };

    const clusterMatch = trimmed.match(/^(-{2,})(.*)$/);
    if (clusterMatch) {
      const dashes = clusterMatch[1];
      const rest = String(clusterMatch[2] || "").trim();
      const depth = dashes.length;
      if (depth % 2 === 0 && rest) return { type: "cluster", row, lineNo };
    }

    const edgeMatch = trimmed.match(/^(.+?)\s*->\s*(.+)$/);
    if (edgeMatch) return { type: "edge", row, lineNo };

    return { type: "none", row, lineNo };
  }

  // Cluster line parsing/updating uses shared helpers: parseClusterDefLineAt / setClusterDefLineAt

  function setNodeControlsEnabled(enabled) {
    if (nodeFill) nodeFill.disabled = !enabled || !nodeFillEnabled?.checked;
    if (nodeBw) nodeBw.disabled = !enabled || !nodeBorderEnabled?.checked;
    if (nodeBs) nodeBs.disabled = !enabled || !nodeBorderEnabled?.checked;
    if (nodeBc) nodeBc.disabled = !enabled || !nodeBorderEnabled?.checked;
    if (nodeRounded) nodeRounded.disabled = !enabled;
    if (nodeFillEnabled) nodeFillEnabled.disabled = !enabled;
    if (nodeBorderEnabled) nodeBorderEnabled.disabled = !enabled;
    if (nodeTextSizeEnabled) nodeTextSizeEnabled.disabled = !enabled;
    if (nodeTextSize) nodeTextSize.disabled = !enabled || !nodeTextSizeEnabled?.checked;
  }

  function setClusterControlsEnabled(enabled) {
    if (clusterFillEnabled) clusterFillEnabled.disabled = !enabled;
    if (clusterFill) clusterFill.disabled = !enabled || !clusterFillEnabled?.checked;
    if (clusterBorderEnabled) clusterBorderEnabled.disabled = !enabled;
    if (clusterBw) clusterBw.disabled = !enabled || !clusterBorderEnabled?.checked;
    if (clusterBs) clusterBs.disabled = !enabled || !clusterBorderEnabled?.checked;
    if (clusterBc) clusterBc.disabled = !enabled || !clusterBorderEnabled?.checked;
    if (clusterTextColourEnabled) clusterTextColourEnabled.disabled = !enabled;
    if (clusterTextColour) clusterTextColour.disabled = !enabled || !clusterTextColourEnabled?.checked;
    if (clusterTextSizeEnabled) clusterTextSizeEnabled.disabled = !enabled;
    if (clusterTextSize) clusterTextSize.disabled = !enabled || !clusterTextSizeEnabled?.checked;
  }

  function setEdgeControlsEnabled(enabled) {
    if (edgeLabel) edgeLabel.disabled = !enabled;
    if (edgeBw) edgeBw.disabled = !enabled || !edgeBorderEnabled?.checked;
    if (edgeBs) edgeBs.disabled = !enabled || !edgeBorderEnabled?.checked;
    if (edgeBc) edgeBc.disabled = !enabled || !edgeBorderEnabled?.checked;
    if (edgeBorderEnabled) edgeBorderEnabled.disabled = !enabled;
  }

  function refreshFormFromCursorLine() {
    suppressLiveApply = true;
    try {
      const info = getCursorLineInfo();
      if (meta) meta.textContent = `Line ${info.lineNo}`;

      const showNone = info.type === "none";
      none?.classList.toggle("d-none", !showNone);
      nodeBox?.classList.toggle("d-none", info.type !== "node");
      clusterBox?.classList.toggle("d-none", info.type !== "cluster");
      edgeBox?.classList.toggle("d-none", info.type !== "edge");

      if (showNone) {
        setNodeControlsEnabled(false);
        setClusterControlsEnabled(false);
        setEdgeControlsEnabled(false);
        return;
      }

      const lines = editor.getValue().split(/\r?\n/);

      if (info.type === "node") {
        if (meta) meta.textContent = `Line ${info.lineNo}: node ${info.nodeId}`;
        const parsed = parseNodeDefLine(lines, info.nodeId);
        const fromAttrs = styleInnerToNodeUi(parsed?.styleInner || "");
        const defaults = getDefaultNodeUi();

        const fillHex = fromAttrs?.fillHex || null;
        if (nodeFillEnabled) nodeFillEnabled.checked = Boolean(fillHex);
        if (nodeFill) nodeFill.value = fillHex || defaults.fillHex || "#ffffff";

        const borderUi = fromAttrs?.borderUi || null;
        if (nodeBorderEnabled) nodeBorderEnabled.checked = Boolean(borderUi);
        if (nodeBw) nodeBw.value = String(borderUi?.width ?? 1);
        if (nodeBs) nodeBs.value = String(borderUi?.style || "solid");
        if (nodeBc) nodeBc.value = String(borderUi?.colorHex || "#999999");

        if (nodeRounded) nodeRounded.checked = Boolean(fromAttrs?.rounded);

        const textSizeScale = fromAttrs?.textSizeScale;
        if (nodeTextSizeEnabled) nodeTextSizeEnabled.checked = Number.isFinite(textSizeScale) && textSizeScale !== 1;
        if (nodeTextSize) nodeTextSize.value = String(Number.isFinite(textSizeScale) ? textSizeScale : 1);

        setNodeControlsEnabled(true);
        setClusterControlsEnabled(false);
        setEdgeControlsEnabled(false);
        return;
      }

      if (info.type === "cluster") {
        if (meta) meta.textContent = `Line ${info.lineNo}: group box`;
        const parsed = parseClusterDefLineAt(lines, info.row);
        const fromAttrs = styleInnerToClusterUi(parsed?.styleInner || "");

        const fillHex = fromAttrs?.fillHex || null;
        if (clusterFillEnabled) clusterFillEnabled.checked = Boolean(fillHex);
        if (clusterFill) clusterFill.value = fillHex || "#ffffff";

        const borderUi = fromAttrs?.borderUi || null;
        if (clusterBorderEnabled) clusterBorderEnabled.checked = Boolean(borderUi);
        if (clusterBw) clusterBw.value = String(borderUi?.width ?? 1);
        if (clusterBs) clusterBs.value = String(borderUi?.style || "solid");
        if (clusterBc) clusterBc.value = String(borderUi?.colorHex || "#cccccc");

        const tc = fromAttrs?.textColourHex || null;
        if (clusterTextColourEnabled) clusterTextColourEnabled.checked = Boolean(tc);
        if (clusterTextColour) clusterTextColour.value = tc || "#111827";

        const ts = fromAttrs?.textSizeScale;
        if (clusterTextSizeEnabled) clusterTextSizeEnabled.checked = Number.isFinite(ts) && ts !== 1;
        if (clusterTextSize) clusterTextSize.value = String(Number.isFinite(ts) ? ts : 1);

        setNodeControlsEnabled(false);
        setClusterControlsEnabled(true);
        setEdgeControlsEnabled(false);
        return;
      }

      if (info.type === "edge") {
        if (meta) meta.textContent = `Line ${info.lineNo}: link`;
        const parsed = parseEdgeLine(lines, info.lineNo);

        if (edgeLabel) edgeLabel.value = parsed?.label ?? "";

        const borderText = String(parsed?.border || "").trim();
        const hasBorder = Boolean(borderText);
        if (edgeBorderEnabled) edgeBorderEnabled.checked = hasBorder;
        const ui = borderText ? borderTextToUi(borderText) : borderTextToUi(getDefaultEdgeBorderText());
        if (edgeBw) edgeBw.value = String(ui.width ?? 1);
        if (edgeBs) edgeBs.value = ui.style || "solid";
        if (edgeBc) edgeBc.value = ui.colorHex || "#999999";

        setNodeControlsEnabled(false);
        setClusterControlsEnabled(false);
        setEdgeControlsEnabled(true);
      }
    } finally {
      suppressLiveApply = false;
    }
  }

  function syncStyleButtonToCursorLine() {
    const info = getCursorLineInfo();
    const lines = editor.getValue().split(/\r?\n/);

    if (info.type === "none") {
      setStyleButtonState({
        enabled: false,
        isCustom: false,
        title: `Line ${info.lineNo}: no node/link to style`,
        preview: null,
      });
      return;
    }

    if (info.type === "setting") {
      setStyleButtonState({
        enabled: true,
        // Treat settings lines as "custom" so it's obvious this line already carries styles.
        isCustom: true,
        title: `Line ${info.lineNo}: global style setting (${info.keyRaw})`,
        preview: null,
      });
      return;
    }

    if (info.type === "node") {
      const parsed = parseNodeDefLine(lines, info.nodeId);
      const styleInner = String(parsed?.styleInner || "").trim();
      const ui = styleInnerToNodeUi(styleInner) || {};
      const hasCustom = Boolean(styleInner); // any inline attrs (even unrecognised) counts as custom

      const parts = [];
      if (ui.fillHex) parts.push(`colour=${ui.fillHex}`);
      if (ui.borderUi) parts.push(`border=${uiToBorderText(ui.borderUi)}`);
      if (ui.rounded) parts.push("shape=rounded");

      // Effective preview: merge defaults + inline overrides
      const defaults = getDefaultNodeUi();
      const effFillHex = ui.fillHex || defaults.fillHex || "";
      const effBorderUi = ui.borderUi || defaults.borderUi || { width: 1, style: "solid", colorHex: "#999999" };
      const effRounded = ui.rounded || Boolean(defaults.rounded);

      setStyleButtonState({
        enabled: true,
        isCustom: hasCustom,
        title: hasCustom
          ? `Line ${info.lineNo}: node ${info.nodeId} (${parts.join(" | ")})`
          : `Line ${info.lineNo}: node ${info.nodeId} (default)`,
        preview: { fillHex: effFillHex, borderUi: effBorderUi, rounded: effRounded },
      });
      return;
    }

    if (info.type === "cluster") {
      const parsed = parseClusterDefLineAt(lines, info.row);
      const styleInner = String(parsed?.styleInner || "").trim();
      const ui = styleInnerToClusterUi(styleInner) || {};
      const hasCustom = Boolean(styleInner);

      const parts = [];
      if (ui.fillHex) parts.push(`colour=${ui.fillHex}`);
      if (ui.borderUi) parts.push(`border=${uiToBorderText(ui.borderUi)}`);
      if (ui.textColourHex) parts.push(`text colour=${ui.textColourHex}`);
      if (Number.isFinite(ui.textSizeScale) && ui.textSizeScale !== 1) parts.push(`text size=${ui.textSizeScale}`);

      setStyleButtonState({
        enabled: true,
        isCustom: hasCustom,
        title: hasCustom ? `Line ${info.lineNo}: group box (${parts.join(" | ")})` : `Line ${info.lineNo}: group box (default)`,
        preview: { fillHex: ui.fillHex || "", borderUi: ui.borderUi || { width: 1, style: "solid", colorHex: "#cccccc" }, rounded: false },
      });
      return;
    }

    // edge
    const parsed = parseEdgeLine(lines, info.lineNo);
    const label = String(parsed?.label || "").trim();
    const border = String(parsed?.border || "").trim();
    const hasCustom = Boolean(parsed?.hasBracket && (label || border)); // only treat as custom if user provided bracket content

    const parts = [];
    if (label) parts.push(`label=${label}`);
    if (border) parts.push(`border=${border}`);

    // Effective preview: use explicit border if present, otherwise default link border.
    const borderText = border || getDefaultEdgeBorderText();
    const borderUi = borderTextToUi(borderText);

    setStyleButtonState({
      enabled: true,
      isCustom: hasCustom,
      title: hasCustom ? `Line ${info.lineNo}: link (${parts.join(" | ")})` : `Line ${info.lineNo}: link (default)`,
      preview: { fillHex: "", borderUi, rounded: false },
    });
  }

  function openStylesModalForSettingKey(keyLower) {
    // Reuse the existing Styles modal (diagram-wide) rather than inventing a second UI.
    // Button exists in the toolbar and already opens the modal.
    // Hint to the modal which accordion panel should be open when it appears.
    const styleModalEl = document.getElementById("tm-style-modal");
    if (styleModalEl?.dataset) styleModalEl.dataset.tmStyleOpenPanel = "more";
    document.getElementById("tm-editor-style")?.click();

    const idByKey = {
      background: "tm-style-background",
      direction: "tm-style-direction",
      "title size": "tm-style-title-size",
      "text colour": "tm-style-text-color",
      "text color": "tm-style-text-color",
      "default node text colour": "tm-style-default-node-text-color",
      "default node text color": "tm-style-default-node-text-color",
      "default group text colour": "tm-style-default-group-text-color",
      "default group text color": "tm-style-default-group-text-color",
      "default node colour": "tm-style-node-fill",
      "default node color": "tm-style-node-fill",
      "default node shape": "tm-style-node-shape",
      "default node border": "tm-style-node-border-width",
      "default node shadow": "tm-style-node-shadow",
      "default link colour": "tm-style-link-color",
      "default link color": "tm-style-link-color",
      "default link style": "tm-style-link-style",
      "default link width": "tm-style-link-width",
      "label wrap": "tm-style-label-wrap",
      "spacing along": "tm-style-rank-gap",
      "spacing across": "tm-style-node-gap",
    };

    // Focus after the modal starts opening.
    window.setTimeout(() => {
      const id = idByKey[String(keyLower || "").trim().toLowerCase()];
      if (!id) return;
      document.getElementById(id)?.focus?.();
    }, 0);
  }

  function openSettingLineModal(keyLower) {
    // Focused modal for the current setting line (background/direction/gaps/etc).
    // Falls back to the big Styles drawer if the focused UI isn't available.
    if (!settingModalEl || !settingModalBody) return openStylesModalForSettingKey(keyLower);

    const key = String(keyLower || "").trim().toLowerCase();
    const parsed = dslToDot(editor.getValue()).settings;
    const cur = coerceUiStyleSettings(pickStyleSettings(parsed));

    const titleMap = {
      background: "Background",
      direction: "Direction",
      "text colour": "Text colour (title + edge labels)",
      "text color": "Text colour (title + edge labels)",
      "default node text colour": "Default node text colour",
      "default node text color": "Default node text colour",
      "default group text colour": "Default group text colour",
      "default group text color": "Default group text colour",
      "title size": "Title size",
    "title position": "Title position",
      "default node colour": "Default node colour",
      "default node color": "Default node colour",
      "default node shape": "Default node shape",
      "default node shadow": "Default node shadow",
      "default node border": "Default node border",
      "default link colour": "Default link colour",
      "default link color": "Default link colour",
      "default link style": "Default link style",
      "default link width": "Default link width",
      "label wrap": "Label wrap",
      "spacing along": "Spacing along",
      "spacing across": "Spacing across",
    };

    const label = titleMap[key] || key;
    if (settingModalTitle) settingModalTitle.textContent = `Edit: ${label}`;
    if (settingModalMeta) settingModalMeta.textContent = "Changes apply live and are written into the editor.";

    const applyPatch = (patch) => {
      const next = { ...cur, ...(patch || {}) };
      upsertEditorStyleBlockFromUiStyleSettings(editor, next);
      afterEditorMutation({ editor, graphviz });
    };

    const makeColorInput = (initialCss, onCssChange) => {
      const rgb = resolveCssColorToRgb(initialCss || "#ffffff") || { r: 255, g: 255, b: 255 };
      const wrap = document.createElement("div");
      const input = document.createElement("input");
      input.type = "color";
      input.className = "form-control form-control-sm form-control-color";
      input.value = rgbToHex(rgb);
      input.addEventListener("input", () => onCssChange(input.value));
      input.addEventListener("change", () => onCssChange(input.value));
      wrap.appendChild(input);
      return { wrap, focusEl: input };
    };

    const makeSelect = (options, initialValue, onChange) => {
      const sel = document.createElement("select");
      sel.className = "form-select form-select-sm";
      for (const opt of options) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        sel.appendChild(o);
      }
      sel.value = String(initialValue ?? "");
      sel.addEventListener("change", () => onChange(sel.value));
      return { el: sel, focusEl: sel };
    };

    const makeRange = ({ min, max, step, value, suffix }, onInput) => {
      const wrap = document.createElement("div");
      const top = document.createElement("div");
      top.className = "d-flex align-items-center justify-content-between";
      const val = document.createElement("div");
      val.className = "small text-muted";
      const range = document.createElement("input");
      range.type = "range";
      range.className = "form-range";
      range.min = String(min);
      range.max = String(max);
      range.step = String(step);
      range.value = String(value);
      const sync = () => {
        val.textContent = `${range.value}${suffix || ""}`;
        onInput(range.value);
      };
      range.addEventListener("input", sync);
      range.addEventListener("change", sync);
      sync();
      top.appendChild(document.createElement("div"));
      top.appendChild(val);
      wrap.appendChild(top);
      wrap.appendChild(range);
      return { wrap, focusEl: range };
    };

    // Build minimal UI for the specific key.
    settingModalBody.innerHTML = "";
    let focusEl = null;

    if (key === "background") {
      const { wrap, focusEl: f } = makeColorInput(cur.background || "#ffffff", (hex) => applyPatch({ background: normalizeColor(hex) }));
      settingModalBody.appendChild(wrap);
      focusEl = f;
    } else if (key === "text colour" || key === "text color") {
      const { wrap, focusEl: f } = makeColorInput(cur.textColour || "#111827", (hex) => applyPatch({ textColour: normalizeColor(hex) }));
      settingModalBody.appendChild(wrap);
      focusEl = f;
    } else if (key === "default node text colour" || key === "default node text color") {
      const { wrap, focusEl: f } = makeColorInput(cur.defaultNodeTextColour || "#111827", (hex) => applyPatch({ defaultNodeTextColour: normalizeColor(hex) }));
      settingModalBody.appendChild(wrap);
      focusEl = f;
    } else if (key === "default group text colour" || key === "default group text color") {
      const { wrap, focusEl: f } = makeColorInput(cur.defaultBoxTextColour || "#111827", (hex) => applyPatch({ defaultBoxTextColour: normalizeColor(hex) }));
      settingModalBody.appendChild(wrap);
      focusEl = f;
    } else if (key === "default node colour" || key === "default node color") {
      const { wrap, focusEl: f } = makeColorInput(cur.defaultBoxColour || "#e7f5ff", (hex) => applyPatch({ defaultBoxColour: normalizeColor(hex) }));
      settingModalBody.appendChild(wrap);
      focusEl = f;
    } else if (key === "default link colour" || key === "default link color") {
      const { wrap, focusEl: f } = makeColorInput(cur.defaultLinkColour || "#6c757d", (hex) => applyPatch({ defaultLinkColour: normalizeColor(hex) }));
      settingModalBody.appendChild(wrap);
      focusEl = f;
    } else if (key === "direction") {
      const { el, focusEl: f } = makeSelect(
        [
          { value: "LR", label: "→" },
          { value: "RL", label: "←" },
          { value: "TB", label: "↓" },
          { value: "BT", label: "↑" },
        ],
        cur.direction || "LR",
        (v) => applyPatch({ direction: normalizeDirection(v) || v })
      );
      settingModalBody.appendChild(el);
      focusEl = f;
    } else if (key === "title size") {
      const n = Number(cur.titleSize);
      const { wrap, focusEl: f } = makeRange({ min: 10, max: 36, step: 1, value: Number.isFinite(n) ? Math.round(n) : 18, suffix: "pt" }, (v) =>
        applyPatch({ titleSize: Number(v) })
      );
      settingModalBody.appendChild(wrap);
      focusEl = f;
    } else if (key === "title position") {
      const initial = normalizeTitlePosition(cur.titlePosition) || "bottom-left";
      const { el, focusEl: f } = makeSelect(
        [
          { value: "bottom-left", label: "bottom left" },
          { value: "bottom-centre", label: "bottom centre" },
          { value: "bottom-right", label: "bottom right" },
          { value: "top-left", label: "top left" },
          { value: "top-centre", label: "top centre" },
          { value: "top-right", label: "top right" },
        ],
        initial,
        (v) => {
          const p = normalizeTitlePosition(v);
          applyPatch({ titlePosition: p === "bottom-left" ? null : p });
        }
      );
      settingModalBody.appendChild(el);
      focusEl = f;
    } else if (key === "label wrap") {
      const { wrap, focusEl: f } = makeRange({ min: 8, max: 40, step: 1, value: Number(cur.labelWrap || 18), suffix: "" }, (v) =>
        applyPatch({ labelWrap: Number(v) })
      );
      settingModalBody.appendChild(wrap);
      focusEl = f;
    } else if (key === "spacing along") {
      const { wrap, focusEl: f } = makeRange({ min: 0, max: 20, step: 1, value: Number(cur.spacingAlong || 4), suffix: "" }, (v) =>
        applyPatch({ spacingAlong: Number(v) })
      );
      settingModalBody.appendChild(wrap);
      focusEl = f;
    } else if (key === "spacing across") {
      const { wrap, focusEl: f } = makeRange({ min: 0, max: 20, step: 1, value: Number(cur.spacingAcross || 3), suffix: "" }, (v) =>
        applyPatch({ spacingAcross: Number(v) })
      );
      settingModalBody.appendChild(wrap);
      focusEl = f;
    } else if (key === "default link width") {
      const { wrap, focusEl: f } = makeRange({ min: 1, max: 6, step: 1, value: Number(cur.defaultLinkWidth || 1), suffix: "px" }, (v) =>
        applyPatch({ defaultLinkWidth: Number(v) })
      );
      settingModalBody.appendChild(wrap);
      focusEl = f;
    } else if (key === "default link style") {
      const { el, focusEl: f } = makeSelect(
        [
          { value: "", label: "(auto)" },
          { value: "solid", label: "solid" },
          { value: "dotted", label: "dotted" },
          { value: "dashed", label: "dashed" },
          { value: "bold", label: "bold" },
        ],
        String(cur.defaultLinkStyle || ""),
        (v) => applyPatch({ defaultLinkStyle: String(v || "").trim().toLowerCase() || null })
      );
      settingModalBody.appendChild(el);
      focusEl = f;
    } else if (key === "default node shape") {
      const { el, focusEl: f } = makeSelect(
        [
          { value: "", label: "square" },
          { value: "rounded", label: "rounded" },
        ],
        String(cur.defaultBoxShape || ""),
        (v) => applyPatch({ defaultBoxShape: String(v || "").trim().toLowerCase() || null })
      );
      settingModalBody.appendChild(el);
      focusEl = f;
    } else if (key === "default node shadow") {
      const { el, focusEl: f } = makeSelect(
        [
          { value: "none", label: "none" },
          { value: "subtle", label: "subtle" },
          { value: "medium", label: "medium" },
          { value: "strong", label: "strong" },
        ],
        String(cur.defaultBoxShadow || "medium"),
        (v) => applyPatch({ defaultBoxShadow: String(v || "").trim() || null })
      );
      settingModalBody.appendChild(el);
      focusEl = f;
    } else if (key === "default node border") {
      const ui = borderTextToUi(String(cur.defaultBoxBorder || "1px solid rgb(30,144,255)"));
      const row = document.createElement("div");
      row.className = "row g-2";

      const colW = document.createElement("div");
      colW.className = "col-4";
      const w = document.createElement("input");
      w.type = "number";
      w.className = "form-control form-control-sm";
      w.min = "0";
      w.step = "1";
      w.value = String(ui.width ?? 1);

      const colS = document.createElement("div");
      colS.className = "col-4";
      const s = document.createElement("select");
      s.className = "form-select form-select-sm";
      ["solid", "dotted", "dashed", "bold"].forEach((x) => {
        const o = document.createElement("option");
        o.value = x;
        o.textContent = x;
        s.appendChild(o);
      });
      s.value = String(ui.style || "solid");

      const colC = document.createElement("div");
      colC.className = "col-4";
      const c = document.createElement("input");
      c.type = "color";
      c.className = "form-control form-control-sm form-control-color";
      c.value = String(ui.colorHex || "#1e90ff");

      const sync = () => {
        const border = uiToBorderText({ width: Number(w.value), style: String(s.value || "solid"), colorHex: String(c.value || "#999999") });
        applyPatch({ defaultBoxBorder: border || null });
      };
      w.addEventListener("input", sync);
      s.addEventListener("change", sync);
      c.addEventListener("input", sync);
      row.appendChild(colW);
      row.appendChild(colS);
      row.appendChild(colC);
      colW.appendChild(w);
      colS.appendChild(s);
      colC.appendChild(c);
      settingModalBody.appendChild(row);
      focusEl = c;
    } else {
      // Unknown setting line -> fall back to the big Styles modal.
      return openStylesModalForSettingKey(keyLower);
    }

    closeOtherVizDrawers(settingModalEl);
    settingModalEl.classList.add("tm-open");
    positionVizDrawerAgainstDiagram(settingModalEl);
    if (focusEl) setTimeout(() => focusEl.focus?.(), 0);
  }

  function closeSettingLineDrawer() {
    settingModalEl?.classList?.remove?.("tm-open");
  }

  settingModalCloseX?.addEventListener("click", closeSettingLineDrawer);
  settingModalCloseBtn?.addEventListener("click", closeSettingLineDrawer);

  function applyToEditor({ hideAfter = true, focusEditor = true } = {}) {
    const info = getCursorLineInfo();
    if (info.type === "none") return;

    const lines = editor.getValue().split(/\r?\n/);
    let changedIdx = -1;

    if (info.type === "node") {
      const parsed = parseNodeDefLine(lines, info.nodeId);
      if (!parsed) return;
      changedIdx = parsed.idx;

      const fillHex = nodeFillEnabled?.checked ? (nodeFill?.value || "") : null;
      const borderText = nodeBorderEnabled?.checked
        ? uiToBorderText({
            width: nodeBw?.value ?? 0,
            style: nodeBs?.value ?? "solid",
            colorHex: nodeBc?.value ?? "#999999",
          })
        : "";
      const rounded = Boolean(nodeRounded?.checked);
      const textSizeScale = nodeTextSizeEnabled?.checked ? Number(nodeTextSize?.value) : null;

      const nextInner = upsertNodeStyleInner(parsed.styleInner || "", {
        fillHex,
        borderText,
        rounded,
        textSizeScale: Number.isFinite(textSizeScale) && textSizeScale > 0 ? textSizeScale : null,
      });

      const ok = setNodeDefLine(lines, info.nodeId, { label: parsed.label || info.nodeId, styleInner: nextInner });
      if (!ok) return;
    }

    if (info.type === "cluster") {
      const parsed = parseClusterDefLineAt(lines, info.row);
      if (!parsed) return;
      changedIdx = parsed.idx;

      const fillHex = clusterFillEnabled?.checked ? (clusterFill?.value || "") : null;
      const borderText = clusterBorderEnabled?.checked
        ? uiToBorderText({
            width: clusterBw?.value ?? 0,
            style: clusterBs?.value ?? "solid",
            colorHex: clusterBc?.value ?? "#cccccc",
          })
        : "";
      const textColourHex = clusterTextColourEnabled?.checked ? (clusterTextColour?.value || "") : null;
      const textSizeScale = clusterTextSizeEnabled?.checked ? Number(clusterTextSize?.value) : null;

      const nextInner = upsertClusterStyleInner(parsed.styleInner || "", {
        fillHex: fillHex || null,
        borderText: borderText || "",
        textColourHex: textColourHex || null,
        textSizeScale: Number.isFinite(textSizeScale) && textSizeScale > 0 ? textSizeScale : null,
      });

      setClusterDefLineAt(lines, parsed.idx, {
        dashes: parsed.dashes,
        label: parsed.label,
        styleInner: nextInner,
        comment: parsed.comment,
      });
    }

    if (info.type === "edge") {
      changedIdx = info.lineNo - 1;
      const borderText = edgeBorderEnabled?.checked
        ? uiToBorderText({
            width: edgeBw?.value ?? 0,
            style: edgeBs?.value ?? "solid",
            colorHex: edgeBc?.value ?? "#999999",
          })
        : "";

      const ok = setEdgeLine(lines, info.lineNo, {
        fromId: null,
        toId: null,
        label: edgeLabel?.value ?? "",
        border: borderText,
        nodesById: null,
      });
      if (!ok) return;
    }

    if (changedIdx >= 0) {
      const ok = replaceEditorLine(editor, changedIdx, lines[changedIdx]);
      if (!ok) return;
      afterEditorMutation({ editor, graphviz });
      // Keep the cursor-adjacent button preview in sync even if the cursor didn't move.
      syncStyleButtonToCursorLine();
    }

    if (focusEditor) editor.focus();
    if (hideAfter) hide();
  }

  // Keep enabling/disabling inputs in sync with the override switches.
  nodeFillEnabled?.addEventListener("change", () => setNodeControlsEnabled(true));
  nodeBorderEnabled?.addEventListener("change", () => setNodeControlsEnabled(true));
  nodeTextSizeEnabled?.addEventListener("change", () => setNodeControlsEnabled(true));
  clusterFillEnabled?.addEventListener("change", () => setClusterControlsEnabled(true));
  clusterBorderEnabled?.addEventListener("change", () => setClusterControlsEnabled(true));
  clusterTextColourEnabled?.addEventListener("change", () => setClusterControlsEnabled(true));
  clusterTextSizeEnabled?.addEventListener("change", () => setClusterControlsEnabled(true));
  edgeBorderEnabled?.addEventListener("change", () => setEdgeControlsEnabled(true));

  function openStyleUiForCursorLine() {
    const info = getCursorLineInfo();
    if (info.type === "setting") {
      openSettingLineModal(info.keyLower);
      return;
    }
    refreshFormFromCursorLine();
    showAtCursor();
    // Focus the first meaningful input.
    if (info.type === "node") (nodeFillEnabled || nodeFill)?.focus?.();
    else if (info.type === "cluster") (clusterFillEnabled || clusterFill)?.focus?.();
    else if (info.type === "edge") (edgeLabel || edgeBorderEnabled)?.focus?.();
  }

  // Use mousedown (not click) so Ace blur doesn't hide the button before the handler runs.
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openStyleUiForCursorLine();
  });

  // Live preview: any change updates the editor + rerenders immediately.
  function maybeLiveApply() {
    if (suppressLiveApply) return;
    if (pop.classList.contains("d-none")) return;
    applyToEditor({ hideAfter: false, focusEditor: false });
  }

  const liveEls = [
    nodeFillEnabled,
    nodeFill,
    nodeBorderEnabled,
    nodeBw,
    nodeBs,
    nodeBc,
    nodeRounded,
    nodeTextSizeEnabled,
    nodeTextSize,
    clusterFillEnabled,
    clusterFill,
    clusterBorderEnabled,
    clusterBw,
    clusterBs,
    clusterBc,
    clusterTextColourEnabled,
    clusterTextColour,
    clusterTextSizeEnabled,
    clusterTextSize,
    edgeLabel,
    edgeBorderEnabled,
    edgeBw,
    edgeBs,
    edgeBc,
  ].filter(Boolean);

  for (const el of liveEls) {
    el.addEventListener("input", maybeLiveApply);
    el.addEventListener("change", maybeLiveApply);
  }

  // Single-button UI: just close (changes are applied live).
  closeBtn.addEventListener("click", () => hide());

  // Close on Escape anywhere.
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });

  // Click outside closes.
  window.addEventListener("mousedown", (e) => {
    if (pop.classList.contains("d-none")) return;
    if (e.target === btn || btn.contains(e.target)) return;
    if (e.target === pop || pop.contains(e.target)) return;
    hide();
  });

  // Keep the Style button (and popover, if open) in sync as the cursor moves.
  editor.selection.on("changeCursor", () => {
    syncStyleButtonToCursorLine();
    if (!pop.classList.contains("d-none")) refreshFormFromCursorLine();
    positionCursorStyleButton();
  });

  // If the editor scrolls without moving the cursor, keep the cursor button positioned correctly.
  editor.session.on("changeScrollTop", () => positionCursorStyleButton());
  editor.session.on("changeScrollLeft", () => positionCursorStyleButton());

  // Hide cursor button when editor loses focus (prevents a "stuck" floating button).
  editor.on("blur", () => {
    // Delay so mousedown handlers on the cursor button can run first.
    setTimeout(() => cursorBtn?.classList.add("d-none"), 0);
  });
  editor.on("focus", () => positionCursorStyleButton());

  // If the editor is behind a <details> chevron, track its open/close state.
  if (editorDetailsEl && editorDetailsEl.tagName === "DETAILS") {
    editorDetailsEl.addEventListener("toggle", () => {
      if (!editorDetailsEl.open) cursorBtn?.classList.add("d-none");
      else positionCursorStyleButton();
    });
  }

  // Initial state.
  syncStyleButtonToCursorLine();
  positionCursorStyleButton();
}

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

// Mobile screens: Chat | Editor | Diagram | Templates | Help
// - On narrow screens (below Bootstrap lg), show ONE screen at a time via the hamburger menu.
// - On wider screens, restore the normal split layout.
function initMobileScreens({ editor }) {
  const mq = globalThis.matchMedia?.("(max-width: 991.98px)"); // Bootstrap lg breakpoint
  if (!mq) return;

  const left = document.getElementById("tm-left");
  const right = document.getElementById("tm-right");
  const splitter = document.getElementById("tm-splitter");
  const chatPanel = document.getElementById("tm-chat-panel");
  const editorDetails = document.getElementById("tm-editor-details");
  const offcanvasEl = document.getElementById("tm-mobile-nav");

  if (!left || !right || !splitter || !chatPanel || !editorDetails) return;

  const bs = globalThis.bootstrap;
  const offcanvas = offcanvasEl && bs?.Offcanvas ? bs.Offcanvas.getOrCreateInstance(offcanvasEl) : null;

  function setActiveMenuItem(screen) {
    document.querySelectorAll("[data-tm-screen]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tmScreen === screen);
    });
  }

  function applyDesktopLayout() {
    left.classList.remove("d-none");
    right.classList.remove("d-none");
    splitter.classList.remove("d-none");
    chatPanel.classList.remove("d-none");
    editorDetails.classList.remove("d-none");
  }

  function applyMobileScreen(screen) {
    const s = String(screen || "diagram");
    const isLeft = s === "chat" || s === "editor";
    const isRight = s === "diagram" || s === "templates" || s === "help";

    left.classList.toggle("d-none", !isLeft);
    right.classList.toggle("d-none", !isRight);
    splitter.classList.add("d-none");

    chatPanel.classList.toggle("d-none", s !== "chat");
    editorDetails.classList.toggle("d-none", s !== "editor");

    if (s === "editor") {
      editorDetails.open = true;
      requestAnimationFrame(() => editor?.resize?.());
      setTimeout(() => editor?.resize?.(), 60);
    }

    if (s === "diagram") setActiveTab("viz");
    if (s === "templates") setActiveTab("templates");
    if (s === "help") setActiveTab("help");

    setActiveMenuItem(s);
  }

  function syncToViewport() {
    if (!mq.matches) applyDesktopLayout();
    else applyMobileScreen("diagram"); // default on mobile
  }

  document.querySelectorAll("[data-tm-screen]").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyMobileScreen(btn.dataset.tmScreen);
      offcanvas?.hide?.();
    });
  });

  mq.addEventListener?.("change", syncToViewport);
  window.addEventListener("resize", syncToViewport);

  syncToViewport();
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

    // Keep the map filling the right panel while in the default "fit" mode.
    if (!vizHasUserZoomed) fitVizToContainerWidth();
  });

  window.addEventListener("mouseup", () => {
    dragging = false;
    document.body.style.userSelect = "";
  });
}

function initStyleModal({ editor, graphviz }) {
  const btn = document.getElementById("tm-editor-style");
  const modalEl = document.getElementById("tm-style-modal");
  const btnApply = document.getElementById("tm-style-apply");
  const btnCloseX = document.getElementById("tm-style-close-x");
  if (!btn || !modalEl || !btnApply) return;

  // Preset grids
  const presetColourwaysEl = document.getElementById("tm-style-presets-colourways");
  const presetStylesEl = document.getElementById("tm-style-presets-styles");

  // Inputs
  const bg = document.getElementById("tm-style-background");
  const dir = document.getElementById("tm-style-direction");
  // Direction buttons (UX: 4 buttons, no dropdown)
  const dirBtnsWrap = document.getElementById("tm-style-direction-btns");
  const dirBtns = dirBtnsWrap ? Array.from(dirBtnsWrap.querySelectorAll('button[data-value]')) : [];
  const boxFill = document.getElementById("tm-style-node-fill");
  const boxShape = document.getElementById("tm-style-node-shape");
  const boxBorderW = document.getElementById("tm-style-node-border-width");
  const boxBorderWVal = document.getElementById("tm-style-node-border-width-val");
  const boxBorderStyle = document.getElementById("tm-style-node-border-style");
  const boxBorderColor = document.getElementById("tm-style-node-border-color");
  const boxShadow = document.getElementById("tm-style-node-shadow");
  const textColor = document.getElementById("tm-style-text-color");
  const defaultNodeTextColor = document.getElementById("tm-style-default-node-text-color");
  const defaultGroupTextColor = document.getElementById("tm-style-default-group-text-color");
  const titleSize = document.getElementById("tm-style-title-size");
  const titleSizeVal = document.getElementById("tm-style-title-size-val");
  const titlePosition = document.getElementById("tm-style-title-position");
  const titlePosBtnsWrap = document.getElementById("tm-style-title-position-btns");
  const titlePosBtns = titlePosBtnsWrap ? Array.from(titlePosBtnsWrap.querySelectorAll('button[data-value]')) : [];
  const linkColor = document.getElementById("tm-style-link-color");
  const linkStyle = document.getElementById("tm-style-link-style");
  const linkWidth = document.getElementById("tm-style-link-width");
  const linkWidthVal = document.getElementById("tm-style-link-width-val");
  const labelWrap = document.getElementById("tm-style-label-wrap");
  const labelWrapVal = document.getElementById("tm-style-label-wrap-val");
  const rankGap = document.getElementById("tm-style-rank-gap");
  const rankGapVal = document.getElementById("tm-style-rank-gap-val");
  const nodeGap = document.getElementById("tm-style-node-gap");
  const nodeGapVal = document.getElementById("tm-style-node-gap-val");

  const bs = globalThis.bootstrap;
  const bsCollapse = bs?.Collapse || null;
  const presetsPanel = document.getElementById("tm-style-presets-panel");
  const morePanel = document.getElementById("tm-style-more-panel");
  let suppressLiveApply = false; // prevents feedback loops while we populate widgets
  let lastRequestedPanel = "presets";
 
  function openStyleAccordionPanel(panel) {
    // Purpose: default the Styles modal to Presets on open; allow callers to opt into More settings.
    if (!bsCollapse) return;
    const wantMore = String(panel || "").toLowerCase() === "more";
    const toShow = wantMore ? morePanel : presetsPanel;
    const toHide = wantMore ? presetsPanel : morePanel;
    if (toShow) bsCollapse.getOrCreateInstance(toShow).show();
    if (toHide) bsCollapse.getOrCreateInstance(toHide).hide();
  }

  function openStyleDrawer() {
    // Purpose: show the styles UI as a sliding drawer (replaces the old bootstrap modal).
    closeOtherVizDrawers(modalEl);
    modalEl.classList.add("tm-open");
    positionVizDrawerAgainstDiagram(modalEl);
    // Defer so collapse measures/layout runs after the drawer becomes visible.
    // Default to Presets unless explicitly requested to open More.
    requestAnimationFrame(() => {
      const panel = String(lastRequestedPanel || "presets").trim().toLowerCase() === "more" ? "more" : "presets";
      openStyleAccordionPanel(panel);
    });
  }

  function closeStyleDrawer() {
    modalEl.classList.remove("tm-open");
    // Default back to Presets next time (unless a caller explicitly requests "more").
    lastRequestedPanel = "presets";
  }

  function syncRangeValueLabel(rangeEl, valEl) {
    if (!rangeEl || !valEl) return;
    valEl.textContent = String(rangeEl.value);
  }

  function setRangeUi(rangeEl, valEl) {
    if (!rangeEl || !valEl) return;
    const sync = () => syncRangeValueLabel(rangeEl, valEl);
    rangeEl.addEventListener("input", sync);
    sync();
  }

  setRangeUi(boxBorderW, boxBorderWVal);
  setRangeUi(linkWidth, linkWidthVal);
  setRangeUi(labelWrap, labelWrapVal);
  setRangeUi(rankGap, rankGapVal);
  setRangeUi(nodeGap, nodeGapVal);
  setRangeUi(titleSize, titleSizeVal);

  function setDirectionButtonsUi(value) {
    if (!dirBtns.length) return;
    const v = String(value || "LR");
    for (const b of dirBtns) {
      const on = String(b.dataset.value || "") === v;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function setTitlePositionButtonsUi(value) {
    if (!titlePosBtns.length) return;
    const v = normalizeTitlePosition(value) || "bottom-left";
    for (const b of titlePosBtns) {
      const on = String(b.dataset.value || "") === v;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  // Clicking a direction button writes to the hidden select (source of truth for existing code)
  if (dir && dirBtns.length) {
    for (const b of dirBtns) {
      b.addEventListener("click", () => {
        const v = String(b.dataset.value || "LR");
        dir.value = v;
        setDirectionButtonsUi(v);
        dir.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    dir.addEventListener("change", () => setDirectionButtonsUi(dir.value));
    setDirectionButtonsUi(dir.value || "LR");
  }

  // Clicking a title-position button writes to the hidden select (source of truth)
  if (titlePosition && titlePosBtns.length) {
    for (const b of titlePosBtns) {
      b.addEventListener("click", () => {
        const v = String(b.dataset.value || "bottom-left");
        titlePosition.value = v;
        setTitlePositionButtonsUi(v);
        titlePosition.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    titlePosition.addEventListener("change", () => setTitlePositionButtonsUi(titlePosition.value));
    setTitlePositionButtonsUi(titlePosition.value || "bottom-left");
  }

  function setControlsFromStyleSettings(sIn) {
    suppressLiveApply = true;
    try {
      const s = sIn || {};

      const bgRgb = resolveCssColorToRgb(s.background || "#ffffff") || { r: 255, g: 255, b: 255 };
      if (bg) bg.value = rgbToHex(bgRgb);

      const tcRgb = resolveCssColorToRgb(s.textColour || "#111827") || { r: 17, g: 24, b: 39 };
      if (textColor) textColor.value = rgbToHex(tcRgb);

      const ntcRgb = resolveCssColorToRgb(s.defaultNodeTextColour || "#111827") || { r: 17, g: 24, b: 39 };
      if (defaultNodeTextColor) defaultNodeTextColor.value = rgbToHex(ntcRgb);

      const btcRgb = resolveCssColorToRgb(s.defaultBoxTextColour || "#111827") || { r: 17, g: 24, b: 39 };
      if (defaultGroupTextColor) defaultGroupTextColor.value = rgbToHex(btcRgb);

      if (titleSize) titleSize.value = String(Math.max(6, Math.min(72, Math.round(Number(s.titleSize || 18)))));
      syncRangeValueLabel(titleSize, titleSizeVal);

      if (titlePosition) titlePosition.value = normalizeTitlePosition(s.titlePosition) || "bottom-left";
      setTitlePositionButtonsUi(titlePosition?.value || "bottom-left");

      if (dir) dir.value = String(s.direction || "LR");
      setDirectionButtonsUi(dir?.value || "LR");

      const boxRgb = resolveCssColorToRgb(s.defaultBoxColour || "#e7f5ff") || { r: 231, g: 245, b: 255 };
      if (boxFill) boxFill.value = rgbToHex(boxRgb);
      if (boxShape) boxShape.value = String(s.defaultBoxShape || "");

      const b = borderTextToUi(s.defaultBoxBorder || "1px solid rgb(30,144,255)");
      if (boxBorderW) boxBorderW.value = String(Math.max(0, Math.min(6, Math.round(b.width || 1))));
      if (boxBorderStyle) boxBorderStyle.value = String(b.style || "solid");
      if (boxBorderColor) boxBorderColor.value = String(b.colorHex || "#1e90ff");
      syncRangeValueLabel(boxBorderW, boxBorderWVal);

      // Default node shadow: prefer "medium" when no explicit setting is present.
      if (boxShadow) boxShadow.value = String(s.defaultBoxShadow || "medium");

      const linkRgb = resolveCssColorToRgb(s.defaultLinkColour || "#6c757d") || { r: 108, g: 117, b: 125 };
      if (linkColor) linkColor.value = rgbToHex(linkRgb);
      if (linkStyle) linkStyle.value = String(s.defaultLinkStyle || "");

      if (linkWidth) linkWidth.value = String(Math.max(1, Math.min(6, Math.round(Number(s.defaultLinkWidth || 1)))));
      syncRangeValueLabel(linkWidth, linkWidthVal);

      if (labelWrap) labelWrap.value = String(Math.max(8, Math.min(40, Math.round(Number(s.labelWrap || 18)))));
      syncRangeValueLabel(labelWrap, labelWrapVal);

      if (rankGap) rankGap.value = String(Math.max(0, Math.min(20, Math.round(Number(s.spacingAlong || 4)))));
      syncRangeValueLabel(rankGap, rankGapVal);

      if (nodeGap) nodeGap.value = String(Math.max(0, Math.min(20, Math.round(Number(s.spacingAcross || 3)))));
      syncRangeValueLabel(nodeGap, nodeGapVal);
    } finally {
      suppressLiveApply = false;
    }
  }

  function readUiStylesFromModal() {
    const out = {};
    if (bg) out.background = normalizeColor(bg.value);
    if (textColor) out.textColour = normalizeColor(textColor.value);
    if (defaultNodeTextColor) out.defaultNodeTextColour = normalizeColor(defaultNodeTextColor.value);
    if (defaultGroupTextColor) out.defaultBoxTextColour = normalizeColor(defaultGroupTextColor.value);
    if (titleSize) out.titleSize = Number(titleSize.value);
    if (titlePosition) {
      const p = normalizeTitlePosition(titlePosition.value);
      // Keep default bottom-left implicit (so we don't spam the editor with a redundant setting line).
      if (p && p !== "bottom-left") out.titlePosition = p;
    }
    if (dir) out.direction = normalizeDirection(dir.value) || dir.value;
    if (boxFill) out.defaultBoxColour = normalizeColor(boxFill.value);
    if (boxShape) out.defaultBoxShape = String(boxShape.value || "").trim().toLowerCase() || null;
    if (boxShadow) out.defaultBoxShadow = String(boxShadow.value || "").trim() || null;

    // Border text stays in our existing "Npx style rgb(...)" format.
    if (boxBorderW && boxBorderStyle && boxBorderColor) {
      out.defaultBoxBorder = uiToBorderText({
        width: Number(boxBorderW.value),
        style: String(boxBorderStyle.value || "solid"),
        colorHex: String(boxBorderColor.value || "#999999"),
      }) || null;
    }

    if (linkColor) out.defaultLinkColour = normalizeColor(linkColor.value);
    if (linkStyle) out.defaultLinkStyle = String(linkStyle.value || "").trim().toLowerCase() || null;
    if (linkWidth) out.defaultLinkWidth = Number(linkWidth.value);
    if (labelWrap) out.labelWrap = Number(labelWrap.value);
    if (rankGap) out.spacingAlong = Number(rankGap.value);
    if (nodeGap) out.spacingAcross = Number(nodeGap.value);

    return coerceUiStyleSettings(out);
  }

  function renderPresetButton(container, { title, preview, onClick }) {
    if (!container) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tm-style-preset-btn";
    btn.title = title || "";
    btn.setAttribute("aria-label", title || "Preset");
    btn.setAttribute("aria-pressed", "false");

    const thumb = document.createElement("div");
    thumb.className = "tm-style-thumb";
    thumb.style.background = preview.background || "#ffffff";

    const node = document.createElement("div");
    node.className = "tm-style-thumb-node";
    node.style.background = preview.nodeFill || "#e7f5ff";
    node.style.border = preview.nodeBorder || "1px solid #1e90ff";
    node.style.borderRadius = preview.nodeRadius || "6px";

    const edge = document.createElement("div");
    edge.className = "tm-style-thumb-edge";
    edge.style.borderTop = preview.edgeBorder || "2px solid #6c757d";

    thumb.appendChild(node);
    thumb.appendChild(edge);
    btn.appendChild(thumb);

    btn.addEventListener("click", () => onClick(btn));
    container.appendChild(btn);
  }

  function setSelectedPresetInGrid(container, selectedBtn) {
    if (!container || !selectedBtn) return;
    container.querySelectorAll(".tm-style-preset-btn").forEach((b) => {
      const isSelected = b === selectedBtn;
      b.classList.toggle("tm-selected", isSelected);
      b.setAttribute("aria-pressed", isSelected ? "true" : "false");
    });
  }

  function initPresets() {
    if (presetColourwaysEl) presetColourwaysEl.innerHTML = "";
    if (presetStylesEl) presetStylesEl.innerHTML = "";

    function relLuminance(rgb) {
      // WCAG relative luminance for sRGB.
      const toLin = (v) => {
        const s = (Number(v) || 0) / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      const r = toLin(rgb.r);
      const g = toLin(rgb.g);
      const b = toLin(rgb.b);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    function contrastRatio(rgbA, rgbB) {
      const L1 = relLuminance(rgbA);
      const L2 = relLuminance(rgbB);
      const hi = Math.max(L1, L2);
      const lo = Math.min(L1, L2);
      return (hi + 0.05) / (lo + 0.05);
    }

    function mixRgb(a, b, t) {
      const k = Math.max(0, Math.min(1, Number(t)));
      const m = (x, y) => Math.round((1 - k) * x + k * y);
      return { r: m(a.r, b.r), g: m(a.g, b.g), b: m(a.b, b.b) };
    }

    function ensureReadableHexOnBg(fgCss, bgCss, { minRatio = 3 } = {}) {
      // Purpose: keep edges/borders readable on the chosen background, while preserving hue where possible.
      const fg = resolveCssColorToRgb(fgCss);
      const bg = resolveCssColorToRgb(bgCss);
      if (!fg || !bg) return String(fgCss || "").trim();
      if (contrastRatio(fg, bg) >= minRatio) return rgbToHex(fg);

      const bgLum = relLuminance(bg);
      const target = bgLum < 0.45 ? { r: 248, g: 250, b: 252 } : { r: 17, g: 24, b: 39 }; // light or dark

      // Nudge towards the target (white-ish on dark bg, black-ish on light bg) until readable.
      for (const t of [0.18, 0.30, 0.42, 0.54, 0.66, 0.78, 0.9, 1]) {
        const cand = mixRgb(fg, target, t);
        if (contrastRatio(cand, bg) >= minRatio) return rgbToHex(cand);
      }
      return rgbToHex(target);
    }

    function pickBestTextColour(bgCss, boxCss) {
      // Purpose: pick a single text colour that stays readable on BOTH the background and default node fill.
      const bg = resolveCssColorToRgb(bgCss);
      const box = resolveCssColorToRgb(boxCss);
      if (!bg || !box) return "#111827";

      const dark = { r: 17, g: 24, b: 39 }; // #111827
      const light = { r: 248, g: 250, b: 252 }; // #f8fafc

      const score = (rgb) => Math.min(contrastRatio(rgb, bg), contrastRatio(rgb, box));
      const best = score(light) >= score(dark) ? light : dark;
      return rgbToHex(best);
    }

    // Colourways (36): ordered to scan well in the UI:
    // - professional neutrals first (near-white/near-black)
    // - muted light palettes
    // - stronger dark backgrounds last
    const COLOURWAYS = [
      // Professional / neutral (light)
      { name: "Paper + ink", bg: "#fffdf5", box: "#ffffff", border: "#111827", link: "#111827" },
      { name: "Slate", bg: "#f1f5f9", box: "#f1f3f5", border: "#495057", link: "#495057" },
      { name: "Mono high-contrast", bg: "#ffffff", box: "#ffffff", border: "#000000", link: "#000000" },

      // Professional / neutral (dark)
      { name: "Charcoal", bg: "#0f172a", box: "#111827", border: "#94a3b8", link: "#e2e8f0" },
      { name: "Dark mode", bg: "#0b1020", box: "#111827", border: "#93c5fd", link: "#93c5fd" },

      // Muted light palettes
      { name: "Arctic", bg: "#e0f2fe", box: "#bae6fd", border: "#0284c7", link: "#334155" },
      { name: "Indigo", bg: "#eef2ff", box: "#edf2ff", border: "#364fc7", link: "#364fc7" },
      { name: "Teal", bg: "#ecfeff", box: "#e6fcf5", border: "#0ca678", link: "#0ca678" },
      { name: "Aqua", bg: "#ecfeff", box: "#cffafe", border: "#06b6d4", link: "#0891b2" },
      { name: "Spring", bg: "#f0fdf4", box: "#dcfce7", border: "#22c55e", link: "#16a34a" },
      { name: "Lime", bg: "#f7fee7", box: "#ecfccb", border: "#84cc16", link: "#65a30d" },
      { name: "Amber", bg: "#fffbeb", box: "#fef3c7", border: "#f59e0b", link: "#f59e0b" },
      { name: "Lemon", bg: "#fffbeb", box: "#fff9db", border: "#f59f00", link: "#6c757d" },
      { name: "Mocha", bg: "#faf5ef", box: "#f3e8d9", border: "#7c4a2d", link: "#7c4a2d" },
      { name: "Coral", bg: "#fff1f2", box: "#ffe4e6", border: "#fb7185", link: "#fb7185" },
      { name: "Tangerine", bg: "#fff7ed", box: "#ffedd5", border: "#f97316", link: "#f97316" },
      { name: "Magenta", bg: "#fdf2f8", box: "#fce7f3", border: "#db2777", link: "#be185d" },
      { name: "Cobalt", bg: "#eff6ff", box: "#dbeafe", border: "#2563eb", link: "#1d4ed8" },
      { name: "Violet", bg: "#f5f3ff", box: "#ede9fe", border: "#8b5cf6", link: "#7c3aed" },
      { name: "Forest", bg: "#f0fdf4", box: "#dcfce7", border: "#166534", link: "#166534" },
      { name: "Evergreen + gold", bg: "#f0fdf4", box: "#dcfce7", border: "#065f46", link: "#b45309" },
      { name: "Burgundy", bg: "#fff1f2", box: "#ffe4e6", border: "#7f1d1d", link: "#7f1d1d" },

      // Strong dark backgrounds
      { name: "Navy", bg: "#0b2a5b", box: "#123b73", border: "#93c5fd", link: "#93c5fd" },
      { name: "Ocean night", bg: "#082f49", box: "#0b2a3d", border: "#38bdf8", link: "#38bdf8" },
      { name: "Deep teal", bg: "#05343b", box: "#0a4a54", border: "#2dd4bf", link: "#2dd4bf" },
      { name: "Pine", bg: "#052e1b", box: "#0b4a2b", border: "#34d399", link: "#34d399" },
      { name: "Midnight blue", bg: "#0b132b", box: "#1c2541", border: "#5bc0be", link: "#5bc0be" },
      { name: "Nord", bg: "#2e3440", box: "#3b4252", border: "#88c0d0", link: "#a3be8c" },
      { name: "Plum night", bg: "#120a1f", box: "#2a0a3d", border: "#c084fc", link: "#c084fc" },
      { name: "Royal purple", bg: "#2b0f3a", box: "#3f1a59", border: "#d8b4fe", link: "#d8b4fe" },
      { name: "Burgundy night", bg: "#3b0a17", box: "#5a1224", border: "#fb7185", link: "#fb7185" },
      { name: "Deep maroon", bg: "#4a0f0f", box: "#6b1d1d", border: "#fca5a5", link: "#fca5a5" },
      { name: "Desert dusk", bg: "#2d1b12", box: "#1f2937", border: "#f59e0b", link: "#f97316" },
      { name: "Night mint", bg: "#0b1020", box: "#1ff2a8", border: "#9ec5fe", link: "#9ec5fe" },
      { name: "Cyber lime", bg: "#0b0f14", box: "#111827", border: "#a3e635", link: "#a3e635" },
      { name: "Neon on black", bg: "#0b0f14", box: "#0b0f14", border: "#22d3ee", link: "#f472b6" },
    ];

    COLOURWAYS.forEach((cw) => {
      renderPresetButton(presetColourwaysEl, {
        title: cw.name,
        preview: {
          background: cw.bg,
          nodeFill: cw.box,
          nodeBorder: `1px solid ${cw.border}`,
          nodeRadius: "0px",
          edgeBorder: `2px solid ${cw.link}`,
        },
        onClick: (btnEl) => {
          setSelectedPresetInGrid(presetColourwaysEl, btnEl);
          const cur = readUiStylesFromModal();
          const curBorder = borderTextToUi(cur.defaultBoxBorder || "1px solid rgb(30,144,255)");
          const nextBorderHex = ensureReadableHexOnBg(cw.border, cw.bg, { minRatio: 3 });
          const nextLinkHex = ensureReadableHexOnBg(cw.link, cw.bg, { minRatio: 3 });
          const nextBorder = uiToBorderText({
            width: Number.isFinite(curBorder.width) ? curBorder.width : 1,
            style: curBorder.style || "solid",
            colorHex: nextBorderHex,
          });

          const merged = {
            ...cur,
            background: cw.bg,
            textColour: pickBestTextColour(cw.bg, cw.box),
            defaultNodeTextColour: pickBestTextColour(cw.box, cw.box), // node text on node fill
            defaultBoxTextColour: pickBestTextColour(cw.bg, cw.box), // group title on diagram background
            defaultBoxColour: cw.box,
            defaultLinkColour: nextLinkHex,
            defaultBoxBorder: nextBorder,
          };
          setControlsFromStyleSettings(merged);
          applyLiveFromModal(); // preset clicks don't fire input/change events; apply immediately
        },
      });
    });

    // 12 style presets: rounded/square + thick/thin + edge style, without overriding colours.
    const STYLES = [
      { name: "Square / thin", shape: "", bw: 1, bs: "solid", ew: 1, es: "solid", shadow: "none" },
      { name: "Rounded / thin", shape: "rounded", bw: 1, bs: "solid", ew: 1, es: "solid", shadow: "subtle" },
      { name: "Square / thick", shape: "", bw: 3, bs: "solid", ew: 3, es: "solid", shadow: "none" },
      { name: "Rounded / thick", shape: "rounded", bw: 3, bs: "solid", ew: 3, es: "solid", shadow: "medium" },
      { name: "Square / dotted", shape: "", bw: 2, bs: "dotted", ew: 2, es: "dotted", shadow: "none" },
      { name: "Rounded / dotted", shape: "rounded", bw: 2, bs: "dotted", ew: 2, es: "dotted", shadow: "subtle" },
      { name: "Square / dashed", shape: "", bw: 2, bs: "dashed", ew: 2, es: "dashed", shadow: "none" },
      { name: "Rounded / dashed", shape: "rounded", bw: 2, bs: "dashed", ew: 2, es: "dashed", shadow: "subtle" },
      { name: "Square / bold", shape: "", bw: 4, bs: "bold", ew: 4, es: "bold", shadow: "none" },
      { name: "Rounded / bold", shape: "rounded", bw: 4, bs: "bold", ew: 4, es: "bold", shadow: "medium" },
      { name: "Soft shadow", shape: "rounded", bw: 1, bs: "solid", ew: 1, es: "solid", shadow: "medium" },
      { name: "Flat + crisp", shape: "", bw: 1, bs: "solid", ew: 1, es: "solid", shadow: "none" },
    ];

    STYLES.forEach((st) => {
      renderPresetButton(presetStylesEl, {
        title: st.name,
        preview: {
          background: "#ffffff",
          nodeFill: "#f1f3f5",
          nodeBorder: `${st.bw}px ${st.bs} #495057`,
          nodeRadius: st.shape === "rounded" ? "8px" : "0px",
          edgeBorder: `${st.ew}px ${st.es} #495057`,
        },
        onClick: (btnEl) => {
          setSelectedPresetInGrid(presetStylesEl, btnEl);
          const cur = readUiStylesFromModal();
          const curBorder = borderTextToUi(cur.defaultBoxBorder || "1px solid rgb(30,144,255)");
          const borderColorHex = curBorder.colorHex || "#1e90ff";
          const nextBorder = uiToBorderText({ width: st.bw, style: st.bs, colorHex: borderColorHex });

          const merged = {
            ...cur,
            defaultBoxShape: st.shape,
            defaultBoxShadow: st.shadow,
            defaultBoxBorder: nextBorder,
            defaultLinkWidth: st.ew,
            defaultLinkStyle: st.es,
          };
          setControlsFromStyleSettings(merged);
          applyLiveFromModal(); // preset clicks don't fire input/change events; apply immediately
        },
      });
    });
  }

  // Render presets once (they only need to exist; clicks mutate the modal fields).
  initPresets();

  function applyLiveFromModal() {
    if (suppressLiveApply) return;
    // Persist to the editor (source of truth), then URL (#m), then render.
    const ui = readUiStylesFromModal();
    upsertEditorStyleBlockFromUiStyleSettings(editor, ui);
    afterEditorMutation({ editor, graphviz });
  }

  btn.addEventListener("click", () => {
    // Prefer what's currently in the editor (so manual edits to style lines are respected).
    const parsed = dslToDot(editor.getValue()).settings;
    const fromEditor = coerceUiStyleSettings(pickStyleSettings(parsed));
    setControlsFromStyleSettings(fromEditor || {});
    // Always open on Presets unless a caller explicitly requests "more".
    const requestedPanel = modalEl?.dataset?.tmStyleOpenPanel || "presets";
    if (modalEl?.dataset) delete modalEl.dataset.tmStyleOpenPanel;
    lastRequestedPanel = requestedPanel;
    openStyleDrawer();
  });

  btnApply.addEventListener("click", async () => {
    // Ensure the latest values are applied (the modal is live, but keep this deterministic).
    applyLiveFromModal();
    closeStyleDrawer();
  });

  btnCloseX?.addEventListener("click", () => {
    // Keep behavior consistent with the footer close button (apply latest, then close).
    applyLiveFromModal();
    closeStyleDrawer();
  });

  // Live preview: update URL + rerender on any input change.
  const liveEls = [
    bg,
    dir,
    boxFill,
    boxShape,
    boxBorderW,
    boxBorderStyle,
    boxBorderColor,
    boxShadow,
    textColor,
    defaultNodeTextColor,
    defaultGroupTextColor,
    titleSize,
    titlePosition,
    linkColor,
    linkStyle,
    linkWidth,
    labelWrap,
    rankGap,
    nodeGap,
  ].filter(Boolean);
  for (const el of liveEls) {
    el.addEventListener("input", applyLiveFromModal);
    el.addEventListener("change", applyLiveFromModal);
  }
}

function initTitleModal({ editor, graphviz }) {
  // Purpose: small focused modal for editing title styling (size/colour/position).
  const modalEl = document.getElementById("tm-title-modal");
  const btnCloseX = document.getElementById("tm-title-close-x");
  const btnClose = document.getElementById("tm-title-close");
  if (!modalEl) return null;

  const titleText = document.getElementById("tm-title-text");
  const textColor = document.getElementById("tm-title-text-color");
  const titleSize = document.getElementById("tm-title-size");
  const titleSizeVal = document.getElementById("tm-title-size-val");
  const titlePosition = document.getElementById("tm-title-position");
  const titlePosBtnsWrap = document.getElementById("tm-title-position-btns");
  const titlePosBtns = titlePosBtnsWrap ? Array.from(titlePosBtnsWrap.querySelectorAll('button[data-value]')) : [];

  let suppressLiveApply = false;

  function syncRangeValueLabel(rangeEl, valEl) {
    if (!rangeEl || !valEl) return;
    valEl.textContent = String(rangeEl.value);
  }
  if (titleSize && titleSizeVal) {
    titleSize.addEventListener("input", () => syncRangeValueLabel(titleSize, titleSizeVal));
    syncRangeValueLabel(titleSize, titleSizeVal);
  }

  function setTitlePositionButtonsUi(value) {
    if (!titlePosBtns.length) return;
    const v = normalizeTitlePosition(value) || "bottom-left";
    for (const b of titlePosBtns) {
      const on = String(b.dataset.value || "") === v;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  if (titlePosition && titlePosBtns.length) {
    for (const b of titlePosBtns) {
      b.addEventListener("click", () => {
        const v = String(b.dataset.value || "bottom-left");
        titlePosition.value = v;
        setTitlePositionButtonsUi(v);
        titlePosition.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    titlePosition.addEventListener("change", () => setTitlePositionButtonsUi(titlePosition.value));
    setTitlePositionButtonsUi(titlePosition.value || "bottom-left");
  }

  function setControlsFromStyleSettings(sIn) {
    suppressLiveApply = true;
    try {
      const s = sIn || {};
      if (titleText) titleText.value = String(s.title || "").trim();
      const tcRgb = resolveCssColorToRgb(s.textColour || "#111827") || { r: 17, g: 24, b: 39 };
      if (textColor) textColor.value = rgbToHex(tcRgb);

      if (titleSize) titleSize.value = String(Math.max(10, Math.min(36, Math.round(Number(s.titleSize || 18)))));
      syncRangeValueLabel(titleSize, titleSizeVal);

      if (titlePosition) titlePosition.value = normalizeTitlePosition(s.titlePosition) || "bottom-left";
      setTitlePositionButtonsUi(titlePosition?.value || "bottom-left");
    } finally {
      suppressLiveApply = false;
    }
  }

  function upsertTitleLineInEditor(nextTitleRaw) {
    // Purpose: update/insert/remove the single "Title: ..." line in the editor (and remove duplicates).
    const nextTitle = String(nextTitleRaw ?? "").trim();
    const lines = editor.getValue().split(/\r?\n/);

    const titleIdxs = [];
    for (let i = 0; i < lines.length; i++) {
      const trimmed = String(lines[i] || "").trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const { code } = stripCommentKeepSuffix(lines[i]);
      if (/^\s*title\s*:\s*(.+)\s*$/i.test(code)) titleIdxs.push(i);
    }

    if (!titleIdxs.length) {
      if (!nextTitle) return false;
      // Insert after any leading blank/comment lines to keep top-of-file tidy.
      let insertAt = 0;
      while (insertAt < lines.length) {
        const t = String(lines[insertAt] || "").trim();
        if (t === "" || t.startsWith("#")) insertAt++;
        else break;
      }
      lines.splice(insertAt, 0, `Title: ${nextTitle}`);
      editor.setValue(lines.join("\n"), -1);
      return true;
    }

    // If empty: delete all Title lines.
    if (!nextTitle) {
      for (let k = titleIdxs.length - 1; k >= 0; k--) lines.splice(titleIdxs[k], 1);
      editor.setValue(lines.join("\n"), -1);
      return true;
    }

    // Replace first, remove duplicates.
    const firstIdx = titleIdxs[0];
    const { comment } = stripCommentKeepSuffix(lines[firstIdx]);
    lines[firstIdx] = `Title: ${nextTitle}${comment ? ` ${comment.trimStart()}` : ""}`.trimEnd();
    for (let k = titleIdxs.length - 1; k >= 1; k--) lines.splice(titleIdxs[k], 1);
    editor.setValue(lines.join("\n"), -1);
    return true;
  }

  function applyLive() {
    if (suppressLiveApply) return;
    const parsed = dslToDot(editor.getValue()).settings;
    const cur = coerceUiStyleSettings(pickStyleSettings(parsed));

    // Title text is NOT a "style setting" in this app; it stays as a user-facing "Title: ..." line.
    if (titleText) upsertTitleLineInEditor(titleText.value);

    const patch = {};
    if (textColor) patch.textColour = normalizeColor(textColor.value);
    if (titleSize) patch.titleSize = Number(titleSize.value);
    if (titlePosition) {
      const p = normalizeTitlePosition(titlePosition.value);
      patch.titlePosition = p === "bottom-left" ? null : p;
    }

    const next = { ...cur, ...patch };
    upsertEditorStyleBlockFromUiStyleSettings(editor, next);
    afterEditorMutation({ editor, graphviz });
  }

  const liveEls = [titleText, textColor, titleSize, titlePosition].filter(Boolean);
  for (const el of liveEls) {
    el.addEventListener("input", applyLive);
    el.addEventListener("change", applyLive);
  }

  function openTitleDrawer() {
    closeOtherVizDrawers(modalEl);
    modalEl.classList.add("tm-open");
    positionVizDrawerAgainstDiagram(modalEl);
  }

  function closeTitleDrawer() {
    modalEl.classList.remove("tm-open");
  }

  btnCloseX?.addEventListener("click", closeTitleDrawer);
  btnClose?.addEventListener("click", closeTitleDrawer);

  return function openTitleModal() {
    const parsed = dslToDot(editor.getValue()).settings;
    // Need `title` too (not in pickStyleSettings), so pass the parsed settings directly.
    setControlsFromStyleSettings(parsed || {});
    openTitleDrawer();
  };
}

// -----------------------------
// Templates: examples + (optional) saved local maps
// -----------------------------

const TM_SAVED_KEY_PREFIX = "tm_map:";
const EXAMPLE_THUMB_CACHE = new Map(); // exampleId -> dataURL (png)

function escapeForTemplateLiteral(s) {
  // Keep admin "save as standard example" safe even if the DSL contains backticks or ${...}.
  return String(s || "").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function nextExampleIdFromCurrentExamples() {
  // Ex: ex-01 ... ex-16 -> ex-17 (pad to 2 digits)
  let maxN = 0;
  for (const ex of GALLERY_EXAMPLES) {
    const m = String(ex?.id || "").match(/^ex-(\d+)$/);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n)) maxN = Math.max(maxN, n);
  }
  return `ex-${String(maxN + 1).padStart(2, "0")}`;
}

function buildStandardExampleSnippet({ id, title, desc, dsl }) {
  // Admin-only: generate the exact object literal to paste into `GALLERY_EXAMPLES` in examples.js.
  const safeTitle = String(title || "").replace(/"/g, '\\"');
  const safeDesc = String(desc || "").replace(/"/g, '\\"');
  return [
    "  {",
    `    id: "${String(id)}",`,
    `    title: "${safeTitle}",`,
    `    desc: "${safeDesc}",`,
    `    dsl: \`${escapeForTemplateLiteral(dsl)}\`,`,
    "  },",
  ].join("\n");
}

function listSavedMapsFromLocalStorage() {
  // Saved maps are optional; templates shows them if present.
  // Expected value: JSON { name, dsl, styleSettings?, savedAt, screenshotDataUrl? }
  const items = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(TM_SAVED_KEY_PREFIX)) continue;
    const raw = localStorage.getItem(k);
    if (!raw) continue;
    try {
      const v = JSON.parse(raw);
      if (!v || typeof v.dsl !== "string") continue;
      items.push({
        id: k,
        title: String(v.name || k.slice(TM_SAVED_KEY_PREFIX.length) || "Saved map"),
        desc: v.savedAt ? `Saved ${new Date(v.savedAt).toLocaleString()}` : "Saved map",
        dsl: v.dsl,
        styleSettings: v.styleSettings && typeof v.styleSettings === "object" ? coerceUiStyleSettings(v.styleSettings) : null,
        screenshotDataUrl: typeof v.screenshotDataUrl === "string" ? v.screenshotDataUrl : null,
        _savedAt: v.savedAt ? Number(new Date(v.savedAt)) : 0,
      });
    } catch {
      // ignore malformed entries
    }
  }
  items.sort((a, b) => (b._savedAt || 0) - (a._savedAt || 0));
  return items;
}

function makeSavedMapKey(name) {
  // Key is user-defined but sanitised (stable + safe for localStorage keyspace).
  return `${TM_SAVED_KEY_PREFIX}${slugId(String(name || ""))}`;
}

async function captureVizPngDataUrl({ scale = 2 } = {}) {
  // Capture the current Graphviz SVG as a PNG data URL (for template thumbnails).
  const svgEl = document.querySelector("#tm-viz svg");
  if (!svgEl) return null;

  const serializer = new XMLSerializer();
  const svgText = serializer.serializeToString(svgEl);
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();

    const rect = svgEl.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || img.width || 1));
    const h = Math.max(1, Math.round(rect.height || img.height || 1));

    const s = Number(scale);
    const k = Number.isFinite(s) && s > 0 ? s : 2;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * k);
    canvas.height = Math.round(h * k);

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Background: match the viz panel background so thumbnail isn't transparent.
  const vizBg = getComputedStyle(document.getElementById("tm-viz") || document.body).backgroundColor || "white";
    ctx.fillStyle = vizBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function saveMapToLocalStorage({ key, name, dsl, screenshotDataUrl }) {
  // Stored format is read by Templates (see listSavedMapsFromLocalStorage()).
  const payload = {
    name,
    dsl,
    // styleSettings: legacy (we now store styles in the editor/MapScript itself)
    savedAt: new Date().toISOString(),
    screenshotDataUrl: screenshotDataUrl || null,
  };
  localStorage.setItem(key, JSON.stringify(payload));
}

function updateSavedMapThumbnailInLocalStorage(key, screenshotDataUrl) {
  const raw = localStorage.getItem(key);
  if (!raw) return false;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v.dsl !== "string") return false;
    v.screenshotDataUrl = screenshotDataUrl || null;
    localStorage.setItem(key, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

function parseSvgSize(svgEl) {
  // Prefer viewBox, then width/height attributes.
  const vb = svgEl.getAttribute("viewBox");
  if (vb) {
    const parts = vb.split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const w = Math.max(1, Math.round(parts[2]));
      const h = Math.max(1, Math.round(parts[3]));
      return { w, h };
    }
  }

  const wAttr = svgEl.getAttribute("width");
  const hAttr = svgEl.getAttribute("height");
  const w = wAttr ? Number(String(wAttr).replace(/[^\d.]/g, "")) : NaN;
  const h = hAttr ? Number(String(hAttr).replace(/[^\d.]/g, "")) : NaN;
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
  }

  return { w: 800, h: 450 };
}

async function svgTextToPngDataUrl(svgText, { scale = 2, backgroundColor = "#ffffff" } = {}) {
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();

    // Use SVG size hints if possible (more stable than img.width/height on some browsers).
    let w = 800;
    let h = 450;
    try {
      const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
      const svgEl = doc.querySelector("svg");
      if (svgEl) {
        const s = parseSvgSize(svgEl);
        w = s.w;
        h = s.h;
      }
    } catch {
      // ignore
    }

    const s = Number(scale);
    const k = Number.isFinite(s) && s > 0 ? s : 2;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * k);
    canvas.height = Math.round(h * k);

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/png");
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function buildExampleThumbnail(example, graphviz) {
  // Render example DSL → DOT → SVG, then convert SVG → PNG dataURL.
  const { dot, errors } = dslToDot(example.dsl);
  if (errors?.length) return null;

  try {
    const svg = await graphviz.layout(dot, "svg", "dot");
    const bg = "#ffffff"; // keep thumbnails consistent; map background is already embedded in DOT as bgcolor
    return await svgTextToPngDataUrl(svg, { scale: 2, backgroundColor: bg });
  } catch {
    return null;
  }
}

function splitMapScriptStylesAndContents(text) {
  // “Styles” here means: initial comment/blank lines + any recognised settings lines,
  // up until the first “content-like” line (node, edge, cluster, headings, etc).
  const lines = String(text || "").split(/\r?\n/);
  const styleLines = [];
  const contentLines = [];

  let inStyles = true;
  for (const raw of lines) {
    const trimmed = raw.trim();
    const isBlank = trimmed === "";
    const isComment = trimmed.startsWith("#");

    const isSettingLine = (() => {
      if (trimmed.includes("->") || trimmed.includes("::")) return false;
      const m = trimmed.match(/^([^:]+):\s*(.+)$/);
      if (!m) return false;
      const key = m[1].trim().toLowerCase();
      return SUPPORTED_SETTING_LINE_KEYS.has(key);
    })();

    if (inStyles) {
      if (isBlank || isComment || isSettingLine) {
        styleLines.push(raw);
        continue;
      }
      inStyles = false;
      contentLines.push(raw);
      continue;
    }

    contentLines.push(raw);
  }

  return {
    styles: styleLines.join("\n").trimEnd(),
    contents: contentLines.join("\n").trimStart(),
  };
}

function initTemplates(editor, graphviz) {
  const examplesWrap = document.getElementById("tm-templates-examples");
  const savedWrap = document.getElementById("tm-templates-saved");
  const savedEmpty = document.getElementById("tm-templates-saved-empty");
  if (!examplesWrap) return null;

  function cardHtml(item, { isSaved }) {
    const badge = isSaved ? `<span class="badge text-bg-secondary ms-2">saved</span>` : "";
    const thumbUrl = isSaved ? item.screenshotDataUrl : EXAMPLE_THUMB_CACHE.get(item.id);
    const thumb = thumbUrl
      ? `<img class="tm-templates-thumb" src="${thumbUrl}" alt="" />`
      : `<div class="tm-templates-thumb-placeholder" aria-hidden="true"></div>`;

    const deleteActions = isSaved
      ? `
          <div class="tm-templates-actions">
            <button
              type="button"
              class="btn btn-sm btn-outline-danger"
              data-template-delete="1"
              data-template-id="${item.id}"
              aria-label="Delete saved map"
              title="Delete"
            >
              Delete
            </button>
          </div>
        `
      : "";

    return `
      <div class="col-12 col-md-6 col-xl-4">
        <div class="card tm-templates-card h-100" role="button" tabindex="0" data-template-id="${item.id}" data-template-saved="${isSaved ? "1" : "0"}">
          ${deleteActions}
          ${thumb}
          <div class="card-body">
            <div class="d-flex align-items-center">
              <div class="fw-semibold">${item.title}</div>
              ${badge}
            </div>
            <div class="small text-muted mt-1">${item.desc || ""}</div>
          </div>
        </div>
      </div>
    `;
  }

  async function ensureExampleThumbnails() {
    // Sequentially generate thumbnails to avoid hammering Graphviz/WASM.
    for (const ex of GALLERY_EXAMPLES) {
      if (EXAMPLE_THUMB_CACHE.has(ex.id)) continue;
      const dataUrl = await buildExampleThumbnail(ex, graphviz);
      if (dataUrl) EXAMPLE_THUMB_CACHE.set(ex.id, dataUrl);
      // Yield to keep UI responsive.
      await new Promise((r) => setTimeout(r, 0));
      renderTemplates();
    }
  }

  function renderTemplates() {
    // Saved first (if any)
    const saved = listSavedMapsFromLocalStorage();
    if (savedWrap && savedEmpty) {
      if (saved.length) {
        savedEmpty.classList.add("d-none");
        savedWrap.classList.remove("d-none");
        savedWrap.innerHTML = saved.map((it) => cardHtml(it, { isSaved: true })).join("");
      } else {
        savedEmpty.classList.remove("d-none");
        savedWrap.classList.add("d-none");
        savedWrap.innerHTML = "";
      }
    }

    // Examples
    examplesWrap.innerHTML = GALLERY_EXAMPLES.map((it) => cardHtml(it, { isSaved: false })).join("");
  }

  function getItemById(id, isSaved) {
    if (isSaved) {
      const saved = listSavedMapsFromLocalStorage();
      return saved.find((x) => x.id === id) || null;
    }
    return GALLERY_EXAMPLES.find((x) => x.id === id) || null;
  }

  function loadTemplate(item) {
    if (!item) return;
    const selectedDsl = String(item.dsl || "");
    const styleFromItem =
      item.styleSettings && typeof item.styleSettings === "object"
        ? coerceUiStyleSettings(item.styleSettings)
        : coerceUiStyleSettings(pickStyleSettings(dslToDot(selectedDsl).settings));

    // Replace entire editor content; ensure selected styles are present as style lines.
    editor.setValue(selectedDsl, -1);
    if (styleFromItem && Object.keys(styleFromItem).length) {
      upsertEditorStyleBlockFromUiStyleSettings(editor, styleFromItem);
    }
    afterEditorMutation({ editor, graphviz });
    setActiveTab("viz");
  }

  function onCardActivate(el) {
    const id = el.getAttribute("data-template-id");
    const isSaved = el.getAttribute("data-template-saved") === "1";
    const item = id ? getItemById(id, isSaved) : null;
    if (!item) return;
    loadTemplate(item);
  }

  function wireCardEvents(container) {
    container.addEventListener("click", (e) => {
      const delBtn = e.target?.closest?.("[data-template-delete='1']");
      if (delBtn) {
        e.preventDefault();
        e.stopPropagation();
        const key = delBtn.getAttribute("data-template-id");
        if (!key) return;
        const ok = confirm("Delete this saved map from this browser? This cannot be undone.");
        if (!ok) return;
        localStorage.removeItem(key);
        renderTemplates();
        return;
      }

      const card = e.target?.closest?.("[data-template-id]");
      if (!card) return;
      onCardActivate(card);
    });
    container.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const card = e.target?.closest?.("[data-template-id]");
      if (!card) return;
      e.preventDefault();
      onCardActivate(card);
    });
  }

  wireCardEvents(examplesWrap);
  if (savedWrap) wireCardEvents(savedWrap);

  renderTemplates();
  // Start thumbnail generation after initial paint.
  setTimeout(() => {
    ensureExampleThumbnails();
  }, 0);
  return renderTemplates;
}

async function rebuildSavedThumbnails({ editor, graphviz, refreshTemplates }) {
  const saved = listSavedMapsFromLocalStorage();
  if (!saved.length) return;

  const current = editor.getValue();
  const prevSuppress = suppressHistorySync;
  suppressHistorySync = true; // avoid polluting browser history while batch-rendering thumbnails
  try {
    setVizStatus(`Rebuilding ${saved.length} thumbnails…`);
    for (let i = 0; i < saved.length; i++) {
      const it = saved[i];
      editor.setValue(it.dsl, -1);
      // Back-compat: older saved maps may store styles separately; import into editor before rendering.
      if (it.styleSettings && !editorHasStyleLines(editor.getValue())) {
        upsertEditorStyleBlockFromUiStyleSettings(editor, it.styleSettings);
      }
      await renderNow(graphviz, editor);
      const shot = await captureVizPngDataUrl({ scale: 1.5 });
      if (shot) updateSavedMapThumbnailInLocalStorage(it.id, shot);
      setVizStatus(`Rebuilding thumbnails… (${i + 1}/${saved.length})`);
    }
  } finally {
    editor.setValue(current, -1);
    setMapScriptInUrl(editor.getValue());
    await renderNow(graphviz, editor);
    if (typeof refreshTemplates === "function") refreshTemplates();
    setVizStatus("Thumbnails rebuilt");
    suppressHistorySync = prevSuppress;
  }
}

// -----------------------------
// URL ↔ editor syncing (share/restore)
// - Stores MapScript in URL hash as: #m=<base64url(utf8)>
// - Uses History API so browser back/forward can restore prior editor states
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

function getUrlWithMapScript(mapScript) {
  const params = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  params.set("m", base64UrlEncodeUtf8(mapScript));
  return `${location.pathname}${location.search}#${params.toString()}`;
}

function setMapScriptInUrl(mapScript) {
  // Replace (not push): keeps the current history entry up to date during an edit burst.
  const next = getUrlWithMapScript(mapScript);
  const prev = history.state && history.state[TM_HISTORY_STATE_MARK] ? history.state : { [TM_HISTORY_STATE_MARK]: true };
  history.replaceState(prev, "", next);
}

function pushMapScriptInUrl(mapScript) {
  // Push: creates a new browser history entry (so Back/Forward walks through prior states).
  const next = getUrlWithMapScript(mapScript);
  history.pushState({ [TM_HISTORY_STATE_MARK]: true }, "", next);
}

function getStyleSettingsFromUrl() {
  const hash = (location.hash || "").replace(/^#/, "");
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const s = params.get("s");
  if (!s) return null;
  try {
    const txt = base64UrlDecodeUtf8(s);
    const obj = JSON.parse(txt);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

function clearStyleSettingsFromUrl() {
  // Legacy cleanup: remove #s=... after importing styles into the editor text.
  const params = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  if (!params.has("s")) return false;
  params.delete("s");
  const next = `${location.pathname}${location.search}#${params.toString()}`;
  const prev = history.state && history.state[TM_HISTORY_STATE_MARK] ? history.state : { [TM_HISTORY_STATE_MARK]: true };
  history.replaceState(prev, "", next);
  return true;
}

function pickStyleSettings(settings) {
  // Keep only the style settings (not title) and drop null/undefined.
  const out = {};
  for (const k of STYLE_SETTING_KEYS) {
    const v = settings ? settings[k] : null;
    if (v == null) continue;
    out[k] = v;
  }
  return out;
}

function coerceUiStyleSettings(obj) {
  // Minimal sanitiser for URL/localStorage payloads.
  const x = obj && typeof obj === "object" ? obj : {};
  const out = {};
  for (const k of STYLE_SETTING_KEYS) {
    const v = x[k];
    if (v == null) continue;
    if (k === "titleSize") {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[k] = n;
      continue;
    }
    if (k === "titlePosition") {
      const p = normalizeTitlePosition(v);
      // Store only non-default positions in UI settings (default is bottom-left and can be implicit).
      if (p && p !== "bottom-left") out[k] = p;
      continue;
    }
    out[k] = v;
  }
  return out;
}

function initHistoryNav({ editor, graphviz }) {
  // Navbar buttons mirror browser back/forward.
  document.getElementById("tm-undo")?.addEventListener("click", () => history.back());
  document.getElementById("tm-redo")?.addEventListener("click", () => history.forward());

  // Keyboard shortcuts: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z for undo/redo (when not typing in an input/editor).
  // Purpose: match "usual" undo/redo without stealing Ace/text-field undo.
  function isEditableTarget(el) {
    const x = el && el.nodeType === 1 ? el : null;
    if (!x) return false;
    const tag = x.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (x.isContentEditable) return true;
    // Ace editor handles its own undo/redo; don't override it.
    if (x.closest?.(".ace_editor")) return true;
    return false;
  }

  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    if (isEditableTarget(e.target)) return;

    const k = String(e.key || "").toLowerCase();
    if (k === "z") {
      e.preventDefault();
      if (e.shiftKey) history.forward();
      else history.back();
      return;
    }
    if (k === "y") {
      e.preventDefault();
      history.forward();
    }
  });

  // Browser back/forward: restore editor from the URL hash.
  window.addEventListener("popstate", (e) => {
    // Only handle entries we created (otherwise you might be navigating away).
    if (!e?.state || !e.state[TM_HISTORY_STATE_MARK]) return;
    const fromUrl = getMapScriptFromUrl();
    if (fromUrl == null) return;

    if (historyBurstTimer) clearTimeout(historyBurstTimer);
    historyBurstTimer = null;
    historyBurstActive = false;

    suppressHistorySync = true;
    try {
      editor.setValue(fromUrl, -1);
    } finally {
      suppressHistorySync = false;
    }
    renderNow(graphviz, editor);
  });
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

function domSafeToken(s) {
  // Used only for DOM ids embedded into Graphviz SVG output.
  // Keep it simple and deterministic: alnum only, other chars -> "_".
  return String(s || "").replace(/[^A-Za-z0-9]+/g, "_");
}

function makeNodeDomId(nodeId) {
  return `tm_n_${domSafeToken(nodeId)}`;
}

function makeEdgeDomId({ srcLineNo, fromId, toId }) {
  // Use "--" as delimiter because domSafeToken never outputs "-".
  return `tm_e_${srcLineNo}--${domSafeToken(fromId)}--${domSafeToken(toId)}`;
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

  const color = colorPart ? normalizeColor(colorPart.trim()) : null;

  const out = {};
  if (penwidth) out.penwidth = penwidth;
  if (style) out.style = style;
  if (color) out.color = color;
  return out;
}

function parseEdgeBorderLoosePart(partRaw) {
  // Purpose: parse *partial* edge border specs so users can write:
  // - [seagreen] (colour only)
  // - [1px] (width only)
  // - [dotted] (style only)
  // - [1px solid] (width + style)
  // - [1px solid seagreen] (full)
  // - [solid seagreen] (style + colour)
  const part = String(partRaw || "").trim();
  if (!part) return {};

  const normalizeColorIfValid = (token) => {
    // Avoid treating arbitrary words (e.g. "decreases") as colours.
    const rgb = resolveCssColorToRgb(token);
    if (!rgb) return null;
    return normalizeColor(token);
  };

  // Try full border text first (only works for WIDTH STYLE [COLOUR]).
  const full = parseBorder(part);
  if (full && (full.penwidth || full.style || full.color)) return full;

  // Width only
  const mW = part.match(/^(\d+)(px)?$/i);
  if (mW) return { penwidth: mW[1] };

  // Style only
  const s = part.toLowerCase();
  if (["solid", "dotted", "dashed", "bold"].includes(s)) return { style: s };

  // Style + colour (no width)
  const mSC = part.match(/^(solid|dotted|dashed|bold)\s+(.+)$/i);
  if (mSC) {
    const c = normalizeColorIfValid(mSC[2].trim());
    const out = { style: mSC[1].toLowerCase() };
    if (c) out.color = c;
    return out;
  }

  // Colour only
  const c = normalizeColorIfValid(part);
  if (c) return { color: c };

  return {};
}

function looksLikeEdgeStyleToken(token) {
  const t = String(token || "").trim();
  if (!t) return false;
  const b = parseEdgeBorderLoosePart(t);
  return Boolean(b && (b.penwidth || b.style || b.color));
}

function clampByte(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(255, Math.round(x)));
}

function byteToHex(n) {
  return clampByte(n).toString(16).padStart(2, "0");
}

function expandHexColor(s) {
  // Supports: #rgb, #rgba, #rrggbb, #rrggbbaa (alpha ignored)
  const hex = String(s || "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
  if (hex.length === 3) return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toLowerCase();
  if (hex.length === 4) return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toLowerCase();
  if (hex.length === 6) return `#${hex}`.toLowerCase();
  if (hex.length === 8) return `#${hex.slice(0, 6)}`.toLowerCase();
  return null;
}

function parseCssNumberOrPercent(s) {
  const t = String(s).trim();
  if (t.endsWith("%")) {
    const n = Number(t.slice(0, -1));
    if (!Number.isFinite(n)) return null;
    return (n / 100) * 255;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function normalizeColor(value) {
  // Convert common CSS formats into Graphviz-friendly hex where possible.
  const raw = String(value ?? "").trim();
  if (!raw) return raw;

  if (raw.startsWith("#")) return expandHexColor(raw) ?? raw;

  const rgbMatch = raw.match(/^rgba?\(\s*([^)]+)\s*\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(",").map((p) => p.trim());
    const r = parseCssNumberOrPercent(parts[0]);
    const g = parseCssNumberOrPercent(parts[1]);
    const b = parseCssNumberOrPercent(parts[2]);
    if (r == null || g == null || b == null) return raw;
    return `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`;
  }

  // Keep named colours and other formats as-is.
  return raw;
}

function parseBorderRaw(borderText) {
  // Like parseBorder(), but keeps the raw colour token(s) without normalization
  // so we can round-trip UI values as rgb(...) rather than hex.
  const parts = String(borderText || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return {};

  const widthPart = parts[0];
  const stylePart = parts[1];
  const colorPart = parts.slice(2).join(" ");

  const widthMatch = widthPart.match(/^(\d+)(px)?$/i);
  const penwidth = widthMatch ? Number(widthMatch[1]) : null;

  const style = ["solid", "dotted", "dashed", "bold"].includes(stylePart.toLowerCase())
    ? stylePart.toLowerCase()
    : null;

  const out = {};
  if (penwidth != null) out.penwidth = penwidth;
  if (style) out.style = style;
  if (colorPart) out.colorRaw = colorPart.trim();
  return out;
}

function hexToRgb(hex) {
  const h = String(hex || "").trim();
  const ex = expandHexColor(h);
  if (!ex || !/^#[0-9a-f]{6}$/i.test(ex)) return null;
  const r = parseInt(ex.slice(1, 3), 16);
  const g = parseInt(ex.slice(3, 5), 16);
  const b = parseInt(ex.slice(5, 7), 16);
  return { r, g, b };
}

function rgbToHex({ r, g, b }) {
  return `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`;
}

function cssColorToRgb(value) {
  // Fast path: parse rgb()/rgba() or #hex only.
  const raw = String(value || "").trim();
  if (!raw) return null;

  // rgb()/rgba()
  const rgbMatch = raw.match(/^rgba?\(\s*([^)]+)\s*\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(",").map((p) => p.trim());
    const r = parseCssNumberOrPercent(parts[0]);
    const g = parseCssNumberOrPercent(parts[1]);
    const b = parseCssNumberOrPercent(parts[2]);
    if (r == null || g == null || b == null) return null;
    return { r: clampByte(r), g: clampByte(g), b: clampByte(b) };
  }

  // hex
  if (raw.startsWith("#")) return hexToRgb(raw);

  // Named colours/hsl(): handled by resolveCssColorToRgb()
  return null;
}

let _tmColorProbeEl = null;
function resolveCssColorToRgb(value) {
  // Convert any CSS color string the browser understands into {r,g,b}, for use with <input type="color">.
  const raw = String(value || "").trim();
  if (!raw) return null;

  const direct = cssColorToRgb(raw);
  if (direct) return direct;

  // Browser resolve (handles named colours, hsl(), etc.)
  try {
    if (!_tmColorProbeEl) {
      const el = document.createElement("span");
      el.style.position = "absolute";
      el.style.left = "-99999px";
      el.style.top = "0";
      el.style.visibility = "hidden";
      document.body.appendChild(el);
      _tmColorProbeEl = el;
    }
    // IMPORTANT: if raw is invalid, browsers keep style.color == "" and computed style stays at the default.
    // We must treat invalid tokens as invalid (otherwise lots of normal words would "resolve" to black).
    _tmColorProbeEl.style.color = "";
    _tmColorProbeEl.style.color = raw;
    if (_tmColorProbeEl.style.color === "") return null;
    const computed = getComputedStyle(_tmColorProbeEl).color; // "rgb(r, g, b)" or "rgba(...)"
    return cssColorToRgb(computed);
  } catch {
    return null;
  }
}

function borderTextToUi(borderText) {
  const raw = String(borderText || "").trim();
  if (!raw) return { width: 0, style: "solid", colorHex: "#999999" };

  const b = parseBorderRaw(raw);
  const width = Number.isFinite(b.penwidth) ? b.penwidth : 1;
  const style = b.style || "solid";

  const rgb = resolveCssColorToRgb(b.colorRaw || "");
  const colorHex = rgb ? rgbToHex(rgb) : "#999999";

  return { width, style, colorHex };
}

function uiToBorderText({ width, style, colorHex }) {
  const w = Number(width);
  if (!Number.isFinite(w) || w <= 0) return "";
  const s = String(style || "solid").trim() || "solid";
  const rgb = hexToRgb(colorHex || "#999999") || { r: 153, g: 153, b: 153 };
  // Store rgb(...) in the DSL, but Graphviz will still get hex via normalizeColor() later.
  return `${Math.round(w)}px ${s} rgb(${rgb.r},${rgb.g},${rgb.b})`;
}

function getDefaultEdgeBorderText() {
  // Use diagram defaults if provided; fall back to a sane app default.
  const w = Number(lastVizSettings?.defaultLinkWidth);
  const width = Number.isFinite(w) && w > 0 ? Math.round(w) : 1;

  const s = String(lastVizSettings?.defaultLinkStyle || "").trim().toLowerCase();
  const style = ["solid", "dotted", "dashed", "bold"].includes(s) ? s : "solid";

  const c = String(lastVizSettings?.defaultLinkColour || "").trim();
  const colour = c || "rgb(108,117,125)"; // bootstrap-ish secondary

  return `${width}px ${style} ${colour}`;
}

function getDefaultNodeUi() {
  // Defaults for node widgets when node has no explicit attrs.
  const fillRgb = resolveCssColorToRgb(String(lastVizSettings?.defaultBoxColour || "").trim());
  const fillHex = fillRgb ? rgbToHex(fillRgb) : "#ffffff";

  const borderText = String(lastVizSettings?.defaultBoxBorder || "").trim();
  const borderUi = borderText ? borderTextToUi(borderText) : { width: 0, style: "solid", colorHex: "#999999" };

  const rounded = String(lastVizSettings?.defaultBoxShape || "").trim().toLowerCase() === "rounded";

  return { fillHex, borderUi, rounded, hasFillDefault: Boolean(lastVizSettings?.defaultBoxColour), hasBorderDefault: Boolean(borderText) };
}

function styleInnerToNodeUi(styleInner) {
  const inner = String(styleInner || "").trim();
  if (!inner) return null;
  const { kv } = parseBracketAttrs(`[${inner}]`);

  const fillRaw = kv.colour || kv.color || kv.background || "";
  const fillRgb = resolveCssColorToRgb(fillRaw);
  const fillHex = fillRgb ? rgbToHex(fillRgb) : null;

  const borderRaw = kv.border ? String(kv.border) : "";
  const borderUi = borderRaw ? borderTextToUi(borderRaw) : null;

  const rounded = String(kv.shape || "").trim().toLowerCase() === "rounded";

  const textScaleRaw = kv["text size"] || kv.textsize || kv["text scale"] || kv.textscale || "";
  const textSizeScale = parseRelativeScale(textScaleRaw);

  return { fillHex, borderUi, rounded, textSizeScale: Number.isFinite(textSizeScale) ? textSizeScale : null };
}

function styleInnerToClusterUi(styleInner) {
  // Cluster (group box) attrs mirror node attrs, plus optional title text styling.
  const inner = String(styleInner || "").trim();
  if (!inner) return null;
  const { kv } = parseBracketAttrs(`[${inner}]`);

  const fillRaw = kv.colour || kv.color || kv.background || "";
  const fillRgb = resolveCssColorToRgb(fillRaw);
  const fillHex = fillRgb ? rgbToHex(fillRgb) : null;

  const borderRaw = kv.border ? String(kv.border) : "";
  const borderUi = borderRaw ? borderTextToUi(borderRaw) : null;

  const textColourRaw = kv["text colour"] || kv["text color"] || kv.textcolour || kv.textcolor || "";
  const textRgb = resolveCssColorToRgb(textColourRaw);
  const textColourHex = textRgb ? rgbToHex(textRgb) : null;

  const textScaleRaw = kv["text size"] || kv.textsize || kv["text scale"] || kv.textscale || "";
  const textSizeScale = parseRelativeScale(textScaleRaw);

  return {
    fillHex,
    borderUi,
    textColourHex,
    textSizeScale: Number.isFinite(textSizeScale) ? textSizeScale : null,
  };
}

function upsertNodeStyleInner(existingInner, { fillHex, borderText, rounded, textSizeScale }) {
  // Update/replace only the keys we manage; preserve any other attrs/loose tokens.
  const parts = String(existingInner || "")
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);

  const kept = [];
  let sawColour = false;
  let sawBackground = false;
  let sawBorder = false;
  let sawShape = false;
  let sawTextSize = false;

  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) {
      kept.push(p);
      continue;
    }
    const k = p.slice(0, eq).trim().toLowerCase();
    if (k === "colour" || k === "color") {
      if (!sawColour) {
        sawColour = true;
        // handled later
      }
      continue;
    }
    if (k === "background") {
      if (!sawBackground) {
        sawBackground = true;
        // handled later
      }
      continue;
    }
    if (k === "border") {
      sawBorder = true;
      continue;
    }
    if (k === "shape") {
      sawShape = true;
      continue;
    }
    if (k === "text size" || k === "textscale" || k === "text scale") {
      sawTextSize = true;
      continue;
    }
    kept.push(p);
  }

  const out = [];
  if (fillHex) {
    const rgb = hexToRgb(fillHex);
    if (rgb) out.push(`colour=rgb(${rgb.r},${rgb.g},${rgb.b})`);
  }
  if (borderText) out.push(`border=${borderText}`);
  if (rounded) out.push("shape=rounded");
  if (Number.isFinite(Number(textSizeScale)) && Number(textSizeScale) > 0) {
    const s = Math.round(Number(textSizeScale) * 100) / 100;
    if (s !== 1) out.push(`text size=${String(s)}`);
  }

  // Preserve other attrs after ours
  out.push(...kept);
  return out.join(" | ");
}

function upsertClusterStyleInner(existingInner, { fillHex, borderText, textColourHex, textSizeScale }) {
  // Update/replace only the keys we manage; preserve any other attrs/loose tokens.
  const parts = String(existingInner || "")
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);

  const kept = [];
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) {
      kept.push(p);
      continue;
    }
    const k = p.slice(0, eq).trim().toLowerCase();
    if (k === "colour" || k === "color" || k === "background") continue;
    if (k === "border") continue;
    if (k === "text colour" || k === "text color" || k === "textcolour" || k === "textcolor") continue;
    if (k === "text size" || k === "textscale" || k === "text scale") continue;
    kept.push(p);
  }

  const out = [];

  if (fillHex) {
    const rgb = hexToRgb(fillHex);
    if (rgb) out.push(`colour=rgb(${rgb.r},${rgb.g},${rgb.b})`);
  }

  if (borderText) out.push(`border=${borderText}`);

  if (textColourHex) {
    const rgb = hexToRgb(textColourHex);
    if (rgb) out.push(`text colour=rgb(${rgb.r},${rgb.g},${rgb.b})`);
  }

  if (Number.isFinite(Number(textSizeScale)) && Number(textSizeScale) > 0) {
    const s = Math.round(Number(textSizeScale) * 100) / 100;
    if (s !== 1) out.push(`text size=${String(s)}`);
  }

  out.push(...kept);
  return out.join(" | ");
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
    // NOTE: don't escape backslashes here; Graphviz uses sequences like "\n" inside quoted labels.
    .map(([k, v]) => `${k}="${String(v).replaceAll('"', '\\"')}"`);
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

function normalizeTitlePosition(value) {
  // MapScript values accepted (case-insensitive):
  // - top left|centre|center|right
  // - bottom left|centre|center|right
  // - also accept hyphen/underscore forms (e.g. "bottom-left")
  // - single word shortcuts: left|centre|center|right map to bottom-*
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;

  const compact = raw.replace(/[\s_-]+/g, "");
  const mapCompact = new Map([
    ["topleft", "top-left"],
    ["topcenter", "top-centre"],
    ["topcentre", "top-centre"],
    ["topright", "top-right"],
    ["bottomleft", "bottom-left"],
    ["bottomcenter", "bottom-centre"],
    ["bottomcentre", "bottom-centre"],
    ["bottomright", "bottom-right"],
    ["left", "bottom-left"],
    ["center", "bottom-centre"],
    ["centre", "bottom-centre"],
    ["right", "bottom-right"],
    ["top", "top-centre"],
    ["bottom", "bottom-centre"],
  ]);
  const hit = mapCompact.get(compact);
  return hit || null;
}

function titlePositionToGraphvizAttrs(titlePosition) {
  // Default: bottom-left (preferred)
  const p = normalizeTitlePosition(titlePosition) || "bottom-left";
  const loc = p.startsWith("top") ? "t" : "b";
  const just = p.endsWith("left") ? "l" : p.endsWith("right") ? "r" : "c";
  return { labelloc: loc, labeljust: just };
}

function parseLeadingNumber(value) {
  const m = String(value || "").trim().match(/^-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function parseRelativeScale(value) {
  // Parse a "relative size" multiplier like:
  // - "1.2" (20% bigger)
  // - "80%" (20% smaller)
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.endsWith("%")) {
    const n = Number(raw.slice(0, -1));
    if (!Number.isFinite(n) || n <= 0) return null;
    return n / 100;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function fontNameWithStyle(baseFont, styleText) {
  // Minimal mapping: Graphviz doesn't have separate "font-weight"/"font-style" attrs,
  // so we use fontname variants when possible.
  const base = String(baseFont || "").trim() || "Arial";
  const raw = String(styleText || "").trim().toLowerCase();
  if (!raw || raw === "normal" || raw === "plain") return base;
  const wantsBold = raw.includes("bold");
  const wantsItalic = raw.includes("italic");
  if (wantsBold && wantsItalic) return `${base} Bold Italic`;
  if (wantsBold) return `${base} Bold`;
  if (wantsItalic) return `${base} Italic`;
  return base;
}

function dslToDot(dslText) {
  const errors = [];
  const BASE_NODE_FONT_SIZE = 14; // Graphviz-ish default; used only when user sets a relative node text size
  const BASE_CLUSTER_FONT_SIZE = 14; // used only when user sets a relative cluster title text size
  const settings = {
    title: null,
    background: null,
    textColour: null,
    defaultNodeTextColour: null,
    defaultBoxTextColour: null,
    titlePosition: null,
    defaultBoxColour: null,
    defaultBoxShape: null,
    defaultBoxBorder: null,
    // Default node shadow (used for rendered SVG via CSS filter drop-shadow()).
    defaultBoxShadow: "medium",
    defaultLinkColour: null,
    defaultLinkStyle: null,
    defaultLinkWidth: null,
    direction: null,
    labelWrap: null,
    spacingAlong: null,
    spacingAcross: null,
  };

  const nodes = new Map(); // id -> { label, attrs }
  const autoLabelNodes = new Map(); // id -> label (from edges)
  const edges = []; // { fromId, toId, attrs, srcLineNo }
  const clusters = []; // { id, label, depth, styleInner, srcLineNo, nodeIds: [], children: [] }
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
    // - default node colour -> fillcolor + filled
    // - default node border -> color/style/penwidth
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

    // Grouping box line:
    // - "--Label" opens a level-1 cluster
    // - "----Label" opens a level-2 cluster (nested)
    // - "----" closes the current level-2 cluster (if any)
    // - "--" closes the current level-1 cluster (and anything nested)
    //
    // Rule: the number of leading '-' determines nesting depth (2 = level 1, 4 = level 2, etc).
    const clusterMatch = line.match(/^(-{2,})(.*)$/);
    if (clusterMatch) {
      const dashes = clusterMatch[1];
      let rest = (clusterMatch[2] || "").trim();
      const depth = dashes.length;

      if (depth % 2 !== 0) {
        errors.push(`Line ${i + 1}: grouping box marker must use an even number of '-' (e.g. -- or ----)`);
        continue;
      }

      // Optional cluster attrs: "--Label [colour=... | border=... | text colour=... | text size=...]"
      let bracket = null;
      const bracketStart = rest.lastIndexOf("[");
      if (bracketStart >= 0 && rest.endsWith("]")) {
        bracket = rest.slice(bracketStart);
        rest = rest.slice(0, bracketStart).trim();
      }

      // Empty marker ("--" / "----") is ambiguous: it can either CLOSE an existing box at that depth,
      // or OPEN an untitled box if there is nothing to close at that depth yet.
      //
      // Rule used here (and mirrored in the UI cluster scanner):
      // - If there's an open cluster at depth >= this depth, treat as a CLOSE.
      // - Otherwise, treat as an OPEN with an empty label.
      if (!rest && !bracket && clusterStack.length && clusterStack[clusterStack.length - 1].depth >= depth) {
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
        styleInner: bracket ? bracket.slice(1, -1).trim() : "",
        srcLineNo: i + 1,
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
      else if (key === "background") settings.background = normalizeColor(value);
      else if (key === "text colour" || key === "text color") settings.textColour = normalizeColor(value);
      else if (key === "default node text colour" || key === "default node text color") settings.defaultNodeTextColour = normalizeColor(value);
      else if (key === "default group text colour" || key === "default group text color") settings.defaultBoxTextColour = normalizeColor(value);
      else if (key === "title size") settings.titleSize = parseLeadingNumber(value);
      else if (key === "title position") settings.titlePosition = normalizeTitlePosition(value);
      else if (key === "default node colour" || key === "default node color") settings.defaultBoxColour = normalizeColor(value);
      else if (key === "default node shape") settings.defaultBoxShape = value.trim().toLowerCase();
      else if (key === "default node border") settings.defaultBoxBorder = value;
      else if (key === "default link colour" || key === "default link color") settings.defaultLinkColour = normalizeColor(value);
      else if (key === "default link style") settings.defaultLinkStyle = value.trim().toLowerCase();
      else if (key === "default link width") settings.defaultLinkWidth = parseLeadingNumber(value);
      else if (key === "default node shadow") settings.defaultBoxShadow = value;
      else if (key === "direction") settings.direction = normalizeDirection(value);
      else if (key === "label wrap") settings.labelWrap = parseLeadingNumber(value);
      else if (key === "spacing along") settings.spacingAlong = parseLeadingNumber(value);
      else if (key === "spacing across") settings.spacingAcross = parseLeadingNumber(value);
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
          attrs.fillcolor = normalizeColor(kv.colour || kv.color);
          addStyle(attrs, "filled");
        }
        if (kv.background) {
          attrs.fillcolor = normalizeColor(kv.background);
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

        // Relative node text sizing (multiplier vs default)
        // Example: A:: Label [text size=1.2] or [text size=80%]
        const textSizeScale = parseRelativeScale(kv["text size"] || kv.textsize || kv["text scale"] || kv.textscale);
        if (Number.isFinite(textSizeScale) && textSizeScale > 0) {
          attrs.fontsize = (BASE_NODE_FONT_SIZE * textSizeScale).toFixed(1);
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
        const { kv, loose } = parseBracketAttrs(bracket);
        // Flexible edge parsing:
        // - label: either "label=..." or first loose part
        // - border: either "border=..." or second loose part
        //
        // New (key/value only, to avoid ambiguity):
        // - label style: "label style=italic|bold|bold italic|normal"
        // - label size: "label size=10" (Graphviz points-ish)

        const labelFromKv = kv.label ? String(kv.label) : "";
        const borderFromKv = kv.border ? String(kv.border) : "";
        const labelStyleFromKv = kv["label style"] || kv.labelstyle || "";
        const labelSizeFromKv = kv["label size"] || kv.labelsize || "";

        // Label/border (prefer explicit keys)
        if (labelFromKv) edgeAttrs.label = labelFromKv;

        // Border from explicit key: allow full or partial, just like loose tokens.
        if (borderFromKv) {
          const b = parseEdgeBorderLoosePart(borderFromKv);
          if (b.color) edgeAttrs.color = b.color;
          if (b.penwidth) edgeAttrs.penwidth = b.penwidth;
          if (b.style) addStyle(edgeAttrs, b.style);
        }

        // Loose tokens (split by "|") are now more flexible:
        // - first token is a label ONLY if it doesn't look like a style token (colour/width/style)
        // - any remaining tokens are treated as style fragments (can be partial: colour-only, width-only, etc)
        const looseTokens = Array.isArray(loose) ? loose.map((x) => String(x || "").trim()).filter(Boolean) : [];
        if (!labelFromKv && looseTokens.length) {
          if (!looksLikeEdgeStyleToken(looseTokens[0])) {
            edgeAttrs.label = looseTokens[0];
            looseTokens.shift();
          }
        }
        if (!borderFromKv && looseTokens.length) {
          for (const tok of looseTokens) {
            const b = parseEdgeBorderLoosePart(tok);
            if (b.color) edgeAttrs.color = b.color;
            if (b.penwidth) edgeAttrs.penwidth = b.penwidth;
            if (b.style) addStyle(edgeAttrs, b.style);
          }
        }

        // Link label styling
        if (labelStyleFromKv) edgeAttrs.fontname = fontNameWithStyle("Arial", labelStyleFromKv);
        const sz = parseLeadingNumber(labelSizeFromKv);
        if (Number.isFinite(sz) && sz > 0) edgeAttrs.fontsize = sz;

      }

      for (const s of sources) {
        const fromId = ensureNode(s);
        if (!fromId) continue;
        for (const t of targets) {
          const toId = ensureNode(t);
          if (!toId) continue;
          // IMPORTANT: clone attrs so per-edge ids or later changes don't mutate other edges from the same line.
          edges.push({ fromId, toId, attrs: { ...edgeAttrs }, srcLineNo: i + 1 });
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
  const nodeDefaults = { fontname: "Arial", shape: "box" };
  if (settings.defaultNodeTextColour) nodeDefaults.fontcolor = settings.defaultNodeTextColour;
  dot.push(`  node${toDotAttrs(nodeDefaults)};`);
  // Edge defaults (links)
  const edgeDefaults = { fontname: "Arial", fontsize: 12 };
  if (settings.defaultLinkColour) edgeDefaults.color = settings.defaultLinkColour;
  if (settings.textColour) edgeDefaults.fontcolor = settings.textColour;
  if (settings.defaultLinkStyle) {
    const s = String(settings.defaultLinkStyle || "").trim().toLowerCase();
    if (["solid", "dotted", "dashed", "bold"].includes(s)) addStyle(edgeDefaults, s);
  }
  if (Number.isFinite(settings.defaultLinkWidth) && settings.defaultLinkWidth > 0) edgeDefaults.penwidth = Math.round(settings.defaultLinkWidth);
  dot.push(`  edge${toDotAttrs(edgeDefaults)};`);

  if (settings.background) dot.push(`  bgcolor="${settings.background.replaceAll('"', '\\"')}";`);
  if (settings.textColour) dot.push(`  fontcolor="${settings.textColour.replaceAll('"', '\\"')}";`);
  if (settings.title) {
    // Title (graph label): slightly larger by default, with a bit of extra space below.
    // Graphviz doesn't have a simple "margin-bottom for title", so we add a trailing newline.
    const fsRaw = Number(settings.titleSize);
    const fs = Number.isFinite(fsRaw) && fsRaw > 0 ? fsRaw : 18;
    const tp = titlePositionToGraphvizAttrs(settings.titlePosition);
    dot.push(
      `  label="${settings.title.replaceAll('"', '\\"')}\\n"; labelloc="${tp.labelloc}"; labeljust="${tp.labeljust}"; fontsize="${String(fs)}";`
    );
  }
  if (settings.direction) dot.push(`  rankdir="${settings.direction}";`);
  // Graphviz ranksep/nodesep are in inches; MapScript values are treated as "px-ish", so scale down.
  if (Number.isFinite(settings.spacingAlong)) dot.push(`  ranksep="${settings.spacingAlong * 0.1}";`);
  if (Number.isFinite(settings.spacingAcross)) dot.push(`  nodesep="${settings.spacingAcross * 0.1}";`);

  // Emit clusters (nested)
  const clustered = new Set();
  function emitCluster(c, indent) {
    // Emit even if empty (so nested structure remains visible)
    dot.push(`${indent}subgraph ${c.id} {`);

    // Cluster styling:
    // - Default: rounded + light grey border (existing behavior)
    // - Optional: allow cluster lines to override fill/border and title text styling
    const clusterAttrs = {};
    // If the label is empty, omit it entirely so Graphviz doesn't reserve label space.
    clusterAttrs.label = String(c.label || "").trim() ? c.label : null;
    addStyle(clusterAttrs, "rounded");
    if (!clusterAttrs.color) clusterAttrs.color = "#cccccc";
    if (settings.defaultBoxTextColour) clusterAttrs.fontcolor = settings.defaultBoxTextColour;

    if (c.styleInner) {
      const { kv } = parseBracketAttrs(`[${c.styleInner}]`);

      // Fill (accept colour/color/background)
      if (kv.colour || kv.color || kv.background) {
        clusterAttrs.fillcolor = normalizeColor(kv.colour || kv.color || kv.background);
        addStyle(clusterAttrs, "filled");
      }

      // Border
      if (kv.border) {
        const b = parseBorder(String(kv.border));
        if (b.color) clusterAttrs.color = b.color;
        if (b.penwidth) clusterAttrs.penwidth = b.penwidth;
        if (b.style) addStyle(clusterAttrs, b.style);
      }

      // Cluster title text colour
      if (kv["text colour"] || kv["text color"] || kv.textcolour || kv.textcolor) {
        clusterAttrs.fontcolor = normalizeColor(kv["text colour"] || kv["text color"] || kv.textcolour || kv.textcolor);
      }

      // Cluster title text sizing (multiplier)
      const textSizeScale = parseRelativeScale(kv["text size"] || kv.textsize || kv["text scale"] || kv.textscale);
      if (Number.isFinite(textSizeScale) && textSizeScale > 0) {
        clusterAttrs.fontsize = (BASE_CLUSTER_FONT_SIZE * textSizeScale).toFixed(1);
      }
    }

    // Emit cluster attrs (stable order)
    if (clusterAttrs.label != null) dot.push(`${indent}  label="${String(clusterAttrs.label).replaceAll('"', '\\"')}";`);
    if (clusterAttrs.style) dot.push(`${indent}  style="${String(clusterAttrs.style).replaceAll('"', '\\"')}";`);
    if (clusterAttrs.color) dot.push(`${indent}  color="${String(clusterAttrs.color).replaceAll('"', '\\"')}";`);
    if (clusterAttrs.penwidth) dot.push(`${indent}  penwidth="${String(clusterAttrs.penwidth).replaceAll('"', '\\"')}";`);
    if (clusterAttrs.fillcolor) dot.push(`${indent}  fillcolor="${String(clusterAttrs.fillcolor).replaceAll('"', '\\"')}";`);
    if (clusterAttrs.fontcolor) dot.push(`${indent}  fontcolor="${String(clusterAttrs.fontcolor).replaceAll('"', '\\"')}";`);
    if (clusterAttrs.fontsize) dot.push(`${indent}  fontsize="${String(clusterAttrs.fontsize).replaceAll('"', '\\"')}";`);

    for (const id of c.nodeIds) {
      clustered.add(id);
      const n = nodes.get(id);
      const attrs = { ...n.attrs };
      applyDefaults(attrs); // ensure defaults apply even if node was created implicitly via edges
      attrs.label = wrapLabelToDot(n.label, settings.labelWrap);
      attrs.id = makeNodeDomId(id);
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
    const attrs = { ...n.attrs };
    applyDefaults(attrs); // ensure defaults apply even if node was created implicitly via edges
    attrs.label = wrapLabelToDot(n.label, settings.labelWrap);
    attrs.id = makeNodeDomId(id);
    dot.push(`  "${id}"${toDotAttrs(attrs)};`);
  }

  // Emit edges
  for (const e of edges) {
    const attrs = { ...e.attrs, id: makeEdgeDomId(e) };
    dot.push(`  "${e.fromId}" -> "${e.toId}"${toDotAttrs(attrs)};`);
  }

  dot.push("}");

  return { dot: dot.join("\n"), errors, settings };
}

// -----------------------------
// Viz interactivity (click nodes/edges → edit modal)
// -----------------------------

function stripCommentKeepSuffix(rawLine) {
  const idx = rawLine.indexOf("#");
  if (idx < 0) return { code: rawLine, comment: "" };
  return { code: rawLine.slice(0, idx), comment: rawLine.slice(idx) };
}

function parseTrailingBracket(codePart) {
  // Mirrors the relaxed parsing used elsewhere: take the last "[" if line ends with "]".
  const c = String(codePart || "");
  const bracketStart = c.lastIndexOf("[");
  if (bracketStart >= 0 && c.trimEnd().endsWith("]")) {
    const before = c.slice(0, bracketStart).trimEnd();
    const bracket = c.slice(bracketStart).trim();
    const inner = bracket.startsWith("[") && bracket.endsWith("]") ? bracket.slice(1, -1).trim() : bracket.trim();
    return { before, inner };
  }
  return { before: c.trimEnd(), inner: "" };
}

function findNodeDefLineIndex(lines, nodeId) {
  const re = new RegExp(`^\\s*${nodeId.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*::\\s*`, "i");
  for (let i = 0; i < lines.length; i++) {
    const { code } = stripCommentKeepSuffix(lines[i]);
    if (re.test(code)) return i;
  }
  return -1;
}

function getExplicitNodeIdsFromLines(lines) {
  const ids = new Set();
  for (const raw of lines) {
    const { code } = stripCommentKeepSuffix(raw);
    const m = code.trim().match(/^(\S+)\s*::\s*(.+)$/);
    if (!m) continue;
    ids.add(m[1].trim());
  }
  return ids;
}

function makeUniqueNodeIdFromLabel(label, existingIds) {
  const base = `N_${slugId(label || "node")}`.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40);
  let id = base.match(/^[A-Za-z]\w*$/) ? base : `N_${base}`.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40);
  if (!id.match(/^[A-Za-z]\w*$/)) id = "N_node";

  if (!existingIds?.has?.(id)) return id;
  for (let i = 2; i < 9999; i++) {
    const next = `${id}_${i}`;
    if (!existingIds.has(next)) return next;
  }
  return `${id}_${Date.now()}`;
}

function parseNodeDefLine(lines, nodeId) {
  const idx = findNodeDefLineIndex(lines, nodeId);
  if (idx < 0) return null;
  const raw = lines[idx];
  const { code, comment } = stripCommentKeepSuffix(raw);
  const after = code.split("::").slice(1).join("::"); // allow "::" inside label (rare)
  const { before: labelPart, inner: styleInner } = parseTrailingBracket(after);
  return {
    idx,
    comment,
    label: labelPart.trim(),
    styleInner,
  };
}

function parseClusterDefLineAt(lines, idx) {
  const raw = lines[idx] || "";
  const { code, comment } = stripCommentKeepSuffix(raw);
  const trimmed = code.trim();
  const m = trimmed.match(/^(-{2,})(.*)$/);
  if (!m) return null;
  const dashes = m[1];
  if (dashes.length % 2 !== 0) return null;
  const rest = String(m[2] || "").trim();
  // NOTE: This parser is *syntactic* only; opener/closer disambiguation is handled by
  // scanClusterOpenersFromLines() so untitled groups ("--") can be valid.
  const { before: labelPart, inner: styleInner } = parseTrailingBracket(rest);
  return {
    idx,
    comment,
    dashes,
    label: String(labelPart || "").trim(),
    styleInner: String(styleInner || "").trim(),
  };
}

function scanClusterOpenersFromLines(lines) {
  // Purpose: mirror the cluster open/close rules from dslToDot(), but keep editor line indices.
  // Returns openers in the exact order they will be assigned cluster ids (cluster_0, cluster_1, ...).
  const openers = [];
  const stack = []; // { depth }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] || "";
    const { code, comment } = stripCommentKeepSuffix(raw);
    const trimmed = String(code || "").trim();
    if (!trimmed) continue;

    const m = trimmed.match(/^(-{2,})(.*)$/);
    if (!m) continue;
    const dashes = m[1];
    const depth = dashes.length;
    if (depth % 2 !== 0) continue;

    const rest = String(m[2] || "").trim();
    const { before: labelPart, inner: styleInnerRaw } = parseTrailingBracket(rest);
    const label = String(labelPart || "").trim();
    const styleInner = String(styleInnerRaw || "").trim();
    const hasOpenerContent = Boolean(label || styleInner);

    const hasOpenAtOrDeeper = stack.length && stack[stack.length - 1].depth >= depth;
    const isClose = !hasOpenerContent && hasOpenAtOrDeeper;

    if (isClose) {
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      continue;
    }

    // Opener: align to parent depth (depth-2), matching dslToDot().
    const parentDepth = depth - 2;
    while (stack.length && stack[stack.length - 1].depth > parentDepth) stack.pop();

    openers.push({ idx: i, comment, dashes, label, styleInner, depth });
    stack.push({ depth });
  }

  return openers;
}

function setClusterDefLineAt(lines, idx, { dashes, label, styleInner, comment }) {
  const c = String(comment || "").trim();
  const commentSuffix = c ? ` ${c}` : "";
  const inner = String(styleInner || "").trim();
  const styleSuffix = inner ? ` [${inner}]` : "";
  lines[idx] = `${String(dashes || "").trim()}${String(label || "").trim()}${styleSuffix}${commentSuffix}`.trimEnd();
  return true;
}

function setNodeDefLine(lines, nodeId, { label, styleInner }) {
  const parsed = parseNodeDefLine(lines, nodeId);
  if (!parsed) return false;
  const comment = parsed.comment ? ` ${parsed.comment.trim()}` : "";
  const style = String(styleInner || "").trim() ? ` [${String(styleInner).trim()}]` : "";
  lines[parsed.idx] = `${nodeId}:: ${String(label || "").trim()}${style}${comment}`.trimEnd();
  return true;
}

function parseEdgeLine(lines, lineNo1) {
  const idx = Number(lineNo1) - 1;
  if (!Number.isFinite(idx) || idx < 0 || idx >= lines.length) return null;
  const raw = lines[idx];
  const { code, comment } = stripCommentKeepSuffix(raw);
  const { before, inner } = parseTrailingBracket(code);
  const { kv, loose } = parseBracketAttrs(inner ? `[${inner}]` : "[]");

  // Match the same “single part might actually be border” heuristic used by dslToDot()
  // so the UI loads existing edge styling correctly.
  let label = kv.label ? String(kv.label) : (loose[0] ? String(loose[0]) : "");
  let border = kv.border ? String(kv.border) : (loose[1] ? String(loose[1]) : "");
  if (loose.length === 1 && /\b(solid|dotted|dashed)\b/i.test(label) && /\d+\s*px/i.test(label)) {
    border = label;
    label = "";
  }

  // Preserve any extra edge attrs inside [...] so saving via modal doesn't wipe them.
  const keptKv = { ...kv };
  delete keptKv.label;
  delete keptKv.border;
  const keptLoose = loose.slice(0);
  // If label/border came from loose positions, drop them from keptLoose (we will re-add from current widget values).
  if (!kv.label && keptLoose.length) keptLoose.shift();
  if (!kv.border && keptLoose.length) keptLoose.shift();

  return {
    idx,
    comment,
    label,
    border,
    keptKv,
    keptLoose,
    hasBracket: Boolean(inner && inner.trim()),
    before, // code before trailing bracket
  };
}

function buildEdgeBracketInner({ label, border, keptKv, keptLoose }) {
  // Keep it simple and stable:
  // - First: label (loose)
  // - Second: border (loose)
  // - Then: any remaining loose parts
  // - Then: any remaining key=value parts (sorted by key for determinism)
  const parts = [];
  const l = String(label || "").trim();
  const b = String(border || "").trim();
  if (l) parts.push(l);
  if (b) parts.push(b);

  for (const x of (keptLoose || [])) {
    const t = String(x || "").trim();
    if (t) parts.push(t);
  }

  const kv = keptKv && typeof keptKv === "object" ? keptKv : {};
  const keys = Object.keys(kv).sort((a, b2) => String(a).localeCompare(String(b2)));
  for (const k of keys) {
    const v = String(kv[k] ?? "").trim();
    const kk = String(k || "").trim();
    if (!kk || !v) continue;
    parts.push(`${kk}=${v}`);
  }

  return parts.join(" | ");
}

function parseEdgeEndpoints(before) {
  const m = String(before || "").trim().match(/^(.+?)\s*->\s*(.+)$/);
  if (!m) return null;
  const left = m[1].trim();
  const right = m[2].trim();
  return {
    sources: left.split("|").map((t) => t.trim()).filter(Boolean),
    targets: right.split("|").map((t) => t.trim()).filter(Boolean),
  };
}

function isSimpleIdToken(token) {
  return /^[A-Za-z]\w*$/.test(String(token || "").trim());
}

function nodeIdToDslToken(nodeId, nodesById) {
  const id = String(nodeId || "").trim();
  if (!id) return "";
  const n = nodesById?.get?.(id) || null;
  // For explicit/simple IDs use the ID token; for implicit (slugged) nodes use their label token.
  if (isSimpleIdToken(id)) return id;
  const label = n?.label ? String(n.label).trim() : "";
  return label || id;
}

function setEdgeLine(lines, lineNo1, { fromId, toId, label, border, nodesById }) {
  const parsed = parseEdgeLine(lines, lineNo1);
  if (!parsed) return false;

  // Default: preserve the original "A | B -> C | D" formatting unless endpoints are changed.
  let before = parsed.before.trimEnd();
  if (fromId || toId) {
    // Update endpoints by replacing matching tokens (either exact match or slugId match).
    const ep = parseEdgeEndpoints(parsed.before);
    if (!ep) return false;

    const findIdx = (arr, id) => arr.findIndex((tok) => tok === id || slugId(tok) === id);

    if (fromId) {
      const i = findIdx(ep.sources, fromId.old);
      if (i >= 0) ep.sources[i] = nodeIdToDslToken(fromId.next, nodesById);
      else return false;
    }
    if (toId) {
      const i = findIdx(ep.targets, toId.old);
      if (i >= 0) ep.targets[i] = nodeIdToDslToken(toId.next, nodesById);
      else return false;
    }

    before = `${ep.sources.join(" | ")} -> ${ep.targets.join(" | ")}`;
  }

  const l = String(label || "").trim();
  const b = String(border || "").trim();
  const inner = buildEdgeBracketInner({
    label: l,
    border: b,
    keptKv: parsed.keptKv,
    keptLoose: parsed.keptLoose,
  });
  const bracket = inner ? ` [${inner}]` : "";

  const comment = parsed.comment ? ` ${parsed.comment.trim()}` : "";
  lines[parsed.idx] = `${before}${bracket}${comment}`.trimEnd();
  return true;
}

function deleteEdgeLine(lines, lineNo1) {
  const idx = Number(lineNo1) - 1;
  if (!Number.isFinite(idx) || idx < 0 || idx >= lines.length) return false;
  lines.splice(idx, 1);
  return true;
}

function deleteNodeEverywhere(lines, nodeId) {
  // Minimal: remove the explicit node definition, and remove any edge lines that mention this ID.
  // This intentionally only targets explicit IDs (simple tokens), not free-label implicit nodes.
  const out = [];
  const id = String(nodeId || "").trim();
  if (!id) return lines;

  const nodeRe = new RegExp(`^\\s*${id.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*::\\s*`, "i");

  for (const raw of lines) {
    const { code } = stripCommentKeepSuffix(raw);
    const line = code.trim();
    if (!line) {
      out.push(raw);
      continue;
    }

    if (nodeRe.test(code)) continue;

    if (line.includes("->")) {
      const m = line.match(/^(.+?)\s*->\s*(.+)$/);
      if (m) {
        const left = m[1].trim();
        const right = m[2].trim();
        const sources = left.split("|").map((t) => t.trim()).filter(Boolean);
        const targets = right.split("|").map((t) => t.trim()).filter(Boolean);
        if (sources.includes(id) || targets.includes(id)) continue;
      }
    }

    out.push(raw);
  }

  return out;
}

function deleteCluster(lines, clusterId) {
  // Delete the opening line and corresponding closing line for a cluster (keeping contents).
  // clusterId is like "cluster_0", "cluster_1", etc.
  // We need to find the opening line and track to the matching closing line.
  
  // Find the opening line index by mirroring dslToDot() cluster open/close rules.
  const openers = scanClusterOpenersFromLines(lines);
  const target = openers.find((o, idx) => `cluster_${idx}` === clusterId) || null;
  const targetOpenIdx = target ? target.idx : -1;
  const targetDepth = target ? target.depth : -1;
  
  if (targetOpenIdx < 0) return lines; // cluster not found
  
  // Find the corresponding closing line: first closing marker with matching or greater depth
  let targetCloseIdx = -1;
  const stack = [{ depth: targetDepth, openIdx: targetOpenIdx }];
  
  for (let i = targetOpenIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    const { code } = stripCommentKeepSuffix(raw);
    const line = code.trim();
    const m = line.match(/^(-{2,})(.*)$/);
    if (!m) continue;
    
    const dashes = m[1];
    const depth = dashes.length;
    if (depth % 2 !== 0) continue;
    
    const rest = String(m[2] || "").trim();
    const { before: labelPart, inner: styleInnerRaw } = parseTrailingBracket(rest);
    const label = String(labelPart || "").trim();
    const styleInner = String(styleInnerRaw || "").trim();
    const hasOpenerContent = Boolean(label || styleInner);

    const hasOpenAtOrDeeper = stack.length && stack[stack.length - 1].depth >= depth;
    const isClose = !hasOpenerContent && hasOpenAtOrDeeper;

    if (isClose) {
      // Closing marker - closes everything >= depth
      while (stack.length && stack[stack.length - 1].depth >= depth) {
        const popped = stack.pop();
        if (popped.openIdx === targetOpenIdx && depth === targetDepth) {
          targetCloseIdx = i;
          break;
        }
      }
      if (targetCloseIdx >= 0) break;
      continue;
    }

    // Opener: mirror dslToDot() alignment (can implicitly close nested stacks)
    const parentDepth = depth - 2;
    while (stack.length && stack[stack.length - 1].depth > parentDepth) stack.pop();
    if (depth > targetDepth) stack.push({ depth, openIdx: i });
  }
  
  // If no closing marker found, just delete the opening line
  if (targetCloseIdx < 0) {
    lines.splice(targetOpenIdx, 1);
    return lines;
  }
  
  // Delete both lines (close first to preserve indices)
  lines.splice(targetCloseIdx, 1);
  lines.splice(targetOpenIdx, 1);
  return lines;
}

function clearVizSelection() {
  document.querySelectorAll("#tm-viz .tm-viz-selected").forEach((el) => el.classList.remove("tm-viz-selected"));
}

function getClosestGraphvizGroup(target, cls) {
  // Graphviz SVG uses <g class="node"> and <g class="edge"> groups.
  return target?.closest?.(`g.${cls}`) || null;
}

function getGraphvizTitleText(gEl) {
  const t = gEl?.querySelector?.("title");
  return t ? String(t.textContent || "").trim() : "";
}

function parseTmEdgeDomIdFromEl(el) {
  const idEl = el?.closest?.('[id^="tm_e_"]');
  const id = idEl?.getAttribute?.("id") || "";
  const m = String(id).match(/^tm_e_(\d+)--/);
  return m ? Number(m[1]) : null;
}

function initVizInteractivity(editor, graphviz, opts = {}) {
  const vizEl = document.getElementById("tm-viz");
  if (!vizEl) return;
  const vizWrapEl = vizEl.closest(".tm-viz-wrap");
  const openTitleModal = typeof opts?.openTitleModal === "function" ? opts.openTitleModal : null;

  // Track selected nodes for multi-select
  const selectedNodes = new Set();

  // Hover-only delete button (red X) for nodes/links (fast delete with confirm).
  let hoverDeleteBtn = document.getElementById("tm-viz-hover-delete");
  if (!hoverDeleteBtn) {
    hoverDeleteBtn = document.createElement("button");
    hoverDeleteBtn.id = "tm-viz-hover-delete";
    hoverDeleteBtn.type = "button";
    hoverDeleteBtn.className = "btn btn-sm btn-danger tm-viz-hover-delete";
    hoverDeleteBtn.textContent = "×";
    hoverDeleteBtn.setAttribute("aria-label", "Delete");
    hoverDeleteBtn.title = "Delete";
    vizEl.appendChild(hoverDeleteBtn);
  }

  // Hover-only checkbox for multi-select
  let hoverCheckbox = document.getElementById("tm-viz-hover-checkbox");
  if (!hoverCheckbox) {
    hoverCheckbox = document.createElement("label");
    hoverCheckbox.id = "tm-viz-hover-checkbox";
    hoverCheckbox.className = "btn btn-sm btn-outline-primary tm-viz-hover-checkbox";
    hoverCheckbox.innerHTML = '<input type="checkbox" />';
    hoverCheckbox.setAttribute("aria-label", "Select node");
    hoverCheckbox.title = "Select node";
    vizEl.appendChild(hoverCheckbox);
  }
  const checkboxInput = hoverCheckbox.querySelector("input");

  // Hover-only "Source" button for quick link creation: Source -> Target.
  let hoverSourceBtn = document.getElementById("tm-viz-hover-source");
  if (!hoverSourceBtn) {
    hoverSourceBtn = document.createElement("button");
    hoverSourceBtn.id = "tm-viz-hover-source";
    hoverSourceBtn.type = "button";
    hoverSourceBtn.className = "btn btn-sm btn-outline-primary tm-viz-hover-source";
    hoverSourceBtn.innerHTML = '<i class="bi bi-arrow-right" aria-hidden="true"></i>';
    hoverSourceBtn.setAttribute("aria-label", "Start link");
    hoverSourceBtn.title = "Start link (pick source, then click target)";
    vizEl.appendChild(hoverSourceBtn);
  }

  const modalEl = document.getElementById("tm-viz-edit-modal");
  const modalTitle = document.getElementById("tm-viz-edit-modal-title");
  const modalMeta = document.getElementById("tm-viz-edit-meta");
  const modalDisabled = document.getElementById("tm-viz-edit-disabled");
  const modalCloseX = document.getElementById("tm-viz-edit-close-x");
  const nodeFields = document.getElementById("tm-viz-edit-node-fields");
  const clusterFields = document.getElementById("tm-viz-edit-cluster-fields");
  const edgeFields = document.getElementById("tm-viz-edit-edge-fields");
  const nodeLabelInput = document.getElementById("tm-viz-node-label");
  const nodeFillInput = document.getElementById("tm-viz-node-fill-color");
  const nodeRoundedChk = document.getElementById("tm-viz-node-rounded");
  const nodeBwInput = document.getElementById("tm-viz-node-border-width");
  const nodeBsSel = document.getElementById("tm-viz-node-border-style");
  const nodeBcInput = document.getElementById("tm-viz-node-border-color");
  const nodeTextSizeInput = document.getElementById("tm-viz-node-text-size");

  // Cluster fields
  const clusterLabelInput = document.getElementById("tm-viz-cluster-label");
  const clusterFillInput = document.getElementById("tm-viz-cluster-fill");
  const clusterBwInput = document.getElementById("tm-viz-cluster-border-width");
  const clusterBsSel = document.getElementById("tm-viz-cluster-border-style");
  const clusterBcInput = document.getElementById("tm-viz-cluster-border-color");
  const clusterTextColourInput = document.getElementById("tm-viz-cluster-text-colour");
  const clusterTextSizeInput = document.getElementById("tm-viz-cluster-text-size");

  // Node modal: add-link widgets
  const addDirSel = document.getElementById("tm-viz-add-edge-dir");
  const addOtherSel = document.getElementById("tm-viz-add-edge-other");
  const addNewNodeBtn = document.getElementById("tm-viz-add-edge-new-node-btn");
  const addNewLabelInput = document.getElementById("tm-viz-add-edge-new-label");
  const addNewHint = document.getElementById("tm-viz-add-edge-new-hint");
  const addEdgeLabelInput = document.getElementById("tm-viz-add-edge-label");
  const addBwInput = document.getElementById("tm-viz-add-edge-border-width");
  const addBsSel = document.getElementById("tm-viz-add-edge-border-style");
  const addBcInput = document.getElementById("tm-viz-add-edge-border-color");
  const addBtn = document.getElementById("tm-viz-add-edge-btn");
  const addStatus = document.getElementById("tm-viz-add-edge-status");
  const edgeLabelInput = document.getElementById("tm-viz-edge-label");
  const edgeFromSel = document.getElementById("tm-viz-edge-from");
  const edgeToSel = document.getElementById("tm-viz-edge-to");
  const edgeBwInput = document.getElementById("tm-viz-edge-border-width");
  const edgeBsSel = document.getElementById("tm-viz-edge-border-style");
  const edgeBcInput = document.getElementById("tm-viz-edge-border-color");
  const btnDelete = document.getElementById("tm-viz-edit-delete");
  const btnSave = document.getElementById("tm-viz-edit-save");

  function openEditDrawer() {
    closeOtherVizDrawers(modalEl);
    modalEl?.classList?.add?.("tm-open");
    positionVizDrawerAgainstDiagram(modalEl);
  }

  function closeEditDrawer() {
    modalEl?.classList?.remove?.("tm-open");
  }

  // Quick link drawer (opens when setting a Source; does not block clicking the viz)
  const quickDrawerEl = document.getElementById("tm-viz-quicklink-drawer");
  const quickDrawerMeta = document.getElementById("tm-viz-quicklink-meta");
  const quickDirOut = document.getElementById("tm-viz-quicklink-dir-out");
  const quickDirIn = document.getElementById("tm-viz-quicklink-dir-in");
  const quickNewLabelsWrap = document.getElementById("tm-viz-quicklink-new-labels");
  const quickCreateNewBtn = document.getElementById("tm-viz-quicklink-create-new-btn");
  const quickEdgeLabelInput = document.getElementById("tm-viz-quicklink-edge-label");
  const quickBorderEnabled = document.getElementById("tm-viz-quicklink-border-enabled");
  const quickBorderControls = document.getElementById("tm-viz-quicklink-border-controls");
  const quickBwInput = document.getElementById("tm-viz-quicklink-border-width");
  const quickBsSel = document.getElementById("tm-viz-quicklink-border-style");
  const quickBcInput = document.getElementById("tm-viz-quicklink-border-color");
  const quickStatus = document.getElementById("tm-viz-quicklink-status");
  const quickCancelBtn = document.getElementById("tm-viz-quicklink-cancel");
  const quickCloseBtn = document.getElementById("tm-viz-quicklink-close");

  // Selection drawer (opens when nodes are multi-selected via checkboxes)
  const selDrawerEl = document.getElementById("tm-viz-selection-drawer");
  const selDrawerMeta = document.getElementById("tm-viz-selection-meta");
  const selDrawerCloseBtn = document.getElementById("tm-viz-selection-close");

  let selection = null; // { type: "node", nodeId } | { type: "cluster", clusterId } | { type: "edge", lineNo, fromId, toId }
  let canSave = false;
  let canDelete = false;
  let suppressLiveApply = false; // prevents feedback loops while we populate widgets

  let hoverDeleteTarget = null; // { type: "node", nodeId } | { type: "edge", lineNo, fromId, toId }
  let hoverSourceTarget = null; // { type: "node", nodeId }
  let pendingLinkSourceId = null; // nodeId while user is choosing a target

  // Baseline values captured when the modal opens; used to write ONLY changed attrs (and remove duplicates/redundant overrides).
  let baseline = null;

  function hideHoverDelete() {
    hoverDeleteBtn?.classList?.remove("tm-show");
    hoverDeleteTarget = null;
  }

  function showHoverDeleteAtSvgGroup(gEl, anchorEl = null) {
    if (!hoverDeleteBtn || !gEl) return;
    const vizRect = vizEl.getBoundingClientRect();
    const r = (anchorEl || gEl).getBoundingClientRect();

    // Convert viewport coordinates to coordinates inside the scrollable viz container.
    const x = r.right - vizRect.left + vizEl.scrollLeft - 18;
    let y = r.top - vizRect.top + vizEl.scrollTop + 2;

    // For nodes, put the delete widget near the vertical center (rounded corners make top/bottom fiddly).
    if (gEl.classList?.contains?.("node")) {
      hoverDeleteBtn.style.visibility = "hidden";
      hoverDeleteBtn.classList.add("tm-show"); // ensure measurable
      const bh = hoverDeleteBtn.offsetHeight || 24;
      hoverDeleteBtn.style.visibility = "";
      y = r.top - vizRect.top + vizEl.scrollTop + r.height * 0.5 - bh / 2;
    }

    hoverDeleteBtn.style.left = `${Math.max(0, x)}px`;
    hoverDeleteBtn.style.top = `${Math.max(0, y)}px`;
    hoverDeleteBtn.classList.add("tm-show");
  }

  function showHoverDeleteAtSvgPoint(svgX, svgY) {
    // Purpose: place the hover delete X directly on an edge path (used when an edge has no label element).
    if (!hoverDeleteBtn) return;
    const svg = getVizSvgEl();
    if (!svg) return;

    const vizRect = vizEl.getBoundingClientRect();
    const vb = svg.viewBox?.baseVal;
    if (!vb || !Number.isFinite(vb.width) || !Number.isFinite(vb.height) || vb.width <= 0 || vb.height <= 0) return;

    // Convert SVG viewBox coordinates -> viewport coords, then -> coords inside the scrollable viz container.
    // IMPORTANT: edge label positioning + path points are in the SVG's viewBox coordinate space.
    const svgRect = svg.getBoundingClientRect();
    const viewportX = svgRect.left + ((svgX - vb.x) * svgRect.width) / vb.width;
    const viewportY = svgRect.top + ((svgY - vb.y) * svgRect.height) / vb.height;
    const x = viewportX - vizRect.left + vizEl.scrollLeft;
    const y = viewportY - vizRect.top + vizEl.scrollTop;

    // Show first so we can measure size, then center on the point.
    hoverDeleteBtn.classList.add("tm-show");

    const bw = hoverDeleteBtn.offsetWidth || 24;
    const bh = hoverDeleteBtn.offsetHeight || 24;
    hoverDeleteBtn.style.left = `${x - bw / 2}px`;
    hoverDeleteBtn.style.top = `${y - bh / 2}px`;
  }

  function refreshHoverSourceBtnAppearance() {
    if (!hoverSourceBtn) return;
    const on = Boolean(pendingLinkSourceId);
    hoverSourceBtn.classList.toggle("btn-primary", on);
    hoverSourceBtn.classList.toggle("btn-outline-primary", !on);
  }

  function hideHoverSource() {
    hoverSourceBtn?.classList?.remove("tm-show");
    hoverSourceTarget = null;
  }

  function showHoverSourceAtSvgGroup(gEl) {
    if (!hoverSourceBtn || !gEl) return;
    const vizRect = vizEl.getBoundingClientRect();
    const r = gEl.getBoundingClientRect();

    // Convert viewport coordinates to coordinates inside the scrollable viz container.
    const x = r.left - vizRect.left + vizEl.scrollLeft + 2;
    hoverSourceBtn.style.visibility = "hidden";
    hoverSourceBtn.classList.add("tm-show"); // ensure measurable
    const bh = hoverSourceBtn.offsetHeight || 24;
    hoverSourceBtn.style.visibility = "";
    // Slightly above center so it doesn't collide with the checkbox on the left side.
    const y = r.top - vizRect.top + vizEl.scrollTop + r.height * 0.35 - bh / 2;

    hoverSourceBtn.style.left = `${Math.max(0, x)}px`;
    hoverSourceBtn.style.top = `${Math.max(0, y)}px`;
    hoverSourceBtn.classList.add("tm-show");
  }

  function hideHoverCheckbox() {
    hoverCheckbox?.classList?.remove("tm-show");
  }

  function showHoverCheckboxAtSvgGroup(gEl, nodeId) {
    if (!hoverCheckbox || !gEl) return;
    // Purpose: once we are in multi-select mode (per-node checkboxes are shown),
    // the hover-only checkbox becomes redundant and visually noisy.
    if (selectedNodes.size > 0) {
      hideHoverCheckbox();
      return;
    }
    const vizRect = vizEl.getBoundingClientRect();
    const r = gEl.getBoundingClientRect();

    // Convert viewport coordinates to coordinates inside the scrollable viz container.
    const x = r.left - vizRect.left + vizEl.scrollLeft + 2;
    hoverCheckbox.style.visibility = "hidden";
    hoverCheckbox.classList.add("tm-show"); // ensure measurable
    const bh = hoverCheckbox.offsetHeight || 24;
    hoverCheckbox.style.visibility = "";
    // Slightly below center so it doesn't collide with the Source button on the left side.
    const y = r.top - vizRect.top + vizEl.scrollTop + r.height * 0.65 - bh / 2;

    hoverCheckbox.style.left = `${Math.max(0, x)}px`;
    hoverCheckbox.style.top = `${Math.max(0, y)}px`;
    
    // Update checkbox state based on selection
    if (checkboxInput) {
      checkboxInput.checked = selectedNodes.has(nodeId);
    }
    
    hoverCheckbox.classList.add("tm-show");
  }

  function updateDeleteSelectedButton() {
    // Purpose: show multi-select actions via a sliding drawer (not toolbar icons).
    const n = selectedNodes.size;
    const show = n > 0;

    if (!selDrawerEl) return;

    if (!show) {
      selDrawerEl.classList.remove("tm-open");
      if (selDrawerMeta) selDrawerMeta.textContent = "";
      return;
    }

    closeOtherVizDrawers(selDrawerEl);
    selDrawerEl.classList.add("tm-open");
    if (selDrawerMeta) selDrawerMeta.textContent = `${n} selected`;
    positionVizDrawerAgainstDiagram(selDrawerEl, { topOffsetPx: 100 });
  }

  function applyMultiSelectVisuals() {
    // If at least one node is selected, show checkboxes on ALL nodes (so selection is obvious),
    // otherwise fall back to hover-only checkbox UI.
    const svg = getVizSvgEl();
    if (!svg) return;

    // Remove any previous per-node checkbox overlays (we re-create them to stay simple).
    svg.querySelectorAll(".tm-node-checkbox").forEach((el) => el.remove());

    if (selectedNodes.size === 0) return;

    for (const nodeG of svg.querySelectorAll("g.node")) {
      const nodeId = getGraphvizTitleText(nodeG);
      if (!nodeId) continue;

      // Place a small checkbox at the bottom-left of the node group.
      const bbox = nodeG.getBBox();
      const fo = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
      fo.setAttribute("class", "tm-node-checkbox");
      fo.setAttribute("x", String(bbox.x));
      fo.setAttribute("y", String(bbox.y + bbox.height - 18));
      fo.setAttribute("width", "18");
      fo.setAttribute("height", "18");

      // Use a plain checkbox (no Bootstrap button chrome) so it's small.
      const wrap = document.createElement("div");
      wrap.style.width = "18px";
      wrap.style.height = "18px";
      wrap.style.display = "flex";
      wrap.style.alignItems = "center";
      wrap.style.justifyContent = "center";
      wrap.style.pointerEvents = "auto";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selectedNodes.has(nodeId);
      cb.style.width = "14px";
      cb.style.height = "14px";
      cb.style.margin = "0";
      cb.style.cursor = "pointer";

      cb.addEventListener("click", (e) => {
        // Prevent opening the node modal
        e.stopPropagation();
      });

      cb.addEventListener("change", (e) => {
        e.stopPropagation();
        if (cb.checked) selectedNodes.add(nodeId);
        else selectedNodes.delete(nodeId);
        updateDeleteSelectedButton();
        applyMultiSelectVisuals(); // refresh checks + remove overlays if selection empties
      });

      wrap.appendChild(cb);
      fo.appendChild(wrap);
      nodeG.appendChild(fo);
    }
  }

  function setQuickStatus(msg) {
    if (!quickStatus) return;
    quickStatus.textContent = String(msg || "");
  }

  function syncQuickBorderControls() {
    const on = Boolean(quickBorderEnabled?.checked);
    quickBorderControls?.classList.toggle("d-none", !on);
  }

  function openQuickDrawerForSource(nodeId) {
    if (quickDrawerMeta) quickDrawerMeta.textContent = nodeId ? `Source: ${nodeId} → (click target)` : "";
    setQuickStatus("");
    syncQuickBorderControls();
    ensureTrailingBlankQuickNewLabel();
    syncQuickCreateBtn();
    closeOtherVizDrawers(quickDrawerEl);
    quickDrawerEl?.classList?.add("tm-open");
    positionQuickDrawerAgainstDiagram();
  }

  function closeQuickDrawer() {
    quickDrawerEl?.classList?.remove("tm-open");
  }

  function positionQuickDrawerAgainstDiagram() {
    // Purpose: slide in from the far left, but stop so the drawer's RIGHT edge touches the diagram's LEFT edge.
    if (!quickDrawerEl) return;
    positionVizDrawerAgainstDiagram(quickDrawerEl, { topOffsetPx: 100 });
  }

  function maybeRepositionQuickDrawer() {
    // Keep all open drawers aligned with the diagram when the layout changes.
    document.querySelectorAll(".tm-viz-drawer.tm-open").forEach((el) => positionVizDrawerAgainstDiagram(el, { topOffsetPx: 100 }));
  }

  window.addEventListener("resize", maybeRepositionQuickDrawer);
  document.getElementById("tm-splitter")?.addEventListener?.("pointerup", maybeRepositionQuickDrawer);
  document.getElementById("tm-splitter")?.addEventListener?.("mouseup", maybeRepositionQuickDrawer);

  function getQuickDir() {
    return quickDirIn?.checked ? "in" : "out";
  }

  function ensureTrailingBlankQuickNewLabel() {
    // Purpose: when the user types into the last "new node label" input, add another blank below.
    if (!quickNewLabelsWrap) return;
    const inputs = Array.from(quickNewLabelsWrap.querySelectorAll("input.tm-viz-quicklink-new-label"));
    const last = inputs[inputs.length - 1] || null;
    const lastHasText = Boolean(String(last?.value || "").trim());
    if (!last || lastHasText) {
      const inp = document.createElement("input");
      inp.className = "form-control form-control-sm tm-viz-quicklink-new-label";
      inp.type = "text";
      inp.placeholder = "(optional)";
      quickNewLabelsWrap.appendChild(inp);
    }
  }

  function getQuickNewLabels() {
    if (!quickNewLabelsWrap) return [];
    return Array.from(quickNewLabelsWrap.querySelectorAll("input.tm-viz-quicklink-new-label"))
      .map((el) => String(el.value || "").trim())
      .filter(Boolean);
  }

  function syncQuickCreateBtn() {
    if (!quickCreateNewBtn) return;
    const hasAny = getQuickNewLabels().length > 0;
    // Visual "glow" using Bootstrap primary styling when there's something to create.
    quickCreateNewBtn.classList.toggle("btn-outline-secondary", !hasAny);
    quickCreateNewBtn.classList.toggle("btn-primary", hasAny);
  }

  function resetQuickNewLabels() {
    if (!quickNewLabelsWrap) return;
    quickNewLabelsWrap.innerHTML = "";
    const inp = document.createElement("input");
    inp.className = "form-control form-control-sm tm-viz-quicklink-new-label";
    inp.type = "text";
    inp.placeholder = "(optional)";
    quickNewLabelsWrap.appendChild(inp);
    syncQuickCreateBtn();
  }

  quickNewLabelsWrap?.addEventListener("input", (e) => {
    const isLabel = e?.target?.classList?.contains?.("tm-viz-quicklink-new-label");
    if (!isLabel) return;
    ensureTrailingBlankQuickNewLabel();
    syncQuickCreateBtn();
  });

  function clearSourceGlow() {
    vizEl?.querySelectorAll?.("svg g.node.tm-viz-source")?.forEach?.((g) => g.classList.remove("tm-viz-source"));
  }

  function applySourceGlow(nodeId) {
    clearSourceGlow();
    const id = String(nodeId || "").trim();
    if (!id) return;
    const svg = vizEl?.querySelector?.("svg");
    if (!svg) return;
    for (const g of svg.querySelectorAll("g.node")) {
      if (getGraphvizTitleText(g) === id) {
        g.classList.add("tm-viz-source");
        return;
      }
    }
  }

  function buildQuickLinkBracket() {
    // Purpose: optional label + optional border override for the next link.
    const lbl = String(quickEdgeLabelInput?.value || "").trim();
    const wantsBorder = Boolean(quickBorderEnabled?.checked);
    const border = wantsBorder
      ? uiToBorderText({
          width: quickBwInput?.value ?? 0,
          style: quickBsSel?.value ?? "solid",
          colorHex: quickBcInput?.value ?? "#6c757d",
        })
      : "";

    if (lbl && border) return ` [${lbl} | ${border}]`;
    if (lbl) return ` [${lbl}]`;
    if (border) return ` [${border}]`;
    return "";
  }

  function appendEdgeLineToEditor({ fromId, toId, alsoAddNewNodeLine = "" }) {
    // Purpose: keep quick-link and modal add-link behavior consistent (append DSL + rerender).
    const bracket = buildQuickLinkBracket();
    const edgeLine = `${fromId} -> ${toId}${bracket}`;

    const text = editor.getValue().trimEnd();
    const chunk = alsoAddNewNodeLine ? `${alsoAddNewNodeLine}\n${edgeLine}` : edgeLine;
    const next = text ? `${text}\n${chunk}\n` : `${chunk}\n`;

    editor.setValue(next, -1);
    setMapScriptInUrl(editor.getValue());
    renderNow(graphviz, editor);
  }

  function getDiagramBackgroundHexFromEditor(dslText) {
    const s = dslToDot(String(dslText || "")).settings || {};
    const rgb = resolveCssColorToRgb(s.background || "#ffffff") || { r: 255, g: 255, b: 255 };
    return rgbToHex(rgb);
  }

  function getDefaultGroupTextHexFromEditor(dslText) {
    const s = dslToDot(String(dslText || "")).settings || {};
    const rgb = resolveCssColorToRgb(s.defaultBoxTextColour || "#111827") || { r: 17, g: 24, b: 39 };
    return rgbToHex(rgb);
  }

  function borderUiEquals(a, b) {
    const aa = a || {};
    const bb = b || {};
    return (
      Number(aa.width ?? 0) === Number(bb.width ?? 0) &&
      String(aa.style || "solid") === String(bb.style || "solid") &&
      String(aa.colorHex || "").toLowerCase() === String(bb.colorHex || "").toLowerCase()
    );
  }

  function setActions({ save, del, message }) {
    canSave = Boolean(save);
    canDelete = Boolean(del);
    if (modalDisabled) {
      const msg = String(message || "").trim();
      modalDisabled.classList.toggle("d-none", !msg);
      modalDisabled.textContent = msg;
    }
    if (btnSave) btnSave.disabled = !canSave;
    if (btnDelete) btnDelete.disabled = !canDelete;
  }

  function buildNodesByIdFromDsl() {
    const { errors, dot, settings, ...rest } = dslToDot(editor.getValue());
    // Reconstruct nodes list by re-parsing from the editor; keeps this modal self-contained.
    // (dslToDot already computed nodes internally; we reproduce that info by reading DOT is hard,
    // so instead we derive a nodes list by scanning node defs + implicit nodes via dslToDot again.)
    //
    // NOTE: we can't access the internal nodes Map from dslToDot without changing its return shape.
    // So we do a tiny, safe approximation: parse editor lines for explicit nodes, and add any implicit
    // ones by reusing the same ensureNode logic indirectly isn't available here.
    //
    // Keep simple: just list explicit IDs from "ID:: ..." plus any IDs referenced in edges (simple IDs).
    const lines = editor.getValue().split(/\r?\n/);
    const nodesById = new Map();

    for (const raw of lines) {
      const { code } = stripCommentKeepSuffix(raw);
      const m = code.trim().match(/^(\S+)\s*::\s*(.+)$/);
      if (!m) continue;
      const id = m[1].trim();
      const labelRaw = m[2].trim();
      const { before: labelPart } = parseTrailingBracket(labelRaw);
      nodesById.set(id, { id, label: labelPart.trim() || id });
    }

    for (const raw of lines) {
      const { code } = stripCommentKeepSuffix(raw);
      const c = code.trim();
      if (!c.includes("->")) continue;
      const m = c.match(/^(.+?)\s*->\s*(.+)$/);
      if (!m) continue;
      const left = m[1].trim();
      const right = parseTrailingBracket(m[2]).before.trim();
      const tokens = []
        .concat(left.split("|").map((t) => t.trim()))
        .concat(right.split("|").map((t) => t.trim()))
        .filter(Boolean);
      for (const tok of tokens) {
        if (!isSimpleIdToken(tok)) continue;
        if (!nodesById.has(tok)) nodesById.set(tok, { id: tok, label: tok });
      }
    }

    return nodesById;
  }

  function fillNodeSelect(selectEl, nodesById, selectedId) {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    const items = Array.from(nodesById.values()).sort((a, b) => String(a.label).localeCompare(String(b.label)));
    for (const n of items) {
      const opt = document.createElement("option");
      opt.value = n.id;
      opt.textContent = n.label === n.id ? n.label : `${n.label} (${n.id})`;
      selectEl.appendChild(opt);
    }
    if (selectedId && nodesById.has(selectedId)) selectEl.value = selectedId;
  }

  function fillNodeSelectWithNew(selectEl, nodesById, selectedId) {
    if (!selectEl) return;
    // Important: do NOT call fillNodeSelect() here because it clears innerHTML (and would remove "New…")
    selectEl.innerHTML = "";

    const optNew = document.createElement("option");
    optNew.value = "__new__";
    optNew.textContent = "New…";
    selectEl.appendChild(optNew);

    const items = Array.from(nodesById.values()).sort((a, b) => String(a.label).localeCompare(String(b.label)));
    for (const n of items) {
      const opt = document.createElement("option");
      opt.value = n.id;
      opt.textContent = n.label === n.id ? n.label : `${n.label} (${n.id})`;
      selectEl.appendChild(opt);
    }

    if (selectedId === "__new__") selectEl.value = "__new__";
    else if (selectedId && nodesById.has(selectedId)) selectEl.value = selectedId;
  }

  function setAddEdgeStatus(msg) {
    if (!addStatus) return;
    addStatus.textContent = String(msg || "");
  }

  function setNewNodeMode(enabled) {
    addNewLabelInput?.classList.toggle("d-none", !enabled);
    addNewHint?.classList.toggle("d-none", !enabled);
  }

  function openModal() {
    // Purpose: keep existing naming, but use the sliding drawer (not a bootstrap modal).
    openEditDrawer();
  }

  function buildClustersByIdFromLines(lines) {
    // Must match dslToDot(): clusters get ids in the order opening markers appear.
    const out = new Map(); // id -> { id, idx, dashes, label, styleInner, comment }
    const openers = scanClusterOpenersFromLines(lines);
    for (let n = 0; n < openers.length; n++) {
      const o = openers[n];
      const id = `cluster_${n}`;
      out.set(id, { id, idx: o.idx, comment: o.comment, dashes: o.dashes, label: o.label, styleInner: o.styleInner });
    }
    return out;
  }

  function refreshFormFromEditor() {
    if (!selection) return;
    suppressLiveApply = true;
    try {
      const lines = editor.getValue().split(/\r?\n/);
      baseline = null;

      clearVizSelection();
      setActions({ save: true, del: true, message: "" });

      if (selection.type === "node") {
        if (modalTitle) modalTitle.textContent = "Edit node";
        if (modalMeta) modalMeta.textContent = `Node: ${selection.nodeId}`;
        nodeFields?.classList.remove("d-none");
        clusterFields?.classList.add("d-none");
        edgeFields?.classList.add("d-none");

        const parsed = parseNodeDefLine(lines, selection.nodeId);
        if (!parsed) {
          nodeFields?.classList.add("d-none");
          setActions({
            save: false,
            del: false,
            message:
              "This node is implicit (created from a free-label link). To edit it with widgets, define it explicitly as a node line like: ID:: Label",
          });
          return;
        }
        if (nodeLabelInput) nodeLabelInput.value = parsed?.label ?? "";

        const defaults = getDefaultNodeUi();
        const fromAttrs = styleInnerToNodeUi(parsed?.styleInner || "");

        const fillHex = fromAttrs?.fillHex || (defaults.hasFillDefault ? defaults.fillHex : null);
        if (nodeFillInput) nodeFillInput.value = fillHex || "#ffffff";

        const borderUi = fromAttrs?.borderUi || (defaults.hasBorderDefault ? defaults.borderUi : null);
        if (nodeBwInput) nodeBwInput.value = String(borderUi?.width ?? 0);
        if (nodeBsSel) nodeBsSel.value = borderUi?.style || "solid";
        if (nodeBcInput) nodeBcInput.value = borderUi?.colorHex || "#999999";

        const rounded = fromAttrs?.rounded ?? defaults.rounded;
        if (nodeRoundedChk) nodeRoundedChk.checked = Boolean(rounded);

        const textSizeScale = Number.isFinite(fromAttrs?.textSizeScale) ? Number(fromAttrs.textSizeScale) : 1;
        if (nodeTextSizeInput) nodeTextSizeInput.value = String(textSizeScale);

        baseline = {
          type: "node",
          fillHex: (fillHex || "#ffffff").toLowerCase(),
          borderUi: { width: Number(borderUi?.width ?? 0), style: borderUi?.style || "solid", colorHex: borderUi?.colorHex || "#999999" },
          rounded: Boolean(rounded),
          textSizeScale,
        };

        // Add-link widgets (only meaningful for editable explicit nodes)
        const nodesById = buildNodesByIdFromDsl();
        fillNodeSelectWithNew(addOtherSel, nodesById, "");
        if (addDirSel) addDirSel.value = "out";
        setNewNodeMode(addOtherSel?.value === "__new__");
        setAddEdgeStatus("");

        const defBorderUi = borderTextToUi(getDefaultEdgeBorderText());
        if (addBwInput) addBwInput.value = String(defBorderUi.width ?? 1);
        if (addBsSel) addBsSel.value = defBorderUi.style || "solid";
        if (addBcInput) addBcInput.value = defBorderUi.colorHex || "#6c757d";
        if (addEdgeLabelInput) addEdgeLabelInput.value = "";

        return;
      }

      if (selection.type === "cluster") {
        if (modalTitle) modalTitle.textContent = "Edit group box";
        if (modalMeta) modalMeta.textContent = `Group: ${selection.clusterId}`;
        nodeFields?.classList.add("d-none");
        clusterFields?.classList.remove("d-none");
        edgeFields?.classList.add("d-none");

        // Clusters are always explicit lines; map from clusterId -> editor line.
        const clustersById = buildClustersByIdFromLines(lines);
        const c = clustersById.get(selection.clusterId);
        if (!c) {
          clusterFields?.classList.add("d-none");
          setActions({ save: false, del: false, message: "This group box couldn't be mapped back to a cluster line in the editor." });
          return;
        }

        setActions({ save: true, del: false, message: "" });

        if (clusterLabelInput) clusterLabelInput.value = c.label || "";

        const fromAttrs = styleInnerToClusterUi(c.styleInner || "");

        const baselineFillHex = (fromAttrs?.fillHex || getDiagramBackgroundHexFromEditor(editor.getValue()) || "#ffffff").toLowerCase();
        if (clusterFillInput) clusterFillInput.value = baselineFillHex;

        const baselineBorderUi = fromAttrs?.borderUi || { width: 1, style: "solid", colorHex: "#cccccc" };
        if (clusterBwInput) clusterBwInput.value = String(baselineBorderUi?.width ?? 1);
        if (clusterBsSel) clusterBsSel.value = String(baselineBorderUi?.style || "solid");
        if (clusterBcInput) clusterBcInput.value = String(baselineBorderUi?.colorHex || "#cccccc");

        const baselineTextHex = (fromAttrs?.textColourHex || getDefaultGroupTextHexFromEditor(editor.getValue()) || "#111827").toLowerCase();
        if (clusterTextColourInput) clusterTextColourInput.value = baselineTextHex;

        const baselineTextSizeScale = Number.isFinite(fromAttrs?.textSizeScale) ? Number(fromAttrs.textSizeScale) : 1;
        if (clusterTextSizeInput) clusterTextSizeInput.value = String(baselineTextSizeScale);

        baseline = {
          type: "cluster",
          fillHex: baselineFillHex,
          borderUi: { width: Number(baselineBorderUi?.width ?? 1), style: String(baselineBorderUi?.style || "solid"), colorHex: String(baselineBorderUi?.colorHex || "#cccccc") },
          textColourHex: baselineTextHex,
          textSizeScale: baselineTextSizeScale,
        };

        return;
      }

      if (selection.type === "edge") {
        if (modalTitle) modalTitle.textContent = "Edit link";
        if (modalMeta) modalMeta.textContent = `Link: ${selection.fromId} -> ${selection.toId} (line ${selection.lineNo})`;
        edgeFields?.classList.remove("d-none");
        nodeFields?.classList.add("d-none");
        clusterFields?.classList.add("d-none");

        const parsed = parseEdgeLine(lines, selection.lineNo);
        const ep = parsed ? parseEdgeEndpoints(parsed.before) : null;
        const isMulti = Boolean(ep && (ep.sources.length > 1 || ep.targets.length > 1));
        // Multi-link line: allow style/label edits (apply to all generated edges), but disable rerouting.
        if (edgeFromSel) edgeFromSel.disabled = isMulti;
        if (edgeToSel) edgeToSel.disabled = isMulti;
        setActions({
          save: true,
          del: !isMulti, // deleting a multi-link line is a bigger action; keep disabled here
          message: isMulti
            ? "This link comes from a multi-link line using '|'. Any label/border changes here apply to ALL links produced by that line. Rerouting source/target is disabled."
            : "",
        });

        if (edgeLabelInput) edgeLabelInput.value = parsed?.label ?? "";

        const nodesById = buildNodesByIdFromDsl();
        fillNodeSelect(edgeFromSel, nodesById, selection.fromId);
        fillNodeSelect(edgeToSel, nodesById, selection.toId);

        const borderText = String(parsed?.border || "").trim() || getDefaultEdgeBorderText();
        const ui = borderTextToUi(borderText);
        // Debug: confirms what we parsed from the DSL line and what we loaded into widgets.
        console.debug("[tm] edge modal load", { lineNo: selection.lineNo, parsed, defaultBorder: getDefaultEdgeBorderText(), ui });
        if (edgeBwInput) edgeBwInput.value = String(ui.width ?? 0);
        if (edgeBsSel) edgeBsSel.value = ui.style || "solid";
        if (edgeBcInput) edgeBcInput.value = ui.colorHex || "#999999";
      }
    } finally {
      suppressLiveApply = false;
    }
  }

  function applyEditorLines(lines) {
    editor.setValue(lines.join("\n"), -1);
    setMapScriptInUrl(editor.getValue());
    renderNow(graphviz, editor);
  }

  function applySelectionEdits({ closeAfter = false } = {}) {
    // Purpose: apply current widget values back into the editor text (single-line patch) + rerender.
    if (!selection || !canSave) return;
    if (suppressLiveApply) return;

    const lines = editor.getValue().split(/\r?\n/);
    let changedIdx = -1;

    if (selection.type === "node") {
      const parsed = parseNodeDefLine(lines, selection.nodeId);
      if (!parsed) return;
      changedIdx = parsed.idx;

      const base = baseline && baseline.type === "node" ? baseline : null;
      if (!base) return;

      const curFillHex = String(nodeFillInput?.value || "#ffffff").toLowerCase();
      const curBorderUi = {
        width: Number(nodeBwInput?.value ?? 0),
        style: String(nodeBsSel?.value ?? "solid"),
        colorHex: String(nodeBcInput?.value ?? "#999999"),
      };
      const curRounded = Boolean(nodeRoundedChk?.checked);
      const curTextSizeScale = Number(nodeTextSizeInput?.value ?? 1);
      if (!(Number.isFinite(curTextSizeScale) && curTextSizeScale > 0)) return;

      const fillHex = curFillHex !== base.fillHex ? curFillHex : null;
      const borderText = !borderUiEquals(curBorderUi, base.borderUi)
        ? uiToBorderText({ width: curBorderUi.width, style: curBorderUi.style, colorHex: curBorderUi.colorHex })
        : "";
      const rounded = curRounded !== base.rounded ? curRounded : false;
      const textSizeScale = curTextSizeScale !== base.textSizeScale ? curTextSizeScale : null;

      const styleInner = upsertNodeStyleInner(parsed.styleInner || "", {
        fillHex,
        borderText: borderText || "",
        rounded,
        textSizeScale,
      });

      const ok = setNodeDefLine(lines, selection.nodeId, {
        label: nodeLabelInput?.value ?? "",
        styleInner,
      });
      if (!ok) return;
    }

    if (selection.type === "cluster") {
      const clustersById = buildClustersByIdFromLines(lines);
      const c = clustersById.get(selection.clusterId);
      if (!c) return;
      changedIdx = c.idx;

      const base = baseline && baseline.type === "cluster" ? baseline : null;
      if (!base) return;

      const curFillHex = String(clusterFillInput?.value || "#ffffff").toLowerCase();
      const curBorderUi = {
        width: Number(clusterBwInput?.value ?? 1),
        style: String(clusterBsSel?.value ?? "solid"),
        colorHex: String(clusterBcInput?.value ?? "#cccccc"),
      };
      const curTextHex = String(clusterTextColourInput?.value || "#111827").toLowerCase();
      const curTextSizeScale = Number(clusterTextSizeInput?.value ?? 1);
      if (!(Number.isFinite(curTextSizeScale) && curTextSizeScale > 0)) return;

      const fillHex = curFillHex !== base.fillHex ? curFillHex : null;
      const borderText = !borderUiEquals(curBorderUi, base.borderUi)
        ? uiToBorderText({ width: curBorderUi.width, style: curBorderUi.style, colorHex: curBorderUi.colorHex })
        : "";
      const textColourHex = curTextHex !== base.textColourHex ? curTextHex : null;
      const textSizeScale = curTextSizeScale !== base.textSizeScale ? curTextSizeScale : null;

      const nextInner = upsertClusterStyleInner(c.styleInner || "", {
        fillHex,
        borderText: borderText || "",
        textColourHex,
        textSizeScale,
      });

      setClusterDefLineAt(lines, c.idx, {
        dashes: c.dashes,
        // Allow empty cluster titles (valid): an empty label is written as "-- []" (see setClusterDefLineAt).
        label: String(clusterLabelInput?.value ?? "").trim(),
        styleInner: nextInner,
        comment: c.comment,
      });
    }

    if (selection.type === "edge") {
      changedIdx = selection.lineNo - 1;
      const border = uiToBorderText({
        width: edgeBwInput?.value ?? 0,
        style: edgeBsSel?.value ?? "solid",
        colorHex: edgeBcInput?.value ?? "#999999",
      });

      const nextFrom = edgeFromSel?.value || selection.fromId;
      const nextTo = edgeToSel?.value || selection.toId;
      const fromChanged = nextFrom !== selection.fromId;
      const toChanged = nextTo !== selection.toId;
      const nodesById = fromChanged || toChanged ? buildNodesByIdFromDsl() : null;

      const ok = setEdgeLine(lines, selection.lineNo, {
        fromId: fromChanged ? { old: selection.fromId, next: nextFrom } : null,
        toId: toChanged ? { old: selection.toId, next: nextTo } : null,
        label: edgeLabelInput?.value ?? "",
        border,
        nodesById,
      });
      if (!ok) return;

      // Keep selection meta accurate if the user rerouted the edge.
      selection = {
        ...selection,
        fromId: fromChanged ? nextFrom : selection.fromId,
        toId: toChanged ? nextTo : selection.toId,
      };
    }

    if (changedIdx >= 0) {
      const ok = replaceEditorLine(editor, changedIdx, lines[changedIdx]);
      if (!ok) return;
      afterEditorMutation({ editor, graphviz });
    }

    if (closeAfter) closeEditDrawer();
  }

  vizEl.addEventListener("click", (e) => {
    // If the user just drag-panned, suppress the synthetic click fired on mouseup.
    if (vizEl?.dataset?.tmIgnoreNextClick === "1") {
      delete vizEl.dataset.tmIgnoreNextClick;
      return;
    }

    // Ignore clicks on any selection checkbox UI (hover checkbox or per-node checkboxes)
    if (e.target === hoverCheckbox || hoverCheckbox?.contains?.(e.target) || e.target.closest?.(".tm-node-checkbox")) {
      return;
    }

    const nodeG = getClosestGraphvizGroup(e.target, "node");
    const clusterG = getClosestGraphvizGroup(e.target, "cluster");
    const edgeG = getClosestGraphvizGroup(e.target, "edge");

    // If we're in "pick target" mode, only a node click should complete it; anything else cancels.
    if (pendingLinkSourceId && !nodeG) {
      pendingLinkSourceId = null;
      delete vizEl.dataset.tmPendingSourceId;
      clearSourceGlow();
      refreshHoverSourceBtnAppearance();
      setVizStatus("Source cleared");
      closeQuickDrawer();
      return;
    }

    if (!nodeG && !clusterG && !edgeG) {
      // Title click: open title-only modal (size/colour/position).
      const title = String(lastVizSettings?.title || "").trim();
      const textEl = e.target?.closest?.("g.graph text") || null;
      const clicked = String(textEl?.textContent || "").trim();
      if (openTitleModal && title && clicked === title) {
        clearVizSelection();
        hideHoverDelete();
        openTitleModal();
        return;
      }

      // Diagram background click: open diagram-wide style modal (background + title settings).
      clearVizSelection();
      document.getElementById("tm-editor-style")?.click();
      return;
    }

    clearVizSelection();
    (nodeG || edgeG)?.classList?.add("tm-viz-selected");

    if (nodeG) {
      const nodeId = getGraphvizTitleText(nodeG);
      if (!nodeId) return;

      // Quick add link: Source -> Target (without opening the modal).
      if (pendingLinkSourceId) {
        const dir = getQuickDir();
        const fromId = dir === "out" ? pendingLinkSourceId : nodeId;
        const toId = dir === "out" ? nodeId : pendingLinkSourceId;
        if (fromId === toId) {
          setVizStatus("Pick a different target");
          return;
        }

        pendingLinkSourceId = null;
        delete vizEl.dataset.tmPendingSourceId;
        clearSourceGlow();
        refreshHoverSourceBtnAppearance();
        appendEdgeLineToEditor({ fromId, toId });
        setVizStatus(`Added link ${fromId} -> ${toId}`);
        hideHoverDelete();
        hideHoverSource();
        closeQuickDrawer();
        return;
      }

      selection = { type: "node", nodeId };
      refreshFormFromEditor();
      openModal();
      return;
    }

    if (clusterG) {
      const clusterId = getGraphvizTitleText(clusterG);
      if (!clusterId || !String(clusterId).startsWith("cluster_")) return;
      selection = { type: "cluster", clusterId };
      refreshFormFromEditor();
      openModal();
      return;
    }

    if (edgeG) {
      const title = getGraphvizTitleText(edgeG); // often "A->B"
      const m = title.match(/^(.+)->(.+)$/);
      const fromId = m ? m[1].trim() : "";
      const toId = m ? m[2].trim() : "";
      const lineNo = parseTmEdgeDomIdFromEl(e.target);
      if (!fromId || !toId || !lineNo) return;
      selection = { type: "edge", fromId, toId, lineNo };
      refreshFormFromEditor();
      openModal();
    }
  });

  // Hover X for quick delete (does not open the modal).
  vizEl.addEventListener("mousemove", (e) => {
    if (!hoverDeleteBtn) return;
    // Don't flicker when moving onto the button itself.
    if (e.target === hoverDeleteBtn || hoverDeleteBtn.contains(e.target)) return;
    if (e.target === hoverSourceBtn || hoverSourceBtn?.contains?.(e.target)) return;
    if (e.target === hoverCheckbox || hoverCheckbox?.contains?.(e.target)) return;

    const nodeG = getClosestGraphvizGroup(e.target, "node");
    const edgeG = getClosestGraphvizGroup(e.target, "edge");
    const clusterG = getClosestGraphvizGroup(e.target, "cluster");
    
    if (!nodeG && !edgeG && !clusterG) {
      hideHoverDelete();
      hideHoverSource();
      hideHoverCheckbox();
      return;
    }

    if (nodeG) {
      const nodeId = getGraphvizTitleText(nodeG);
      if (!nodeId) {
        hideHoverDelete();
        hideHoverSource();
        hideHoverCheckbox();
        return;
      }
      hoverDeleteTarget = { type: "node", nodeId };
      showHoverDeleteAtSvgGroup(nodeG);

      hoverSourceTarget = { type: "node", nodeId };
      refreshHoverSourceBtnAppearance();
      showHoverSourceAtSvgGroup(nodeG);
      
      showHoverCheckboxAtSvgGroup(nodeG, nodeId);
      
      return;
    }

    if (clusterG) {
      const clusterId = getGraphvizTitleText(clusterG);
      if (!clusterId || !clusterId.startsWith("cluster_")) {
        hideHoverDelete();
        hideHoverSource();
        hideHoverCheckbox();
        return;
      }
      hoverDeleteTarget = { type: "cluster", clusterId };
      // Position on the cluster label text if available
      const labelText = clusterG.querySelector("text");
      hideHoverSource();
      hideHoverCheckbox();
      if (labelText) return showHoverDeleteAtSvgGroup(clusterG, labelText);
      return showHoverDeleteAtSvgGroup(clusterG);
    }

    if (edgeG) {
      const title = getGraphvizTitleText(edgeG); // often "A->B"
      const m = title.match(/^(.+)->(.+)$/);
      const fromId = m ? m[1].trim() : "";
      const toId = m ? m[2].trim() : "";
      const lineNo = parseTmEdgeDomIdFromEl(e.target);
      if (!fromId || !toId || !lineNo) {
        hideHoverDelete();
        hideHoverSource();
        hideHoverCheckbox();
        return;
      }
      hoverDeleteTarget = { type: "edge", fromId, toId, lineNo };
      // Prefer positioning over the edge label (when present), otherwise place directly on the edge path.
      const labelText = edgeG.querySelector("text");
      const path = edgeG.querySelector("path");
      hideHoverSource();
      hideHoverCheckbox();
      if (labelText) return showHoverDeleteAtSvgGroup(edgeG, labelText);

      // For unlabeled edges: compute closest point on path, create a temp anchor element there, position button relative to it.
      if (path) {
        const svg = getVizSvgEl();
        if (!svg) return showHoverDeleteAtSvgGroup(edgeG);

        const svgRect = svg.getBoundingClientRect();
        const base = getSvgBaseSizePx(svg);
        if (!base) return showHoverDeleteAtSvgGroup(edgeG);

        // Convert mouse client coords to SVG coordinate space (same system as path.getPointAtLength).
        const mouseSvgX = ((e.clientX - svgRect.left) * base.w) / svgRect.width;
        const mouseSvgY = ((e.clientY - svgRect.top) * base.h) / svgRect.height;
        const pt = getClosestPointOnSvgPath(path, mouseSvgX, mouseSvgY);
        if (!pt) return showHoverDeleteAtSvgGroup(edgeG);

        // Create a temporary circle at the computed point so we can use its bounding rect (browser does coord conversion).
        let anchor = edgeG.querySelector(".tm-edge-hover-anchor");
        if (!anchor) {
          anchor = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          anchor.classList.add("tm-edge-hover-anchor");
          anchor.setAttribute("r", "1");
          anchor.setAttribute("fill", "none");
          anchor.setAttribute("stroke", "none");
          anchor.setAttribute("pointer-events", "none");
          edgeG.appendChild(anchor);
        }
        anchor.setAttribute("cx", pt.x);
        anchor.setAttribute("cy", pt.y);
        return showHoverDeleteAtSvgGroup(edgeG, anchor);
      }

      return showHoverDeleteAtSvgGroup(edgeG);
    }
  });

  vizEl.addEventListener("mouseleave", () => {
    hideHoverDelete();
    hideHoverSource();
    hideHoverCheckbox();
  });

  hoverDeleteBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!hoverDeleteTarget) return;

    const lines = editor.getValue().split(/\r?\n/);

    if (hoverDeleteTarget.type === "node") {
      // Delete immediately (no confirm modal).
      const next = deleteNodeEverywhere(lines, hoverDeleteTarget.nodeId);
      applyEditorLines(next);
      selectedNodes.delete(hoverDeleteTarget.nodeId);
      updateDeleteSelectedButton();
      clearVizSelection();
      hideHoverDelete();
      return;
    }

    if (hoverDeleteTarget.type === "cluster") {
      // Delete cluster box (keeping contents).
      deleteCluster(lines, hoverDeleteTarget.clusterId);
      applyEditorLines(lines);
      clearVizSelection();
      hideHoverDelete();
      return;
    }

    if (hoverDeleteTarget.type === "edge") {
      // Delete immediately (no confirm modal).
      const did = deleteEdgeLine(lines, hoverDeleteTarget.lineNo);
      if (!did) return setVizStatus("Delete failed: edge line not found");
      applyEditorLines(lines);
      clearVizSelection();
      hideHoverDelete();
    }
  });

  hoverSourceBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const nodeId = hoverSourceTarget?.type === "node" ? hoverSourceTarget.nodeId : "";
    if (!nodeId) return;

    // Toggle: clicking Source again on the same node clears the mode.
    pendingLinkSourceId = pendingLinkSourceId === nodeId ? null : nodeId;
    if (pendingLinkSourceId) vizEl.dataset.tmPendingSourceId = pendingLinkSourceId;
    else delete vizEl.dataset.tmPendingSourceId;
    applySourceGlow(pendingLinkSourceId);
    refreshHoverSourceBtnAppearance();
    if (pendingLinkSourceId) {
      setVizStatus(`Source: ${pendingLinkSourceId} (click target)`);
      openQuickDrawerForSource(pendingLinkSourceId);
    } else {
      setVizStatus("Source cleared");
      closeQuickDrawer();
    }
  });

  // Checkbox for multi-select toggle
  checkboxInput?.addEventListener("change", (e) => {
    e.stopPropagation();
    const nodeId = hoverSourceTarget?.type === "node" ? hoverSourceTarget.nodeId : "";
    if (!nodeId) return;
    
    if (checkboxInput.checked) {
      selectedNodes.add(nodeId);
    } else {
      selectedNodes.delete(nodeId);
    }
    updateDeleteSelectedButton();
    applyMultiSelectVisuals();
    hideHoverCheckbox(); // keep UI clean; per-node checkboxes will take over once selection exists
  });

  // Also stop propagation on the checkbox label click
  hoverCheckbox?.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  function getClusterDepthAtLine(lines, idx) {
    // Return current open cluster depth (0 = none, 2 = level-1, 4 = level-2, etc) just BEFORE lines[idx].
    const stack = [];
    for (let i = 0; i < idx; i++) {
      const raw = lines[i] || "";
      const line = stripComment(raw).trim();
      if (!line) continue;
      const m = line.match(/^(-{2,})(.*)$/);
      if (!m) continue;
      const dashes = m[1];
      const rest = String(m[2] || "").trim();
      const depth = dashes.length;
      if (depth % 2 !== 0) continue;

      // Closing marker
      if (!rest) {
        while (stack.length && stack[stack.length - 1] >= depth) stack.pop();
        continue;
      }

      // Opening marker: align to parent depth
      const parentDepth = depth - 2;
      while (stack.length && stack[stack.length - 1] > parentDepth) stack.pop();
      stack.push(depth);
    }
    return stack.length ? stack[stack.length - 1] : 0;
  }

  function findExplicitNodeDefIdx(lines, nodeId) {
    const id = String(nodeId || "").trim();
    if (!id) return -1;
    const re = new RegExp(`^\\s*${id.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*::\\s*`, "i");
    for (let i = 0; i < lines.length; i++) {
      const { code } = stripCommentKeepSuffix(lines[i] || "");
      if (re.test(code)) return i;
    }
    return -1;
  }

  function groupNodesIntoCluster(lines, nodeIds, labelText) {
    // Group selected nodes by moving their explicit definition lines into a new cluster block.
    const ids = Array.from(nodeIds || []).map((s) => String(s || "").trim()).filter(Boolean);
    if (!ids.length) return { ok: false, message: "No selected nodes." };

    const defs = [];
    const missing = [];
    for (const id of ids) {
      const idx = findExplicitNodeDefIdx(lines, id);
      if (idx < 0) missing.push(id);
      else defs.push({ id, idx, raw: lines[idx] });
    }

    if (!defs.length) return { ok: false, message: "No selected nodes have explicit 'A:: ...' lines to group." };

    // Insert at the earliest selected node definition line.
    defs.sort((a, b) => a.idx - b.idx);
    const insertIdx = defs[0].idx;

    // Remove original node definition lines (bottom-up so indices stay valid).
    const removeIdxs = defs.map((d) => d.idx).sort((a, b) => b - a);
    for (const i of removeIdxs) lines.splice(i, 1);

    // Determine nesting depth at insertion point (after removals; cluster markers unchanged).
    const curDepth = getClusterDepthAtLine(lines, insertIdx);
    const newDepth = curDepth + 2;
    const dashes = "-".repeat(newDepth);

    const label = String(labelText || "Group").trim() || "Group";
    const openLine = `${dashes}${label}`;
    const closeLine = `${dashes}`;

    // Insert: open, node defs (in original order), close.
    const nodeLines = defs.map((d) => d.raw);
    lines.splice(insertIdx, 0, openLine, ...nodeLines, closeLine);

    const msg = missing.length
      ? `Grouped ${defs.length} node(s). Skipped (no explicit A:: line): ${missing.join(", ")}`
      : `Grouped ${defs.length} node(s).`;
    return { ok: true, message: msg };
  }

  // Delete selected nodes button
  const deleteSelectedBtn = document.getElementById("tm-delete-selected");
  deleteSelectedBtn?.addEventListener("click", () => {
    if (selectedNodes.size === 0) return;
    
    let lines = editor.getValue().split(/\r?\n/);
    for (const nodeId of selectedNodes) {
      lines = deleteNodeEverywhere(lines, nodeId);
    }
    applyEditorLines(lines);
    selectedNodes.clear();
    updateDeleteSelectedButton();
    clearVizSelection();
  });

  // Group selected nodes into a grouping box (cluster)
  const groupSelectedBtn = document.getElementById("tm-group-selected");
  const groupLabelInput = document.getElementById("tm-viz-selection-group-label");
  groupSelectedBtn?.addEventListener("click", () => {
    if (selectedNodes.size === 0) return;
    const lines = editor.getValue().split(/\r?\n/);
    const label = String(groupLabelInput?.value || "").trim() || "Group";
    const res = groupNodesIntoCluster(lines, selectedNodes, label);
    if (!res.ok) return setVizStatus(res.message || "Group failed");
    applyEditorLines(lines);
    setVizStatus(res.message);
    // After grouping, clear selection (requested).
    selectedNodes.clear();
    updateDeleteSelectedButton();
    applyMultiSelectVisuals();
  });

  // Clear selection
  const clearSelBtn = document.getElementById("tm-clear-selection");
  clearSelBtn?.addEventListener("click", () => {
    if (selectedNodes.size === 0) return;
    selectedNodes.clear();
    updateDeleteSelectedButton();
    applyMultiSelectVisuals();
  });

  selDrawerCloseBtn?.addEventListener("click", () => {
    // Purpose: let the user hide the actions drawer without altering the selection.
    selDrawerEl?.classList?.remove("tm-open");
  });

  // Quick drawer interactions
  quickBorderEnabled?.addEventListener("change", syncQuickBorderControls);

  quickCancelBtn?.addEventListener("click", () => {
    pendingLinkSourceId = null;
    delete vizEl.dataset.tmPendingSourceId;
    clearSourceGlow();
    refreshHoverSourceBtnAppearance();
    setVizStatus("Source cleared");
    closeQuickDrawer();
  });

  quickCloseBtn?.addEventListener("click", () => {
    closeQuickDrawer();
  });

  quickCreateNewBtn?.addEventListener("click", () => {
    if (!pendingLinkSourceId) return setQuickStatus("Pick a source first");
    const labels = getQuickNewLabels();
    if (!labels.length) return setQuickStatus("Enter at least one new node label");

    const lines = editor.getValue().split(/\r?\n/);
    const existingIds = new Set(getExplicitNodeIdsFromLines(lines));
    const dir = getQuickDir();
    const bracket = buildQuickLinkBracket();

    const newNodeLines = [];
    const edgeLines = [];
    for (const label of labels) {
      const newId = makeUniqueNodeIdFromLabel(label, existingIds);
      existingIds.add(newId);
      newNodeLines.push(`${newId}:: ${label}`);
      const fromId = dir === "out" ? pendingLinkSourceId : newId;
      const toId = dir === "out" ? newId : pendingLinkSourceId;
      edgeLines.push(`${fromId} -> ${toId}${bracket}`);
    }

    pendingLinkSourceId = null;
    delete vizEl.dataset.tmPendingSourceId;
    clearSourceGlow();
    refreshHoverSourceBtnAppearance();

    const text = editor.getValue().trimEnd();
    const chunk = newNodeLines.concat(edgeLines).join("\n");
    const next = text ? `${text}\n${chunk}\n` : `${chunk}\n`;
    editor.setValue(next, -1);
    setMapScriptInUrl(editor.getValue());
    renderNow(graphviz, editor);

    setVizStatus(`Added ${edgeLines.length} link${edgeLines.length === 1 ? "" : "s"}`);
    setQuickStatus("Added");
    resetQuickNewLabels();
    closeQuickDrawer();
  });

  // Live preview in the viz edit modal: any change updates editor + rerenders.
  function maybeLiveApply() {
    if (suppressLiveApply) return;
    applySelectionEdits({ closeAfter: false });
  }

  const liveEls = [
    nodeLabelInput,
    nodeFillInput,
    nodeRoundedChk,
    nodeBwInput,
    nodeBsSel,
    nodeBcInput,
    nodeTextSizeInput,
    clusterLabelInput,
    clusterFillInput,
    clusterBwInput,
    clusterBsSel,
    clusterBcInput,
    clusterTextColourInput,
    clusterTextSizeInput,
    edgeLabelInput,
    edgeFromSel,
    edgeToSel,
    edgeBwInput,
    edgeBsSel,
    edgeBcInput,
  ].filter(Boolean);
  for (const el of liveEls) {
    el.addEventListener("input", maybeLiveApply);
    el.addEventListener("change", maybeLiveApply);
  }

  // "Done" just closes (changes are applied live).
  btnSave?.addEventListener("click", () => closeEditDrawer());
  modalCloseX?.addEventListener("click", () => closeEditDrawer());

  // Add-link interactions (node modal)
  addOtherSel?.addEventListener("change", () => {
    setNewNodeMode(addOtherSel.value === "__new__");
    setAddEdgeStatus("");
  });

  addNewNodeBtn?.addEventListener("click", () => {
    if (!addOtherSel) return;
    addOtherSel.value = "__new__";
    addOtherSel.dispatchEvent(new Event("change", { bubbles: true }));
    addNewLabelInput?.focus?.();
  });

  addDirSel?.addEventListener("change", () => {
    setAddEdgeStatus("");
  });

  addBtn?.addEventListener("click", () => {
    if (!selection || selection.type !== "node" || !canSave) return;

    const lines = editor.getValue().split(/\r?\n/);
    const nodesById = buildNodesByIdFromDsl();

    const dir = addDirSel?.value === "in" ? "in" : "out";
    const otherChoice = addOtherSel?.value || "";
    const wantsNew = otherChoice === "__new__";

    let otherToken = "";
    let newNodeLine = "";

    if (wantsNew) {
      const label = String(addNewLabelInput?.value || "").trim();
      if (!label) return setAddEdgeStatus("Enter a new node label");
      const existingIds = getExplicitNodeIdsFromLines(lines);
      const newId = makeUniqueNodeIdFromLabel(label, existingIds);
      newNodeLine = `${newId}:: ${label}`;
      otherToken = newId;
    } else {
      if (!otherChoice) return setAddEdgeStatus("Choose a node");
      otherToken = nodeIdToDslToken(otherChoice, nodesById);
      if (!otherToken) return setAddEdgeStatus("Choose a node");
    }

    const thisToken = selection.nodeId;
    const fromTok = dir === "out" ? thisToken : otherToken;
    const toTok = dir === "out" ? otherToken : thisToken;

    const border = uiToBorderText({
      width: addBwInput?.value ?? 0,
      style: addBsSel?.value ?? "solid",
      colorHex: addBcInput?.value ?? "#6c757d",
    });
    const lbl = String(addEdgeLabelInput?.value || "").trim();
    const bracket = lbl && border ? ` [${lbl} | ${border}]` : lbl ? ` [${lbl}]` : border ? ` [${border}]` : "";

    const edgeLine = `${fromTok} -> ${toTok}${bracket}`;

    const text = editor.getValue().trimEnd();
    const chunk = newNodeLine ? `${newNodeLine}\n${edgeLine}` : edgeLine;
    const next = text ? `${text}\n${chunk}\n` : `${chunk}\n`;

    editor.setValue(next, -1);
    setMapScriptInUrl(editor.getValue());
    renderNow(graphviz, editor);
    setAddEdgeStatus("Added");
  });

  btnDelete?.addEventListener("click", () => {
    if (!selection || !canDelete) return;
    const lines = editor.getValue().split(/\r?\n/);

    if (selection.type === "node") {
      const next = deleteNodeEverywhere(lines, selection.nodeId);
      applyEditorLines(next);
      return;
    }

    if (selection.type === "edge") {
      const ok = deleteEdgeLine(lines, selection.lineNo);
      if (!ok) return setVizStatus("Delete failed: edge line not found");
      applyEditorLines(lines);
    }
  });

  // Return functions that need to be called from outside
  return { applyMultiSelectVisuals };
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

// -----------------------------
// Viz toolbar controls (zoom + export/copy)
// -----------------------------

let vizScale = 1;
let lastVizSettings = null; // populated by renderNow
let vizHasUserZoomed = false; // once user zooms manually, preserve their chosen scale across rerenders/resizes

function setVizStatus(msg) {
  const el = document.getElementById("tm-viz-status");
  if (!el) return;
  el.textContent = msg || "";
  if (!msg) return;
  // Clear after a short delay so the toolbar stays clean.
  window.clearTimeout(setVizStatus._t);
  setVizStatus._t = window.setTimeout(() => {
    el.textContent = "";
  }, 1800);
}

function getVizSvgEl() {
  return document.getElementById("tm-viz")?.querySelector("svg") || null;
}

function parseSvgLengthToPx(s) {
  // Parses SVG length strings like "123", "123px", "123pt".
  const t = String(s || "").trim();
  if (!t) return null;
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n)) return null;
  if (t.endsWith("pt")) return n * (96 / 72); // 1pt = 1/72in, 96dpi CSS px
  return n; // treat as px-ish
}

function getSvgBaseSizePx(svg) {
  // Prefer viewBox (stable), otherwise fall back to width/height attrs.
  const vb = svg.viewBox?.baseVal;
  if (vb && Number.isFinite(vb.width) && vb.width > 0 && Number.isFinite(vb.height) && vb.height > 0) {
    return { w: vb.width, h: vb.height };
  }
  const w = parseSvgLengthToPx(svg.getAttribute("width"));
  const h = parseSvgLengthToPx(svg.getAttribute("height"));
  if (w && h) return { w, h };
  return null;
}

function applyVizScale() {
  const svg = getVizSvgEl();
  if (!svg) return;
  const base = getSvgBaseSizePx(svg);
  if (!base) return;

  // IMPORTANT: use width/height sizing (not CSS transform), so scrolling/overflow reflect zoomed size.
  svg.style.width = `${base.w * vizScale}px`;
  svg.style.height = `${base.h * vizScale}px`;
  svg.style.maxWidth = "none";
  svg.style.maxHeight = "none";
  svg.style.display = "block"; // avoids odd inline-SVG whitespace in some browsers
}

function fitVizToContainerWidth() {
  // Fit the rendered SVG to the current viz panel width (so the map fills the panel by default).
  const viz = document.getElementById("tm-viz");
  const svg = getVizSvgEl();
  if (!viz || !svg) return;

  const base = getSvgBaseSizePx(svg);
  if (!base) return;

  // Available content width excludes padding.
  const cs = getComputedStyle(viz);
  const padL = Number.parseFloat(cs.paddingLeft || "0") || 0;
  const padR = Number.parseFloat(cs.paddingRight || "0") || 0;
  const available = Math.max(1, viz.clientWidth - padL - padR);

  // Choose a scale that makes SVG width match the available panel width.
  const next = available / base.w;
  vizScale = Math.max(0.2, Math.min(6, next));
  applyVizScale();
}

function setVizScale(next) {
  const n = Number(next);
  if (!Number.isFinite(n)) return;
  vizScale = Math.max(0.2, Math.min(6, n));
  applyVizScale();
}

function enhanceEdgeHitTargets() {
  // Make edges easier to click: add an invisible, thicker-stroked clone of each edge path.
  // This avoids changing the visible stroke width while dramatically improving UX.
  const svg = getVizSvgEl();
  if (!svg) return;

  svg.querySelectorAll("g.edge").forEach((g) => {
    // Avoid duplicating if we re-run this after re-render
    if (g.querySelector(".tm-edge-hit")) return;

    const path = g.querySelector("path");
    if (!path) return;

    const hit = path.cloneNode(true);
    hit.classList.add("tm-edge-hit");
    // Big click target, but visually invisible
    hit.setAttribute("fill", "none");
    hit.setAttribute("stroke", "transparent");
    hit.setAttribute("stroke-width", "16");
    hit.setAttribute("pointer-events", "stroke");

    // Put hit path before the visible path so visuals stay unchanged
    g.insertBefore(hit, path);
  });
}

function getClosestPointOnSvgPath(pathEl, targetX, targetY) {
  // Purpose: reuse the edge-label placement logic (closest point on edge path) for other overlays (eg hover delete X).
  if (!pathEl) return null;

  const pathLen = pathEl.getTotalLength();
  let closestDist = Infinity;
  let closestPoint = null;

  // Sample at fine intervals to find closest point (same approach as edge label placement).
  const samples = Math.max(50, Math.ceil(pathLen / 2));
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * pathLen;
    const pt = pathEl.getPointAtLength(t);
    const dx = pt.x - targetX;
    const dy = pt.y - targetY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < closestDist) {
      closestDist = dist;
      closestPoint = pt;
    }
  }

  return closestPoint;
}

function repositionEdgeLabels() {
  // Position edge labels on the edge path by calculating where a Graphviz-style
  // connector from the label center to the edge would intersect the edge.
  const svg = getVizSvgEl();
  if (!svg) return;

  svg.querySelectorAll("g.edge").forEach((g) => {
    const path = g.querySelector("path");
    const textEl = g.querySelector("text");
    if (!path || !textEl) return;

    // Remove link-label background (we want plain text labels)
    g.querySelector(".tm-edge-label-bg")?.remove?.();

    // Edge label readability: if the label text is light, use a darker halo (stroke) behind it.
    // Default halo is set in CSS (white-ish); here we only override when needed.
    try {
      const fillCss = getComputedStyle(textEl).fill; // typically "rgb(r,g,b)" or a resolved token
      const rgb = resolveCssColorToRgb(fillCss);
      if (rgb) {
        // WCAG relative luminance for sRGB (0..1). Higher = lighter.
        const toLin = (v) => {
          const s = (Number(v) || 0) / 255;
          return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        const lum = 0.2126 * toLin(rgb.r) + 0.7152 * toLin(rgb.g) + 0.0722 * toLin(rgb.b);
        const useDarkHalo = lum >= 0.65;
        if (useDarkHalo) textEl.style.stroke = "rgba(0, 0, 0, 0.55)";
        else textEl.style.removeProperty("stroke"); // fall back to CSS default
      }
    } catch {
      // Ignore: keep CSS default.
    }

    // Get label's current position in SVG coordinate space
    const bbox = textEl.getBBox();
    const labelCx = bbox.x + bbox.width / 2;
    const labelCy = bbox.y + bbox.height / 2;

    // Find the closest point on the edge path to the label center
    const closestPoint = getClosestPointOnSvgPath(path, labelCx, labelCy);
    if (!closestPoint) return;

    // Set text anchor to middle for proper centering
    textEl.setAttribute("text-anchor", "middle");
    textEl.setAttribute("dominant-baseline", "central");
    
    // Position the label center at the closest point on the edge
    textEl.setAttribute("x", closestPoint.x);
    textEl.setAttribute("y", closestPoint.y);
    
    // Remove any transform that Graphviz might have added
    textEl.removeAttribute("transform");

    // Recalculate bbox after repositioning
    textEl.getBBox();
  });
}

async function copyTextToClipboard(text) {
  // Minimal: use Clipboard API (works on HTTPS + localhost).
  await navigator.clipboard.writeText(String(text));
}

async function copyRichToClipboard({ html, text, pngBlob }) {
  // Writes rich clipboard content for pasting into Word/Google Docs/email clients.
  // NOTE: requires secure context (https or localhost) and user gesture.
  const items = {};
  if (html != null) items["text/html"] = new Blob([String(html)], { type: "text/html" });
  if (text != null) items["text/plain"] = new Blob([String(text)], { type: "text/plain" });
  if (pngBlob) items["image/png"] = pngBlob;
  await navigator.clipboard.write([new ClipboardItem(items)]);
}

function serializeSvg(svgEl) {
  // Ensure the SVG has namespaces so the exported file renders reliably.
  if (!svgEl.getAttribute("xmlns")) svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!svgEl.getAttribute("xmlns:xlink")) svgEl.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  return new XMLSerializer().serializeToString(svgEl);
}

function svgToPngBlob(svgEl, { scale = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const svgText = serializeSvg(svgEl);
    const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      try {
        const vb = svgEl.viewBox?.baseVal;
        const rect = svgEl.getBoundingClientRect();
        const w = vb?.width ? vb.width : rect.width;
        const h = vb?.height ? vb.height : rect.height;

        const outW = Math.max(1, Math.round(w * scale));
        const outH = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement("canvas");
        canvas.width = outW;
        canvas.height = outH;

        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas not available");

        // White background (Graphviz SVG background is often transparent).
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(img, 0, 0, outW, outH);

        canvas.toBlob(
          (pngBlob) => {
            URL.revokeObjectURL(url);
            if (!pngBlob) return reject(new Error("Failed to create PNG"));
            resolve(pngBlob);
          },
          "image/png",
          1.0
        );
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load SVG for export"));
    };
    img.src = url;
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsDataURL(blob);
  });
}

function getRawRestoreUrl() {
  // This already includes #m=... and is continuously updated while typing.
  return location.href;
}

function getExportBaseName() {
  const title = String(lastVizSettings?.title || "").trim();
  const base = title ? slugId(title) : "theorymaker";
  return base || "theorymaker";
}

function getFormattedLinkHtml() {
  const href = getRawRestoreUrl();
  const text = String(lastVizSettings?.title || "Theorymaker map").replaceAll('"', "&quot;");
  return `<a href="${href.replaceAll('"', "&quot;")}">${text}</a>`;
}

function initVizToolbar() {
  const zoomOutBtn = document.getElementById("tm-zoom-out");
  const zoomInBtn = document.getElementById("tm-zoom-in");
  const zoomResetBtn = document.getElementById("tm-zoom-reset");

  const copyRawUrlBtn = document.getElementById("tm-copy-raw-url");
  const downloadPngBtn = document.getElementById("tm-download-png");
  const copyLinkBtn = document.getElementById("tm-copy-link");
  const downloadHtmlBtn = document.getElementById("tm-download-html");

  // Drag-to-pan (scroll) on the viz container.
  const viz = document.getElementById("tm-viz");
  if (viz) {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    viz.style.cursor = "grab";

    viz.addEventListener("mousedown", (e) => {
      // Left-button drag pans the scroll container.
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      // Reset any prior "ignore next click" guard once a new gesture starts.
      delete viz.dataset.tmIgnoreNextClick;
      viz.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      startX = e.clientX;
      startY = e.clientY;
      startLeft = viz.scrollLeft;
      startTop = viz.scrollTop;
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      // Treat small jitter as a click, not a drag.
      if (!moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) moved = true;
      viz.scrollLeft = startLeft - dx;
      viz.scrollTop = startTop - dy;
    });

    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      viz.style.cursor = "grab";
      document.body.style.userSelect = "";
      // Browsers often fire a click on mouseup after a drag; suppress the next click handler.
      if (moved) viz.dataset.tmIgnoreNextClick = "1";
    });
  }

  zoomOutBtn?.addEventListener("click", () => {
    vizHasUserZoomed = true;
    setVizScale(vizScale / 1.2);
  });
  zoomInBtn?.addEventListener("click", () => {
    vizHasUserZoomed = true;
    setVizScale(vizScale * 1.2);
  });
  zoomResetBtn?.addEventListener("click", () => {
    vizHasUserZoomed = false;
    fitVizToContainerWidth();
    setVizStatus("Fit to width");
  });

  copyRawUrlBtn?.addEventListener("click", async () => {
    try {
      await copyTextToClipboard(getRawRestoreUrl());
      setVizStatus("Raw URL copied");
    } catch (e) {
      setVizStatus(`Copy failed: ${e?.message || String(e)}`);
    }
  });

  copyLinkBtn?.addEventListener("click", async () => {
    try {
      const html = getFormattedLinkHtml();
      const text = getRawRestoreUrl();
      await copyRichToClipboard({ html, text });
      setVizStatus("Link copied");
    } catch (e) {
      setVizStatus(`Copy failed: ${e?.message || String(e)}`);
    }
  });

  downloadPngBtn?.addEventListener("click", async () => {
    const svg = getVizSvgEl();
    if (!svg) return setVizStatus("Nothing to export");

    try {
      setVizStatus("Copying PNG…");
      const png = await svgToPngBlob(svg, { scale: 3 });
      await copyRichToClipboard({ pngBlob: png, text: getRawRestoreUrl() });
      setVizStatus("PNG copied");
    } catch (e) {
      setVizStatus(`Export failed: ${e?.message || String(e)}`);
    }
  });

  downloadHtmlBtn?.addEventListener("click", async () => {
    const svg = getVizSvgEl();
    if (!svg) return setVizStatus("Nothing to export");

    try {
      setVizStatus("Copying HTML…");
      const png = await svgToPngBlob(svg, { scale: 3 });
      const dataUrl = await blobToDataUrl(png);
      const linkHtml = getFormattedLinkHtml();
      const title = String(lastVizSettings?.title || "Theorymaker map").trim() || "Theorymaker map";

      // Clipboard HTML: keep it fragment-ish so paste targets treat it as rich content.
      const safeTitle = title.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      const html = `<div>
  <div style="font-family: Arial, sans-serif; font-size: 12pt;">
    <div style="font-weight: 600; margin: 0 0 8px 0;">${safeTitle}</div>
    <div><img alt="${safeTitle.replaceAll('"', "&quot;")}" src="${dataUrl}" /></div>
    <div style="margin-top: 10px;">${linkHtml}</div>
  </div>
</div>`;

      const text = `${title}\n${getRawRestoreUrl()}`;
      await copyRichToClipboard({ html, text, pngBlob: png });
      setVizStatus("HTML copied");
    } catch (e) {
      setVizStatus(`Export failed: ${e?.message || String(e)}`);
    }
  });

  const shareBlueskyBtn = document.getElementById("tm-share-bluesky");
  const shareTwitterBtn = document.getElementById("tm-share-twitter");

  shareBlueskyBtn?.addEventListener("click", async () => {
    const svg = getVizSvgEl();
    if (!svg) return setVizStatus("Nothing to share");

    try {
      // Copy HTML package to clipboard first
      setVizStatus("Copying…");
      const png = await svgToPngBlob(svg, { scale: 3 });
      const dataUrl = await blobToDataUrl(png);
      const linkHtml = getFormattedLinkHtml();
      const title = String(lastVizSettings?.title || "Theorymaker map").trim() || "Theorymaker map";
      const safeTitle = title.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      const html = `<div>
  <div style="font-family: Arial, sans-serif; font-size: 12pt;">
    <div style="font-weight: 600; margin: 0 0 8px 0;">${safeTitle}</div>
    <div><img alt="${safeTitle.replaceAll('"', "&quot;")}" src="${dataUrl}" /></div>
    <div style="margin-top: 10px;">${linkHtml}</div>
  </div>
</div>`;
      const text = `${title}\n${getRawRestoreUrl()}`;
      await copyRichToClipboard({ html, text, pngBlob: png });

      // Open Bluesky composer
      const composeText = encodeURIComponent(text);
      window.open(`https://bsky.app/intent/compose?text=${composeText}`, "_blank");
      setVizStatus("Copied - paste into Bluesky");
    } catch (e) {
      setVizStatus(`Share failed: ${e?.message || String(e)}`);
    }
  });

  shareTwitterBtn?.addEventListener("click", async () => {
    const svg = getVizSvgEl();
    if (!svg) return setVizStatus("Nothing to share");

    try {
      // Copy HTML package to clipboard first
      setVizStatus("Copying…");
      const png = await svgToPngBlob(svg, { scale: 3 });
      const dataUrl = await blobToDataUrl(png);
      const linkHtml = getFormattedLinkHtml();
      const title = String(lastVizSettings?.title || "Theorymaker map").trim() || "Theorymaker map";
      const safeTitle = title.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      const html = `<div>
  <div style="font-family: Arial, sans-serif; font-size: 12pt;">
    <div style="font-weight: 600; margin: 0 0 8px 0;">${safeTitle}</div>
    <div><img alt="${safeTitle.replaceAll('"', "&quot;")}" src="${dataUrl}" /></div>
    <div style="margin-top: 10px;">${linkHtml}</div>
  </div>
</div>`;
      const text = `${title}\n${getRawRestoreUrl()}`;
      await copyRichToClipboard({ html, text, pngBlob: png });

      // Open Twitter composer
      const composeText = encodeURIComponent(text);
      window.open(`https://twitter.com/intent/tweet?text=${composeText}`, "_blank");
      setVizStatus("Copied - paste into Twitter");
    } catch (e) {
      setVizStatus(`Share failed: ${e?.message || String(e)}`);
    }
  });
}

function initTooltips() {
  // Enable Bootstrap tooltips for icon buttons.
  const bootstrap = globalThis.bootstrap;
  if (!bootstrap?.Tooltip) return;
  document
    .querySelectorAll('[data-bs-toggle="tooltip"]')
    .forEach((el) => new bootstrap.Tooltip(el, { trigger: "hover focus" }));
}

// -----------------------------
// Intro.js guided tour (on load + rerun from navbar)
// -----------------------------

const TM_INTRO_TOUR_HIDE_KEY = "tm_intro_tour_hide_v1";

function isElementVisible(el) {
  // Purpose: include only elements that are actually visible (not hidden/collapsed) when the tour starts.
  if (!el) return false;
  const cs = globalThis.getComputedStyle ? getComputedStyle(el) : null;
  if (!cs) return false;
  if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
  const r = el.getBoundingClientRect?.();
  if (!r) return false;
  return r.width > 0 && r.height > 0;
}

function startIntroTour({ force = false } = {}) {
  // Purpose: start the tour (auto on first load; manual via navbar always works).
  const introJsFactory = globalThis.introJs;
  if (typeof introJsFactory !== "function") return;

  if (!force && localStorage.getItem(TM_INTRO_TOUR_HIDE_KEY) === "1") return;

  const stepsAll = [
    {
      // Centered welcome step
      intro: `
        <div class="fw-semibold mb-1">Welcome to theorymaker</div>
        <div class="text-muted small">
          Create and update simple or complex diagrams using text or AI.
        </div>
        <div class="text-muted small">
          Great for Theory of Change diagrams.
        </div>
        <ul class="mt-3 mb-0 ps-3">
          <li>🆓 Free</li>
          <li>📝 Use a simple text “language” to quickly create and style complex diagrams</li>
          <li>🤖 And/or get help from AI</li>
          <li>⚡ Updates in real time as you type</li>
          <li>🔗 Share via a URL</li>
        </ul>
      `.trim(),
    },
    {
      element: "#tm-left",
      intro: "Left side: chat with the AI and/or write text in the editor to define your diagram.",
      position: "right",
    },
    {
      element: "#tm-chat-input",
      intro: "Tell the AI what you want, or use the manual editor below.",
      position: "right",
    },
    {
      element: "#tm-chat-send",
      intro: "Send your message to the AI. (Enter to send; Shift+Enter for a newline.)",
      position: "right",
    },
    {
      element: ".tm-editor-details-summary",
      intro: "Manual editor: click here to open the text editor.",
      position: "right",
    },
    {
      element: ".tm-tab.active",
      intro: "These tabs switch between the diagram, templates, and help.",
      position: "bottom",
    },
    {
      element: "#tm-viz",
      intro: "Your diagram renders here. You can click on nodes and links to edit them or apply styles.",
      position: "left",
    },
    {
      element: ".tm-viz-toolbar",
      intro: "Diagram toolbar: zoom, save, export, share, and style.",
      position: "bottom",
    },
    {
      element: '.tm-tab[data-tab="templates"]',
      intro: "Templates: load any diagrams you saved in this browser or pick an example to start from.",
      position: "bottom",
    },
    {
      element: '.tm-tab[data-tab="help"]',
      intro: "Help: usage notes and a quick reference on how to use text to create your diagram.",
      position: "bottom",
    },
    {
      element: "#tm-undo",
      intro: "Undo/redo: steps through edit history (back/forward).",
      position: "bottom",
    },
    {
      element: "#tm-tour",
      intro: "Rerun this tour any time from here.",
      position: "bottom",
    },
  ];

  // Only keep steps that target elements currently visible (startup-visible elements only)
  const steps = stepsAll.filter((s) => {
    if (!s?.element) return true; // welcome step
    const el = document.querySelector(s.element);
    return isElementVisible(el);
  });

  const intro = introJsFactory();
  intro.setOptions({
    steps,
    tooltipClass: "tm-intro-tooltip",
    showProgress: true,
    showBullets: false,
    keyboardNavigation: true, // arrow keys
    exitOnOverlayClick: true, // click outside to dismiss
    nextLabel: "Next",
    prevLabel: "Back",
    skipLabel: "×",
    doneLabel: "Done",
  });

  function syncDontShowFooter() {
    // Purpose: keep "Don't show again" in the footer (button bar) on the first step only.
    const cur = Number(intro?._currentStep);
    const buttons = document.querySelector(".tm-intro-tooltip .introjs-tooltipbuttons");
    if (!buttons) return;

    const existing = buttons.querySelector("#tm-intro-footer");
    if (cur !== 0) {
      existing?.remove();
      return;
    }

    if (existing) return;
    const footer = document.createElement("div");
    footer.id = "tm-intro-footer";
    footer.className = "tm-intro-footer form-check m-0";
    footer.innerHTML = `
      <input class="form-check-input" type="checkbox" id="tm-intro-dontshow" />
      <label class="form-check-label small" for="tm-intro-dontshow">Don’t show again</label>
    `.trim();
    buttons.prepend(footer);
  }

  function persistDontShowAgain() {
    const cb = document.getElementById("tm-intro-dontshow");
    if (cb && cb.checked) {
      localStorage.setItem(TM_INTRO_TOUR_HIDE_KEY, "1");
    }
  }

  intro.onafterchange(syncDontShowFooter);
  intro.onexit(persistDontShowAgain);
  intro.oncomplete(persistDontShowAgain);
  
  // Add immediate checkbox change handler
  intro.onafterchange(() => {
    syncDontShowFooter();
    const cb = document.getElementById("tm-intro-dontshow");
    if (cb && !cb.dataset.listenerAttached) {
      cb.addEventListener("change", () => {
        if (cb.checked) {
          localStorage.setItem(TM_INTRO_TOUR_HIDE_KEY, "1");
        }
      });
      cb.dataset.listenerAttached = "true";
    }
  });
  
  intro.start();
}

async function renderNow(graphviz, editor) {
  const dsl = editor.getValue();
  const { dot, errors, settings } = dslToDot(dsl);
  showErrors(errors);
  applyVizCssSettings(document.getElementById("tm-viz"), settings);
  lastVizSettings = settings;

  try {
    const svg = await graphviz.layout(dot, "svg", "dot");
    // Keep any overlay UI (eg hover delete button) across rerenders.
    const viz = document.getElementById("tm-viz");
    const hoverDeleteBtn = document.getElementById("tm-viz-hover-delete"); // may be null on first render
    const hoverSourceBtn = document.getElementById("tm-viz-hover-source"); // may be null on first render
    const hoverCheckbox = document.getElementById("tm-viz-hover-checkbox"); // may be null on first render
    if (viz) viz.innerHTML = svg;
    if (viz && hoverDeleteBtn) viz.appendChild(hoverDeleteBtn);
    if (viz && hoverSourceBtn) viz.appendChild(hoverSourceBtn);
    if (viz && hoverCheckbox) viz.appendChild(hoverCheckbox);
    // Re-apply "source glow" after rerender if the user is mid link-creation.
    const pendingSourceId = String(viz?.dataset?.tmPendingSourceId || "").trim();
    if (pendingSourceId && viz) {
      const getTitle = (g) => String(g?.querySelector?.("title")?.textContent || "").trim();
      for (const g of viz.querySelectorAll("svg g.node")) {
        if (getTitle(g) === pendingSourceId) {
          g.classList.add("tm-viz-source");
          break;
        }
      }
    }
    // Re-apply multi-select visuals after rerender
    if (window.vizInteractivityApi?.applyMultiSelectVisuals) {
      window.vizInteractivityApi.applyMultiSelectVisuals();
    }
    // Default behavior: fill the panel width until user zooms manually.
    if (!vizHasUserZoomed) fitVizToContainerWidth();
    else applyVizScale(); // keep zoom consistent across rerenders
    enhanceEdgeHitTargets(); // easier clicking on links
    repositionEdgeLabels(); // position labels on the edge path
  } catch (e) {
    showErrors([...(errors || []), `Graphviz error: ${e?.message || String(e)}`]);
    document.getElementById("tm-viz").innerHTML = "";
  }
}

// -----------------------------
// Chat UI
// -----------------------------

function initChatUi({ editor, graphviz }) {
  // NOTE: API key is stored server-side in Netlify Functions environment variables.

  const input = document.getElementById("tm-chat-input");
  const btnSend = document.getElementById("tm-chat-send");
  const btnClear = document.getElementById("tm-chat-clear");
  const btnStop = document.getElementById("tm-chat-stop");
  const sendLabel = document.getElementById("tm-chat-send-label");
  const sendSpinner = document.getElementById("tm-chat-send-spinner");
  const historyEl = document.getElementById("tm-chat-history");
  const historyDetails = document.getElementById("tm-chat-history-details");

  const editorDetails = document.getElementById("tm-editor-details");

  if (!input || !btnSend || !btnClear || !btnStop || !historyEl) return;

  // Auto-grow chat input on focus/input, up to a maximum height.
  // Purpose: keep the default compact (1 line) but allow long prompts without manual resizing.
  const CHAT_INPUT_MAX_PX = 200;
  const CHAT_INPUT_FOCUS_MIN_PX = 72; // ~4 lines at current font/line-height
  function updateClearVisibility() {
    // Clear is for the current input text (not history).
    btnClear.classList.toggle("d-none", !String(input.value || "").trim());
  }
  function resizeChatInput(forceFocusMin = false) {
    // Reset first so scrollHeight reflects the natural content height.
    input.style.height = "auto";
    const natural = input.scrollHeight || 0;
    const clamped = Math.min(natural, CHAT_INPUT_MAX_PX);
    const target = forceFocusMin ? Math.max(clamped, CHAT_INPUT_FOCUS_MIN_PX) : clamped;
    input.style.height = `${Math.max(1, target)}px`;
    input.style.overflowY = natural > CHAT_INPUT_MAX_PX ? "auto" : "hidden";
  }

  input.addEventListener("focus", () => {
    resizeChatInput(true);
    updateClearVisibility();
  });
  input.addEventListener("input", () => {
    resizeChatInput(true);
    updateClearVisibility();
  });
  input.addEventListener("blur", () => {
    // Collapse back to 1 line if empty; otherwise keep a sane size.
    if (!String(input.value || "").trim()) {
      input.style.height = "";
      input.style.overflowY = "hidden";
      updateClearVisibility();
      return;
    }
    resizeChatInput(false);
    updateClearVisibility();
  });

  // Briefly open history when the AI posts a comment (so you notice it) if it's currently closed.
  let historyAutoOpened = false;
  let historyAutoCloseTimer = null;
  let suppressNextHistoryToggle = false;
  function brieflyRevealHistory() {
    if (!historyDetails) return;
    if (historyDetails.open) return;
    historyAutoOpened = true;
    suppressNextHistoryToggle = true; // opening programmatically triggers 'toggle'
    historyDetails.open = true;
    if (historyAutoCloseTimer) clearTimeout(historyAutoCloseTimer);
    historyAutoCloseTimer = setTimeout(() => {
      if (!historyDetails.open) return;
      if (!historyAutoOpened) return; // user interacted; don't fight them
      suppressNextHistoryToggle = true; // closing programmatically triggers 'toggle'
      historyDetails.open = false;
      historyAutoOpened = false;
    }, 2500);
  }
  if (historyDetails) {
    historyDetails.addEventListener("toggle", () => {
      if (suppressNextHistoryToggle) {
        suppressNextHistoryToggle = false;
        return;
      }
      // If the user toggles it, cancel any pending auto-close.
      historyAutoOpened = false;
      if (historyAutoCloseTimer) clearTimeout(historyAutoCloseTimer);
      historyAutoCloseTimer = null;
    });
  }

  const messages = [];
  let conversationId = "";
  let activeChatAbortController = null; // AbortController for the current request (for Stop button)

  function renderHistory() {
    historyEl.innerHTML = "";
    
    // Show/hide the entire history details element based on whether there are messages
    if (messages.length === 0) {
      historyDetails.classList.add("d-none");
      return;
    } else {
      historyDetails.classList.remove("d-none");
    }
    
    for (const m of messages) {
      const div = document.createElement("div");
      div.className = `tm-chat-msg ${m.role === "user" ? "tm-chat-msg-user" : "tm-chat-msg-assistant"}`;
      div.textContent = m.text;
      historyEl.appendChild(div);
    }
    historyEl.scrollTop = historyEl.scrollHeight;
  }

  function push(role, text) {
    const t = String(text || "").trim();
    if (!t) return;
    messages.push({ role, text: t });
    renderHistory();
  }

  function getOrCreateStableId(key) {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `tm_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(key, id);
    return id;
  }

  function extractJsonFromAnswer(answerText) {
    // Dify returns the model response as plain text; we expect strict JSON per your app instruction.
    const raw = String(answerText || "").trim();
    if (!raw) return null;

    // Common case: the model wraps JSON in a fenced code block.
    if (raw.startsWith("```")) {
      const lines = raw.split(/\r?\n/);
      // Drop first fence line, drop last fence line if present.
      const inner = lines.slice(1, lines[lines.length - 1].startsWith("```") ? -1 : undefined).join("\n").trim();
      return inner || null;
    }
    return raw;
  }

  async function send() {
    const msg = String(input.value || "").trim();
    if (!msg) return;

    const userId = getOrCreateStableId("tm_dify_user");

    push("user", msg);
    input.value = "";
    resizeChatInput(false);
    updateClearVisibility();

    btnSend.disabled = true;
    btnClear.disabled = true;
    input.disabled = true;
    btnStop.disabled = false;
    btnStop.classList.remove("d-none");
    if (sendLabel) sendLabel.textContent = "Thinking…";
    if (sendSpinner) sendSpinner.classList.remove("d-none");

    try {
      activeChatAbortController = new AbortController();
      const currentDsl = editor.getValue();
      const query = `Current diagram:\n\n${currentDsl}\n\nChat request:\n\n${msg}\n\nReturn ONLY valid JSON with keys: syntax, comments.`;

      // Local dev: call Dify directly with user's key
      const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
      let r;

      if (isLocal) {
        const apiKey = localStorage.getItem("tm_dify_api_key") || prompt("Paste your Dify App API key (local dev only):");
        if (!apiKey) {
          push("assistant", "API key required for local development.");
          return;
        }
        localStorage.setItem("tm_dify_api_key", apiKey);

        r = await fetch("https://api.dify.ai/v1/chat-messages", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          signal: activeChatAbortController.signal,
          body: JSON.stringify({
            inputs: {},
            query,
            response_mode: "blocking",
            conversation_id: conversationId || "",
            user: userId,
          }),
        });
      } else {
        // Production: use Netlify Function
        r = await fetch("/.netlify/functions/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: activeChatAbortController.signal,
          body: JSON.stringify({
            inputs: {},
            query,
            response_mode: "blocking",
            conversation_id: conversationId || "",
            user: userId,
          }),
        });
      }

      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`Chat API error (${r.status}): ${txt || r.statusText}`);
      }

      const data = await r.json();
      conversationId = String(data?.conversation_id || conversationId || "");

      const answer = String(data?.answer || "").trim();
      const jsonText = extractJsonFromAnswer(answer);
      if (!jsonText) throw new Error("Empty answer from AI.");

      const obj = JSON.parse(jsonText);
      const nextSyntax = String(obj?.syntax || "").trim();
      const comments = String(obj?.comments || "").trim();
      if (!nextSyntax) throw new Error("Returned JSON is missing `syntax`.");

      // Apply returned syntax directly to the editor (editor is the source of truth).
      editor.setValue(nextSyntax, -1);
      setMapScriptInUrl(editor.getValue());
      await renderNow(graphviz, editor);

      if (comments) {
        push("assistant", comments);
        brieflyRevealHistory();
      } else {
        push("assistant", "Applied update.");
      }
    } catch (e) {
      // If the user clicks Stop, fetch() throws an AbortError.
      if (e?.name === "AbortError") push("assistant", "Stopped.");
      else push("assistant", `Error: ${e?.message || String(e)}`);
    } finally {
      activeChatAbortController = null;
      btnSend.disabled = false;
      btnClear.disabled = false;
      input.disabled = false;
      btnStop.classList.add("d-none");
      if (sendLabel) sendLabel.textContent = "Send";
      if (sendSpinner) sendSpinner.classList.add("d-none");
    }
  }

  btnSend.addEventListener("click", send);
  btnStop.addEventListener("click", () => {
    if (!activeChatAbortController) return;
    btnStop.disabled = true; // prevent double-click spam while abort resolves
    activeChatAbortController.abort();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    // Plain Enter sends. Shift+Enter / Ctrl+Enter should insert a newline (do NOT send).
    if (e.shiftKey || e.ctrlKey) return;
    e.preventDefault(); // prevent newline
    send();
  });

  btnClear.addEventListener("click", () => {
    input.value = "";
    resizeChatInput(false);
    updateClearVisibility();
    input.focus();
  });

  // Ensure correct initial button state.
  updateClearVisibility();

  // When the editor is hidden behind a chevron, Ace needs a resize when revealed.
  if (editorDetails) {
    editorDetails.addEventListener("toggle", () => {
      if (!editorDetails.open) return;
      // Let layout settle, then resize Ace.
      requestAnimationFrame(() => editor.resize());
      setTimeout(() => editor.resize(), 60);
    });
  }

}

async function main() {
  initTabs();
  initSplitter();
  initVizToolbar();
  initTooltips();
  setActiveTab("viz");

  // Keep "fit to width" correct if the window size changes (only while in default fit mode).
  window.addEventListener("resize", () => {
    if (!vizHasUserZoomed) fitVizToContainerWidth();
  });

  // Help panel (shared with standalone /help page)
  await initHelpFromMarkdown({ mdUrl: "./help.md", defaultTab: "intro", isStandalone: false, helpPathPrefix: "/help" });

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
  editor.renderer.setPadding(12); // add some breathing room around the text inside the editor

  // Editor auto-grow: on focus (and while editing), expand Ace's height to fit its content
  // like an auto-growing textarea. (No other UI elements change on focus.)
  function resizeAceToContents() {
    const lines = Math.max(1, editor.session.getLength());
    const lh = editor.renderer.lineHeight || 16;
    const pad = 24; // small breathing room
    const contentPx = lines * lh + pad;

    // Cap to (nearly) the viewport height so the editor never disappears off-screen.
    // When content exceeds the cap, Ace will show its own scrollbars automatically.
    const top = editor.container.getBoundingClientRect().top || 0;
    const maxPx = Math.max(220, Math.floor(window.innerHeight - top - 24)); // keep a small bottom gap
    const px = Math.min(contentPx, maxPx);

    editor.container.style.height = `${px}px`;
    editor.resize();
  }
  editor.on("focus", resizeAceToContents);
  editor.on("change", resizeAceToContents);
  window.addEventListener("resize", resizeAceToContents);

  // Restore editor from URL if present, otherwise seed a starter example.
  const fromUrl = getMapScriptFromUrl();
  const isMobile = Boolean(globalThis.matchMedia?.("(max-width: 991.98px)")?.matches);
  const suppressAutoTour = isMobile && !fromUrl; // per request: on mobile with empty URL, don't auto-run Intro.js
  // Default starter (when no URL): use the "Trade-offs" example from the gallery.
  const starter = (GALLERY_EXAMPLES.find((it) => it.id === "ex-07") || GALLERY_EXAMPLES[0]).dsl;

  editor.setValue(fromUrl ?? starter, -1);

  // Legacy support: if URL contains #s=... (JSON styles), import into editor and then drop #s.
  const legacyFromUrlStyles = getStyleSettingsFromUrl();
  if (legacyFromUrlStyles && !editorHasStyleLines(editor.getValue())) {
    upsertEditorStyleBlockFromUiStyleSettings(editor, coerceUiStyleSettings(legacyFromUrlStyles));
  }
  if (legacyFromUrlStyles) clearStyleSettingsFromUrl();
  // Ensure URL always reflects the editor content.
  setMapScriptInUrl(editor.getValue());

  // Mobile: single-screen mode via hamburger menu (do this early so first paint is the Diagram screen)
  initMobileScreens({ editor });

  // Graphviz WASM init
  const graphviz = await Graphviz.load();

  // Chat UI (left panel)
  initChatUi({ editor, graphviz });

  // Browser history + Undo/Redo buttons
  initHistoryNav({ editor, graphviz });

  // Style modal (writes to URL + re-renders)
  initStyleModal({ editor, graphviz });

  // Title-only modal (opened when clicking the title in the diagram)
  const openTitleModal = initTitleModal({ editor, graphviz });

  // Editor: style the current node/link line (writes styles inline into that line)
  initAceLineStylePopover({ editor, graphviz });

  // Templates
  const refreshTemplates = initTemplates(editor, graphviz);

  // Templates: rebuild saved thumbnails on demand
  const btnRebuildThumbs = document.getElementById("tm-templates-rebuild-thumbs");
  if (btnRebuildThumbs) {
    if (!IS_ADMIN) {
      // Non-admins shouldn't see or use this (it can churn CPU + touch lots of LocalStorage).
      btnRebuildThumbs.classList.add("d-none");
    } else {
      btnRebuildThumbs.addEventListener("click", async () => {
        const ok = confirm("Rebuild thumbnails for all saved maps in this browser? This may take a few seconds.");
        if (!ok) return;
        await rebuildSavedThumbnails({ editor, graphviz, refreshTemplates });
      });
    }
  }

  // Editor: Save to localStorage (with optional screenshot)
  const btnSave = document.getElementById("tm-editor-save");
  if (btnSave) {
    const bs = globalThis.bootstrap;
    const saveModalEl = document.getElementById("tm-save-modal");
    const btnSaveLocal = document.getElementById("tm-save-local");
    const btnSaveExample = document.getElementById("tm-save-example");
    const snippetTa = document.getElementById("tm-save-snippet");
    const snippetHint = document.getElementById("tm-save-snippet-hint");
    const saveModal = saveModalEl && bs?.Modal ? new bs.Modal(saveModalEl) : null;

    async function saveToLocalStorageFlow() {
      const rawName = prompt("Save map as (name):", "");
      if (rawName == null) return; // cancelled
      const name = String(rawName || "").trim();
      if (!name) return;

      const key = makeSavedMapKey(name);
      if (!key || key === TM_SAVED_KEY_PREFIX) return;

      if (localStorage.getItem(key)) {
        const ok = confirm(`Overwrite existing saved map "${name}"?`);
        if (!ok) return;
      }

      // Ensure viz is up-to-date before capturing a thumbnail.
      await renderNow(graphviz, editor);

      const dsl = editor.getValue();
      const screenshotDataUrl = await captureVizPngDataUrl({ scale: 2 });

      try {
        saveMapToLocalStorage({ key, name, dsl, screenshotDataUrl });
      } catch (e) {
        // If the screenshot makes it too big for localStorage, retry without it.
        if (screenshotDataUrl) {
          try {
            saveMapToLocalStorage({ key, name, dsl, screenshotDataUrl: null });
            alert("Saved (without screenshot). The screenshot was too large for LocalStorage.");
          } catch {
            alert(`Save failed: ${e?.message || String(e)}`);
            return;
          }
        } else {
          alert(`Save failed: ${e?.message || String(e)}`);
          return;
        }
      }

      // Refresh templates so the saved map appears immediately.
      if (typeof refreshTemplates === "function") refreshTemplates();
    }

    // Admin-only: modal with a separate click target for the file picker (required by browsers).
    if (IS_ADMIN && btnSaveExample) btnSaveExample.classList.remove("d-none");

    btnSave.addEventListener("click", () => {
      if (IS_ADMIN && saveModal) saveModal.show();
      else saveToLocalStorageFlow();
    });

    btnSaveLocal?.addEventListener("click", () => {
      saveModal?.hide();
      saveToLocalStorageFlow();
    });

    btnSaveExample?.addEventListener("click", (e) => {
      e.preventDefault();
      if (snippetTa) snippetTa.classList.add("d-none");
      if (snippetHint) snippetHint.classList.add("d-none");

      const rawTitle = prompt("Example title:", "");
      if (rawTitle == null) return;
      const title = String(rawTitle || "").trim();
      if (!title) return;

      const desc = String(prompt("Example description (short):", "") || "").trim();
      const dsl = editor.getValue();
      const id = nextExampleIdFromCurrentExamples();
      const snippet = buildStandardExampleSnippet({ id, title, desc, dsl });

      // Show snippet in the modal for visibility + manual copy.
      if (snippetTa) {
        snippetTa.value = snippet;
        snippetTa.classList.remove("d-none");
      }
      if (snippetHint) snippetHint.classList.remove("d-none");

      // Best-effort clipboard copy (still allows manual copy if blocked).
      globalThis.navigator?.clipboard
        ?.writeText?.(snippet)
        ?.catch(() => {
          // ignore (manual copy via textarea)
        });
    });
  }

  // Viz interactivity (click-to-edit)
  const vizInteractivityApi = initVizInteractivity(editor, graphviz, { openTitleModal });
  window.vizInteractivityApi = vizInteractivityApi;

  // Light “autocorrect/validate then render” on idle typing (kept minimal)
  editor.session.on("change", () => {
    if (suppressHistorySync) return;

    // First change in a burst: create a new history entry. Subsequent changes update that entry.
    if (!historyBurstActive) {
      historyBurstActive = true;
      pushMapScriptInUrl(editor.getValue());
    }
    if (historyBurstTimer) clearTimeout(historyBurstTimer);
    historyBurstTimer = setTimeout(() => {
      const text = editor.getValue();
      setMapScriptInUrl(text);
      renderNow(graphviz, editor);
      historyBurstActive = false; // next change starts a new history entry
    }, 350);
  });

  // Initial render
  setMapScriptInUrl(editor.getValue());
  await renderNow(graphviz, editor);

  // Guided tour: auto-run on first load; rerunnable via navbar button
  document.getElementById("tm-tour")?.addEventListener("click", () => startIntroTour({ force: true }));
  if (!suppressAutoTour) startIntroTour({ force: false });
}

main();


