// Shared Help renderer (used by the main app and the standalone /help page)
// Keeps the logic in one place (no duplication between pages).

function isLocalLiveServer() {
  // Live Server typically serves from http://localhost:<port>/ (or 127.0.0.1)
  const h = String(globalThis.location?.hostname || "");
  const p = String(globalThis.location?.protocol || "");
  return p === "http:" && (h === "localhost" || h === "127.0.0.1");
}

async function copyTextToClipboard(text) {
  // Minimal: use Clipboard API (works on HTTPS + localhost).
  await navigator.clipboard.writeText(String(text));
}

function getHelpTabFromLocation({ tabs, helpPathPrefix }) {
  // Supports:
  // - /help#syntax
  // - /help/#syntax
  // - /help/syntax (if hosted with rewrites) OR when running on /help/ directly.
  const rawHash = String(globalThis.location?.hash || "").replace(/^#/, "").trim().toLowerCase();
  if (rawHash && tabs.includes(rawHash)) return rawHash;

  const path = String(globalThis.location?.pathname || "");
  const idx = path.toLowerCase().indexOf(helpPathPrefix.toLowerCase());
  if (idx >= 0) {
    const rest = path.slice(idx + helpPathPrefix.length);
    const seg = rest.replace(/^\/+/, "").split("/")[0].trim().toLowerCase();
    if (seg && tabs.includes(seg)) return seg;
  }

  return "";
}

export async function initHelpFromMarkdown({
  mdUrl,
  defaultTab = "intro",
  isStandalone = false,
  helpPathPrefix = "/help",
} = {}) {
  // If the help DOM isn't present on this page, do nothing.
  const el = document.getElementById("tm-help-md");
  if (!el) return;

  const IS_ADMIN = isLocalLiveServer();

  const tabs = ["intro", "usage", "ai", "syntax", "quickref", "admin"];
  const sections = { intro: "", usage: "", ai: "", syntax: "", admin: "" };
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

  let currentTab = "";

  function setHelpTab(name) {
    const tab = tabs.includes(name) ? name : defaultTab;
    if (tab === "admin" && !IS_ADMIN) return setHelpTab(defaultTab);

    currentTab = tab;
    document.querySelectorAll(".tm-help-subtab").forEach((a) => {
      a.classList.toggle("active", a.dataset.helpTab === tab);
    });

    // Inline help page: keep the "open in new page" link pointing at the current section.
    const openEl = document.getElementById("tm-help-open");
    if (openEl && !isStandalone) {
      openEl.setAttribute("href", `./help/${tab === "intro" ? "intro" : tab}`);
    }

    // Toggle quickref vs markdown body
    if (tab === "quickref") {
      if (quickrefEl) quickrefEl.classList.remove("d-none");
      el.classList.add("d-none");
      enhanceHelpCopyButtons(quickrefEl);
    } else {
      if (quickrefEl) quickrefEl.classList.add("d-none");
      el.classList.remove("d-none");

      const md = globalThis.marked;
      if (md && typeof md.parse === "function") {
        el.innerHTML = md.parse(sections[tab] || "", { gfm: true, breaks: true });
      } else {
        el.textContent = sections[tab] || "";
      }
      enhanceHelpCopyButtons(el);
    }

    // Standalone help page: keep URL shareable by writing the hash.
    if (isStandalone) {
      const nextHash = `#${tab}`;
      if (globalThis.location?.hash !== nextHash) {
        history.replaceState(null, "", nextHash);
      }
    }
  }

  // Wire clicks once
  document.querySelectorAll(".tm-help-subtab").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      setHelpTab(a.dataset.helpTab);
    });
  });

  // Load markdown and split by headings in help.md: "## Intro", "## Usage", "## AI", "## Syntax", "## Admin"
  try {
    const r = await fetch(mdUrl, { cache: "no-cache" });
    const txt = await r.text();

    const lines = String(txt || "").split(/\r?\n/);
    let current = null;
    for (const line of lines) {
      const m = line.match(/^##\s+(intro|usage|ai|syntax|admin)\s*$/i);
      if (m) {
        current = m[1].toLowerCase();
        continue;
      }
      if (current) sections[current] += `${line}\n`;
    }
  } catch (e) {
    el.textContent = `Failed to load help.md: ${e?.message || String(e)}`;
  }

  const requested = getHelpTabFromLocation({ tabs, helpPathPrefix });
  setHelpTab(requested || defaultTab);

  if (isStandalone) {
    // Let /help#syntax drive the page if the user changes the hash manually.
    window.addEventListener("hashchange", () => {
      const t = getHelpTabFromLocation({ tabs, helpPathPrefix });
      if (t && t !== currentTab) setHelpTab(t);
    });
  }
}


