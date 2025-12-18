// Theorymaker: minimal no-build app (Netlify static)
// - Ace editor on the left
// - DSL → validate/autocorrect → DOT
// - DOT → SVG via Graphviz WebAssembly (@hpcc-js/wasm)

import { Graphviz } from "https://cdn.jsdelivr.net/npm/@hpcc-js/wasm@2.20.0/dist/graphviz.js";
import { GALLERY_EXAMPLES } from "./examples.js";

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
// Ace helpers: colour picker that inserts rgb(...) (MapScript treats '#' as comments)
// -----------------------------

function hexToRgbCss(hex) {
  // Convert "#RRGGBB" to "rgb(r,g,b)" (keeps MapScript '#' comment rule intact).
  const h = String(hex || "").trim();
  const m = h.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgb(${r}, ${g}, ${b})`;
}

function findColourTokenInLine(line, col) {
  // Find a colour token spanning the cursor column. Supported tokens:
  // - rgb(...)
  // - simple CSS colour names (letters + hyphen)
  const s = String(line || "");
  const c = Math.max(0, Math.min(Number(col) || 0, s.length));

  const tokens = [];
  const reRgb = /rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)/gi;
  const reName = /\b[a-z][a-z-]*\b/gi;

  for (const re of [reRgb, reName]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      tokens.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    }
  }

  // Prefer the smallest token that contains the cursor.
  const hits = tokens.filter((t) => t.start <= c && c <= t.end);
  if (!hits.length) return null;
  hits.sort((a, b) => (a.end - a.start) - (b.end - b.start));
  return hits[0];
}

function initAceColourPicker(editor) {
  const btn = document.getElementById("tm-editor-color");
  const pop = document.getElementById("tm-ace-color-popover");
  const input = document.getElementById("tm-ace-color-input");
  const apply = document.getElementById("tm-ace-color-apply");
  const close = document.getElementById("tm-ace-color-close");
  if (!btn || !pop || !input || !apply || !close) return;

  // Keep the widget disabled unless the cursor is currently inside a valid colour token.
  // While it is valid, keep the button showing the colour (swatch) and flash on every cursor move.
  const DEFAULT_BTN_LABEL = (btn.textContent || "Colour").trim() || "Colour";

  function hide() {
    pop.classList.add("d-none");
  }

  function clearButtonSwatch() {
    btn.style.backgroundColor = "";
    btn.style.borderColor = "";
    btn.style.color = "";
  }

  function setButtonSwatch(rgb, hex) {
    // Show a filled swatch on the button until cursor leaves.
    btn.style.backgroundColor = hex;
    btn.style.borderColor = hex;
    // Simple contrast heuristic so text stays readable.
    const lum = (rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114) / 255;
    btn.style.color = lum > 0.62 ? "#111" : "#fff";
  }

  function getActiveColourAtCursor() {
    const pos = editor.getCursorPosition(); // { row, column }
    const line = editor.session.getLine(pos.row);
    const tok = findColourTokenInLine(line, pos.column);
    if (!tok) return null;

    const rgb = resolveCssColorToRgb(tok.text);
    if (!rgb) return null;

    return {
      row: pos.row,
      start: tok.start,
      end: tok.end,
      text: tok.text,
      rgb,
      hex: rgbToHex(rgb),
    };
  }

  function flashButtonOnce() {
    btn.classList.remove("tm-flash");
    // Trigger reflow so removing+adding replays the animation.
    void btn.offsetWidth;
    btn.classList.add("tm-flash");
  }

  function syncUiToCursorColour() {
    const active = getActiveColourAtCursor();

    btn.disabled = !active;
    btn.textContent = active ? "Edit Colour" : DEFAULT_BTN_LABEL;
    btn.title = active ? "Pick colour (cursor is on a colour)" : "Move cursor onto a colour token to enable";

    if (!active) {
      clearButtonSwatch();
      hide();
      return;
    }

    // Keep the colour input synced even before opening the popover.
    input.value = active.hex;

    // Flash on every cursor move while we're in a valid colour token.
    flashButtonOnce();

    setButtonSwatch(active.rgb, active.hex);
  }

  function showAtCursor() {
    const pos = editor.getCursorPosition(); // { row, column }
    const xy = editor.renderer.textToScreenCoordinates(pos.row, pos.column);
    pop.style.left = `${Math.round(xy.pageX + 10)}px`;
    pop.style.top = `${Math.round(xy.pageY + 18)}px`;
    pop.classList.remove("d-none");
    input.focus();
  }

  function applyToEditor() {
    const rgb = hexToRgbCss(input.value);
    if (!rgb) return;

    const pos = editor.getCursorPosition();
    const line = editor.session.getLine(pos.row);
    const tok = findColourTokenInLine(line, pos.column);
    if (!tok) return;

    // Only allow replacement when we're on a *valid* colour token (keeps widget behaviour consistent with disabling).
    if (!resolveCssColorToRgb(tok.text)) return;

    const Range = ace.require("ace/range").Range;
    editor.session.replace(new Range(pos.row, tok.start, pos.row, tok.end), rgb);
    editor.focus();
    hide();
  }

  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    syncUiToCursorColour();
    showAtCursor();
  });

  apply.addEventListener("click", () => {
    applyToEditor();
  });

  close.addEventListener("click", () => hide());

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

  // Enable/disable + sync as the user moves the cursor.
  editor.selection.on("changeCursor", syncUiToCursorColour);
  syncUiToCursorColour(); // initial state
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

// -----------------------------
// Gallery: examples + (optional) saved local maps
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
  // Saved maps are optional; gallery shows them if present.
  // Expected value: JSON { name, dsl, savedAt, screenshotDataUrl? }
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
  // Capture the current Graphviz SVG as a PNG data URL (for gallery thumbnails).
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
  // Stored format is read by Gallery (see listSavedMapsFromLocalStorage()).
  const payload = {
    name,
    dsl,
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

  const supportedSettingKeys = new Set([
    "title",
    "background",
    "default box colour",
    "default box color",
    "default box shape",
    "default box border",
    "default link colour",
    "default link color",
    "default link style",
    "default link width",
    "default box shadow",
    "box shadow",
    "direction",
    "label wrap",
    "rank gap",
    "node gap",
  ]);

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
      return supportedSettingKeys.has(key);
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

function buildStyleOnlyMapScript(exampleDsl, currentDsl) {
  const ex = splitMapScriptStylesAndContents(exampleDsl);
  const cur = splitMapScriptStylesAndContents(currentDsl);

  const styles = (ex.styles || "").trimEnd();
  const contents = (cur.contents || "").trimStart();

  if (!styles) return currentDsl;
  if (!contents) return styles;
  return `${styles}\n\n${contents}`;
}

function initGallery(editor, graphviz) {
  const examplesWrap = document.getElementById("tm-gallery-examples");
  const savedWrap = document.getElementById("tm-gallery-saved");
  const savedEmpty = document.getElementById("tm-gallery-saved-empty");
  if (!examplesWrap) return null;

  const modalEl = document.getElementById("tm-gallery-modal");
  const modalTitle = document.getElementById("tm-gallery-modal-title");
  const modalDesc = document.getElementById("tm-gallery-modal-desc");
  const btnApplyAll = document.getElementById("tm-gallery-apply-all");
  const btnApplyStyles = document.getElementById("tm-gallery-apply-styles");

  const bs = globalThis.bootstrap;
  const modal = modalEl && bs?.Modal ? new bs.Modal(modalEl) : null;

  let selectedItem = null;

  function cardHtml(item, { isSaved }) {
    const badge = isSaved ? `<span class="badge text-bg-secondary ms-2">saved</span>` : "";
    const thumbUrl = isSaved ? item.screenshotDataUrl : EXAMPLE_THUMB_CACHE.get(item.id);
    const thumb = thumbUrl
      ? `<img class="tm-gallery-thumb" src="${thumbUrl}" alt="" />`
      : `<div class="tm-gallery-thumb-placeholder" aria-hidden="true"></div>`;

    const deleteActions = isSaved
      ? `
          <div class="tm-gallery-actions">
            <button
              type="button"
              class="btn btn-sm btn-outline-danger"
              data-gallery-delete="1"
              data-gallery-id="${item.id}"
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
        <div class="card tm-gallery-card h-100" role="button" tabindex="0" data-gallery-id="${item.id}" data-gallery-saved="${isSaved ? "1" : "0"}">
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
      renderGallery();
    }
  }

  function renderGallery() {
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

  function openConfirm(item) {
    selectedItem = item;
    if (modalTitle) modalTitle.textContent = item.title || "Load map";
    if (modalDesc) modalDesc.textContent = item.desc || "";
    if (modal) modal.show();
    else {
      // If bootstrap JS isn't available, do nothing rather than inventing a second modal system.
      // (Bootstrap JS is loaded in index.html.)
    }
  }

  function applySelection(mode) {
    if (!selectedItem) return;
    const current = editor.getValue();
    const next = mode === "styles" ? buildStyleOnlyMapScript(selectedItem.dsl, current) : selectedItem.dsl;
    editor.setValue(next, -1);
    setMapScriptInUrl(editor.getValue());
    renderNow(graphviz, editor);
    if (modal) modal.hide(); // close gallery confirm modal after user choice
    setActiveTab("viz");
  }

  function onCardActivate(el) {
    const id = el.getAttribute("data-gallery-id");
    const isSaved = el.getAttribute("data-gallery-saved") === "1";
    const item = id ? getItemById(id, isSaved) : null;
    if (!item) return;
    openConfirm(item);
  }

  function wireCardEvents(container) {
    container.addEventListener("click", (e) => {
      const delBtn = e.target?.closest?.("[data-gallery-delete='1']");
      if (delBtn) {
        e.preventDefault();
        e.stopPropagation();
        const key = delBtn.getAttribute("data-gallery-id");
        if (!key) return;
        const ok = confirm("Delete this saved map from this browser? This cannot be undone.");
        if (!ok) return;
        localStorage.removeItem(key);
        renderGallery();
        return;
      }

      const card = e.target?.closest?.("[data-gallery-id]");
      if (!card) return;
      onCardActivate(card);
    });
    container.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const card = e.target?.closest?.("[data-gallery-id]");
      if (!card) return;
      e.preventDefault();
      onCardActivate(card);
    });
  }

  wireCardEvents(examplesWrap);
  if (savedWrap) wireCardEvents(savedWrap);

  if (btnApplyAll) btnApplyAll.addEventListener("click", () => applySelection("all"));
  if (btnApplyStyles) btnApplyStyles.addEventListener("click", () => applySelection("styles"));

  renderGallery();
  // Start thumbnail generation after initial paint.
  setTimeout(() => {
    ensureExampleThumbnails();
  }, 0);
  return renderGallery;
}

async function rebuildSavedThumbnails({ editor, graphviz, refreshGallery }) {
  const saved = listSavedMapsFromLocalStorage();
  if (!saved.length) return;

  const current = editor.getValue();
  try {
    setVizStatus(`Rebuilding ${saved.length} thumbnails…`);
    for (let i = 0; i < saved.length; i++) {
      const it = saved[i];
      editor.setValue(it.dsl, -1);
      await renderNow(graphviz, editor);
      const shot = await captureVizPngDataUrl({ scale: 1.5 });
      if (shot) updateSavedMapThumbnailInLocalStorage(it.id, shot);
      setVizStatus(`Rebuilding thumbnails… (${i + 1}/${saved.length})`);
    }
  } finally {
    editor.setValue(current, -1);
    setMapScriptInUrl(editor.getValue());
    await renderNow(graphviz, editor);
    if (typeof refreshGallery === "function") refreshGallery();
    setVizStatus("Thumbnails rebuilt");
  }
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

  return { fillHex, borderUi, rounded };
}

function upsertNodeStyleInner(existingInner, { fillHex, borderText, rounded }) {
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
    kept.push(p);
  }

  const out = [];
  if (fillHex) {
    const rgb = hexToRgb(fillHex);
    if (rgb) out.push(`colour=rgb(${rgb.r},${rgb.g},${rgb.b})`);
  }
  if (borderText) out.push(`border=${borderText}`);
  if (rounded) out.push("shape=rounded");

  // Preserve other attrs after ours
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

function parseLeadingNumber(value) {
  const m = String(value || "").trim().match(/^-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
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
  const settings = {
    title: null,
    background: null,
    defaultBoxColour: null,
    defaultBoxShape: null,
    defaultBoxBorder: null,
    defaultBoxShadow: null,
    defaultLinkColour: null,
    defaultLinkStyle: null,
    defaultLinkWidth: null,
    direction: null,
    labelWrap: null,
    rankGap: null,
    nodeGap: null,
  };

  const nodes = new Map(); // id -> { label, attrs }
  const autoLabelNodes = new Map(); // id -> label (from edges)
  const edges = []; // { fromId, toId, attrs, srcLineNo }
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
      const rest = (clusterMatch[2] || "").trim();
      const depth = dashes.length;

      if (depth % 2 !== 0) {
        errors.push(`Line ${i + 1}: grouping box marker must use an even number of '-' (e.g. -- or ----)`);
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
      else if (key === "background") settings.background = normalizeColor(value);
      else if (key === "default box colour" || key === "default box color") settings.defaultBoxColour = normalizeColor(value);
      else if (key === "default box shape") settings.defaultBoxShape = value.trim().toLowerCase();
      else if (key === "default box border") settings.defaultBoxBorder = value;
      else if (key === "default link colour" || key === "default link color") settings.defaultLinkColour = normalizeColor(value);
      else if (key === "default link style") settings.defaultLinkStyle = value.trim().toLowerCase();
      else if (key === "default link width") settings.defaultLinkWidth = parseLeadingNumber(value);
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

        // Label/border (prefer explicit keys, else keep legacy loose parsing)
        if (labelFromKv) edgeAttrs.label = labelFromKv;
        else if (loose[0]) edgeAttrs.label = loose[0];

        const borderText = borderFromKv || (loose[1] ? String(loose[1]) : "");
        if (borderText) {
          const b = parseBorder(borderText);
          if (b.color) edgeAttrs.color = b.color;
          if (b.penwidth) edgeAttrs.penwidth = b.penwidth;
          if (b.style) addStyle(edgeAttrs, b.style);
        }

        // If only one loose part and it looks like a border, treat it as style instead of label (legacy)
        const onlyLoose = loose.length === 1 ? String(loose[0] || "") : "";
        if (!labelFromKv && !borderFromKv && loose.length === 1 && /\b(px)?\b/i.test(onlyLoose) && /\b(solid|dotted|dashed)\b/i.test(onlyLoose)) {
          delete edgeAttrs.label;
          const b = parseBorder(onlyLoose);
          if (b.color) edgeAttrs.color = b.color;
          if (b.penwidth) edgeAttrs.penwidth = b.penwidth;
          if (b.style) addStyle(edgeAttrs, b.style);
        }

        // Link label styling
        if (labelStyleFromKv) edgeAttrs.fontname = fontNameWithStyle("Arial", labelStyleFromKv);
        const sz = parseLeadingNumber(labelSizeFromKv);
        if (Number.isFinite(sz) && sz > 0) edgeAttrs.fontsize = sz;

        // If only one part and it looks like a border, treat it as style instead of label
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
  dot.push('  node [fontname="Arial", shape="box"];');
  // Edge defaults (links)
  const edgeDefaults = { fontname: "Arial", fontsize: 12 };
  if (settings.defaultLinkColour) edgeDefaults.color = settings.defaultLinkColour;
  if (settings.defaultLinkStyle) {
    const s = String(settings.defaultLinkStyle || "").trim().toLowerCase();
    if (["solid", "dotted", "dashed", "bold"].includes(s)) addStyle(edgeDefaults, s);
  }
  if (Number.isFinite(settings.defaultLinkWidth) && settings.defaultLinkWidth > 0) edgeDefaults.penwidth = Math.round(settings.defaultLinkWidth);
  dot.push(`  edge${toDotAttrs(edgeDefaults)};`);

  if (settings.background) dot.push(`  bgcolor="${settings.background.replaceAll('"', '\\"')}";`);
  if (settings.title) {
    // Title (graph label): slightly larger by default, with a bit of extra space below.
    // Graphviz doesn't have a simple "margin-bottom for title", so we add a trailing newline.
    dot.push(`  label="${settings.title.replaceAll('"', '\\"')}\\n"; labelloc="t"; fontsize="18";`);
  }
  if (settings.direction) dot.push(`  rankdir="${settings.direction}";`);
  // Graphviz ranksep/nodesep are in inches; MapScript values are treated as "px-ish", so scale down.
  if (Number.isFinite(settings.rankGap)) dot.push(`  ranksep="${settings.rankGap * 0.1}";`);
  if (Number.isFinite(settings.nodeGap)) dot.push(`  nodesep="${settings.nodeGap * 0.1}";`);

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

function initVizInteractivity(editor, graphviz) {
  const vizEl = document.getElementById("tm-viz");
  if (!vizEl) return;

  const modalEl = document.getElementById("tm-viz-edit-modal");
  const modalTitle = document.getElementById("tm-viz-edit-modal-title");
  const modalMeta = document.getElementById("tm-viz-edit-meta");
  const modalDisabled = document.getElementById("tm-viz-edit-disabled");
  const nodeFields = document.getElementById("tm-viz-edit-node-fields");
  const edgeFields = document.getElementById("tm-viz-edit-edge-fields");
  const nodeLabelInput = document.getElementById("tm-viz-node-label");
  const nodeFillInput = document.getElementById("tm-viz-node-fill-color");
  const nodeRoundedChk = document.getElementById("tm-viz-node-rounded");
  const nodeBwInput = document.getElementById("tm-viz-node-border-width");
  const nodeBsSel = document.getElementById("tm-viz-node-border-style");
  const nodeBcInput = document.getElementById("tm-viz-node-border-color");

  // Node modal: add-link widgets
  const addDirSel = document.getElementById("tm-viz-add-edge-dir");
  const addOtherSel = document.getElementById("tm-viz-add-edge-other");
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

  const bs = globalThis.bootstrap;
  const modal = modalEl && bs?.Modal ? new bs.Modal(modalEl) : null;

  let selection = null; // { type: "node", nodeId } | { type: "edge", lineNo, fromId, toId }
  let canSave = false;
  let canDelete = false;

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
    selectEl.innerHTML = "";
    const optNew = document.createElement("option");
    optNew.value = "__new__";
    optNew.textContent = "New…";
    selectEl.appendChild(optNew);
    fillNodeSelect(selectEl, nodesById, selectedId);
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
    if (modal) modal.show();
  }

  function refreshFormFromEditor() {
    if (!selection) return;
    const lines = editor.getValue().split(/\r?\n/);

    clearVizSelection();
    setActions({ save: true, del: true, message: "" });

    if (selection.type === "node") {
      if (modalTitle) modalTitle.textContent = "Edit node";
      if (modalMeta) modalMeta.textContent = `Node: ${selection.nodeId}`;
      nodeFields?.classList.remove("d-none");
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

    if (selection.type === "edge") {
      if (modalTitle) modalTitle.textContent = "Edit link";
      if (modalMeta) modalMeta.textContent = `Link: ${selection.fromId} -> ${selection.toId} (line ${selection.lineNo})`;
      edgeFields?.classList.remove("d-none");
      nodeFields?.classList.add("d-none");

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
  }

  function applyEditorLines(lines) {
    editor.setValue(lines.join("\n"), -1);
    setMapScriptInUrl(editor.getValue());
    renderNow(graphviz, editor);
  }

  vizEl.addEventListener("click", (e) => {
    const nodeG = getClosestGraphvizGroup(e.target, "node");
    const edgeG = getClosestGraphvizGroup(e.target, "edge");
    if (!nodeG && !edgeG) return;

    clearVizSelection();
    (nodeG || edgeG)?.classList?.add("tm-viz-selected");

    if (nodeG) {
      const nodeId = getGraphvizTitleText(nodeG);
      if (!nodeId) return;
      selection = { type: "node", nodeId };
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

  btnSave?.addEventListener("click", () => {
    if (!selection || !canSave) return;
    const lines = editor.getValue().split(/\r?\n/);

    if (selection.type === "node") {
      const parsed = parseNodeDefLine(lines, selection.nodeId);
      if (!parsed) return setVizStatus("Edit failed: node must be defined as ID:: ...");

      const fillHex = nodeFillInput?.value || "";
      const border = uiToBorderText({
        width: nodeBwInput?.value ?? 0,
        style: nodeBsSel?.value ?? "solid",
        colorHex: nodeBcInput?.value ?? "#999999",
      });
      const rounded = Boolean(nodeRoundedChk?.checked);

      const styleInner = upsertNodeStyleInner(parsed.styleInner || "", {
        fillHex: fillHex ? fillHex : null,
        borderText: border || "",
        rounded,
      });

      const ok = setNodeDefLine(lines, selection.nodeId, {
        label: nodeLabelInput?.value ?? "",
        styleInner,
      });
      if (!ok) return setVizStatus("Edit failed: node must be defined as ID:: ...");
      applyEditorLines(lines);
      return;
    }

    if (selection.type === "edge") {
      const border = uiToBorderText({
        width: edgeBwInput?.value ?? 0,
        style: edgeBsSel?.value ?? "solid",
        colorHex: edgeBcInput?.value ?? "#999999",
      });
      console.debug("[tm] edge modal save", { lineNo: selection.lineNo, border });

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
      if (!ok) return setVizStatus("Edit failed: can't update this edge (multi-edge line or implicit label)");
      applyEditorLines(lines);
    }
  });

  // Add-link interactions (node modal)
  addOtherSel?.addEventListener("change", () => {
    setNewNodeMode(addOtherSel.value === "__new__");
    setAddEdgeStatus("");
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
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    viz.style.cursor = "grab";

    viz.addEventListener("mousedown", (e) => {
      // Left-button drag pans the scroll container.
      if (e.button !== 0) return;
      dragging = true;
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
      viz.scrollLeft = startLeft - dx;
      viz.scrollTop = startTop - dy;
    });

    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      viz.style.cursor = "grab";
      document.body.style.userSelect = "";
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
}

function initTooltips() {
  // Enable Bootstrap tooltips for icon buttons.
  const bootstrap = globalThis.bootstrap;
  if (!bootstrap?.Tooltip) return;
  document
    .querySelectorAll('[data-bs-toggle="tooltip"]')
    .forEach((el) => new bootstrap.Tooltip(el, { trigger: "hover focus" }));
}

async function renderNow(graphviz, editor) {
  const dsl = editor.getValue();
  const { dot, errors, settings } = dslToDot(dsl);
  showErrors(errors);
  applyVizCssSettings(document.getElementById("tm-viz"), settings);
  lastVizSettings = settings;

  try {
    const svg = await graphviz.layout(dot, "svg", "dot");
    document.getElementById("tm-viz").innerHTML = svg;
    // Default behavior: fill the panel width until user zooms manually.
    if (!vizHasUserZoomed) fitVizToContainerWidth();
    else applyVizScale(); // keep zoom consistent across rerenders
    enhanceEdgeHitTargets(); // easier clicking on links
  } catch (e) {
    showErrors([...(errors || []), `Graphviz error: ${e?.message || String(e)}`]);
    document.getElementById("tm-viz").innerHTML = "";
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

  // Help panel: load from help.md (served by Live Server / Netlify)
  try {
    const r = await fetch("./help.md", { cache: "no-cache" });
    const txt = await r.text();
    const el = document.getElementById("tm-help-md");
    if (el) {
      // Render markdown to HTML (marked is loaded via <script> in index.html)
      const md = globalThis.marked;
      const tabs = ["intro", "usage", "syntax", "quickref", "admin"];
      const sections = { intro: "", usage: "", syntax: "", admin: "" };
      const quickrefEl = document.getElementById("tm-help-quickref");
      const adminTabEl = document.getElementById("tm-help-admin-tab");
      const adminSepEl = document.getElementById("tm-help-admin-sep");

      // Only show the admin subtab when running locally.
      if (adminTabEl) adminTabEl.classList.toggle("d-none", !IS_ADMIN);
      if (adminSepEl) adminSepEl.classList.toggle("d-none", !IS_ADMIN);

      function enhanceHelpCopyButtons(container) {
        // Add a "Copy" button to each <pre> block (for help.md examples + quickref).
        if (!container) return;
        container.querySelectorAll("pre").forEach((pre) => {
          if (pre.dataset.tmCopyEnhanced === "1") return;
          pre.dataset.tmCopyEnhanced = "1";

          const codeEl = pre.querySelector("code");
          const text = (codeEl ? codeEl.textContent : pre.textContent) || "";

          const wrap = document.createElement("div");
          wrap.className = "tm-help-pre-wrap";
          pre.parentNode?.insertBefore(wrap, pre);
          wrap.appendChild(pre);

          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn btn-sm btn-outline-secondary tm-help-copy-btn";
          btn.textContent = "Copy";
          btn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
              await copyTextToClipboard(text);
              btn.textContent = "Copied";
              setTimeout(() => (btn.textContent = "Copy"), 900);
            } catch {
              btn.textContent = "Failed";
              setTimeout(() => (btn.textContent = "Copy"), 900);
            }
          });
          wrap.insertBefore(btn, pre);
        });
      }

      // Split by explicit headings in help.md: "## Intro", "## Usage", "## Syntax", "## Admin"
      const lines = String(txt || "").split(/\r?\n/);
      let current = null;
      for (const line of lines) {
        const m = line.match(/^##\s+(intro|usage|syntax|admin)\s*$/i);
        if (m) {
          current = m[1].toLowerCase();
          continue;
        }
        if (current) sections[current] += `${line}\n`;
      }

      function setHelpTab(name) {
        const tab = tabs.includes(name) ? name : "intro";
        if (tab === "admin" && !IS_ADMIN) return setHelpTab("intro");
        document.querySelectorAll(".tm-help-subtab").forEach((a) => {
          a.classList.toggle("active", a.dataset.helpTab === tab);
        });

        // Toggle quickref vs markdown body
        if (tab === "quickref") {
          if (quickrefEl) quickrefEl.classList.remove("d-none");
          el.classList.add("d-none");
          enhanceHelpCopyButtons(quickrefEl);
          return;
        }

        if (quickrefEl) quickrefEl.classList.add("d-none");
        el.classList.remove("d-none");
        if (md && typeof md.parse === "function") {
          el.innerHTML = md.parse(sections[tab] || "", { gfm: true, breaks: true });
        } else {
          el.textContent = sections[tab] || "";
        }
        enhanceHelpCopyButtons(el);
      }

      // Wire clicks once
      document.querySelectorAll(".tm-help-subtab").forEach((a) => {
        a.addEventListener("click", (e) => {
          e.preventDefault();
          setHelpTab(a.dataset.helpTab);
        });
      });

      // Default tab
      setHelpTab("intro");
    }
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
  editor.renderer.setPadding(12); // add some breathing room around the text inside the editor

  // Ace: colour picker popover that inserts rgb(...) (instead of #hex) for MapScript compatibility
  initAceColourPicker(editor);

  // Restore editor from URL if present, otherwise seed a starter example.
  const fromUrl = getMapScriptFromUrl();
  // Default starter (when no URL): use the "Trade-offs" example from the gallery.
  const starter = (GALLERY_EXAMPLES.find((it) => it.id === "ex-07") || GALLERY_EXAMPLES[0]).dsl;

  editor.setValue(fromUrl ?? starter, -1);

  // Graphviz WASM init
  const graphviz = await Graphviz.load();

  // Gallery
  const refreshGallery = initGallery(editor, graphviz);

  // Gallery: rebuild saved thumbnails on demand
  const btnRebuildThumbs = document.getElementById("tm-gallery-rebuild-thumbs");
  if (btnRebuildThumbs) {
    if (!IS_ADMIN) {
      // Non-admins shouldn't see or use this (it can churn CPU + touch lots of LocalStorage).
      btnRebuildThumbs.classList.add("d-none");
    } else {
      btnRebuildThumbs.addEventListener("click", async () => {
        const ok = confirm("Rebuild thumbnails for all saved maps in this browser? This may take a few seconds.");
        if (!ok) return;
        await rebuildSavedThumbnails({ editor, graphviz, refreshGallery });
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

      // Refresh gallery so the saved map appears immediately.
      if (typeof refreshGallery === "function") refreshGallery();
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
  initVizInteractivity(editor, graphviz);

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


