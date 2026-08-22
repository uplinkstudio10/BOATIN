// Insert your Cloudflare Worker URL here:
  const WORKER_PROXY_URL = "https://boatin.uplinkstudio.workers.dev/";

  // ─── PWA: installable manifest + offline app-shell caching ──────────────
  // Self-contained (no external files needed) so this still works as a single
  // HTML file hosted anywhere, e.g. GitHub Pages.
  (function setupPWA() {
    try {
      const manifest = {
        name: "BOATIN",
        short_name: "BOATIN",
        start_url: "./",
        display: "standalone",
        background_color: "#080a09",
        theme_color: "#080a09",
        icons: [
          {
            src: "data:image/svg+xml," + encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="%23080a09"/><circle cx="50" cy="50" r="24" fill="%2376b900"/></svg>'
            ),
            sizes: "192x192",
            type: "image/svg+xml"
          }
        ]
      };
      const manifestBlob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
      const link = document.getElementById("pwaManifestLink");
      if (link) link.href = URL.createObjectURL(manifestBlob);

      if ("serviceWorker" in navigator) {
        const swSource = `
          const SHELL_CACHE = "uplink-shell-v1";
          self.addEventListener("install", (e) => {
            self.skipWaiting();
            e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.add(self.registration.scope)));
          });
          self.addEventListener("activate", (e) => { self.clients.claim(); });
          self.addEventListener("fetch", (e) => {
            if (e.request.method !== "GET") return;
            const url = new URL(e.request.url);
            // Only handle same-origin navigation/app-shell requests; let API/CDN calls pass through untouched.
            if (url.origin !== self.location.origin) return;
            e.respondWith(
              caches.match(e.request).then((cached) => {
                const network = fetch(e.request).then((res) => {
                  if (res && res.ok) caches.open(SHELL_CACHE).then((c) => c.put(e.request, res.clone()));
                  return res;
                }).catch(() => cached);
                return cached || network;
              })
            );
          });
        `;
        const swBlob = new Blob([swSource], { type: "application/javascript" });
        const swUrl = URL.createObjectURL(swBlob);
        navigator.serviceWorker.register(swUrl).catch(() => {});
      }
    } catch (_) { /* PWA setup is best-effort; ignore failures */ }
  })();

  // NVIDIA Build catalog: chat / reasoning / coding / vision models that fit this
  // OpenAI-compatible chat proxy. Specialized NIMs (OCR, embeddings, rerankers,
  // TTS, image generation, etc.) are intentionally not sent through /chat.
  // Refreshed 2026 NVIDIA/NIM chat model catalog.
  // Specialized NIMs (embeddings, rerankers, OCR-only, TTS, moderation, etc.)
  // are intentionally excluded because this UI sends /chat/completions requests.
  // Catalog verified against live Worker (Aug 2026).
  // OK = returned chat content · TO = slow/timeout under load · XX = 404/410/EOL
  const NVIDIA_MODEL_GROUPS = [
    {
      category: "🏆 Recommended",
      models: [
        { value: "nvidia/llama-3.3-nemotron-super-49b-v1.5", label: "(DEFAULT) Nemotron Super 49B v1.5", tags: "verified, strong" },
        { value: "nvidia/llama-3.3-nemotron-super-49b-v1", label: "Nemotron Super 49B v1", tags: "verified" },
        { value: "meta/llama-3.1-8b-instruct", label: "Llama 3.1 8B Instruct", tags: "verified, fast" },
        { value: "meta/llama-3.1-70b-instruct", label: "Llama 3.1 70B Instruct", tags: "verified, quality" },
        { value: "openai/gpt-oss-20b", label: "GPT-OSS 20B", tags: "verified" },
        { value: "nvidia/nemotron-3-super-120b-a12b", label: "Nemotron 3 Super 120B", tags: "quality, may be slow" }
      ]
    },
    {
      category: "⚡ Groq (Fast)",
      models: [
        { value: "groq/llama-3.1-8b-instant", label: "Groq • Llama 3.1 8B Instant", tags: "groq, free, very fast" },
        { value: "groq/llama-3.3-70b-versatile", label: "Groq • Llama 3.3 70B", tags: "groq, free, quality+fast" },
        { value: "groq/gemma2-9b-it", label: "Groq • Gemma 2 9B", tags: "groq, free, fast" },
        { value: "groq/mixtral-8x7b-32768", label: "Groq • Mixtral 8x7B", tags: "groq, free" }
      ]
    },
    {
      category: "🌐 Web Pulse",
      models: [
        { value: "webpulse/nemotron-super", label: "Research • Nemotron Super 49B", tags: "live search" },
        { value: "webpulse/llama8b", label: "Research • Llama 3.1 8B", tags: "live search, fast" },
        { value: "webpulse/llama70", label: "Research • Llama 3.1 70B", tags: "live search, deep" },
        { value: "webpulse/gptoss", label: "Research • GPT-OSS 20B", tags: "live search" }
      ]
    },
    {
      category: "🚀 Power House",
      models: [
        { value: "power/agent", label: "Power House Agent", tags: "autonomous coding, plan+build+review+fix" }
      ]
    },
    {
      category: "🧠 Reasoning",
      models: [
        { value: "nvidia/llama-3.3-nemotron-super-49b-v1.5", label: "Nemotron Super 49B v1.5", tags: "reasoning" },
        { value: "meta/llama-3.1-70b-instruct", label: "Llama 3.1 70B", tags: "reasoning" },
        { value: "nvidia/nemotron-3-super-120b-a12b", label: "Nemotron 3 Super 120B", tags: "deep" }
      ]
    },
    {
      category: "💻 Coding",
      models: [
        { value: "nvidia/llama-3.3-nemotron-super-49b-v1.5", label: "Nemotron Super 49B v1.5", tags: "coding" },
        { value: "meta/llama-3.1-70b-instruct", label: "Llama 3.1 70B", tags: "coding" },
        { value: "openai/gpt-oss-20b", label: "GPT-OSS 20B", tags: "coding" },
        { value: "meta/llama-3.1-8b-instruct", label: "Llama 3.1 8B", tags: "coding, fast" }
      ]
    },
    {
      category: "👁️ Vision",
      models: [
        { value: "nvidia/nemotron-nano-12b-v2-vl", label: "Nemotron Nano 12B VL", tags: "verified vision" },
        { value: "meta/llama-3.2-11b-vision-instruct", label: "Llama 3.2 11B Vision", tags: "verified vision" }
      ]
    },
    {
      category: "🎨 Image",
      models: [
        { value: "black-forest-labs/flux.1-schnell", label: "FLUX.1 Schnell", tags: "image, fast" },
        { value: "black-forest-labs/flux.1-dev", label: "FLUX.1 Dev", tags: "image, quality" },
        { value: "stabilityai/stable-diffusion-3.5-large", label: "SD 3.5 Large", tags: "image" },
        { value: "qwen/qwen-image", label: "Qwen Image", tags: "image" },
        { value: "qwen/qwen-image-2512", label: "Qwen Image 2512", tags: "image" },
        { value: "qwen/qwen-image-edit", label: "Qwen Image Edit", tags: "image edit" }
      ]
    },
    {
      category: "⚡ Fast",
      models: [
        { value: "meta/llama-3.1-8b-instruct", label: "Llama 3.1 8B", tags: "verified, fast" },
        { value: "openai/gpt-oss-20b", label: "GPT-OSS 20B", tags: "verified" },
        { value: "nvidia/llama-3.3-nemotron-super-49b-v1", label: "Nemotron Super 49B", tags: "verified" }
      ]
    }
  ];

  const NVIDIA_MODELS = NVIDIA_MODEL_GROUPS.flatMap(g =>
    g.models.map(m => ({ ...m, category: g.category }))
  );

  // Custom renderer: never inject raw HTML into chat (prevents canvas/games auto-running)
  try {
    if (typeof marked !== "undefined" && marked) {
      const mdRenderer = new marked.Renderer();
      mdRenderer.html = () => "";
      // marked v5+ passes a token object as the first arg; older marked passed (code, lang)
      mdRenderer.code = (code, infostring) => {
        let text = code;
        let lang = "";
        if (code && typeof code === "object") {
          text = code.text != null ? code.text : (code.raw || "");
          lang = String(code.lang || infostring || "").trim().split(/\s+/)[0] || "";
        } else {
          text = code == null ? "" : String(code);
          lang = String(infostring || "").trim().split(/\s+/)[0] || "";
        }
        const esc = String(text)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
        const cls = lang ? ` class="language-${lang}"` : "";
        return `<pre><code${cls}>${esc}</code></pre>`;
      };
      marked.setOptions({
        breaks: true,
        gfm: true,
        headerIds: false,
        mangle: false,
        renderer: mdRenderer
      });
    }
  } catch (e) {
    console.warn("marked renderer setup failed", e);
  }

  const appState = {
    messages: [],
    selectedModelId: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    isGenerating: false,
    abortController: null,
    searchQuery: ""
  };
  let currentFile = null;

  const prefs = {
    font: localStorage.getItem("nv_font") || "md",
    theme: localStorage.getItem("nv_theme") || "nvidia",
    sound: localStorage.getItem("nv_sound") === "1",
    haptic: localStorage.getItem("nv_haptic") !== "0",
    compact: localStorage.getItem("nv_compact") === "1",
    timestamps: localStorage.getItem("nv_ts") !== "0",
    systemPrompt: localStorage.getItem("nv_sys") || "",
    voiceLang: localStorage.getItem("nv_voice") || "auto",
    favorites: JSON.parse(localStorage.getItem("nv_favs") || "[]")
  };

  const THEMES = {
    nvidia: { accent: "#76b900", secondary: "#06b6d4" },
    cyan:   { accent: "#22d3ee", secondary: "#818cf8" },
    purple: { accent: "#a78bfa", secondary: "#f472b6" },
    orange: { accent: "#fb923c", secondary: "#fbbf24" },
    rose:   { accent: "#fb7185", secondary: "#c084fc" }
  };

  function applyPrefs() {
    document.body.classList.remove("font-sm", "font-md", "font-lg", "compact");
    document.body.classList.add("font-" + (prefs.font || "md"));
    if (prefs.compact) document.body.classList.add("compact");
    const t = THEMES[prefs.theme] || THEMES.nvidia;
    document.documentElement.style.setProperty("--color-accent-primary", t.accent);
    document.documentElement.style.setProperty("--color-accent-secondary", t.secondary);
    document.documentElement.style.setProperty("--shadow-glow", "0 0 20px " + t.accent + "22");
  }

  function savePrefs() {
    localStorage.setItem("nv_font", prefs.font);
    localStorage.setItem("nv_theme", prefs.theme);
    localStorage.setItem("nv_sound", prefs.sound ? "1" : "0");
    localStorage.setItem("nv_haptic", prefs.haptic ? "1" : "0");
    localStorage.setItem("nv_compact", prefs.compact ? "1" : "0");
    localStorage.setItem("nv_ts", prefs.timestamps ? "1" : "0");
    localStorage.setItem("nv_sys", prefs.systemPrompt || "");
    localStorage.setItem("nv_voice", prefs.voiceLang || "auto");
    localStorage.setItem("nv_favs", JSON.stringify(prefs.favorites || []));
  }

  function playDoneSound() {
    if (!prefs.sound) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 880;
      g.gain.value = 0.04;
      o.connect(g); g.connect(ctx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      o.stop(ctx.currentTime + 0.26);
    } catch (_) {}
  }

  function haptic() {
    if (!prefs.haptic) return;
    try { navigator.vibrate?.(12); } catch (_) {}
  }

  // ── Multi-session chat ──────────────────────────────────────
  function getActiveSessionId() {
    let id = localStorage.getItem("nv_session_id");
    if (!id) {
      id = "s_" + Date.now();
      localStorage.setItem("nv_session_id", id);
    }
    return id;
  }

  function loadSessionIndex() {
    try {
      const raw = localStorage.getItem("nv_sessions");
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }

  function saveSessionIndex(list) {
    localStorage.setItem("nv_sessions", JSON.stringify(list || []));
  }

  function titleFromMessages(msgs) {
    const u = (msgs || []).find(m => m.role === "user" && typeof m.content === "string");
    if (!u) return "New chat";
    const t = String(u.content).replace(/\s+/g, " ").trim();
    return (t.slice(0, 42) || "New chat") + (t.length > 42 ? "…" : "");
  }

  function upsertSessionMeta() {
    const id = getActiveSessionId();
    const list = loadSessionIndex().filter(s => s.id !== id);
    list.unshift({
      id,
      title: titleFromMessages(appState.messages),
      updated: Date.now(),
      count: (appState.messages || []).length
    });
    saveSessionIndex(list.slice(0, 40));
  }

  function switchSession(id) {
    if (!id || id === getActiveSessionId()) return;
    // save current first
    persistMessages();
    localStorage.setItem("nv_session_id", id);
    try {
      const raw = localStorage.getItem(sessionKey(id));
      appState.messages = raw ? JSON.parse(raw) : [];
    } catch (_) { appState.messages = []; }
    if (!appState.messages.length) {
      appState.messages = [{
        role: "assistant",
        ts: Date.now(),
        content: "**New chat**\n\nModel · Effort · Actions — type and send."
      }];
    }
    render();
    toastAssist("Switched chat");
  }

  function newSession() {
    persistMessages();
    const id = "s_" + Date.now();
    localStorage.setItem("nv_session_id", id);
    appState.messages = [{
      role: "assistant",
      ts: Date.now(),
      content: "**New chat**\n\nModel · Effort · Actions — type and send."
    }];
    persistMessages();
    render();
    toastAssist("New chat");
  }

  function deleteSession(id) {
    const list = loadSessionIndex().filter(s => s.id !== id);
    saveSessionIndex(list);
    localStorage.removeItem(sessionKey(id));
    if (id === getActiveSessionId()) {
      if (list.length) switchSession(list[0].id);
      else newSession();
    } else {
      renderSessionModalList();
    }
  }

  function openSessionsModal() {
    let modal = document.getElementById("sessionsModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "sessionsModal";
      modal.className = "modal-backdrop";
      modal.innerHTML = `
        <div class="modal-sheet prompt-lib-sheet">
          <div class="preview-toolbar">
            <span class="preview-title">💬 Chats</span>
            <div style="display:flex;gap:6px;">
              <button type="button" class="tb-btn" id="sessionNewBtn">＋ New</button>
              <button type="button" class="tb-btn" id="sessionCloseBtn">✕</button>
            </div>
          </div>
          <div id="sessionsList" class="prompt-lib-list"></div>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener("click", (e) => { if (e.target === modal) closeSessionsModal(); });
      document.getElementById("sessionCloseBtn").onclick = closeSessionsModal;
      document.getElementById("sessionNewBtn").onclick = () => { newSession(); closeSessionsModal(); };
    }
    modal.classList.add("open");
    modal.style.display = "flex";
    renderSessionModalList();
  }

  function closeSessionsModal() {
    const modal = document.getElementById("sessionsModal");
    if (modal) { modal.classList.remove("open"); modal.style.display = "none"; }
  }

  function renderSessionModalList() {
    const box = document.getElementById("sessionsList");
    if (!box) return;
    upsertSessionMeta();
    const active = getActiveSessionId();
    const list = loadSessionIndex();
    box.innerHTML = "";
    if (!list.length) {
      box.innerHTML = "<div class='prompt-lib-meta'><span>No saved chats yet</span></div>";
      return;
    }
    list.forEach((s) => {
      const row = document.createElement("div");
      row.className = "prompt-lib-item";
      if (s.id === active) row.style.borderColor = "var(--color-accent-primary)";
      const meta = document.createElement("div");
      meta.className = "prompt-lib-meta";
      const when = s.updated ? new Date(s.updated).toLocaleString() : "";
      meta.innerHTML = `<strong>${escapeHtml(s.title || "Chat")}</strong><span>${s.count || 0} msgs · ${escapeHtml(when)}</span>`;
      const open = document.createElement("button");
      open.type = "button";
      open.className = "tb-btn";
      open.textContent = s.id === active ? "Open" : "Switch";
      open.onclick = () => { switchSession(s.id); closeSessionsModal(); };
      const del = document.createElement("button");
      del.type = "button";
      del.className = "tb-btn";
      del.textContent = "🗑";
      del.onclick = () => {
        if (confirm("Delete this chat?")) deleteSession(s.id);
      };
      row.append(meta, open, del);
      box.appendChild(row);
    });
  }

  function sessionKey(id) {
    return "nv_msgs_" + (id || getActiveSessionId());
  }



  const dom = {
    messagesContainer: document.getElementById("messagesContainer"),
    messageTextInput: document.getElementById("messageTextInput"),
    sendMessageBtn: document.getElementById("sendMessageBtn"),
    stopMessageBtn: document.getElementById("stopMessageBtn"),
    modelSelect: document.getElementById("modelSelect"),
    effortMode: document.getElementById("effortMode"),
    autoCallback: document.getElementById("autoCallback"),
    autoMode: document.getElementById("autoMode"),
    attachBtn: document.getElementById("attachBtn"),
    fileInput: document.getElementById("fileInput"),
    attachmentPreviewBar: document.getElementById("attachmentPreviewBar"),
    attachmentNameText: document.getElementById("attachmentNameText"),
    removeFileBtn: document.getElementById("removeFileBtn"),
    clearMemoryBtn: document.getElementById("clearMemoryBtn"),
            catTabs: document.getElementById("catTabs"),
    effortChips: document.getElementById("effortChips"),
    modeChips: document.getElementById("modeChips"),
    actionChips: document.getElementById("actionChips"),
  };

  function setGenerating(on) {
    const was = appState.isGenerating;
    appState.isGenerating = !!on;
    dom.sendMessageBtn.style.display = on ? "none" : "flex";
    dom.stopMessageBtn.style.display = on ? "flex" : "none";
    dom.sendMessageBtn.disabled = !!on;
        if (was && !on) playDoneSound();
  }

  function stopGeneration() {
    if (appState.abortController) {
      try { appState.abortController.abort(); } catch (_) {}
      appState.abortController = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  function persistMessages() {
    const payload = appState.messages.map(m => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : "[Attachment]",
      model: m.model || undefined,
      ts: m.ts || undefined,
      tokPerSec: m.tokPerSec || undefined
    }));
    localStorage.setItem(sessionKey(), JSON.stringify(payload));
    try { upsertSessionMeta(); } catch (_) {}
    updateCtxPill();
  }

  // Safe markdown wrapper: falls back to escaped plain text if the `marked`
  // CDN script failed to load (e.g. blocked network, offline preview sandbox),
  // so a single missing library never crashes render() and blanks the whole chat.
  // Keeps the header and input bar pinned in place on mobile browsers, where
  // the on-screen keyboard opening/closing can otherwise shift or resize the
  // page in ways that make fixed elements appear to "float" or jump.
  function setupViewportLock() {
    const root = document.getElementById("app-root");
    if (!root) return;
    const vv = window.visualViewport;
    if (!vv) return; // Unsupported browser: CSS fixed/dvh fallback still applies.
    const apply = () => {
      root.style.height = vv.height + "px";
      root.style.top = vv.offsetTop + "px";
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
  }

  function safeMarkdown(text) {
    text = typeof coerceText === "function" ? coerceText(text) : (typeof text === "string" ? text : String(text || ""));
    if (!text) return "";
    // Escape HTML outside fenced code blocks so previews never render inside chat
    const parts = String(text).split(/(```[\s\S]*?```)/g);
    const safe = parts.map((part) => {
      if (part.startsWith("```")) return part;
      return part
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }).join("");
    if (typeof marked !== "undefined" && marked && typeof marked.parse === "function") {
      try { return marked.parse(safe); } catch (_) { /* fall through */ }
    }
    return `<p>${safe.replace(/\n/g, "<br>")}</p>`;
  }

  // Throttle stream UI updates to ~1 frame / 50ms (big lag fix while typing tokens)
  function createStreamRenderer(el) {
    let pending = "";
    let raf = 0;
    let last = 0;
    const box = () => dom.messagesContainer || document.getElementById("messagesContainer");
    const paint = () => {
      raf = 0;
      last = Date.now();
      if (!el) return;
      const scroller = box();
      const stick = !scroller || isNearBottom(scroller, 160);
      // Keep a real bubble while streaming so it never collapses to a thin bar
      el.className = "message-bubble assistant streaming";
      const raw = String(pending || "");
      if (!raw.trim() || /^_?\(thinking/i.test(raw.trim()) || /^_thinking/i.test(raw.trim())) {
        el.className = "message-bubble pending";
        el.innerHTML = thinkingHTML("Thinking", "Model is reasoning — reply starts soon…");
      } else {
        el.className = "message-bubble assistant streaming";
        el.innerHTML = safeMarkdown(pending) + '<span class="streaming-cursor"></span>';
      }
      if (stick && scroller) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    };
    return (partial) => {
      pending = partial;
      const now = Date.now();
      if (now - last >= 28 && !raf) {
        paint();
        return;
      }
      if (!raf) raf = requestAnimationFrame(paint);
    };
  }

  function estimateTokens(str) {
    // Rough heuristic (~4 chars/token for English; conservative enough for a UI estimate).
    if (!str) return 0;
    return Math.ceil(str.length / 4);
  }

  function updateCtxPill() {
    const el = document.getElementById("ctxPill");
    if (!el) return;
    const totalChars = appState.messages.reduce((sum, m) => {
      const c = typeof m.content === "string" ? m.content : "";
      return sum + c.length;
    }, 0);
    const tok = estimateTokens("x".repeat(totalChars));
    el.textContent = `${appState.messages.length} msgs · ~${tok.toLocaleString()} tok`;
    el.title = "Messages in this chat · estimated context tokens (rough, ~4 chars/token)";
  }

  // ─── Mobile category panels ──────────────────────────────────
  const QUICK_PROMPTS = [
    { label: "💡 Explain simply", text: "Explain this simply, like I'm smart but not an expert:" },
    { label: "🐛 Debug code", text: "Find bugs and fix this code. Explain each change:\n\n```\n\n```" },
    { label: "✍️ Rewrite better", text: "Rewrite this more clearly and professionally:\n\n" },
    { label: "🌐 Live news", text: "What are the top tech news headlines today?" },
    { label: "🎨 Describe a scene", text: "Describe this scene in vivid detail: " },
    { label: "📝 Summarize", text: "Summarize the key points clearly:\n\n" }
  ];

  function switchCategory(cat) {
    document.querySelectorAll(".cat-tab").forEach(t => {
      t.classList.toggle("active", t.dataset.cat === cat);
    });
    document.querySelectorAll(".cat-panel").forEach(p => {
      p.classList.toggle("active", p.dataset.cat === cat);
    });
    localStorage.setItem("nv_cat", cat);
  }


  // ── Prompt Library ──────────────────────────────────────────
  const DEFAULT_PROMPTS = [
    { id: "explain", title: "Explain simply", text: "Explain this simply, like I'm smart but not an expert:\n\n" },
    { id: "debug", title: "Debug code", text: "Find bugs and fix this code. Explain each change:\n\n```\n\n```" },
    { id: "rewrite", title: "Rewrite better", text: "Rewrite this more clearly and professionally:\n\n" },
    { id: "summarize", title: "Summarize", text: "Summarize the key points clearly:\n\n" },
    { id: "htmlapp", title: "Single HTML app", text: "Build a complete single-file HTML app (inline CSS+JS) for: " },
    { id: "api", title: "Design API", text: "Design a clean REST API for: " },
    { id: "bangla", title: "বাংলায় লেখো", text: "নিচের বিষয়টা সহজ বাংলায় বুঝিয়ে দাও:\n\n" },
    { id: "news", title: "Live tech news", text: "What are the top tech news headlines today?" }
  ];

  function loadPromptLibrary() {
    try {
      const raw = localStorage.getItem("nv_prompts");
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) return arr;
      }
    } catch (_) {}
    return DEFAULT_PROMPTS.map(p => ({ ...p }));
  }

  function savePromptLibrary(list) {
    localStorage.setItem("nv_prompts", JSON.stringify(list || []));
  }

  function openPromptLibrary() {
    let modal = document.getElementById("promptLibModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "promptLibModal";
      modal.className = "modal-backdrop open";
      modal.innerHTML = `
        <div class="modal-sheet prompt-lib-sheet">
          <div class="preview-toolbar">
            <span class="preview-title">📚 Prompt Library</span>
            <button type="button" class="tb-btn" id="promptLibClose">✕ Close</button>
          </div>
          <div id="promptLibList" class="prompt-lib-list"></div>
          <div class="prompt-lib-add">
            <input id="promptLibTitle" placeholder="Title" maxlength="40" />
            <textarea id="promptLibText" placeholder="Prompt text…" rows="3"></textarea>
            <button type="button" class="tb-btn" id="promptLibSave">+ Save prompt</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener("click", (e) => { if (e.target === modal) closePromptLibrary(); });
      document.getElementById("promptLibClose").onclick = closePromptLibrary;
      document.getElementById("promptLibSave").onclick = () => {
        const title = (document.getElementById("promptLibTitle").value || "").trim();
        const text = (document.getElementById("promptLibText").value || "").trim();
        if (!title || !text) { toastAssist("Title + text needed"); return; }
        const list = loadPromptLibrary();
        list.unshift({ id: "c_" + Date.now(), title, text });
        savePromptLibrary(list);
        document.getElementById("promptLibTitle").value = "";
        document.getElementById("promptLibText").value = "";
        renderPromptLibList();
        toastAssist("Prompt saved");
      };
    }
    modal.classList.add("open");
    modal.style.display = "flex";
    renderPromptLibList();
  }

  function closePromptLibrary() {
    const modal = document.getElementById("promptLibModal");
    if (modal) { modal.classList.remove("open"); modal.style.display = "none"; }
  }

  function renderPromptLibList() {
    const box = document.getElementById("promptLibList");
    if (!box) return;
    const list = loadPromptLibrary();
    box.innerHTML = "";
    list.forEach((p, idx) => {
      const row = document.createElement("div");
      row.className = "prompt-lib-item";
      const use = document.createElement("button");
      use.type = "button";
      use.className = "tb-btn";
      use.textContent = "Use";
      use.onclick = () => {
        dom.messageTextInput.value = p.text;
        dom.messageTextInput.focus();
        closePromptLibrary();
        toastAssist("Prompt loaded");
      };
      const del = document.createElement("button");
      del.type = "button";
      del.className = "tb-btn";
      del.textContent = "🗑";
      del.onclick = () => {
        const next = loadPromptLibrary().filter((_, i) => i !== idx);
        savePromptLibrary(next.length ? next : DEFAULT_PROMPTS.map(x => ({ ...x })));
        renderPromptLibList();
      };
      const meta = document.createElement("div");
      meta.className = "prompt-lib-meta";
      meta.innerHTML = `<strong>${escapeHtml(p.title)}</strong><span>${escapeHtml(String(p.text).slice(0, 80))}</span>`;
      row.append(meta, use, del);
      box.appendChild(row);
    });
  }

  // ── Friendly errors ─────────────────────────────────────────
  function friendlyError(err, ctx) {
    const raw = String(err?.message || err || "Unknown error");
    const low = raw.toLowerCase();
    let tip = "";
    if (/404|not found|does not exist|unknown model/.test(low))
      tip = "Model not available on this NVIDIA key. Pick Nemotron Super or Llama 8B, turn Fallback ON.";
    else if (/401|403|unauthorized|forbidden|api.?key/.test(low))
      tip = "API key / Worker auth issue. Check NVIDIA_API_KEY or GROQ_API_KEY secret on Cloudflare Worker.";
    else if (/429|rate limit|quota|too many/.test(low))
      tip = "Rate limited. Wait a few seconds and retry, or switch to a smaller model.";
    else if (/network|failed to fetch|cors|load failed|offline/.test(low))
      tip = "Network problem. Check internet and Worker URL (boatin.uplinkstudio.workers.dev).";
    else if (/timeout|aborted|signal/.test(low))
      tip = "Request timed out or was stopped. Try again with lower Effort.";
    else if (/empty|no assistant content|no content/.test(low))
      tip = "Model returned empty text. Retry, or use Llama 3.1 8B.";
    else if (/search|web pulse/.test(low))
      tip = "Search failed. Redeploy Worker with POST /search, or use normal chat.";
    const head = ctx ? `**${ctx}**` : "**Something went wrong**";
    return `${head}\n\n${raw.slice(0, 500)}${tip ? `\n\n💡 **Tip:** ${tip}` : ""}`;
  }

  // ── Tokens / sec ────────────────────────────────────────────
  function formatTokPerSec(chars, ms) {
    if (!ms || ms < 1) return null;
    const tok = Math.max(1, Math.round(chars / 4));
    const tps = tok / (ms / 1000);
    return tps >= 10 ? tps.toFixed(0) : tps.toFixed(1);
  }

  // ── Multi-file extract + ZIP (store method, no compression lib) ──
  function extractAllCodeBlocks(text) {
    const out = [];
    const re = /```([\w.+-]*)\s*[\r\n]+([\s\S]*?)```/g;
    let m, i = 0;
    while ((m = re.exec(String(text || "")))) {
      const lang = (m[1] || "").toLowerCase();
      const code = m[2].replace(/\s+$/, "");
      if (code.trim().length < 2) continue;
      i++;
      let name = guessFilename(code, lang) || ("file" + i + "." + (lang || "txt"));
      let base = name, n = 2;
      while (out.some(f => f.name === name)) {
        const dot = base.lastIndexOf(".");
        name = dot > 0 ? (base.slice(0, dot) + "_" + n + base.slice(dot)) : (base + "_" + n);
        n++;
      }
      out.push({ name: name, lang: lang, code: code });
    }
    return out;
  }

  function guessFilename(code, lang) {
    const map = {
      html: "index.html", htm: "index.html", css: "styles.css",
      js: "app.js", javascript: "app.js", ts: "app.ts", typescript: "app.ts",
      py: "main.py", python: "main.py", json: "data.json", md: "README.md",
      markdown: "README.md", java: "Main.java", c: "main.c", cpp: "main.cpp",
      php: "index.php", sh: "script.sh", bash: "script.sh", sql: "query.sql"
    };
    if (map[lang]) return map[lang];
    if (/<!doctype html/i.test(code) || /<html[\s>]/i.test(code)) return "index.html";
    if (/function\s+\w+\s*\(/i.test(code) || /const\s+\w+\s*=/.test(code)) return "script.js";
    return null;
  }

  function crc32(str) {
    let c = ~0;
    for (let i = 0; i < str.length; i++) {
      c ^= str.charCodeAt(i) & 0xff;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  }

  function u16(n) { return new Uint8Array([n & 255, (n >>> 8) & 255]); }
  function u32(n) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }

  function buildZip(files) {
    // Store-only ZIP (no compression) — works offline, no CDN
    const enc = new TextEncoder();
    const locals = [];
    const centrals = [];
    let offset = 0;
    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

    files.forEach((f) => {
      const nameBytes = enc.encode(f.name);
      const data = typeof f.code === "string" ? enc.encode(f.code) : f.code;
      const crc = crc32(typeof f.code === "string" ? f.code : new TextDecoder().decode(data));
      // local header
      const local = new Uint8Array(30 + nameBytes.length + data.length);
      local.set([0x50, 0x4b, 0x03, 0x04], 0);
      local.set(u16(20), 4); // version
      local.set(u16(0), 6); // flags
      local.set(u16(0), 8); // method store
      local.set(u16(dosTime), 10);
      local.set(u16(dosDate), 12);
      local.set(u32(crc), 14);
      local.set(u32(data.length), 18);
      local.set(u32(data.length), 22);
      local.set(u16(nameBytes.length), 26);
      local.set(u16(0), 28);
      local.set(nameBytes, 30);
      local.set(data, 30 + nameBytes.length);
      locals.push(local);

      const central = new Uint8Array(46 + nameBytes.length);
      central.set([0x50, 0x4b, 0x01, 0x02], 0);
      central.set(u16(20), 4);
      central.set(u16(20), 6);
      central.set(u16(0), 8);
      central.set(u16(0), 10);
      central.set(u16(dosTime), 12);
      central.set(u16(dosDate), 14);
      central.set(u32(crc), 16);
      central.set(u32(data.length), 20);
      central.set(u32(data.length), 24);
      central.set(u16(nameBytes.length), 28);
      central.set(u16(0), 30);
      central.set(u16(0), 32);
      central.set(u16(0), 34);
      central.set(u16(0), 36);
      central.set(u32(0), 38);
      central.set(u32(offset), 42);
      central.set(nameBytes, 46);
      centrals.push(central);
      offset += local.length;
    });

    const centralSize = centrals.reduce((s, a) => s + a.length, 0);
    const end = new Uint8Array(22);
    end.set([0x50, 0x4b, 0x05, 0x06], 0);
    end.set(u16(0), 4);
    end.set(u16(0), 6);
    end.set(u16(files.length), 8);
    end.set(u16(files.length), 10);
    end.set(u32(centralSize), 12);
    end.set(u32(offset), 16);
    end.set(u16(0), 20);

    const total = offset + centralSize + 22;
    const out = new Uint8Array(total);
    let p = 0;
    locals.forEach(b => { out.set(b, p); p += b.length; });
    centrals.forEach(b => { out.set(b, p); p += b.length; });
    out.set(end, p);
    return new Blob([out], { type: "application/zip" });
  }

  function downloadZipFromText(text, zipName) {
    const files = extractAllCodeBlocks(text);
    if (!files.length) {
      toastAssist("No code blocks to zip");
      return;
    }
    if (files.length === 1) {
      // single file download
      const f = files[0];
      const blob = new Blob([f.code], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      toastAssist("Downloaded " + f.name);
      return;
    }
    const blob = buildZip(files);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = zipName || "powerhouse-build.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    toastAssist(`ZIP · ${files.length} files`);
  }



  function exportChatMarkdown() {
    const lines = ["# BOATIN chat export", "", "_Exported " + new Date().toLocaleString() + "_", ""];
    (appState.messages || []).forEach((m) => {
      const role = m.role === "user" ? "You" : "Assistant";
      const body = typeof m.content === "string" ? m.content : "[attachment]";
      lines.push("## " + role);
      if (m.model) lines.push("_Model: " + m.model + "_");
      if (m.tokPerSec) lines.push("_~" + m.tokPerSec + " tok/s_");
      lines.push("");
      lines.push(body);
      lines.push("");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "boatin-chat-" + new Date().toISOString().slice(0, 10) + ".md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    toastAssist("Exported Markdown");
  }

  // ── Model health ──
  async function checkModelHealth() {
    const modalId = "healthModal";
    let modal = document.getElementById(modalId);
    if (!modal) {
      modal = document.createElement("div");
      modal.id = modalId;
      modal.className = "modal-backdrop";
      modal.innerHTML = `
        <div class="modal-sheet prompt-lib-sheet">
          <div class="preview-toolbar">
            <span class="preview-title">🩺 Model health</span>
            <button type="button" class="tb-btn" id="healthCloseBtn">✕</button>
          </div>
          <div id="healthList" class="prompt-lib-list"><div class="prompt-lib-meta"><span>Checking Worker + models…</span></div></div>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener("click", (e) => { if (e.target === modal) { modal.classList.remove("open"); modal.style.display = "none"; } });
      document.getElementById("healthCloseBtn").onclick = () => { modal.classList.remove("open"); modal.style.display = "none"; };
    }
    modal.classList.add("open");
    modal.style.display = "flex";
    const box = document.getElementById("healthList");
    box.innerHTML = "<div class='prompt-lib-meta'><span>Checking…</span></div>";

    const rows = [];
    // Worker health
    try {
      const res = await fetch(WORKER_PROXY_URL.replace(/\/+$/, "") + "/health", { method: "GET" });
      const data = await res.json().catch(() => ({}));
      rows.push({
        name: "Worker",
        ok: res.ok && data.status === "ok",
        detail: res.ok ? ("OK · NVIDIA=" + !!data.hasKey + " · Groq=" + !!data.hasGroq) : ("HTTP " + res.status)
      });
    } catch (e) {
      rows.push({ name: "Worker", ok: false, detail: e.message || "unreachable" });
    }

    const probe = [
      "nvidia/llama-3.3-nemotron-super-49b-v1.5",
      "meta/llama-3.1-8b-instruct",
      "groq/llama-3.1-8b-instant",
      "meta/llama-3.1-70b-instruct"
    ];
    for (const id of probe) {
      try {
        const attempt = await callModel(id, [{ role: "user", content: "Reply with OK only." }]);
        rows.push({
          name: getModelInfo(id)?.label || id,
          ok: !!(attempt && attempt.ok),
          detail: attempt?.ok ? "OK" : String(attempt?.error || "fail").slice(0, 80)
        });
      } catch (e) {
        rows.push({ name: getModelInfo(id)?.label || id, ok: false, detail: e.message || "error" });
      }
    }

    box.innerHTML = "";
    rows.forEach((r) => {
      const row = document.createElement("div");
      row.className = "prompt-lib-item";
      row.innerHTML = `<div class="prompt-lib-meta"><strong>${r.ok ? "🟢" : "🔴"} ${escapeHtml(r.name)}</strong><span>${escapeHtml(r.detail)}</span></div>`;
      box.appendChild(row);
    });
  }


  function toastAssist(msg) {
    // Non-chat toast — never pollute message history
    let el = document.getElementById("liveToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "liveToast";
      el.style.cssText = "position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:10000;max-width:90%;padding:10px 14px;border-radius:14px;background:rgba(14,19,16,0.96);border:1px solid var(--color-accent-primary);color:var(--color-text-primary);font-size:12px;box-shadow:0 8px 28px rgba(0,0,0,0.45);pointer-events:none;opacity:0;transition:opacity 0.2s;";
      document.body.appendChild(el);
    }
    el.textContent = String(msg || "").replace(/[*_`#]/g, "").slice(0, 160);
    el.style.opacity = "1";
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = "0"; }, 2200);
  }

  function setEffort(level) {
    const v = level || "mid";
    if (dom.effortMode) dom.effortMode.value = v;
    localStorage.setItem("nv_effort", v);
    const lab = document.getElementById("effortTriggerLabel");
    if (lab) lab.textContent = ({ low: "Low", mid: "Mid", high: "High", max: "Max" })[v] || "Mid";
    document.querySelectorAll("#effortDropdown button").forEach(b => {
      b.classList.toggle("active", b.dataset.effort === v);
    });
    syncEffortChips();
  }

  function syncEffortChips() {
    if (!dom.effortChips) return;
    const cur = dom.effortMode.value || "mid";
    dom.effortChips.querySelectorAll(".cat-chip").forEach(c => {
      c.classList.toggle("active", c.dataset.val === cur);
    });
  }

  function syncModeChips() {
    if (!dom.modeChips) return;
    const auto = dom.autoMode.value || "on";
    const fb = dom.autoCallback.value || "on";
    dom.modeChips.querySelectorAll(".cat-chip").forEach(c => {
      if (c.dataset.group === "auto") c.classList.toggle("active", c.dataset.val === auto);
      if (c.dataset.group === "fallback") c.classList.toggle("active", c.dataset.val === fb);
    });
  }

  function renderCategoryPanels() {
    // Effort chips
    if (dom.effortChips) {
      dom.effortChips.innerHTML = "";
      [
        { val: "low", label: "Low · Fast" },
        { val: "mid", label: "Mid · Balanced" },
        { val: "high", label: "High · Deep" },
        { val: "max", label: "Max · Full power" }
      ].forEach(item => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cat-chip";
        b.dataset.val = item.val;
        b.textContent = item.label;
        b.onclick = () => setEffort(item.val);
        dom.effortChips.appendChild(b);
      });
      syncEffortChips();
    }

    // Auto chips (dedicated tab)
    const autoBox = document.getElementById("autoChips");
    if (autoBox) {
      autoBox.innerHTML = "";
      [["on", "Auto Mode ON"], ["off", "Auto Mode OFF"]].forEach(([val, label]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cat-chip" + ((dom.autoMode?.value || "on") === val ? " active" : "");
        b.dataset.val = val;
        b.textContent = label;
        b.onclick = () => {
          if (dom.autoMode) dom.autoMode.value = val;
          localStorage.setItem("nv_automode", val);
          autoBox.querySelectorAll(".cat-chip").forEach(c => c.classList.toggle("active", c.dataset.val === val));
          toastAssist("Auto Mode " + val.toUpperCase());
        };
        autoBox.appendChild(b);
      });
    }

    // Fallback chips (dedicated tab)
    const fbBox = document.getElementById("fallbackChips");
    if (fbBox) {
      fbBox.innerHTML = "";
      [["on", "Fallback ON"], ["off", "Fallback OFF"]].forEach(([val, label]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cat-chip" + ((dom.autoCallback?.value || "on") === val ? " active" : "");
        b.dataset.val = val;
        b.textContent = label;
        b.onclick = () => {
          if (dom.autoCallback) dom.autoCallback.value = val;
          localStorage.setItem("nv_autocallback", val);
          fbBox.querySelectorAll(".cat-chip").forEach(c => c.classList.toggle("active", c.dataset.val === val));
          toastAssist("Fallback " + val.toUpperCase());
        };
        fbBox.appendChild(b);
      });
    }

    // Action chips
    if (dom.actionChips) {
      dom.actionChips.innerHTML = "";
      const pickModel = (id, note) => {
        if (!NVIDIA_MODELS.some(m => m.value === id) && id !== "power/agent" && !/^webpulse\//i.test(id)) {
          toastAssist("Model not in list");
          return;
        }
        dom.modelSelect.value = id;
        appState.selectedModelId = id;
        localStorage.setItem("nv_model", id);
        if (dom.autoMode) {
          dom.autoMode.value = "off";
          localStorage.setItem("nv_automode", "off");
        }
        switchCategory("model");
        toastAssist(note || ("Selected " + (getModelInfo(id)?.label || id)));
      };
      const actions = [
        {
          label: "🌐 Web Pulse",
          run: () => pickModel("webpulse/nemotron-super", "Web Pulse ready")
        },
        {
          label: "🚀 Power House",
          run: () => pickModel("power/agent", "Power House — describe what to build")
        },
        {
          label: "⚡ Groq Fast",
          run: () => pickModel("groq/llama-3.1-8b-instant", "Groq 8B Instant")
        },
        {
          label: "🎨 Image",
          run: () => pickModel("black-forest-labs/flux.1-schnell", "Describe a scene and Send")
        },
        {
          label: "✨ Improve last",
          run: () => {
            const last = [...(appState.messages || [])].reverse().find(m => m.role === "assistant" && typeof m.content === "string");
            if (!last) { toastAssist("No reply to improve"); return; }
            dom.messageTextInput.value = "Improve this answer — clearer, more correct:\n\n" + String(last.content).slice(0, 6000);
            dom.messageTextInput.dispatchEvent(new Event("input"));
            dom.messageTextInput.focus();
          }
        },
        {
          label: "🔁 Regen",
          run: () => {
            if (typeof regenerateLast === "function") regenerateLast();
            else toastAssist("Regen not available");
          }
        }
      ];

      actions.forEach(a => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cat-chip" + (a.danger ? " danger" : "");
        b.textContent = a.label;
        b.onclick = a.run;
        dom.actionChips.appendChild(b);
      });
    }
  }

  function initCategoryTabs() {
    dom.catTabs?.querySelectorAll(".cat-tab").forEach(tab => {
      tab.addEventListener("click", () => switchCategory(tab.dataset.cat));
    });
    renderCategoryPanels();
    const saved = localStorage.getItem("nv_cat") || "model";
    switchCategory(saved);
  }



  async function regenerateLast() {
    if (appState.isGenerating) return;
    while (appState.messages.length && appState.messages[appState.messages.length - 1].role === "assistant") {
      appState.messages.pop();
    }
    const lastUser = [...appState.messages].reverse().find(m => m.role === "user");
    if (!lastUser) {
      appState.messages.push({ role: "assistant", content: "Nothing to regenerate — send a message first." });
      render();
      return;
    }
    const text = typeof lastUser.content === "string"
      ? lastUser.content
      : (Array.isArray(lastUser.content)
          ? (lastUser.content.find(p => p.type === "text")?.text || "Regenerate.")
          : "Regenerate.");
    const hadVision = Array.isArray(lastUser.content);
    persistMessages();
    render();
    await runChatCompletion(text, hadVision);
  }

  // Effort levels → temperature, max_tokens, reasoning system hint
  const EFFORT_PRESETS = {
    low:  { temperature: 0.55, top_p: 0.9,  max_tokens: 3072,  label: "Low",  systemHint: "Fast, correct, useful. Short unless code is needed. Prefer working answers over fluff." },
    mid:  { temperature: 0.4,  top_p: 0.9,  max_tokens: 8192,  label: "Mid",  systemHint: "High-quality answers. Complete working code when asked. Explain only what matters. Prefer correctness over length." },
    high: { temperature: 0.28, top_p: 0.85, max_tokens: 16384, label: "High", systemHint: "Expert-level depth. Full files, edge cases, and clear structure. No placeholders. Solve the whole problem." },
    max:  { temperature: 0.2,  top_p: 0.8,  max_tokens: 32768, label: "Max",  systemHint: "Maximum capability. Deliver production-ready complete solutions, multi-file when needed, rigorous reasoning compressed into the final answer only (never show chain-of-thought)." }
  };


  function smartPickEffort(text) {
    const t = String(text || "");
    const words = t.trim() ? t.trim().split(/\s+/).length : 0;
    const isCode = /```|function |def |class |import |<\/?[a-z]|console\.|SELECT /i.test(t);
    const isLong = words > 80 || t.length > 1200;
    const isTiny = words > 0 && words <= 12 && !isCode;
    const el = dom.effortMode;
    if (!el) return;
    // Only auto-nudge when user left default-ish; still respect explicit Max if they set it via UI recently — use soft rules
    if (isCode || isLong) {
      if (el.value === "low" || el.value === "mid") {
        el.value = isCode ? "high" : "high";
        localStorage.setItem("nv_effort", el.value);
        const lab = document.getElementById("effortTriggerLabel");
        if (lab) lab.textContent = el.value === "high" ? "High" : el.value;
      }
    } else if (isTiny && el.value === "max") {
      el.value = "mid";
      if (typeof setEffort === "function") setEffort("mid");
      else localStorage.setItem("nv_effort", "mid");
    }
  }

  function isBanglaText(s) {
    return /[\u0980-\u09FF]/.test(String(s || ""));
  }

  function getEffortConfig() {
    const key = (dom.effortMode?.value || "mid").toLowerCase();
    return EFFORT_PRESETS[key] || EFFORT_PRESETS.mid;
  }

  function populateModelSelect() {
    dom.modelSelect.innerHTML = "";

    const favs = prefs.favorites || [];
    if (favs.length) {
      const fg = document.createElement("optgroup");
      fg.label = "⭐ Favorites";
      favs.forEach(id => {
        const info = NVIDIA_MODELS.find(m => m.value === id);
        if (!info) return;
        const opt = document.createElement("option");
        opt.value = info.value;
        opt.textContent = "★ " + info.label;
        fg.appendChild(opt);
      });
      if (fg.children.length) dom.modelSelect.appendChild(fg);
    }

    NVIDIA_MODEL_GROUPS.forEach(group => {
      const optgroup = document.createElement("optgroup");
      optgroup.label = group.category;

      group.models.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.value;
        const starred = favs.includes(m.value) ? "★ " : "";
        opt.textContent = starred + m.label;
        opt.dataset.type = m.type || "chat";
        optgroup.appendChild(opt);
      });

      dom.modelSelect.appendChild(optgroup);
    });
  }

  function toggleFavoriteModel(id) {
    const set = new Set(prefs.favorites || []);
    if (set.has(id)) set.delete(id); else set.add(id);
    prefs.favorites = [...set];
    savePrefs();
    const cur = dom.modelSelect.value;
    populateModelSelect();
    dom.modelSelect.value = cur;
  }

  function init() {
    applyPrefs();
    populateModelSelect();

    const collapseBtn = document.getElementById("headerCollapseBtn");
    if (collapseBtn && !collapseBtn.dataset.bound) {
      collapseBtn.dataset.bound = "1";
      const applyCollapse = () => {
        const on = localStorage.getItem("nv_header_collapsed") === "1";
        document.body.classList.toggle("header-collapsed", on);
        collapseBtn.textContent = on ? "▸" : "▾";
      };
      applyCollapse();
      collapseBtn.addEventListener("click", () => {
        const next = localStorage.getItem("nv_header_collapsed") === "1" ? "0" : "1";
        localStorage.setItem("nv_header_collapsed", next);
        applyCollapse();
      });
    }

    if (dom.messageTextInput) { dom.messageTextInput.rows = 1; dom.messageTextInput.style.height = "20px"; }
    setupViewportLock();

    const DEFAULT_MODEL = "nvidia/llama-3.3-nemotron-super-49b-v1.5";
    let savedModel = localStorage.getItem("nv_model") || DEFAULT_MODEL;
    // Default must be a normal chat model — never Research / webpulse
    if (/^webpulse\//i.test(savedModel) || isLiveSearchModel(savedModel)) {
      savedModel = DEFAULT_MODEL;
      localStorage.setItem("nv_model", DEFAULT_MODEL);
    }
    appState.selectedModelId = savedModel;
    dom.modelSelect.value = appState.selectedModelId;
    if (!dom.modelSelect.value || isLiveSearchModel(dom.modelSelect.value)) {
      appState.selectedModelId = DEFAULT_MODEL;
      dom.modelSelect.value = DEFAULT_MODEL;
      localStorage.setItem("nv_model", DEFAULT_MODEL);
    }
    dom.effortMode.value = localStorage.getItem("nv_effort") || "mid";
    if (dom.autoCallback) dom.autoCallback.value = localStorage.getItem("nv_autocallback") || "on";
    if (dom.autoMode) dom.autoMode.value = localStorage.getItem("nv_automode") || "on";

    // Migrate legacy single-chat key once
    if (localStorage.getItem("nv_msgs") && !localStorage.getItem(sessionKey())) {
      localStorage.setItem(sessionKey(), localStorage.getItem("nv_msgs"));
      localStorage.removeItem(sessionKey());
    }
    const saved = localStorage.getItem(sessionKey());
    try {
      appState.messages = saved ? JSON.parse(saved) : null;
    } catch { appState.messages = null; }
    if (!appState.messages || !appState.messages.length) {
      appState.messages = [{
        role: "assistant",
        ts: Date.now(),
        content: `**BOATIN UP▪︎29 《SAMSUNG EDITION》**

Model · Effort · Actions — type and send.`
      }];
    }
    try { upsertSessionMeta(); } catch (_) {}

    // Restore draft
    const draft = localStorage.getItem("nv_draft");
    if (draft) dom.messageTextInput.value = draft;

    dom.modelSelect.addEventListener("change", (e) => {
      appState.selectedModelId = e.target.value;
      localStorage.setItem("nv_model", appState.selectedModelId);
    });

    dom.effortMode.addEventListener("change", (e) => {
      localStorage.setItem("nv_effort", e.target.value);
    });

    dom.autoCallback?.addEventListener("change", (e) => {
      localStorage.setItem("nv_autocallback", e.target.value);
    });

    dom.autoMode?.addEventListener("change", (e) => {
      localStorage.setItem("nv_automode", e.target.value);
    });

    dom.clearMemoryBtn.addEventListener("click", () => {
      if (confirm("Clear this chat session?")) {
        stopGeneration();
        appState.messages = [{ role: "assistant", content: "Memory cleared.", ts: Date.now() }];
        localStorage.removeItem(sessionKey());
        try { upsertSessionMeta(); } catch (_) {}
        setGenerating(false);
        render();
      }
    });

    // Header: chats / export
    const headerActions = document.querySelector(".header-actions");
    if (headerActions && !document.getElementById("chatsHeaderBtn")) {
      const chatsBtn = document.createElement("button");
      chatsBtn.type = "button";
      chatsBtn.className = "header-action-btn";
      chatsBtn.id = "chatsHeaderBtn";
      chatsBtn.textContent = "Chats";
      chatsBtn.title = "Chat sessions";
      chatsBtn.onclick = () => openSessionsModal();
      const expBtn = document.createElement("button");
      expBtn.type = "button";
      expBtn.className = "header-action-btn";
      expBtn.id = "exportHeaderBtn";
      expBtn.textContent = "Export";
      expBtn.title = "Export chat as Markdown";
      expBtn.onclick = () => exportChatMarkdown();
      headerActions.insertBefore(expBtn, headerActions.firstChild);
      headerActions.insertBefore(chatsBtn, headerActions.firstChild);
    }

    dom.stopMessageBtn?.addEventListener("click", stopGeneration);
    
    dom.attachBtn.addEventListener("click", () => dom.fileInput.click());
    bindScrollUi();
    document.getElementById("listenBtn")?.addEventListener("click", listenLastReply);
    const effortTrigger = document.getElementById("effortTrigger");
    const effortDropdown = document.getElementById("effortDropdown");
    effortTrigger?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!effortDropdown) return;
      effortDropdown.hidden = !effortDropdown.hidden;
    });
    effortDropdown?.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        setEffort(btn.dataset.effort);
        if (effortDropdown) effortDropdown.hidden = true;
      });
    });
    document.addEventListener("click", () => {
      if (effortDropdown) effortDropdown.hidden = true;
    });
    setEffort(localStorage.getItem("nv_effort") || "mid");
    dom.removeFileBtn.addEventListener("click", clearFile);
    dom.fileInput.addEventListener("change", handleFile);
    dom.sendMessageBtn.addEventListener("click", () => { haptic(); sendMsg(); });

    initCategoryTabs();
    initStudioFeatures();

    dom.messageTextInput.addEventListener("input", function() {
      this.style.height = "20px";
      const maxH = 72;
      const h = Math.min(Math.max(this.scrollHeight, 20), maxH);
      this.style.height = (this.value.trim() ? h : 20) + "px";
      this.style.overflowY = this.scrollHeight > maxH ? "auto" : "hidden";
      localStorage.setItem("nv_draft", this.value);
      const counter = document.getElementById("inputCounter");
      if (counter) {
        const len = this.value.length;
        if (len > 0) {
          counter.style.display = "block";
          counter.textContent = `${len.toLocaleString()} chars · ~${estimateTokens(this.value).toLocaleString()} tok`;
        } else {
          counter.style.display = "none";
        }
      }
    });

    dom.messageTextInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!appState.isGenerating) { haptic(); sendMsg(); }
      }
      if (e.key === "Escape" && appState.isGenerating) stopGeneration();
    });

    // Paste image from clipboard
    dom.messageTextInput.addEventListener("paste", (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          e.preventDefault();
          const file = it.getAsFile();
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            currentFile = { name: file.name || "paste.png", data: ev.target.result, isImg: true };
            dom.attachmentNameText.textContent = currentFile.name;
            dom.attachmentPreviewBar.style.display = "flex";
          };
          reader.readAsDataURL(file);
          break;
        }
      }
    });

    render();
  }

  function openModal(id) {
    document.getElementById(id)?.classList.add("open");
  }
  function closeModal(id) {
    document.getElementById(id)?.classList.remove("open");
  }

  function initStudioFeatures() {
    // Settings modal fields
    const sys = document.getElementById("sysPromptInput");
    if (sys) sys.value = prefs.systemPrompt || "";
    const fs = document.getElementById("fontSizeSelect");
    const vl = document.getElementById("voiceLangSelect");
    if (vl) vl.value = prefs.voiceLang || "auto";
    if (fs) fs.value = prefs.font || "md";
    const sound = document.getElementById("soundToggle");
    if (sound) sound.checked = !!prefs.sound;
    const hap = document.getElementById("hapticToggle");
    if (hap) hap.checked = !!prefs.haptic;
    const compact = document.getElementById("compactToggle");
    if (compact) compact.checked = !!prefs.compact;
    const ts = document.getElementById("timestampsToggle");
    if (ts) ts.checked = !!prefs.timestamps;

    const sw = document.getElementById("themeSwatches");
    if (sw) {
      sw.innerHTML = "";
      Object.entries(THEMES).forEach(([name, t]) => {
        const d = document.createElement("button");
        d.type = "button";
        d.className = "theme-swatch" + (prefs.theme === name ? " on" : "");
        d.style.background = t.accent;
        d.title = name;
        d.onclick = () => {
          prefs.theme = name;
          savePrefs();
          applyPrefs();
          sw.querySelectorAll(".theme-swatch").forEach(x => x.classList.remove("on"));
          d.classList.add("on");
        };
        sw.appendChild(d);
      });
    }

    // Note: settingsBtn/shortcutsBtn were removed from the toolbar per user request.
    // Modal markup + these close/save handlers are kept intact so the settings
    // (system prompt, font size, theme) and shortcuts modal can be reconnected
    // later just by adding a trigger button back with these same ids.
    document.getElementById("settingsClose")?.addEventListener("click", () => {
      prefs.systemPrompt = document.getElementById("sysPromptInput")?.value || "";
      prefs.font = document.getElementById("fontSizeSelect")?.value || "md";
      prefs.voiceLang = document.getElementById("voiceLangSelect")?.value || "auto";
      prefs.sound = !!document.getElementById("soundToggle")?.checked;
      prefs.haptic = !!document.getElementById("hapticToggle")?.checked;
      prefs.compact = !!document.getElementById("compactToggle")?.checked;
      prefs.timestamps = !!document.getElementById("timestampsToggle")?.checked;
      savePrefs();
      applyPrefs();
      closeModal("settingsModal");
      render();
    });

    document.getElementById("shortcutsClose")?.addEventListener("click", () => closeModal("shortcutsModal"));
    document.getElementById("livePreviewClose")?.addEventListener("click", () => {
      closeModal("livePreviewModal");
      const frame = document.getElementById("livePreviewFrame");
      if (frame) frame.srcdoc = "about:blank";
    });
    document.getElementById("livePreviewReload")?.addEventListener("click", () => {
      const frame = document.getElementById("livePreviewFrame");
      if (frame && frame.dataset.srcHtml) {
        frame.srcdoc = "";
        requestAnimationFrame(() => { frame.srcdoc = frame.dataset.srcHtml; });
      }
    });
    document.getElementById("lightboxClose")?.addEventListener("click", () => {
      document.getElementById("lightbox")?.classList.remove("open");
    });
    document.getElementById("lightbox")?.addEventListener("click", (e) => {
      if (e.target.id === "lightbox") e.currentTarget.classList.remove("open");
    });

    document.getElementById("msgSearch")?.addEventListener("input", (e) => {
      appState.searchQuery = e.target.value || "";
      render();
    });

    // Offline banner
    const banner = document.getElementById("offlineBanner");
    const syncNet = () => {
      if (!banner) return;
      banner.classList.toggle("show", !navigator.onLine);
    };
    window.addEventListener("online", syncNet);
    window.addEventListener("offline", syncNet);
    syncNet();

    // Drag & drop
    const vp = document.querySelector(".chat-viewport");
    const overlay = document.getElementById("dropOverlay");
    if (vp) {
      ["dragenter", "dragover"].forEach(ev => vp.addEventListener(ev, (e) => {
        e.preventDefault(); overlay?.classList.add("show");
      }));
      ["dragleave", "drop"].forEach(ev => vp.addEventListener(ev, (e) => {
        e.preventDefault();
        if (ev === "drop") {
          const file = e.dataTransfer?.files?.[0];
          if (file) {
            const isImg = file.type.startsWith("image/");
            const reader = new FileReader();
            reader.onload = (ev2) => {
              currentFile = { name: file.name, data: ev2.target.result, isImg };
              dom.attachmentNameText.textContent = file.name;
              dom.attachmentPreviewBar.style.display = "flex";
            };
            if (isImg) reader.readAsDataURL(file);
            else reader.readAsText(file);
          }
        }
        overlay?.classList.remove("show");
      }));
    }

    // Keyboard shortcuts
    window.addEventListener("keydown", (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.getElementById("msgSearch")?.focus();
      }
      if (meta && e.key === ",") {
        e.preventDefault();
        openModal("settingsModal");
      }
      if (meta && e.key === "/") {
        e.preventDefault();
        openModal("shortcutsModal");
      }
      if (meta && e.key.toLowerCase() === "n") {
        e.preventDefault();
        dom.clearMemoryBtn?.click();
      }
      if (e.key === "Escape") {
        document.querySelectorAll(".modal-backdrop.open, .lightbox.open").forEach(el => el.classList.remove("open"));
      }
    });
  }

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const isImg = file.type.startsWith("image/");
    const reader = new FileReader();
    reader.onload = (ev) => {
      currentFile = { name: file.name, data: ev.target.result, isImg };
      dom.attachmentNameText.textContent = file.name;
      dom.attachmentPreviewBar.style.display = "flex";
    };
    if (isImg) reader.readAsDataURL(file);
    else reader.readAsText(file);
  }

  function clearFile() {
    currentFile = null;
    dom.fileInput.value = "";
    dom.attachmentPreviewBar.style.display = "none";
  }

  function detectCodeFilename(language, code) {
    const lang = (language || "").toLowerCase();
    const map = {
      js: "script.js",
      javascript: "script.js",
      ts: "script.ts",
      typescript: "script.ts",
      html: "index.html",
      css: "style.css",
      py: "main.py",
      python: "main.py",
      json: "data.json",
      csv: "data.csv",
      md: "README.md",
      markdown: "README.md",
      java: "Main.java",
      c: "main.c",
      cpp: "main.cpp",
      csharp: "Program.cs",
      php: "index.php",
      sh: "script.sh",
      bash: "script.sh",
      sql: "query.sql",
      xml: "data.xml",
      yaml: "config.yaml",
      yml: "config.yml"
    };
    if (map[lang]) return map[lang];
    if (/^<!doctype html/i.test(code) || /<html[\s>]/i.test(code)) return "index.html";
    if (/function\s+\w+\s*\(/i.test(code) || /const\s+\w+\s*=\s*/i.test(code)) return "script.js";
    return "code.txt";
  }

  function wrapHtmlDocument(code) {
    let html = String(code || "").trim();
    // strip outer fence if user passed fenced block
    const fence = html.match(/^```(?:html|htm)?\s*[\r\n]+([\s\S]*?)```$/i);
    if (fence) html = fence[1].trim();
    if (/<!DOCTYPE/i.test(html) || /<html[\s>]/i.test(html)) return html;
    // fragment → full document (like online HTML editors)
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>BOATIN Preview</title>
<style>
  html, body { margin: 0; min-height: 100%; background: #111; color: #eee; font-family: system-ui, sans-serif; }
  canvas { display: block; max-width: 100%; }
</style>
</head>
<body>
${html}
</body>
</html>`;
  }

  function ensurePreviewModal() {
    let modal = document.getElementById("livePreviewModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.id = "livePreviewModal";
    modal.innerHTML = `
      <div class="modal-sheet preview-sheet">
        <div class="preview-toolbar">
          <span class="preview-title">▶ HTML Preview</span>
          <div class="preview-actions">
            <button type="button" class="tb-btn" id="livePreviewReload">↻ Reload</button>
            <button type="button" class="tb-btn" id="livePreviewNewTab">↗ New tab</button>
            <button type="button" class="tb-btn" id="livePreviewClose">✕ Close</button>
          </div>
        </div>
        <iframe id="livePreviewFrame" title="HTML Preview"
          sandbox="allow-scripts allow-forms allow-modals allow-popups"
          referrerpolicy="no-referrer"></iframe>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById("livePreviewClose")?.addEventListener("click", () => {
      const f = document.getElementById("livePreviewFrame");
      if (f) f.srcdoc = "about:blank";
      closeModal("livePreviewModal");
    });
    document.getElementById("livePreviewReload")?.addEventListener("click", () => {
      const f = document.getElementById("livePreviewFrame");
      if (f && f.dataset.srcHtml) {
        const html = f.dataset.srcHtml;
        f.srcdoc = "about:blank";
        requestAnimationFrame(() => { f.srcdoc = html; });
      }
    });
    document.getElementById("livePreviewNewTab")?.addEventListener("click", () => {
      const f = document.getElementById("livePreviewFrame");
      const html = f?.dataset?.srcHtml;
      if (!html) return;
      const w = window.open("", "_blank");
      if (w) { w.document.open(); w.document.write(html); w.document.close(); }
    });
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        const f = document.getElementById("livePreviewFrame");
        if (f) f.srcdoc = "about:blank";
        closeModal("livePreviewModal");
      }
    });
    return modal;
  }

  function openLivePreview(code) {
    ensurePreviewModal();
    const modal = document.getElementById("livePreviewModal");
    const frame = document.getElementById("livePreviewFrame");
    if (!modal || !frame) {
      toastAssist("Preview UI missing");
      return;
    }
    const doc = wrapHtmlDocument(code);
    frame.dataset.srcHtml = doc;
    frame.srcdoc = "about:blank";
    openModal("livePreviewModal");
    requestAnimationFrame(() => { frame.srcdoc = doc; });
  }

  function ensureCodeActions(root) {
    root.querySelectorAll("pre").forEach(pre => {
      if (pre.dataset.enhanced === "1") return;
      const codeEl = pre.querySelector("code");
      if (!codeEl) return;

      pre.dataset.enhanced = "1";

      const raw = codeEl.textContent || "";
      const langClass = [...codeEl.classList].find(c => c.startsWith("language-"));
      const language = langClass ? langClass.slice(9) : "";

      const bar = document.createElement("div");
      bar.className = "code-actions";

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "code-action-btn";
      copyBtn.textContent = "📋 Copy Code";
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(raw);
          const old = copyBtn.textContent;
          copyBtn.textContent = "✓ Copied";
          setTimeout(() => copyBtn.textContent = old, 1200);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = raw;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          document.execCommand("copy");
          ta.remove();
          const old = copyBtn.textContent;
          copyBtn.textContent = "✓ Copied";
          setTimeout(() => copyBtn.textContent = old, 1200);
        }
      };

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "code-action-btn";
      saveBtn.textContent = "💾 Save File";
      saveBtn.onclick = () => {
        const filename = detectCodeFilename(language, raw);
        const blob = new Blob([raw], { type: "text/plain;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      };

      bar.append(copyBtn, saveBtn);

      // HTML / canvas / browser-runnable code → Preview (opens in-app editor frame)
      const looksRunnable =
        language === "html" || language === "htm" || language === "svg" ||
        /<html[\s>]/i.test(raw) || /<!DOCTYPE html/i.test(raw) ||
        /<canvas[\s>]/i.test(raw) || /<body[\s>]/i.test(raw) ||
        /document\.(body|write|getElementById|querySelector)/i.test(raw) ||
        /<script[\s>]/i.test(raw) && /<style[\s>]/i.test(raw);
      if (looksRunnable) {
        const previewBtn = document.createElement("button");
        previewBtn.type = "button";
        previewBtn.className = "code-action-btn preview-btn";
        previewBtn.textContent = "▶ Preview HTML";
        previewBtn.title = "Open live preview (sandbox)";
        previewBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          openLivePreview(raw);
        };
        bar.appendChild(previewBtn);
      }

      // Multi-file ZIP: if this pre is inside a message that has 2+ code blocks
      const bubble = pre.closest(".message-bubble");
      if (bubble && !bubble.dataset.zipBtn) {
        const allCode = bubble.innerText || "";
        const blocks = (typeof extractAllCodeBlocks === "function")
          ? extractAllCodeBlocks(
              // rebuild from pre/code elements for accuracy
              Array.from(bubble.querySelectorAll("pre code")).map(c =>
                "```\n" + (c.textContent || "") + "\n```"
              ).join("\n")
            )
          : [];
        if (blocks.length >= 2) {
          bubble.dataset.zipBtn = "1";
          const zipBtn = document.createElement("button");
          zipBtn.type = "button";
          zipBtn.className = "code-action-btn";
          zipBtn.textContent = "📦 ZIP " + blocks.length + " files";
          zipBtn.title = "Download all code blocks as a zip";
          zipBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const payload = Array.from(bubble.querySelectorAll("pre code")).map(c =>
              "```\n" + (c.textContent || "") + "\n```"
            ).join("\n");
            downloadZipFromText(payload, "powerhouse-build.zip");
          };
          bar.appendChild(zipBtn);
        }
      }

      pre.appendChild(bar);
    });
  }


  function isNearBottom(el, threshold = 100) {
    if (!el) return true;
    return (el.scrollHeight - el.scrollTop - el.clientHeight) <= threshold;
  }

  function updateScrollBottomBtn() {
    const el = dom.messagesContainer || document.getElementById("messagesContainer");
    const btn = document.getElementById("scrollBottomBtn");
    if (!el || !btn) return;
    const overflows = el.scrollHeight > el.clientHeight + 24;
    const near = isNearBottom(el, 120);
    if (overflows && !near) btn.classList.add("visible");
    else btn.classList.remove("visible");
  }

  function scrollToBottom(smooth = true) {
    const el = dom.messagesContainer || document.getElementById("messagesContainer");
    if (!el) return;
    const go = () => {
      const top = el.scrollHeight;
      try { el.scrollTo({ top, behavior: smooth ? "smooth" : "auto" }); }
      catch (_) { el.scrollTop = top; }
      el.scrollTop = top;
    };
    go();
    requestAnimationFrame(go);
    setTimeout(() => { go(); updateScrollBottomBtn(); }, smooth ? 350 : 40);
  }


  function resolveVoiceLang() {
    const pref = (typeof prefs !== "undefined" && prefs.voiceLang) || localStorage.getItem("nv_voice") || "auto";
    if (pref && pref !== "auto") return pref;
    const sample = (dom.messageTextInput?.value || "") + " " +
      (appState.messages || []).slice(-3).map(m => typeof m.content === "string" ? m.content : "").join(" ");
    if (/[\u0980-\u09FF]/.test(sample)) return "bn-IN";
    if (/[\u0900-\u097F]/.test(sample)) return "hi-IN";
    return "en-US";
  }

  function resetAllListenButtons() {
    document.querySelectorAll(".listen-msg-btn.speaking, #listenBtn.speaking").forEach(b => {
      b.classList.remove("speaking");
      if (b.id === "listenBtn") b.textContent = "🎧 Listen";
      else b.textContent = "🎧 Listen";
    });
  }

  function speakTextContent(text, btn) {
    if (!window.speechSynthesis) {
      toastAssist("Listen not supported in this browser");
      return;
    }
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      resetAllListenButtons();
      // If same button was speaking, just stop
      if (btn && btn.dataset.speaking === "1") {
        btn.dataset.speaking = "0";
        return;
      }
    }
    const clean = String(text || "")
      .replace(/```[\s\S]*?```/g, " code block ")
      .replace(/[`*_#>\[\]\(\)]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
    if (!clean) {
      toastAssist("Listen করার মতো টেক্সট নেই");
      return;
    }
    const u = new SpeechSynthesisUtterance(clean);
    u.rate = 1.02;
    u.pitch = 1;
    try {
      const want = resolveVoiceLang();
      const voices = window.speechSynthesis.getVoices() || [];
      const pick = voices.find(v => v.lang === want) ||
        voices.find(v => v.lang && v.lang.startsWith(want.slice(0, 2)));
      if (pick) u.voice = pick;
      u.lang = want;
    } catch (_) {}
    resetAllListenButtons();
    if (btn) {
      btn.classList.add("speaking");
      btn.textContent = "⏹ Stop";
      btn.dataset.speaking = "1";
    }
    const composer = document.getElementById("listenBtn");
    if (composer && btn !== composer) {
      composer.classList.add("speaking");
      composer.textContent = "⏹ Stop";
    }
    u.onend = u.onerror = () => {
      if (btn) {
        btn.classList.remove("speaking");
        btn.textContent = "🎧 Listen";
        btn.dataset.speaking = "0";
      }
      if (composer) {
        composer.classList.remove("speaking");
        composer.textContent = "🎧 Listen";
      }
    };
    window.speechSynthesis.speak(u);
  }

  function listenLastReply() {
    const last = [...(appState.messages || [])].reverse().find(
      m => m.role === "assistant" && typeof m.content === "string" && m.content.trim()
    );
    if (!last) {
      toastAssist("Listen করার মতো কোনো রিপ্লাই নেই");
      return;
    }
    speakTextContent(last.content, document.getElementById("listenBtn"));
  }

  function bindScrollUi() {
    const el = dom.messagesContainer || document.getElementById("messagesContainer");
    const btn = document.getElementById("scrollBottomBtn");
    if (el && !el.dataset.scrollBound) {
      el.dataset.scrollBound = "1";
      el.addEventListener("scroll", updateScrollBottomBtn, { passive: true });
      // Re-check when content size changes (images, streaming)
      try {
        const ro = new ResizeObserver(() => updateScrollBottomBtn());
        ro.observe(el);
      } catch (_) {}
    }
    if (btn && !btn.dataset.scrollBound) {
      btn.dataset.scrollBound = "1";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        scrollToBottom(true);
      });
    }
    updateScrollBottomBtn();
  }

  function render() {
    const _sc = dom.messagesContainer;
    // Stick to bottom unless user clearly scrolled up to read history
    if (_sc) {
      window.__boatinStickBottom = isNearBottom(_sc, 180) || !!appState.isGenerating || _sc.scrollHeight <= _sc.clientHeight + 40;
    } else {
      window.__boatinStickBottom = true;
    }
    dom.messagesContainer.innerHTML = "";
    const q = (appState.searchQuery || "").trim().toLowerCase();
    const lastAssistantIdx = (() => {
      for (let i = appState.messages.length - 1; i >= 0; i--) {
        if (appState.messages[i].role === "assistant") return i;
      }
      return -1;
    })();
    const lastUserIdx = (() => {
      for (let i = appState.messages.length - 1; i >= 0; i--) {
        if (appState.messages[i].role === "user") return i;
      }
      return -1;
    })();

    appState.messages.forEach((m, idx) => {
      if (q) {
        const hay = (typeof m.content === "string" ? m.content : "").toLowerCase();
        if (!hay.includes(q)) return;
      }

      const div = document.createElement("div");
      div.className = "message-bubble " + m.role;
      const body = m.ui || safeMarkdown(typeof m.content === "string" ? m.content : coerceText(m.content));
      div.innerHTML = body;

      // Timestamps
      if (prefs.timestamps && m.ts) {
        const meta = document.createElement("div");
        meta.className = "msg-meta";
        const t = document.createElement("time");
        try { t.textContent = new Date(m.ts).toLocaleString(); }
        catch { t.textContent = ""; }
        meta.appendChild(t);
        div.appendChild(meta);
      }

      // Lightbox for generated / attached images in bubble
      div.querySelectorAll("img").forEach(img => {
        img.style.cursor = "zoom-in";
        img.addEventListener("click", () => openLightbox(img.src));
      });

      if (m.role === "assistant" && typeof m.content === "string") {
        const footer = document.createElement("div");
        footer.className = "msg-footer";

        if (m.model) {
          const badge = document.createElement("span");
          badge.className = "msg-model-badge";
          badge.title = m.model;
          badge.textContent = getModelInfo(m.model)?.label || m.model;
          footer.appendChild(badge);
        }
        if (m.tokPerSec) {
          const tps = document.createElement("span");
          tps.className = "msg-model-badge";
          tps.title = "Approx tokens per second";
          tps.textContent = "⚡ " + m.tokPerSec + " tok/s";
          footer.appendChild(tps);
        }

        const spacer = document.createElement("span");
        spacer.className = "msg-footer-spacer";
        footer.appendChild(spacer);

        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "code-action-btn";
        copyBtn.textContent = "📋 Copy";
        copyBtn.onclick = async () => {
          try {
            await navigator.clipboard.writeText(m.content);
            copyBtn.textContent = "✓ Copied";
            setTimeout(() => { copyBtn.textContent = "📋 Copy"; }, 1100);
          } catch {
            copyBtn.textContent = "Failed";
            setTimeout(() => { copyBtn.textContent = "📋 Copy"; }, 1100);
          }
        };
        footer.appendChild(copyBtn);

        const listenMsgBtn = document.createElement("button");
        listenMsgBtn.type = "button";
        listenMsgBtn.className = "code-action-btn listen-msg-btn";
        listenMsgBtn.textContent = "🎧 Listen";
        listenMsgBtn.title = "Speak this reply";
        listenMsgBtn.onclick = () => speakTextContent(m.content, listenMsgBtn);
        footer.appendChild(listenMsgBtn);

        if (idx === lastAssistantIdx) {
          const regen = document.createElement("button");
          regen.type = "button";
          regen.className = "code-action-btn";
          regen.textContent = "↻ Regen";
          regen.onclick = () => regenerateLast();
          footer.appendChild(regen);
        }
        div.appendChild(footer);
      }

      if (m.role === "user" && idx === lastUserIdx && typeof m.content === "string" && !appState.isGenerating) {
        const footer = document.createElement("div");
        footer.className = "msg-footer";
        const spacer = document.createElement("span");
        spacer.className = "msg-footer-spacer";
        footer.appendChild(spacer);
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "code-action-btn";
        editBtn.textContent = "✏️ Edit";
        editBtn.onclick = () => startEditUserMessage(idx, div, m);
        footer.appendChild(editBtn);
        div.appendChild(footer);
      }

      dom.messagesContainer.appendChild(div);
    });
    if (typeof hljs !== "undefined" && hljs && typeof hljs.highlightElement === "function") {
      document.querySelectorAll("pre code").forEach(el => {
        try { hljs.highlightElement(el); } catch (_) { /* skip highlighting, keep raw code */ }
      });
    }
    ensureCodeActions(dom.messagesContainer);
    requestAnimationFrame(() => {
      bindScrollUi();
      const el = dom.messagesContainer;
      if (el && (window.__boatinStickBottom || isNearBottom(el, 200) || appState.isGenerating)) {
        el.scrollTop = el.scrollHeight;
        requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; updateScrollBottomBtn(); });
      } else {
        updateScrollBottomBtn();
      }
      window.__boatinStickBottom = false;
    });
    updateCtxPill();
  }

  function openLightbox(src) {
    const box = document.getElementById("lightbox");
    const img = document.getElementById("lightboxImg");
    if (!box || !img) return;
    img.src = src;
    box.classList.add("open");
  }


  function startEditUserMessage(idx, bubbleEl, msg) {
    const original = typeof msg.content === "string" ? msg.content : "";
    bubbleEl.innerHTML = "";
    const ta = document.createElement("textarea");
    ta.className = "msg-edit-box";
    ta.value = original;
    const actions = document.createElement("div");
    actions.className = "msg-edit-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "code-action-btn";
    save.textContent = "Save & Resend";
    save.style.borderColor = "var(--color-accent-primary)";
    save.style.color = "var(--color-accent-primary)";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "code-action-btn";
    cancel.textContent = "Cancel";
    cancel.onclick = () => render();
    save.onclick = async () => {
      const newText = ta.value.trim();
      if (!newText) return;
      // Drop this user message and everything after
      appState.messages = appState.messages.slice(0, idx);
      appState.messages.push({ role: "user", content: newText });
      persistMessages();
      render();
      await runChatCompletion(newText, false);
    };
    actions.append(save, cancel);
    bubbleEl.append(ta, actions);
    ta.focus();
  }



  function chooseAutoModel(text, hasImage = false) {
    const t = (text || "").toLowerCase();
    const trimmed = (text || "").trim();
    const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
    const DEFAULT = "nvidia/llama-3.3-nemotron-super-49b-v1.5";
    const STRONG = "meta/llama-3.1-70b-instruct";
    const FAST = "groq/llama-3.1-8b-instant";
    const GROQ_FAST = "groq/llama-3.1-8b-instant";
    const FAST_FALLBACK = "meta/llama-3.1-8b-instruct";
    const pick = (category, fallback) => {
      const found = NVIDIA_MODELS.find(m => m.category === category && !isImageModel(m.value) && m.value !== "power/agent");
      return found?.value || fallback || DEFAULT;
    };

    if (hasImage || /image|photo|picture|screenshot|vision|ছবি|ইমেজ|স্ক্রিনশট/.test(t)) {
      return pick("👁️ Vision", "nvidia/nemotron-nano-12b-v2-vl");
    }
    if (/code|coding|program|javascript|python|html|css|debug|কোড|প্রোগ্রাম/.test(t)) {
      return pick("💻 Coding", DEFAULT);
    }
    if (/reason|math|solve|proof|logic|hard|complex|গণিত|সমাধান|যুক্তি|কঠিন/.test(t)) {
      return pick("🧠 Reasoning", DEFAULT);
    }
    if (/live search|web search|search the web|search online|latest|today|current|news|recent|internet|source|sources|cite|citation|ওয়েবে খোঁজ|ওয়েবে খোঁজ|লাইভ সার্চ|সাম্প্রতিক|আজকের খবর|বর্তমান|উৎস|সোর্স/.test(t)) {
      return "webpulse/nemotron-super";
    }
    if (/fast|quick|simple|সহজ|দ্রুত/.test(t)) {
      return FAST;
    }
    const effortKey = (dom.effortMode?.value || "mid").toLowerCase();
    if (effortKey === "max" || effortKey === "high") {
      return wordCount > 40 || /code|কোড|debug|architect/i.test(t) ? DEFAULT : STRONG;
    }
    if (effortKey === "low") {
      return FAST;
    }
    const looksComplex = wordCount > 30 || /[.?!].*[.?!]/.test(trimmed);
    if (!looksComplex && wordCount > 0 && wordCount <= 20) {
      return FAST;
    }
    return DEFAULT;
  }

  function getModelInfo(id) {
    return NVIDIA_MODELS.find(m => m.value === id) || null;
  }

  function getFallbackModels(primaryId) {
    const primary = getModelInfo(primaryId);

    // Image-generation/editing models never enter chat fallback.
    if (isImageModel(primaryId)) return [];

    const chatModels = NVIDIA_MODELS.filter(m =>
      !isImageModel(m.value) &&
      !isLiveSearchModel(m.value) &&
      m.value !== "power/agent" &&
      !/^webpulse\//i.test(m.value)
    );

    if (!primary) return chatModels.slice(0, 6);

    const sameCategory = chatModels.filter(m =>
      m.category === primary.category && m.value !== primaryId
    );

    const allOthers = chatModels.filter(m =>
      m.value !== primaryId &&
      !sameCategory.some(s => s.value === m.value)
    );

    return [...sameCategory, ...allOthers];
  }

  function applyEffortToMessages(messages) {
    const effort = getEffortConfig();
    const custom = (prefs.systemPrompt || "").trim();
    const lastUser = [...(messages || [])].reverse().find(m => m.role === "user");
    const bangla = lastUser && isBanglaText(typeof lastUser.content === "string" ? lastUser.content : "");
    const langHint = bangla ? " Reply in clear বাংলা (Bangla) unless the user asked for another language." : "";
    const powerBoost =
      "You are BOATIN — a high-capability assistant. Be accurate, concrete, and useful. " +
      "For coding: full runnable code, no TODOs/placeholders. For facts: be careful; say when unsure. " +
      "Never dump internal monologue (no 'Okay/Hmm/Let's think'). Final answer only.";
    const base = powerBoost + "\n\n[Effort: " + effort.label + "] " + effort.systemHint + langHint + (custom ? "\n\nUser instructions:\n" + custom : "");
    const hasSystem = messages.some(m => m.role === "system");
    if (hasSystem) {
      return messages.map((m, i) => {
        if (i === 0 && m.role === "system" && typeof m.content === "string") {
          return { ...m, content: base + "\n\n" + m.content };
        }
        return m;
      });
    }
    return [
      { role: "system", content: base },
      ...messages
    ];
  }

  // Retry helper: retries only transient failures (network drop, 429, 502/503/504)
  // with exponential backoff. Never retries on user-abort or normal model/HTTP errors
  // that should instead fall through to the next candidate model.
    async function fetchWithRetry(url, options, signal, maxRetries = 2) {
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) {
        const e = new Error("Aborted");
        e.name = "AbortError";
        throw e;
      }
      try {
        const res = await fetch(url, { ...options, signal, mode: "cors", cache: "no-store" });
        // Retry transient 5xx / 429
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error("Server " + res.status);
          if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
            continue;
          }
          return res;
        }
        return res;
      } catch (err) {
        if (err?.name === "AbortError" || signal?.aborted) throw err;
        lastErr = err;
        const msg = String(err?.message || err || "");
        if (attempt < maxRetries && /fetch|network|Failed|Load failed|CORS/i.test(msg)) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        // Friendlier message for the classic browser network error
        if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
          throw new Error(
            "Failed to fetch — Worker unreachable or CORS blocked.\\n" +
            "1) Deploy latest worker.js to Cloudflare\\n" +
            "2) Open https://boatin.uplinkstudio.workers.dev/health\\n" +
            "3) Hard-refresh this page\\n" +
            "Worker: " + String(url).replace(/\/+$/, "")
          );
        }
        throw err;
      }
    }
    throw lastErr || new Error("Request failed after retries.");
  }

async function callModelStreaming(modelId, messages, onChunk, signal) {
    const streamStartedAt = Date.now();
    let streamChars = 0;
    const trackedChunk = (partial) => {
      streamChars = String(partial || "").length;
      if (emit) emit(partial);
    };
    const emit = onChunk ? trackedChunk : null;
    const effort = getEffortConfig();
    const msgs = applyEffortToMessages(messages);
    const payload = {
      model: modelId,
      messages: msgs,
      temperature: effort.temperature,
      top_p: effort.top_p,
      max_tokens: effort.max_tokens,
      stream: true
    };
    // Nemotron Ultra sometimes needs thinking disabled for plain content
    if (/nemotron/i.test(modelId)) {
      payload.chat_template_kwargs = { enable_thinking: false };
    }

    const res = await fetchWithRetry(WORKER_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream, application/json" },
      body: JSON.stringify(payload),
      signal
    }, signal);

    if (!res.ok) {
      const raw = await res.text();
      let detail = raw;
      try {
        const d = JSON.parse(raw);
        detail = d?.detail || d?.message || d?.error?.message || d?.error || raw;
      } catch (_) {}
      return { ok: false, status: res.status, error: String(detail).slice(0, 800) };
    }

    // Non-SSE JSON body (some proxies collapse stream)
    const ct = (res.headers.get("Content-Type") || "").toLowerCase();
    if (!ct.includes("text/event-stream") && !ct.includes("stream")) {
      const raw = await res.text();
      try {
        const data = JSON.parse(raw);
        const reply = extractAssistantText(data) || data?.choices?.[0]?.message?.content || "";
        if (reply) {
          onChunk?.(reply);
          return { ok: true, reply };
        }
        return { ok: false, status: res.status, error: "No assistant content returned.", rawText: raw.slice(0, 500) };
      } catch {
        if (raw && raw.trim()) {
          onChunk?.(raw);
          return { ok: true, reply: raw };
        }
        return { ok: false, status: res.status, error: "Empty non-stream response." };
      }
    }

    if (!res.body) {
      return { ok: false, status: res.status, error: "Streaming response body is unavailable." };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let reasoning = "";

    const processLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "[DONE]") return;
      const payloadLine = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
      if (!payloadLine || payloadLine === "[DONE]") return;

      try {
        const obj = JSON.parse(payloadLine);
        const choice = obj?.choices?.[0];
        const delta = choice?.delta || {};
        const content =
          (typeof delta.content === "string" && delta.content) ||
          (typeof choice?.message?.content === "string" && choice.message.content) ||
          (typeof delta.text === "string" && delta.text) ||
          "";
        const reason =
          (typeof delta.reasoning_content === "string" && delta.reasoning_content) ||
          (typeof delta.reasoning === "string" && delta.reasoning) ||
          "";

        if (content) {
          if (!/^\s*\(?thinking\.\.\.\)?\s*$/i.test(content)) {
            fullText += content;
            emit?.(fullText);
          }
        } else if (reason) {
          // Accumulate internal reasoning but never paint it as the reply bubble
          reasoning += reason;
        }
      } catch (_) {}
    };

    try {
      while (true) {
        if (signal?.aborted) {
          try { await reader.cancel(); } catch (_) {}
          return { ok: true, reply: fullText || (reasoning ? "_(Model only produced internal reasoning. Try again or lower Effort.)_" : "_(generation stopped)_"), stopped: true };
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        lines.forEach(processLine);
      }
    } catch (err) {
      if (err?.name === "AbortError" || signal?.aborted) {
        return { ok: true, reply: fullText || (reasoning ? "_(Model only produced internal reasoning. Try again or lower Effort.)_" : "_(generation stopped)_"), stopped: true };
      }
      throw err;
    }

    buffer += decoder.decode();
    if (buffer.trim()) processLine(buffer);

    if (fullText) return { ok: true, reply: fullText || (reasoning ? "The model spent its budget on internal reasoning and returned no final answer. Try **Effort Mid** or another model." : ""), tokPerSec: formatTokPerSec((fullText||reasoning).length, Date.now() - streamStartedAt), elapsedMs: Date.now() - streamStartedAt };
    if (reasoning) return { ok: true, reply: reasoning, tokPerSec: formatTokPerSec(String(reasoning).length, Date.now() - streamStartedAt), elapsedMs: Date.now() - streamStartedAt };

    // Stream empty → one non-stream retry
    try {
      const fallback = await callModel(modelId, messages, signal);
      if (fallback?.ok && fallback.reply) {
        onChunk?.(fallback.reply);
        return fallback;
      }
      return fallback || { ok: false, status: res.status, error: "Stream ended without assistant content." };
    } catch (e) {
      return { ok: false, status: res.status, error: e.message || "Stream ended without assistant content." };
    }
  }


  function coerceText(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (Array.isArray(v)) {
      return v.map(part => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          return part.text || part.content || part.value || "";
        }
        return "";
      }).join("");
    }
    if (typeof v === "object") {
      return coerceText(v.text || v.content || v.message || v.value || "");
    }
    return String(v);
  }

  async function callModel(modelId, messages, signal) {
    const effort = getEffortConfig();
    const msgs = applyEffortToMessages(messages);
    const res = await fetchWithRetry(WORKER_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        messages: msgs,
        temperature: effort.temperature,
        top_p: effort.top_p,
        max_tokens: effort.max_tokens
      }),
      signal
    }, signal);

    const rawText = await res.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      return {
        ok: false,
        status: res.status,
        error: "Server returned non-JSON response.",
        rawText
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: data?.detail || data?.message || data?.error?.message || JSON.stringify(data),
        rawText
      };
    }

    const msg = data?.choices?.[0]?.message || {};
    let reply = coerceText(msg.content);
    if (!reply) reply = coerceText(msg.text || data?.output_text || msg.reasoning_content || "");
    if (!reply) {
      return {
        ok: false,
        status: res.status,
        error: "No assistant content returned. Model may be unavailable on free tier.",
        rawText: String(rawText).slice(0, 600)
      };
    }

    return { ok: true, reply, data };
  }

  const IMAGE_MODEL_IDS = new Set([
    "qwen/qwen-image",
    "qwen/qwen-image-2512",
    "qwen/qwen-image-edit",
    "black-forest-labs/flux.1-dev",
    "black-forest-labs/flux.1-schnell",
    "stabilityai/stable-diffusion-3.5-large"
  ]);

  function isImageModel(modelId) {
    const id = String(modelId || "").toLowerCase();
    if (!id) return false;
    if (IMAGE_MODEL_IDS.has(modelId) || IMAGE_MODEL_IDS.has(id)) return true;
    const info = getModelInfo(modelId);
    if (info && /image/i.test(info.category || "")) return true;
    // Hard fallback by id patterns used on NVIDIA NIM
    return /qwen-image|flux\.|stable-diffusion|sdxl|sd3|imagen|text-to-image/i.test(id);
  }

  const LIVE_SEARCH_MODEL_IDS = new Set([
    "webpulse/nemotron-super",
    "webpulse/llama8b",
    "webpulse/llama70",
    "webpulse/gptoss",
    // legacy aliases still accepted
    "webpulse/llama3b",
    "webpulse/mistral",
    "webpulse/nemotron-fast",
    "webpulse/deepseek",
    "webpulse/llama405"
  ]);

  function isLiveSearchModel(modelId) {
    const id = String(modelId || "");
    if (!id) return false;
    if (LIVE_SEARCH_MODEL_IDS.has(id)) return true;
    // Any webpulse/* alias is research mode (never send these IDs to NVIDIA)
    if (/^webpulse\//i.test(id)) return true;
    if (/research|web\s*pulse|live\s*search/i.test(id)) return true;
    const info = getModelInfo(id);
    if (info && /web\s*pulse|live\s*search/i.test(info.category || "")) return true;
    return false;
  }

  /** Map UI / research aliases → real NVIDIA chat model IDs */
  function resolveChatModelId(modelId) {
    const id = String(modelId || "");
    if (!id) return "nvidia/llama-3.3-nemotron-super-49b-v1.5";
    if (WEB_PULSE_SYNTH_MAP[id]) return WEB_PULSE_SYNTH_MAP[id];
    if (/^webpulse\//i.test(id)) return "nvidia/llama-3.3-nemotron-super-49b-v1.5";
    if (isLiveSearchModel(id)) return "nvidia/llama-3.3-nemotron-super-49b-v1.5";
    return id;
  }

  // Maps each Web Pulse dropdown entry to the real NIM model that should
  // synthesize its answer, so picking e.g. "GLM-5.1 • Web Pulse" actually
  // prefers GLM-5.1 rather than always defaulting to the same model.
  const WEB_PULSE_SYNTH_MAP = {
    "webpulse/nemotron-super": "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    "webpulse/nemotron-fast": "nvidia/llama-3.3-nemotron-super-49b-v1",
    "webpulse/llama8b": "meta/llama-3.1-8b-instruct",
    "webpulse/llama70": "meta/llama-3.1-70b-instruct",
    "webpulse/gptoss": "openai/gpt-oss-20b",
    "webpulse/llama3b": "meta/llama-3.1-8b-instruct",
    "webpulse/mistral": "openai/gpt-oss-20b",
    "webpulse/deepseek": "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    "webpulse/llama405": "meta/llama-3.1-70b-instruct"
  };

  // Only models verified on this NVIDIA key (others return 404)
  const LIVE_SYNTH_MODELS = [
    "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    "meta/llama-3.1-70b-instruct",
    "nvidia/llama-3.3-nemotron-super-49b-v1",
    "meta/llama-3.1-8b-instruct",
    "openai/gpt-oss-20b"
  ];


  function isWeatherQuery(text) {
    return /(?:\bweather\b|\bforecast\b|\btemperature\b|আবহাওয়া|আবহাওয়া|তাপমাত্রা|বৃষ্টি|গরম|ঠান্ডা|cold\b|rain\b|humidity)/i.test(String(text || ""));
  }

  function extractWeatherPlace(text) {
    const t = String(text || "").trim();
    const m =
      t.match(/(?:in|at|for|এ|তে|এর)\s+([A-Za-z\u0980-\u09FF][A-Za-z\u0980-\u09FF\s\-]{1,40})$/i) ||
      t.match(/^(?:weather|forecast|আবহাওয়া|আবহাওয়া)\s+(?:in\s+|at\s+|for\s+)?(.+)$/i) ||
      t.match(/^(.+?)\s+(?:weather|forecast|আবহাওয়া|আবহাওয়া)\s*$/i);
    if (m) return m[1].replace(/[?!.]+$/, "").trim();
    // strip keywords
    const cleaned = t
      .replace(/(?:what(?:'s| is)?|how is|tell me|show|check|এখন|কেমন|কি|কী)/gi, " ")
      .replace(/(?:weather|forecast|temperature|আবহাওয়া|আবহাওয়া|তাপমাত্রা)/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned || "Dhaka";
  }

  function formatWeatherMarkdown(data) {
    const c = data.current || {};
    const lines = [
      `### 🌤️ Weather — ${data.location || "Unknown"}`,
      "",
      `**Now:** ${c.condition || "—"}`,
      `- Temperature: **${c.temperature ?? "—"}°C** (feels like ${c.feelsLike ?? "—"}°C)`,
      `- Humidity: ${c.humidity ?? "—"}%`,
      `- Wind: ${c.windSpeed ?? "—"} km/h`,
      `- Precipitation: ${c.precipitation ?? "—"} mm`,
      ""
    ];
    if (Array.isArray(data.daily) && data.daily.length) {
      lines.push("**Next days:**");
      data.daily.forEach((d) => {
        lines.push(
          `- ${d.date}: ${d.condition || "—"} · ${d.min ?? "—"}° / ${d.max ?? "—"}°C · rain ${d.rain ?? "—"} mm`
        );
      });
    }
    lines.push("", `_Source: Open-Meteo_`);
    return lines.join("\n");
  }

  async function fetchWeather(place) {
    const endpoint = WORKER_PROXY_URL.replace(/\/+$/, "") + "/weather";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: place || "Dhaka" })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.details || ("Weather HTTP " + res.status));
    return data;
  }


  async function liveWebSearch(query) {
    const q = String(query || "").trim();
    if (!q) throw new Error("Empty search query.");

    // PRIMARY: Cloudflare Worker /search (server-side, no CORS block)
    const endpoint = WORKER_PROXY_URL.replace(/\/+$/, "") + "/search";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: q })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data && (data.text || (data.sources && data.sources.length))) {
        return {
          text: String(data.text || "").slice(0, 22000),
          sources: Array.isArray(data.sources) ? data.sources.slice(0, 10) : [],
          providerCount: data.providerCount || 0
        };
      }
      // If worker returned error, fall through to limited client fallback
      console.warn("Worker /search failed:", data?.error || res.status);
    } catch (e) {
      console.warn("Worker /search network error:", e.message);
    }

    // FALLBACK: Wikipedia + DDG Instant only (usually CORS-OK)
    const enc = encodeURIComponent(q);
    const mergedSources = [];
    const seen = new Set();
    const chunks = [];
    const pushSource = (title, url, snippet = "") => {
      try {
        const u = new URL(String(url));
        const key = u.hostname + u.pathname;
        if (seen.has(key)) return;
        seen.add(key);
        mergedSources.push({
          title: String(title || u.hostname).slice(0, 160),
          url: u.href,
          domain: u.hostname.replace(/^www\./, ""),
          snippet: String(snippet || "").slice(0, 240)
        });
      } catch (_) {}
    };

    try {
      const wiki = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc}&utf8=1&format=json&origin=*&srlimit=5`
      );
      if (wiki.ok) {
        const j = await wiki.json();
        const bits = [];
        (j?.query?.search || []).forEach(h => {
          const title = h.title || "";
          const snippet = String(h.snippet || "").replace(/<[^>]+>/g, "");
          const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
          bits.push(`• ${title}: ${snippet}`);
          pushSource(title + " — Wikipedia", url, snippet);
        });
        if (bits.length) chunks.push("[Wikipedia]\n" + bits.join("\n"));
      }
    } catch (_) {}

    try {
      const ddg = await fetch(
        `https://api.duckduckgo.com/?q=${enc}&format=json&no_html=1&skip_disambig=1`
      );
      if (ddg.ok) {
        const j = await ddg.json();
        const bits = [];
        if (j.AbstractText) bits.push(j.AbstractText);
        if (j.Answer) bits.push(j.Answer);
        (j.RelatedTopics || []).slice(0, 6).forEach(t => {
          if (t.Text) bits.push("• " + t.Text);
          if (t.FirstURL && t.Text) pushSource(t.Text, t.FirstURL, t.Text);
        });
        if (j.AbstractURL) pushSource(j.Heading || "DDG", j.AbstractURL, j.AbstractText || "");
        if (bits.length) chunks.push("[DuckDuckGo]\n" + bits.join("\n"));
      }
    } catch (_) {}

    const combined = chunks.join("\n\n");
    if (combined.trim().length < 40 && !mergedSources.length) {
      throw new Error(
        "Web search failed. Deploy the updated Worker with POST /search, then hard-refresh the app."
      );
    }
    return {
      text: combined.slice(0, 16000),
      sources: mergedSources.slice(0, 10),
      providerCount: chunks.length
    };
  }

  function isJunkSource(title, url) {
    const t = String(title || "").trim();
    const href = String(url || "");
    let host = "";
    try { host = new URL(href).hostname.toLowerCase(); } catch { return true; }

    if (/external-content\.duckduckgo\.com/i.test(host)) return true;
    if (/duckduckgo\.com$/i.test(host) && /\/(i\/|y\.js|l\/|cdn)/i.test(href)) return true;
    if (/^(www\.)?(google|bing|yahoo)\./i.test(host) && /\/(search|url|aclk|images|imgres)/i.test(href)) return true;
    if (/\.(png|jpe?g|gif|webp|svg|ico|bmp|css|js)(\?|$)/i.test(href)) return true;
    if (/\/(images?|img|static|thumb|thumbnail|icon|avatar|logo)\//i.test(href)) return true;
    if (/^!?\[?Image\b/i.test(t)) return true;
    if (/^Image\s*\d+$/i.test(t)) return true;
    if (/^!\[/i.test(t)) return true;
    if (t.length < 3) return true;
    return false;
  }

  function extractSearchSources(raw) {
    const results = [];
    const seen = new Set();

    const push = (title, url) => {
      if (results.length >= 12) return;
      try {
        const u = new URL(String(url).replace(/[),.;]+$/, ""));
        if (!/^https?:$/.test(u.protocol)) return;
        let cleanTitle = String(title || "").replace(/\s+/g, " ").trim();
        cleanTitle = cleanTitle.replace(/^!\[[^\]]*\]\s*/g, "").replace(/^\[[^\]]*\]\s*/g, "").trim();
        if (isJunkSource(cleanTitle, u.href)) return;
        const key = u.hostname + u.pathname;
        if (seen.has(key)) return;
        seen.add(key);
        results.push({
          title: cleanTitle || u.hostname.replace(/^www\./, ""),
          url: u.href,
          domain: u.hostname.replace(/^www\./, "")
        });
      } catch (_) {}
    };

    const re = /\[([^\]]{2,180})\]\((https?:\/\/[^)\s]+)\)/g;
    let m;
    while ((m = re.exec(raw)) !== null && results.length < 12) {
      push(m[1], m[2]);
    }

    // Title-like lines near URLs
    const lines = String(raw || "").split(/\n/);
    for (let i = 0; i < lines.length && results.length < 12; i++) {
      const line = lines[i];
      const urlMatch = line.match(/https?:\/\/[^\s<>"')]+/);
      if (!urlMatch) continue;
      let title = line.replace(urlMatch[0], "").replace(/[\[\]\(\)*#_]/g, " ").trim();
      if (title.length < 4 && i > 0) {
        title = lines[i - 1].replace(/[\[\]\(\)*#_]/g, " ").trim();
      }
      push(title, urlMatch[0]);
    }

    if (results.length < 3) {
      const urls = raw.match(/https?:\/\/[^\s<>"')]+/g) || [];
      for (const rawUrl of urls) {
        if (results.length >= 12) break;
        push("", rawUrl);
      }
    }
    return results;
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, ch => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    }[ch]));
  }

  function renderSources(sources) {
    if (!Array.isArray(sources) || !sources.length) return "";
    const id = "src_" + Date.now() + "_" + Math.floor(Math.random() * 9999);
    const items = sources.slice(0, 12).map((src, idx) => `
      <div class="source-item">
        <span>${idx + 1}.</span>
        <div>
          <a href="${escapeHtml(src.url)}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(src.title || src.domain)}
          </a>
          <div class="source-domain">${escapeHtml(src.domain || "")}${src.snippet ? " · " + escapeHtml(String(src.snippet).slice(0, 90)) : ""}</div>
        </div>
      </div>
    `).join("");

    return `<div class="sources-wrap">
      <button type="button" class="sources-toggle" data-src-panel="${id}" onclick="(function(b){var p=document.getElementById('${id}');if(!p)return;var o=p.classList.toggle('open');b.setAttribute('aria-expanded',o?'true':'false');})(this)">
        🔗 Sources <span class="src-count">${Math.min(sources.length, 12)}</span>
      </button>
      <div class="sources-panel" id="${id}">${items}</div>
    </div>`;
  }

  // ─── POWER HOUSE AGENT ────────────────────────────────────────────────
  // Autonomous plan → build → self-review → fix loop for coding requests.
  // Runs multiple model calls internally so a single user request goes
  // through the same discipline a careful engineer would: plan first,
  // write the full solution, review your own output for bugs, then patch
  // before handing it back. Ends with a runnable live-preview button for
  // HTML/CSS/JS output.
  // Power House: best model per stage (plan / write / review / fix)
  // Groq = speed; Nemotron/Llama = deeper reasoning. Falls back if a call fails.
  const POWER_HOUSE_MODELS = {
    // Plan/Review = deeper NVIDIA; Write/Fix = Groq 70B first (fast+strong), then Nemotron
    plan:   ["nvidia/llama-3.3-nemotron-super-49b-v1.5", "nvidia/nemotron-3-super-120b-a12b", "meta/llama-3.1-70b-instruct", "groq/llama-3.3-70b-versatile"],
    write:  ["groq/llama-3.3-70b-versatile", "nvidia/llama-3.3-nemotron-super-49b-v1.5", "meta/llama-3.1-70b-instruct", "nvidia/nemotron-3-super-120b-a12b"],
    review: ["nvidia/llama-3.3-nemotron-super-49b-v1.5", "meta/llama-3.1-70b-instruct", "nvidia/nemotron-3-super-120b-a12b", "groq/llama-3.3-70b-versatile"],
    fix:    ["groq/llama-3.3-70b-versatile", "nvidia/llama-3.3-nemotron-super-49b-v1.5", "meta/llama-3.1-70b-instruct", "nvidia/nemotron-3-super-120b-a12b"]
  };

  async function powerHouseCall(messages, onChunk, stage) {
    const list = POWER_HOUSE_MODELS[stage] || POWER_HOUSE_MODELS.write;
    const errors = [];
    const needsCode = stage === "write" || stage === "fix";

    const accept = (reply) => {
      const t = coerceText(reply).trim();
      if (t.length < 12) return false;
      if (needsCode) {
        // Must contain a real fenced code block — reject pure chain-of-thought
        if (!/```[\s\S]*?```/.test(t)) return false;
        const code = extractFirstCodeBlock(t);
        if (!code || code.trim().length < 30) return false;
        if (/^\s*\[object Object\]\s*$/i.test(code)) return false;
      }
      // Reject obvious thinking-only monologues even if long
      if (!needsCode) return true;
      const before = t.split("```")[0] || "";
      if (before.length > 800 && /^(okay|ok,|hmm|let's|first,|wait,|i need to)/i.test(before.trim())) {
        // still OK if code block exists — we'll polish later
        return true;
      }
      return true;
    };

    for (const modelId of list) {
      // Prefer non-stream for write/fix so UI stays on Thinking card (no monologue leak)
      const tryNonStreamFirst = needsCode;
      const attempts = tryNonStreamFirst
        ? ["non", "stream"]
        : ["stream", "non"];

      for (const mode of attempts) {
        try {
          let res;
          if (mode === "stream") {
            // Don't stream partials to UI for write/fix — only final
            const silent = needsCode ? (() => {}) : (onChunk || (() => {}));
            res = await callModelStreaming(modelId, messages, silent, undefined);
          } else {
            res = await callModel(modelId, messages, undefined);
          }
          if (res?.ok && accept(res.reply)) {
            return { ...res, reply: coerceText(res.reply), model: modelId, stage };
          }
          errors.push((modelId.split("/").pop() || modelId) + " " + mode + ": " + (res?.ok ? "no-code/thinking" : String(res?.error || "fail").slice(0, 40)));
        } catch (e) {
          errors.push((modelId.split("/").pop() || modelId) + " " + mode + ": " + (e.message || "err"));
        }
      }
    }
    return { ok: false, error: "All models failed for " + stage + "\n• " + errors.slice(0, 8).join("\n• "), stage };
  }

  function polishPowerHouseCodeReply(raw) {
    const text = coerceText(raw);
    const code = extractFirstCodeBlock(text);
    if (!code || code.trim().length < 20) return text;
    let lang = "text";
    const m = text.match(/```([a-zA-Z0-9_+-]*)\n/);
    if (m && m[1]) lang = m[1];
    else if (/require\(|module\.exports|process\.|async function/.test(code)) lang = "javascript";
    else if (/def |import |print\(|if __name__/.test(code)) lang = "python";
    else if (/<html[\s>]|<!DOCTYPE/i.test(code)) lang = "html";
    return "### Deliverable\n\n```" + lang + "\n" + code.trim() + "\n```\n";
  }

  function extractFirstCodeBlock(text) {
    const m = coerceText(text).match(/```(?:[a-zA-Z0-9_+-]*)\n([\s\S]*?)```/);
    if (!m) return null;
    const code = m[1];
    if (!code || code.trim() === "[object Object]") return null;
    return code;
  }

  function shortModelName(id) {
    const info = getModelInfo(id);
    if (info?.label) return info.label.replace(/^\(DEFAULT\)\s*/, "").slice(0, 28);
    return String(id || "").split("/").pop() || id;
  }


  function setPowerHouseTimeline(el, step /* 1-4 */) {
    if (!el) return;
    const labels = ["Plan", "Write", "Review", "Fix"];
    const parts = labels.map((lab, i) => {
      const n = i + 1;
      let cls = "ph-step";
      if (n < step) cls += " done";
      else if (n === step) cls += " on";
      return `<span class="${cls}">${n}. ${lab}</span>`;
    }).join("");
    const sub = el.querySelector(".thinking-sub");
    let host = el.querySelector(".ph-timeline");
    if (!host) {
      host = document.createElement("div");
      host.className = "ph-timeline";
      el.appendChild(host);
    }
    host.innerHTML = parts;
  }

  async function runPowerHouseAgent(request, pendingEl) {
    // STEP 1 — Plan
    setThinking(pendingEl, "🚀 Power House", "Step 1/4 · Planning · " + shortModelName(POWER_HOUSE_MODELS.plan[0]));
    setPowerHouseTimeline(pendingEl, 1);
    const planMessages = [
      {
        role: "system",
        content:
          "Senior architect. Output ONLY 5–8 short bullet points for the build plan. " +
          "Pick the right stack (Node/Python for bots/servers, HTML only for web UIs). " +
          "No code. No chain-of-thought. No 'Okay/Hmm/Let's'."
      },
      { role: "user", content: request }
    ];
    const planResult = await powerHouseCall(planMessages, undefined, "plan");
    if (!planResult?.ok || !planResult.reply) {
      return { ok: false, error: "Planning failed.\n" + (planResult?.error || "No response") };
    }
    const plan = coerceText(planResult.reply);
    const usedModels = { plan: planResult.model };

    // STEP 2 — Build
    setThinking(pendingEl, "🚀 Power House", "Step 2/4 · Writing · " + shortModelName(POWER_HOUSE_MODELS.write[0]));
    setPowerHouseTimeline(pendingEl, 2);
    const buildMessages = [
      {
        role: "system",
        content:
          "You are a coding engine. OUTPUT RULES (strict):\n" +
          "1) Do NOT think out loud. No 'Okay', 'Hmm', 'Let's', 'I need to', 'First'.\n" +
          "2) At most ONE short sentence, then ONE fenced code block.\n" +
          "3) Full working code only — no placeholders, no TODOs.\n" +
          "4) Use Node.js or Python if the task needs a long-running bot/server; " +
          "use a single HTML file only when the user asked for a webpage/UI.\n" +
          "5) Nothing after the code block."
      },
      { role: "user", content: `Request: ${request}\n\nPlan:\n${plan}\n\nNow write the full working code.` }
    ];
    const buildResult = await powerHouseCall(buildMessages, () => {
      setThinking(pendingEl, "🚀 Power House", "Step 2/4 · Writing · " + shortModelName(POWER_HOUSE_MODELS.write[0]));
    setPowerHouseTimeline(pendingEl, 2);
    }, "write");
    if (!buildResult?.ok || !buildResult.reply) {
      return { ok: false, error: "Write failed.\n" + (buildResult?.error || "No response") };
    }
    let currentReply = polishPowerHouseCodeReply(buildResult.reply);
    let code = extractFirstCodeBlock(currentReply) || extractFirstCodeBlock(buildResult.reply);
    usedModels.write = buildResult.model;

    // STEP 3 — Self-review
    setThinking(pendingEl, "🚀 Power House", "Step 3/4 · Review · " + shortModelName(POWER_HOUSE_MODELS.review[0]));
    setPowerHouseTimeline(pendingEl, 3);
    if (code) {
      const reviewMessages = [
        {
          role: "system",
          content:
            "You are a strict senior code reviewer. Examine the code below for bugs, " +
            "missing functionality, broken logic, or anything that would fail to run. " +
            "If it is correct and complete, reply with exactly: OK\n" +
            "If it has problems, reply with exactly: ISSUES\n" +
            "followed by a short bullet list of what's wrong. Be specific and concise."
        },
        { role: "user", content: `Original request: ${request}\n\nCode to review:\n\`\`\`\n${code}\n\`\`\`` }
      ];
      const reviewResult = await powerHouseCall(reviewMessages, undefined, "review");
      const reviewText = coerceText(reviewResult?.reply || "");
      usedModels.review = reviewResult?.model;

      // STEP 4 — Fix (only if review found issues)
      if (reviewResult?.ok && /^ISSUES/i.test(reviewText.trim())) {
        setThinking(pendingEl, "🚀 Power House", "Step 4/4 · Fix · " + shortModelName(POWER_HOUSE_MODELS.fix[0]));
        setPowerHouseTimeline(pendingEl, 4);
        const fixMessages = [
          {
            role: "system",
            content:
              "Fix the code per the review. OUTPUT RULES: no thinking aloud; " +
              "at most one short sentence; then ONE complete fenced code block; nothing after."
          },
          {
            role: "user",
            content:
              `Original request: ${request}\n\nCurrent code:\n\`\`\`\n${code}\n\`\`\`\n\n` +
              `Review notes:\n${reviewText}\n\nNow output the fixed, complete code.`
          }
        ];
        const fixResult = await powerHouseCall(fixMessages, () => {
          setThinking(pendingEl, "🚀 Power House", "Step 4/4 · Fix · " + shortModelName(POWER_HOUSE_MODELS.fix[0]));
        setPowerHouseTimeline(pendingEl, 4);
        }, "fix");
        if (fixResult?.ok && fixResult.reply) {
          currentReply = polishPowerHouseCodeReply(fixResult.reply);
          code = extractFirstCodeBlock(currentReply) || code;
          usedModels.fix = fixResult.model;
        }
      }
    }

    const pipeline = [
      usedModels.plan && ("Plan: " + shortModelName(usedModels.plan)),
      usedModels.write && ("Write: " + shortModelName(usedModels.write)),
      usedModels.review && ("Review: " + shortModelName(usedModels.review)),
      usedModels.fix && ("Fix: " + shortModelName(usedModels.fix))
    ].filter(Boolean).join(" · ");
    const footer = "\n\n> 🚀 **Power House** — multi-model pipeline" +
      (code ? " · code ready" : "") +
      (pipeline ? "\n> " + pipeline : "");
    return { ok: true, reply: currentReply + footer, code, usedModels };
  }

  async function answerWithLiveSearch(query, conversation, onChunk, preferredModelId) {
    // Rewrite query for better current-fact retrieval
    const year = new Date().getFullYear();
    let searchQuery = String(query || "").trim();
    if (/\b(current|now|today|latest|who is|cm of|prime minister|president|chief minister|বর্তমান|এখন)\b/i.test(searchQuery)
        && !/\b20\d{2}\b/.test(searchQuery)) {
      searchQuery = searchQuery + " " + year;
    }

    let searchResult;
    try {
      searchResult = await liveWebSearch(searchQuery);
    } catch (e) {
      searchResult = {
        text: `(Search error: ${e.message || e}. Answer carefully and mark uncertainty.)\nQuestion: ${query}`,
        sources: [],
        providerCount: 0
      };
    }
    const searchText = String(searchResult?.text || "");
    // Prefer Wikipedia / official-looking sources first
    const rankedSources = [...(searchResult.sources || [])].sort((a, b) => {
      const score = (s) => {
        const h = String(s.domain || s.url || "").toLowerCase();
        if (/wikipedia\.org/.test(h)) return 0;
        if (/gov|nic\.in|gov\.in|\.edu/.test(h)) return 1;
        if (/bbc|reuters|apnews|thehindu|indianexpress|aljazeera/.test(h)) return 2;
        return 5;
      };
      return score(a) - score(b);
    });
    const sourceList = rankedSources
      .map((s, i) => `${i + 1}. ${s.title} — ${s.url}`)
      .join("\n");

    const realPreferred = WEB_PULSE_SYNTH_MAP[preferredModelId] || "nvidia/llama-3.3-nemotron-super-49b-v1.5";
    const tryOrder = [realPreferred, ...LIVE_SYNTH_MODELS.filter(m => m !== realPreferred)];

    // Shorter evidence → fewer timeouts / empty streams
    const shortEvidence = String(searchText || "").slice(0, 14000);
    const compactMessages = [
      {
        role: "system",
        content:
          "You are WEB PULSE — a careful live researcher.\n" +
          "Rules:\n" +
          "1) Use ONLY the provided EVIDENCE/SOURCES. If evidence is weak or conflicting, say so.\n" +
          "2) Prefer Wikipedia and official/gov/news wire sources over random pages or user claims.\n" +
          "3) If the user states a fact that conflicts with evidence, CORRECT them politely with the evidence-backed answer.\n" +
          "4) For 'current / who is' questions, give the best-supported answer and note the year if known.\n" +
          "5) Never invent people, titles, dates, or URLs.\n" +
          "6) Be direct. Short paragraphs or bullets. Match the user's language (Bangla/English).\n" +
          "7) End with 2–5 source titles if available (no fake links)."
      },
      {
        role: "user",
        content:
          `QUESTION:\n${query}\n\nSEARCH QUERY USED:\n${searchQuery}\n\nSOURCES (priority order):\n${sourceList || "(none)"}\n\nEVIDENCE:\n${shortEvidence}\n\nWrite the accurate answer now.`
      }
    ];

    let result = null;
    let used = null;
    const failNotes = [];

    // 1) Non-stream first (more reliable than SSE for research)
    for (const modelId of tryOrder) {
      try {
        const attempt = await callModel(modelId, compactMessages);
        if (attempt?.ok && attempt.reply && String(attempt.reply).trim().length > 8) {
          result = attempt;
          used = modelId;
          onChunk?.(attempt.reply);
          break;
        }
        failNotes.push((modelId.split("/").pop() || modelId) + ": " + String(attempt?.error || "empty").slice(0, 60));
      } catch (e) {
        failNotes.push((modelId.split("/").pop() || modelId) + ": " + (e.message || "err"));
      }
    }

    // 2) Stream fallback
    if (!result) {
      for (const modelId of tryOrder) {
        try {
          const attempt = await callModelStreaming(
            modelId,
            compactMessages,
            onChunk || (() => {}),
            undefined
          );
          if (attempt?.ok && attempt.reply && String(attempt.reply).trim().length > 8) {
            result = attempt;
            used = modelId;
            break;
          }
          failNotes.push((modelId.split("/").pop() || modelId) + " stream: " + String(attempt?.error || "empty").slice(0, 60));
        } catch (e) {
          failNotes.push((modelId.split("/").pop() || modelId) + " stream: " + (e.message || "err"));
        }
      }
    }

    // 3) Last resort: show search evidence so Web Pulse never total-fails
    if (!result && (shortEvidence.trim() || (searchResult.sources || []).length)) {
      const lines = (searchResult.sources || []).slice(0, 8).map((s, i) =>
        `${i + 1}. [${s.title}](${s.url})` + (s.snippet ? ` — ${s.snippet}` : "")
      );
      const digest = shortEvidence
        .replace(/\n{3,}/g, "\n\n")
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.length > 40)
        .slice(0, 12)
        .join("\n");
      const fallbackReply =
        `### Research results for: ${query}\n\n` +
        (digest ? digest + "\n\n" : "") +
        (lines.length ? `**Sources**\n${lines.join("\n")}` : "_No structured sources_") +
        `\n\n> ⚠️ Live synthesizer was busy — showing raw search evidence. Try again or use **Nemotron Super** chat.`;
      onChunk?.(fallbackReply);
      result = { ok: true, reply: fallbackReply };
      used = "search-digest";
    }

    if (result?.ok) {
      result.sources = rankedSources.length ? rankedSources : searchResult.sources;
      result.model = used;
      result.providerCount = searchResult.providerCount;
    }
    return result || {
      ok: false,
      error: "Web Pulse failed.\n• " + (failNotes.slice(0, 5).join("\n• ") || "no details") +
        "\n\nTip: Deploy latest worker.js, then pick **Research • Nemotron Super**."
    };
  }

  function getSelectedModelId() {
    return dom.modelSelect.value || appState.selectedModelId;
  }

  function thinkingHTML(title, sub = "") {
    return `<div class="thinking-row bixby-think">
      <div class="bixby-orb" aria-hidden="true">
        <span class="bixby-ring r1"></span>
        <span class="bixby-ring r2"></span>
        <span class="bixby-ring r3"></span>
        <span class="bixby-core"></span>
      </div>
      <div class="thinking-meta">
        <div class="thinking-title">${escapeHtml(title)}</div>
        ${sub ? `<div class="thinking-sub">${escapeHtml(sub)}</div>` : ""}
      </div>
    </div>`;
  }

  function setThinking(el, title, sub = "") {
    if (!el) return;
    el.className = "message-bubble pending";
    el.style.cssText = "";
    el.innerHTML = thinkingHTML(title, sub);
  }

  function extractImageUrl(data) {
    // OpenAI-style: data[0].url or data[0].b64_json
    const item = data?.data?.[0] || data?.images?.[0] || null;
    if (item) {
      if (item.url) return item.url;
      if (item.image_url?.url) return item.image_url.url;
      if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
      if (item.b64) return `data:image/png;base64,${item.b64}`;
      if (typeof item === "string" && item.startsWith("http")) return item;
      if (typeof item === "string" && item.length > 100) return `data:image/png;base64,${item}`;
    }
    if (data?.image_url) return typeof data.image_url === "string" ? data.image_url : data.image_url?.url;
    if (data?.url && typeof data.url === "string") return data.url;
    if (data?.b64_json) return `data:image/png;base64,${data.b64_json}`;
    if (data?.image && typeof data.image === "string") {
      return data.image.startsWith("http") || data.image.startsWith("data:")
        ? data.image
        : `data:image/png;base64,${data.image}`;
    }
    // Nested result wrappers some workers return
    if (data?.result) return extractImageUrl(data.result);
    if (data?.output) return extractImageUrl(data.output);
    if (data?.response) return extractImageUrl(data.response);
    return null;
  }

  async function generateImage(modelId, prompt) {
    const endpoint = WORKER_PROXY_URL.replace(/\/+$/, "") + "/image";

    // Worker expects clean { model, prompt }. Try b64 first, then plain.
    const attempts = [
      { model: modelId, prompt, n: 1, response_format: "b64_json" },
      { model: modelId, prompt, n: 1 },
      { model: modelId, prompt, n: 1, size: "1024x1024" }
    ];

    let lastError = "Image generation failed.";

    for (const body of attempts) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body)
        });

        const raw = await res.text();
        let data;
        try { data = JSON.parse(raw); } catch { data = { raw }; }

        if (!res.ok) {
          lastError =
            (typeof data?.error === "string" ? data.error : null) ||
            data?.error?.message ||
            data?.message ||
            data?.detail ||
            (data?.nvidia && (data.nvidia.error?.message || data.nvidia.message)) ||
            (typeof data?.raw === "string" ? data.raw.slice(0, 240) : null) ||
            `Image API HTTP ${res.status}`;
          if (data?.hint) lastError += "\n\n" + data.hint;

          if (res.status === 404 || res.status === 400 || res.status === 422) {
            throw new Error(lastError);
          }
          continue;
        }

        const imageUrl = extractImageUrl(data);
        if (imageUrl) return imageUrl;
        lastError = "Worker OK but no image URL/base64 in response.";
      } catch (err) {
        lastError = err.message || lastError;
        if (/not found|invalid|missing|unsupported/i.test(String(err.message))) {
          throw err;
        }
      }
    }

    throw new Error(lastError);
  }

  function addGeneratedImage(url, prompt) {
    const div = document.createElement("div");
    div.className = "message-bubble assistant";

    const img = document.createElement("img");
    img.src = url;
    img.alt = prompt || "Generated image";
    img.style.cssText = "display:block;max-width:100%;border-radius:12px;background:rgba(0,0,0,.25);";
    img.onerror = () => {
      img.replaceWith(Object.assign(document.createElement("div"), {
        textContent: "⚠️ Image failed to load (broken URL / blocked).",
        style: "color:#ef4444;font-size:12px;padding:8px 0;"
      }));
    };

    const actions = document.createElement("div");
    actions.className = "generated-image-actions";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "code-action-btn";
    save.textContent = "💾 Save Image";
    save.onclick = async () => {
      try {
        if (url.startsWith("data:")) {
          const a = document.createElement("a");
          a.href = url;
          a.download = "uplink-generated-image.png";
          a.click();
          return;
        }
        const r = await fetch(url);
        const blob = await r.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "uplink-generated-image.png";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      } catch {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        a.click();
      }
    };

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "code-action-btn";
    openBtn.textContent = "↗ Open";
    openBtn.onclick = () => window.open(url, "_blank", "noopener");

    actions.append(save, openBtn);
    div.appendChild(img);
    div.appendChild(actions);
    dom.messagesContainer.appendChild(div);
    
  }

  async function sendMsg() {
    const text = dom.messageTextInput.value.trim();
    if (!text && !currentFile) return;

    // IMAGE MODELS ARE ISOLATED FROM CHAT/FALLBACK.
    // They always use the Worker /image route and never fall back to Nemotron,
    // DeepSeek, or any other chat model.
    const selectedImageModelForRequest = getSelectedModelId();
    if (isImageModel(selectedImageModelForRequest)) {
      if (selectedImageModelForRequest === "qwen/qwen-image-edit" && !currentFile?.isImg) {
        appState.messages.push({
          role: "assistant",
          content: "🖼️ **Qwen-Image-Edit** needs an attached image."
        });
        render();
        return;
      }

      const imagePrompt = text || "Create an image from the attached reference.";
      const imageInfo = getModelInfo(selectedImageModelForRequest);
      appState.messages.push({ role: "user", content: imagePrompt });
      dom.messageTextInput.value = "";
      dom.messageTextInput.style.height = "auto";
      clearFile();
      render();

      setGenerating(true);
      const imgPending = document.createElement("div");
      setThinking(imgPending, "Generating image", imageInfo?.label || selectedImageModelForRequest);
      dom.messagesContainer.appendChild(imgPending);
      

      try {
        const imageUrl = await generateImage(
          selectedImageModelForRequest,
          imagePrompt
        );
        imgPending.remove();
        addGeneratedImage(imageUrl, imagePrompt);
        appState.messages.push({
          role: "assistant",
          content: `🎨 Generated image with **${imageInfo?.label || selectedImageModelForRequest}**\n\n> ${imagePrompt}`,
          model: selectedImageModelForRequest
        });
        persistMessages();
      } catch (err) {
        imgPending.remove();
        appState.messages.push({
          role: "assistant",
          content: `🎨 **Image generation failed**\n\n${err.message}\n\n_Tip: check Worker \`/image\` route supports this model, or try another Image Model._`
        });
        render();
      } finally {
        setGenerating(false);
      }

      return;
    }

    // WEATHER: dedicated Open-Meteo via Worker
    if (isWeatherQuery(text) && !currentFile) {
      const place = extractWeatherPlace(text);
      appState.messages.push({ role: "user", content: text });
      dom.messageTextInput.value = "";
      dom.messageTextInput.style.height = "auto";
      render();
      setGenerating(true);
      const pending = document.createElement("div");
      setThinking(pending, "Weather", "Checking " + place + "…");
      dom.messagesContainer.appendChild(pending);
      try {
        const data = await fetchWeather(place);
        pending.remove();
        const reply = formatWeatherMarkdown(data);
        appState.messages.push({
          role: "assistant",
          content: reply,
          ui: safeMarkdown(reply),
          model: "weather/open-meteo",
          ts: Date.now()
        });
        persistMessages();
        render();
      } catch (err) {
        pending.remove();
        appState.messages.push({
          role: "assistant",
          content: "🌤️ **Weather failed**\n\n" + (err.message || err) +
            "\n\n_Deploy Worker with POST /weather, or try: weather in Dhaka_"
        });
        render();
      } finally {
        setGenerating(false);
      }
      return;
    }

    // WEB PULSE (Live Search): fetch web evidence + fast synth models
    const selectedModelForRequest = getSelectedModelId();
    if (isLiveSearchModel(selectedModelForRequest) || /^webpulse\//i.test(String(selectedModelForRequest))) {
      if (!text) return;
      appState.messages.push({ role: "user", content: text });
      dom.messageTextInput.value = "";
      dom.messageTextInput.style.height = "auto";
      clearFile();
      render();

      setGenerating(true);
      const livePending = document.createElement("div");
      setThinking(livePending, "Web Pulse", "Researching Google + web sources…");
      dom.messagesContainer.appendChild(livePending);
      

      try {
        const apiMessages = appState.messages.map(m => ({
          role: m.role,
          content: m.content
        }));

        const result = await answerWithLiveSearch(text, apiMessages, createStreamRenderer(livePending), selectedModelForRequest);

        livePending.remove();

        if (result?.ok) {
          let reply = result.reply || "";
          const foot = "⚡ **Web Pulse** — live web evidence, not training memory.";
          if (!/Web Pulse/i.test(reply)) reply += "\n\n> " + foot;
          appState.messages.push({
            role: "assistant",
            content: reply,
            ui: safeMarkdown(reply) + renderSources(result.sources),
            model: result.model || "web-pulse",
            ts: Date.now()
          });
        } else {
          livePending.remove();
          toastAssist("Web Pulse failed — switching to normal chat…");
          // Auto fallback: answer with Nemotron without web
          appState.selectedModelId = "nvidia/llama-3.3-nemotron-super-49b-v1.5";
          if (dom.modelSelect) dom.modelSelect.value = appState.selectedModelId;
          setGenerating(false);
          await runChatCompletion(text, false);
          return;
        }
      } catch (err) {
        livePending.remove();
        toastAssist("Web Pulse error — falling back to chat…");
        appState.selectedModelId = "nvidia/llama-3.3-nemotron-super-49b-v1.5";
        if (dom.modelSelect) dom.modelSelect.value = appState.selectedModelId;
        setGenerating(false);
        await runChatCompletion(text, false);
        return;
      } finally {
        persistMessages();
        setGenerating(false);
        render();
      }
      return;
    }

    // POWER HOUSE AGENT: autonomous plan → build → self-review → fix loop
    if (selectedModelForRequest === "power/agent") {
      if (!text) return;
      appState.messages.push({ role: "user", content: text });
      dom.messageTextInput.value = "";
      dom.messageTextInput.style.height = "auto";
      clearFile();
      render();

      setGenerating(true);
      const agentPending = document.createElement("div");
      setThinking(agentPending, "🚀 Power House", "Planning the build…");
      dom.messagesContainer.appendChild(agentPending);
      scrollToBottom(false);

      try {
        const result = await runPowerHouseAgent(text, agentPending);
        agentPending.remove();

        if (result?.ok) {
          let reply = coerceText(result.reply);
          const codeStr = coerceText(result.code);
          // Ensure HTML/JS is in a fence so chat never auto-runs it
          if (codeStr && !/```/.test(reply)) {
            reply = "Here's the build:\n\n```html\n" + codeStr + "\n```\n\n> Tap **▶ Preview** under the code to run it.";
          } else if (!/▶ Preview|Live Preview/i.test(reply)) {
            reply += "\n\n> Tap **▶ Preview** under the code block to run this in the built-in HTML editor.";
          }
          const phFiles = extractAllCodeBlocks(reply);
          if (phFiles.length >= 2) {
            reply += "\n\n> 📦 **" + phFiles.length + " files** detected — tap **ZIP** under a code block to download all.";
          }
          appState.messages.push({
            role: "assistant",
            content: reply,
            model: "power/agent",
            ts: Date.now()
          });
        } else {
          appState.messages.push({
            role: "assistant",
            content: "🚀 **Power House failed**\n\n" + (result?.error || "Unknown error") +
              "\n\n_Try again, or simplify the request._"
          });
        }
      } catch (err) {
        agentPending.remove();
        appState.messages.push({
          role: "assistant",
          content: "🚀 **Power House crashed**\n\n" + (err?.message || String(err))
        });
      } finally {
        persistMessages();
        setGenerating(false);
        render();
      }
      return;
    }

    let apiContent = text, uiContent = null;
    if (currentFile) {
      if (currentFile.isImg) {
        apiContent = [
          { type: "text", text: text || "Analyze this image." },
          { type: "image_url", image_url: { url: currentFile.data } }
        ];
        uiContent = `<img src="${currentFile.data}" class="chat-image-preview"><br>${safeMarkdown(text)}`;
      } else {
        apiContent = text + `\n\n[File Content: ${currentFile.name}]\n` + currentFile.data;
        uiContent = `<div class="chat-file-attachment">📄 ${currentFile.name}</div><br>${safeMarkdown(text)}`;
      }
    }

    const hadFile = !!currentFile;
    window.__boatinStickBottom = true;
    appState.messages.push({ role: "user", content: apiContent, ui: uiContent, ts: Date.now() });
    localStorage.removeItem("nv_draft");
    dom.messageTextInput.value = "";
    dom.messageTextInput.style.height = "20px";
    clearFile();
    render();

    smartPickEffort(text);
    await runChatCompletion(text, hadFile);
  }


  function trimMessagesForSpeed(messages, maxMsgs) {
    const arr = (messages || []).map(m => {
      let c = m.content;
      // Cap huge single messages so context fits without killing quality
      if (typeof c === "string" && c.length > 12000) c = c.slice(0, 12000) + "\n…[truncated]";
      return { role: m.role, content: c };
    });
    const limit = maxMsgs || 28;
    if (arr.length <= limit) return arr;
    // keep system-ish first assistant + last N
    return arr.slice(-limit);
  }

  async function runChatCompletion(text, hadFile = false) {
    // Auto-mode may request live search — honor it
    const autoOn = dom.autoMode && dom.autoMode.value === "on";
    if (autoOn && text && !hadFile) {
      const autoPick = chooseAutoModel(text, hadFile);
      if (isLiveSearchModel(autoPick) || /^webpulse\//i.test(String(autoPick))) {
        setGenerating(true);
        const livePending = document.createElement("div");
        setThinking(livePending, "Web Pulse", "Auto · researching…");
        dom.messagesContainer.appendChild(livePending);
        try {
          const apiMessages = appState.messages.map(m => ({ role: m.role, content: m.content }));
          const result = await answerWithLiveSearch(text, apiMessages, createStreamRenderer(livePending), autoPick);
          livePending.remove();
          if (result?.ok) {
            let reply = coerceText(result.reply);
            if (!/Web Pulse/i.test(reply)) reply += "\n\n> ⚡ **Web Pulse** (auto)";
            appState.messages.push({
              role: "assistant",
              content: reply,
              ui: safeMarkdown(reply) + (typeof renderSources === "function" ? renderSources(result.sources) : ""),
              model: result.model || "web-pulse",
              ts: Date.now()
            });
          } else {
            // fall through to normal chat with default model
            livePending.remove();
            toastAssist("Live search missed — normal chat");
          }
          if (result?.ok) {
            persistMessages();
            setGenerating(false);
            render();
            return;
          }
        } catch (e) {
          livePending.remove();
        }
        setGenerating(false);
      }
    }

    // Never run pure image models through /chat
    if (isImageModel(getSelectedModelId()) || isImageModel(appState.selectedModelId)) {
      appState.messages.push({
        role: "assistant",
        content: "🎨 This is an **image model**. Describe what you want to generate and send again — or pick a chat model from **🎯 Model**."
      });
      persistMessages();
      render();
      return;
    }

    const effort = getEffortConfig();
    const pid = "p_" + Date.now();
    const pdiv = document.createElement("div");
    pdiv.id = pid;
    setThinking(pdiv, "Thinking", `Effort ${effort.label}`);
    dom.messagesContainer.appendChild(pdiv);
    

    const controller = new AbortController();
    appState.abortController = controller;
    setGenerating(true);

    try {
      const apiMessages = trimMessagesForSpeed(appState.messages, 28);

      let primary = dom.autoMode.value === "on"
        ? chooseAutoModel(text, hadFile)
        : appState.selectedModelId;
      // Never send research aliases or image models to /chat
      if (isImageModel(primary) || isLiveSearchModel(primary) || /^webpulse\//i.test(String(primary))) {
        primary = resolveChatModelId(primary);
      }
      primary = resolveChatModelId(primary);
      if (isImageModel(primary)) {
        primary = "nvidia/llama-3.3-nemotron-super-49b-v1.5";
      }
      const autoCallback = dom.autoCallback.value === "on";
      const candidates = (autoCallback
        ? [primary, ...getFallbackModels(primary).map(m => m.value)]
        : [primary]
      )
        .map(resolveChatModelId)
        .filter(id => id && !isImageModel(id) && !isLiveSearchModel(id) && !/^webpulse\//i.test(id));
      // Always keep proven free-tier models in the retry chain
      const STABLE = [
        "nvidia/llama-3.3-nemotron-super-49b-v1.5",
        "groq/llama-3.3-70b-versatile",
        "meta/llama-3.1-70b-instruct",
        "nvidia/llama-3.3-nemotron-super-49b-v1",
        "groq/llama-3.1-8b-instant",
        "meta/llama-3.1-8b-instruct",
        "openai/gpt-oss-20b"
      ];
      for (const s of STABLE) {
        if (!candidates.includes(s)) candidates.push(s);
      }
      if (!candidates.length) candidates.push("nvidia/llama-3.3-nemotron-super-49b-v1.5");

      let result = null;
      let usedModel = primary;
      let attempts = [];

      for (let i = 0; i < candidates.length; i++) {
        if (controller.signal.aborted) break;
        const modelId = candidates[i];
        const info = getModelInfo(modelId);
        setThinking(
          pdiv,
          i === 0 ? "Thinking" : `Fallback ${i}/${candidates.length - 1}`,
          `${info?.label || modelId} • Effort ${effort.label}`
        );

        try {
          let attempt = await callModelStreaming(
            modelId,
            apiMessages,
            createStreamRenderer(pdiv),
            controller.signal
          );

          if (!attempt.ok && /stream|body|SSE|ReadableStream/i.test(String(attempt.error || ""))) {
            setThinking(pdiv, "Processing", info?.label || modelId);
            attempt = await callModel(modelId, apiMessages, controller.signal);
          }

          attempts.push({ modelId, ...attempt });

          if (attempt.ok) {
            result = attempt;
            usedModel = modelId;
            break;
          }
        } catch (err) {
          if (err?.name === "AbortError" || controller.signal.aborted) {
            result = { ok: true, reply: "_(generation stopped)_", stopped: true };
            usedModel = modelId;
            break;
          }
          attempts.push({ modelId, ok: false, error: err.message });
        }
      }

      document.getElementById(pid)?.remove();

      if (result?.ok) {
        const callbackNote = usedModel !== primary && !result.stopped
          ? `\n\n> 🔁 **Auto Callback:** Primary model failed, so the response was completed by **${getModelInfo(usedModel)?.label || usedModel}**.`
          : "";
        appState.messages.push({
          role: "assistant",
          content: result.reply + callbackNote,
          model: usedModel,
          tokPerSec: result.tokPerSec || undefined,
          ts: Date.now()
        });
      } else {
        const last = attempts[attempts.length - 1] || {};
        appState.messages.push({
          role: "assistant",
          content: friendlyError(last.error || "Unknown error", "Model failed") +
            "\n\n**Tried:** " + attempts.map(a => getModelInfo(a.modelId)?.label || a.modelId).join(", ")
        });
      }
    } catch (err) {
      document.getElementById(pid)?.remove();
      if (err?.name !== "AbortError") {
        appState.messages.push({ role: "assistant", content: friendlyError(err, "Network error") });
      }
    } finally {
      appState.abortController = null;
      setGenerating(false);
      window.__boatinStickBottom = true;
      persistMessages();
      render();
      requestAnimationFrame(() => scrollToBottom(false));
    }
  }

  // Remove any stale model stored from an older version of the app.
  function sanitizeSavedModel() {
    const saved = localStorage.getItem("nv_model");
    const dead = /405b|deepseek-v3|kimi-k2|glm-5|qwen3-coder-480|qwq-32|minimax|devstral|mistral-nemo|gemma-2|phi-3|mixtral|seed-oss/i;
    if (saved && (!getModelInfo(saved) || isImageModel(saved) || dead.test(saved) || /^webpulse\//i.test(saved))) {
      localStorage.setItem("nv_model", "nvidia/llama-3.3-nemotron-super-49b-v1.5");
      appState.selectedModelId = "nvidia/llama-3.3-nemotron-super-49b-v1.5";
      if (dom.modelSelect) dom.modelSelect.value = appState.selectedModelId;
    }
  }

  sanitizeSavedModel();
  init();
