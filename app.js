/**
 * BOATIN - AI Chat + Real-Time Search Engine
 * Liquid Theme Edition (Ultimate - cleaned)
 *
 * Features:
 * - Real-time web search (Tavily, Exa, Bytez)
 * - AI chat models (NVIDIA Nemotron, Llama, Mistral)
 * - Auto-detection (search vs chat)
 * - Liquid glassmorphism theme
 * - Voice input with auto-send
 * - Message history + localStorage
 * - Mobile responsive
 * - Fallback chain for search engines
 *
 * API Keys (embedded):
 * - NVIDIA: nemotron-3-super-120b
 * - TAVILY: Real-time search synthesis
 * - EXA: Semantic search
 * - BYTEZ: Real-time indexing
 */

// ═══════════════════════════════════════════════════════════════
// API CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const API_KEYS = {
  NVIDIA: "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",
  TAVILY: "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",
  EXA: "c6f6fe81-f6d6-4a46-a7ee-1887216305ee",
  BYTEZ: "e22f52c699b71b327d3a22d50be7064e"
};

const NVIDIA_CHAT_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

const MODELS = {
  DEFAULT: "nvidia/nemotron-3-super-120b-a12b",
  FAST: "meta/llama-3.1-8b",
  ADVANCED: "meta/llama-3.1-405b",
  LLAMA70: "meta/llama-3.3-70b",
  NEMOTRON49: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  NANO30: "nvidia/nemotron-3-nano-30b-a3b",
  LIGHTNING: "nvidia/nemotron-3.5-lightning-30b-a3b",
  ULTRA253: "nvidia/llama-3.1-nemotron-ultra-253b-v1",
  ULTRA550: "nvidia/nemotron-3-ultra-550b-a55b",
  NANO9: "nvidia/nvidia-nemotron-nano-9b-v2",
  GEMMA: "google/gemma-7b",
  CODEGEMMA: "google/codegemma-7b"
};

// ═══════════════════════════════════════════════════════════════
// APPLICATION STATE
// ═══════════════════════════════════════════════════════════════

const appState = {
  messages: [
    {
      role: "assistant",
      content: "🚀 BOATIN is ready.\n\n**Features:**\n• Search: Type to find info (auto-routes to Tavily/Exa/Bytez)\n• Chat: Nemotron Super/Ultra, Llama 405B/70B/8B, Mistral, Gemma & more\n• Auto-detect: Detects search vs chat automatically\n• Voice: Click mic to speak\n• Effort: Low/Mid/High/Max token limits\n\nTry: 'search latest AI news' or 'write Python code'",
      ts: Date.now()
    }
  ],
  autoMode: true,
  currentEffort: "mid",
  isGenerating: false
};

// ═══════════════════════════════════════════════════════════════
// DOM CACHE
// ═══════════════════════════════════════════════════════════════

const dom = {
  messagesContainer: null,
  messageTextInput: null,
  sendMessageBtn: null,
  clearMemoryBtn: null,
  effortMode: null
};

// ═══════════════════════════════════════════════════════════════
// SEARCH ENGINES
// ═══════════════════════════════════════════════════════════════

/**
 * Tavily Search - Intelligent synthesis
 * Free: 1000/month
 */
async function tavilySearch(query) {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: API_KEYS.TAVILY,
        query: query,
        max_results: 15,
        include_answer: true,
        search_depth: "advanced"
      })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const results = data.results || [];
    let text = "";

    // Prefer synthesized answer if available
    if (data.answer) {
      text += `**Answer:** ${data.answer}\n\n---\n\n`;
    }

    text += results
      .map(r => `**${r.title}**\n${r.content || r.snippet || ""}${r.url ? `\n🔗 ${r.url}` : ""}`)
      .join("\n\n---\n\n");

    return {
      ok: true,
      text: text || "No results found",
      provider: "Tavily",
      resultCount: results.length
    };
  } catch (e) {
    return { ok: false, error: e.message, provider: "Tavily" };
  }
}

/**
 * Exa Search - Semantic / neural search
 * Free: 100/month
 */
async function exaSearch(query) {
  try {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEYS.EXA
      },
      body: JSON.stringify({
        query: query,
        numResults: 15,
        useAutoprompt: true,
        type: "neural",
        contents: { text: true }
      })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const results = data.results || [];
    const text = results
      .map(r => `**${r.title}**\n${r.text || r.snippet || ""}${r.url ? `\n🔗 ${r.url}` : ""}`)
      .join("\n\n---\n\n");

    return {
      ok: true,
      text: text || "No results found",
      provider: "Exa",
      resultCount: results.length
    };
  } catch (e) {
    return { ok: false, error: e.message, provider: "Exa" };
  }
}

/**
 * Bytez Search - Real-time indexing
 * Free: 100/month
 */
async function bytezSearch(query) {
  try {
    const res = await fetch(
      `https://api.bytez.com/search?q=${encodeURIComponent(query)}&count=15`,
      {
        headers: {
          Authorization: `Bearer ${API_KEYS.BYTEZ}`,
          Accept: "application/json"
        }
      }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const results = data.results || data.data || [];
    const text = results
      .map(r => `**${r.title || r.name || "Result"}**\n${r.snippet || r.description || r.text || ""}${r.url ? `\n🔗 ${r.url}` : ""}`)
      .join("\n\n---\n\n");

    return {
      ok: true,
      text: text || "No results found",
      provider: "Bytez",
      resultCount: results.length
    };
  } catch (e) {
    return { ok: false, error: e.message, provider: "Bytez" };
  }
}

/**
 * Run search with automatic fallback order:
 * 1. Preferred engine → 2. Exa → 3. Bytez → 4. Tavily
 */
async function searchWithFallback(query, preferred = "tavily") {
  const order = [];
  if (preferred === "tavily") order.push(tavilySearch, exaSearch, bytezSearch);
  else if (preferred === "exa") order.push(exaSearch, tavilySearch, bytezSearch);
  else if (preferred === "bytez") order.push(bytezSearch, tavilySearch, exaSearch);
  else order.push(tavilySearch, exaSearch, bytezSearch);

  let lastError = "Unknown";
  for (const engine of order) {
    const result = await engine(query);
    if (result.ok) return result;
    lastError = result.error;
    showToast(`⚠️ ${result.provider} failed, trying next...`);
  }
  return { ok: false, error: lastError, provider: "All" };
}

// ═══════════════════════════════════════════════════════════════
// CHAT WITH NVIDIA
// ═══════════════════════════════════════════════════════════════

/**
 * Call NVIDIA NIM API for chat
 */
async function callNvidiaChat(messages, model = MODELS.DEFAULT) {
  try {
    const res = await fetch(NVIDIA_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEYS.NVIDIA}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: getTokenLimit(appState.currentEffort),
        temperature: 0.7,
        top_p: 0.9,
        stream: false
      })
    });

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const error = await res.json();
        errMsg = error.error?.message || error.message || errMsg;
      } catch (_) {}
      throw new Error(errMsg);
    }

    const data = await res.json();
    return {
      ok: true,
      reply: data.choices?.[0]?.message?.content || "No response",
      model: model,
      usage: data.usage
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Get token limit based on effort level
 */
function getTokenLimit(effort) {
  const limits = {
    low: 4096,
    mid: 16384,
    high: 32768,
    max: 65536
  };
  return limits[effort] || limits.mid;
}

// ═══════════════════════════════════════════════════════════════
// AUTO-DETECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Detect if query is a search or chat
 */
function detectQueryType(query) {
  const q = query.toLowerCase().trim();

  // Strong search signals
  const searchKeywords =
    /^(search|find|research|look up|lookup|google|what is|what's|who is|when did|where is|how many|latest|news|current|today|recent|trends|define|tell me about|information about|data on)\b/i;

  // Strong chat / generation signals
  const chatKeywords =
    /\b(write|create|generate|code|story|poem|song|dialogue|script|help me|assist|explain how|teach me|tutorial|make a|draw|design|fix|function|class|python|javascript|html)\b/i;

  if (searchKeywords.test(q)) return "search";
  if (chatKeywords.test(q)) return "chat";

  // Question-like → prefer search
  if (q.endsWith("?") || /^(what|who|when|where|why|how|is|are|can|does|did)\b/i.test(q)) {
    return "search";
  }

  return "chat"; // default
}

// ═══════════════════════════════════════════════════════════════
// MESSAGE HANDLING (single clean implementation)
// ═══════════════════════════════════════════════════════════════

async function handleMessage(text) {
  if (!text.trim() || appState.isGenerating) return;

  const modelSelect = document.getElementById("modelSelect");
  const selectedModel = modelSelect?.value || MODELS.DEFAULT;
  const autoModeEnabled = document.getElementById("autoModeToggle")?.checked ?? true;

  // Add user message
  appState.messages.push({ role: "user", content: text, ts: Date.now() });

  // Thinking indicator
  const thinkingId = Date.now() + "_think";
  appState.messages.push({
    role: "assistant",
    content: "...",
    isThinking: true,
    id: thinkingId,
    ts: Date.now()
  });
  appState.isGenerating = true;
  if (dom.sendMessageBtn) dom.sendMessageBtn.disabled = true;
  render();

  try {
    const isSearchModel = ["tavily", "exa", "bytez"].includes(selectedModel);
    const autoDetectedSearch = autoModeEnabled && detectQueryType(text) === "search";

    if (isSearchModel || autoDetectedSearch) {
      // Search path with fallback
      const preferred = isSearchModel ? selectedModel : "tavily";
      const result = await searchWithFallback(text, preferred);

      const content = result.ok
        ? `**${result.provider} Results** (${result.resultCount} found)\n\n${result.text}`
        : `❌ All search engines failed: ${result.error}`;

      const idx = appState.messages.findIndex(m => m.id === thinkingId);
      if (idx !== -1) {
        appState.messages[idx] = {
          role: "assistant",
          content,
          provider: result.provider,
          ts: Date.now()
        };
      }
    } else {
      // Chat path
      const chatMessages = appState.messages
        .filter(m => !m.isThinking)
        .map(m => ({ role: m.role, content: m.content }));

      const response = await callNvidiaChat(chatMessages, selectedModel);

      const idx = appState.messages.findIndex(m => m.id === thinkingId);
      if (idx !== -1) {
        appState.messages[idx] = {
          role: "assistant",
          content: response.ok ? response.reply : `❌ Error: ${response.error}`,
          model: selectedModel,
          tokens: response.usage?.completion_tokens,
          ts: Date.now()
        };
      }
    }
  } catch (e) {
    const idx = appState.messages.findIndex(m => m.id === thinkingId);
    if (idx !== -1) {
      appState.messages[idx] = {
        role: "assistant",
        content: `❌ Unexpected error: ${e.message}`,
        ts: Date.now()
      };
    }
  }

  appState.isGenerating = false;
  if (dom.sendMessageBtn) dom.sendMessageBtn.disabled = false;
  persistMessages();
  render();
}

// ═══════════════════════════════════════════════════════════════
// UI RENDERING (Markdown + syntax highlight)
// ═══════════════════════════════════════════════════════════════

function render() {
  if (!dom.messagesContainer) return;

  dom.messagesContainer.innerHTML = appState.messages
    .map(msg => {
      const role = msg.role === "user" ? "You" : "BOATIN";
      const roleClass = msg.role === "user" ? "user" : "assistant";
      const time = new Date(msg.ts).toLocaleTimeString();
      const meta = [
        msg.provider ? `via ${msg.provider}` : "",
        msg.model ? (msg.model.split("/")[1] || msg.model) : "",
        msg.tokens ? `${msg.tokens} tok` : ""
      ]
        .filter(Boolean)
        .join(" • ");

      let content;
      if (msg.isThinking) {
        content = `<div class="thinking-dots"><span></span><span></span><span></span></div>`;
      } else if (typeof marked !== "undefined") {
        content = marked.parse(msg.content || "");
      } else {
        content = `<p>${(msg.content || "").replace(/\n/g, "<br>")}</p>`;
      }

      return `
        <div class="message-bubble ${roleClass}${msg.isThinking ? " thinking" : ""}">
          <strong>${role}${meta ? ` · ${meta}` : ""}</strong>
          ${content}
          <small>${time}</small>
        </div>
      `;
    })
    .join("");

  // Syntax highlight
  if (typeof hljs !== "undefined") {
    dom.messagesContainer.querySelectorAll("pre code").forEach(block => {
      hljs.highlightElement(block);
    });
  }

  // Scroll to bottom
  setTimeout(() => {
    dom.messagesContainer.scrollTop = dom.messagesContainer.scrollHeight;
  }, 50);
}

// ═══════════════════════════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════════════════════════

function persistMessages() {
  try {
    localStorage.setItem("boatin-messages", JSON.stringify(appState.messages));
  } catch (e) {
    console.warn("Could not save to localStorage:", e);
  }
}

function loadMessages() {
  try {
    const saved = localStorage.getItem("boatin-messages");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length) {
        appState.messages = parsed;
      }
    }
  } catch (e) {
    console.warn("Could not load from localStorage:", e);
  }
}

// ═══════════════════════════════════════════════════════════════
// TAB NAVIGATION
// ═══════════════════════════════════════════════════════════════

function initTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.remove("active"));
      tabContents.forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      const content = document.getElementById(`tab-${target}`);
      if (content) content.classList.add("active");
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// SCROLL TO BOTTOM BUTTON
// ═══════════════════════════════════════════════════════════════

function initScrollButton() {
  const btn = document.getElementById("scrollToBottomBtn");
  const container = document.getElementById("messagesContainer");
  if (!btn || !container) return;

  container.addEventListener("scroll", () => {
    const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    btn.classList.toggle("visible", distFromBottom > 80);
  });

  btn.addEventListener("click", () => {
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  });
}

// ═══════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════

function initActions() {
  // Export chat
  document.getElementById("exportChatBtn")?.addEventListener("click", () => {
    const text = appState.messages
      .map(m => `[${new Date(m.ts).toLocaleString()}] ${m.role.toUpperCase()}:\n${m.content}`)
      .join("\n\n---\n\n");

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `boatin-chat-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("📤 Chat exported");
  });

  // Copy last message
  document.getElementById("copyLastBtn")?.addEventListener("click", () => {
    const last = [...appState.messages].reverse().find(m => m.role === "assistant" && !m.isThinking);
    if (last) {
      navigator.clipboard
        .writeText(last.content)
        .then(() => showToast("✅ Copied!"))
        .catch(() => showToast("❌ Copy failed"));
    } else {
      showToast("No message to copy");
    }
  });

  // Retry last user message
  document.getElementById("retryBtn")?.addEventListener("click", () => {
    const lastUser = [...appState.messages].reverse().find(m => m.role === "user");
    if (lastUser && !appState.isGenerating) {
      // Remove last assistant response
      const lastIdx = appState.messages.map(m => m.role).lastIndexOf("assistant");
      if (lastIdx !== -1 && !appState.messages[lastIdx].isThinking) {
        appState.messages.splice(lastIdx, 1);
      }
      handleMessage(lastUser.content);
    }
  });

  // Live Search toggle (switches model between search & chat)
  document.getElementById("liveSearchBtn")?.addEventListener("click", () => {
    const sel = document.getElementById("modelSelect");
    if (!sel) return;
    const isSearch = ["tavily", "exa", "bytez"].includes(sel.value);
    if (isSearch) {
      sel.value = MODELS.DEFAULT;
      showToast("💬 Chat mode (Nemotron Super)");
    } else {
      sel.value = "tavily";
      showToast("⚡ Live Search on (Tavily)");
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// VOICE INPUT
// ═══════════════════════════════════════════════════════════════

function initVoice() {
  const micBtn = document.getElementById("micBtn");
  if (!micBtn) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    micBtn.title = "Voice not supported in this browser";
    micBtn.style.opacity = "0.4";
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  let isListening = false;

  micBtn.addEventListener("click", () => {
    if (isListening) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch (e) {
        showToast("❌ Mic start failed");
      }
    }
  });

  recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add("recording");
    micBtn.textContent = "⏹️";
    showToast("🎙️ Listening...");
  };

  recognition.onresult = event => {
    const transcript = event.results[0][0].transcript.trim();
    if (transcript) {
      const input = document.getElementById("messageTextInput");
      if (input) input.value = transcript;
      // Auto-send
      setTimeout(() => document.getElementById("sendMessageBtn")?.click(), 300);
    }
  };

  recognition.onerror = () => {
    showToast("❌ Voice input failed");
  };

  recognition.onend = () => {
    isListening = false;
    micBtn.classList.remove("recording");
    micBtn.textContent = "🎙️";
  };
}

// ═══════════════════════════════════════════════════════════════
// FILE ATTACHMENT
// ═══════════════════════════════════════════════════════════════

function initFileAttach() {
  const attachBtn = document.getElementById("attachBtn");
  const fileInput = document.getElementById("fileInput");
  const preview = document.getElementById("attachmentPreview");
  const nameEl = document.getElementById("attachmentName");
  const removeBtn = document.getElementById("removeAttachBtn");

  let attachedFile = null;

  attachBtn?.addEventListener("click", () => fileInput?.click());

  fileInput?.addEventListener("change", e => {
    const file = e.target.files?.[0];
    if (!file) return;
    attachedFile = file;
    if (nameEl) nameEl.textContent = file.name;
    if (preview) preview.style.display = "flex";
    showToast(`📎 ${file.name} attached`);
  });

  removeBtn?.addEventListener("click", () => {
    attachedFile = null;
    if (fileInput) fileInput.value = "";
    if (preview) preview.style.display = "none";
  });
}

// ═══════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════

function showToast(msg, duration = 2500) {
  let toast = document.getElementById("boatin-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "boatin-toast";
    toast.style.cssText = `
      position: fixed; bottom: 160px; left: 50%; transform: translateX(-50%);
      background: rgba(28, 30, 28, 0.95); backdrop-filter: blur(16px);
      border: 1px solid rgba(255,255,255,0.1); color: #e8ede8;
      padding: 10px 20px; border-radius: 999px; font-size: 14px;
      z-index: 9999; pointer-events: none; transition: opacity 0.3s ease;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5); opacity: 0;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = "1";
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.style.opacity = "0";
  }, duration);
}

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

function init() {
  // Cache DOM
  dom.messagesContainer = document.getElementById("messagesContainer");
  dom.messageTextInput = document.getElementById("messageTextInput");
  dom.sendMessageBtn = document.getElementById("sendMessageBtn");
  dom.clearMemoryBtn = document.getElementById("clearMemoryBtn");
  dom.effortMode = document.getElementById("effortMode");

  // Load previous messages
  loadMessages();

  // Send button
  dom.sendMessageBtn?.addEventListener("click", () => {
    const text = (dom.messageTextInput?.value || "").trim();
    if (text && !appState.isGenerating) {
      dom.messageTextInput.value = "";
      handleMessage(text);
    }
  });

  // Enter key (Shift+Enter = new line)
  dom.messageTextInput?.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!appState.isGenerating) dom.sendMessageBtn?.click();
    }
  });

  // Clear button
  dom.clearMemoryBtn?.addEventListener("click", () => {
    if (confirm("Clear all chat history?")) {
      appState.messages = [
        {
          role: "assistant",
          content: "Chat cleared. Ready!",
          ts: Date.now()
        }
      ];
      persistMessages();
      render();
    }
  });

  // Effort selector
  dom.effortMode?.addEventListener("change", e => {
    appState.currentEffort = e.target.value;
  });

  // Init modules
  initTabs();
  initScrollButton();
  initActions();
  initVoice();
  initFileAttach();

  // Auto-resize textarea
  if (dom.messageTextInput) {
    const ta = dom.messageTextInput;
    const autoResize = () => {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
    };
    ta.addEventListener("input", autoResize);
    autoResize();
  }

  // Initial render
  render();
}

document.addEventListener("DOMContentLoaded", init);
