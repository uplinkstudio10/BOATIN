/**
 * BOATIN - AI Chat + Real-Time Search Engine
 * Liquid Theme Edition
 * 
 * Features:
 * - Real-time web search (Tavily, Exa, Bytez)
 * - AI chat models (NVIDIA, Llama, Mistral)
 * - Auto-detection (search vs chat)
 * - Liquid glassmorphism theme
 * - Voice input with auto-send
 * - Message history
 * - Mobile responsive
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
  ADVANCED: "meta/llama-3.1-405b"
};

// ═══════════════════════════════════════════════════════════════
// APPLICATION STATE
// ═══════════════════════════════════════════════════════════════

const appState = {
  messages: [
    {
      role: "assistant",
      content: "🚀 BOATIN is ready.\n\n**Features:**\n• Search: Type to find info (auto-routes to Tavily/Exa/Bytez)\n• Chat: Talk to AI (Nemotron Super, Llama, Mistral)\n• Auto-detect: Detects search vs chat automatically\n• Voice: Click mic to speak\n• Effort: Low/Mid/High/Max token limits\n\nTry: 'search latest AI news' or 'write Python code'",
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
  effortMode: null,
  liveSearchBtn: null,
  attachBtn: null,
  fileInput: null
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
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        api_key: API_KEYS.TAVILY,
        query: query,
        max_results: 15,
        include_answer: true
      })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    const results = data.results || [];
    const text = results
      .map(r => `**${r.title}**\n${r.content}`)
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
 * Exa Search - Semantic search
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
        type: "neural"
      })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    const results = data.results || [];
    const text = results
      .map(r => `**${r.title}**\n${r.text || ""}`)
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
          "Authorization": `Bearer ${API_KEYS.BYTEZ}`,
          "Accept": "application/json"
        }
      }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    const results = data.results || [];
    const text = results
      .map(r => `**${r.title || r.name}**\n${r.snippet || r.description || ""}`)
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
 * Smart search engine selector
 * Rotates between Tavily, Exa, Bytez for diversity
 */
async function smartSearch(query) {
  const engines = [tavilySearch, exaSearch, bytezSearch];
  const engine = engines[Math.floor(Math.random() * engines.length)];
  return await engine(query);
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
        "Authorization": `Bearer ${API_KEYS.NVIDIA}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: getTokenLimit(appState.currentEffort),
        temperature: 0.7,
        top_p: 0.9
      })
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error?.message || `HTTP ${res.status}`);
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
  const q = query.toLowerCase();
  
  const searchKeywords = /search|find|research|latest|news|trends|current|what|how|when|where|who|define|explain|tell me about|information|data/i;
  const chatKeywords = /write|create|generate|code|story|poem|song|dialogue|script|help|assist|explain how|teach|learn|guide|tutorial/i;
  
  if (searchKeywords.test(q)) return "search";
  if (chatKeywords.test(q)) return "chat";
  
  return "chat"; // Default to chat
}

// ═══════════════════════════════════════════════════════════════
// MESSAGE HANDLING
// ═══════════════════════════════════════════════════════════════

/**
 * Main message handler
 */
async function handleMessage(text) {
  if (!text.trim()) return;

  // Add user message
  appState.messages.push({
    role: "user",
    content: text,
    ts: Date.now()
  });

  render();

  // Detect query type
  const queryType = detectQueryType(text);
  appState.isGenerating = true;
  render();

  try {
    if (queryType === "search") {
      // Use smart search
      const result = await smartSearch(text);
      
      const content = result.ok
        ? `**${result.provider} Search Results** (${result.resultCount} found)\n\n${result.text}`
        : `❌ Search Error: ${result.error}`;

      appState.messages.push({
        role: "assistant",
        content: content,
        provider: result.provider,
        ts: Date.now()
      });
    } else {
      // Use chat
      const response = await callNvidiaChat(
        appState.messages.map(m => ({
          role: m.role,
          content: m.content
        }))
      );

      if (response.ok) {
        appState.messages.push({
          role: "assistant",
          content: response.reply,
          model: response.model,
          tokens: response.usage?.completion_tokens,
          ts: Date.now()
        });
      } else {
        appState.messages.push({
          role: "assistant",
          content: `❌ Chat Error: ${response.error}`,
          ts: Date.now()
        });
      }
    }
  } catch (e) {
    appState.messages.push({
      role: "assistant",
      content: `❌ Error: ${e.message}`,
      ts: Date.now()
    });
  }

  appState.isGenerating = false;
  persistMessages();
  render();
}

// ═══════════════════════════════════════════════════════════════
// UI RENDERING
// ═══════════════════════════════════════════════════════════════

/**
 * Render all messages to the DOM
 */
function render() {
  if (!dom.messagesContainer) return;

  dom.messagesContainer.innerHTML = appState.messages
    .map((msg, i) => {
      const role = msg.role === "user" ? "You" : "BOATIN";
      const roleClass = msg.role === "user" ? "user" : "assistant";
      const timestamp = new Date(msg.ts).toLocaleTimeString();
      const provider = msg.provider ? ` (${msg.provider})` : "";
      const model = msg.model ? ` (${msg.model.split('/')[1]})` : "";
      const tokens = msg.tokens ? ` • ${msg.tokens} tokens` : "";

      return `
        <div class="message-bubble ${roleClass}">
          <strong>${role}${provider}${model}</strong>
          <p>${msg.content}</p>
          <small>${timestamp}${tokens}</small>
        </div>
      `;
    })
    .join("");

  // Auto-scroll to bottom
  setTimeout(() => {
    dom.messagesContainer.scrollTop = dom.messagesContainer.scrollHeight;
  }, 0);
}

// ═══════════════════════════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════════════════════════

/**
 * Save messages to localStorage
 */
function persistMessages() {
  try {
    localStorage.setItem("boatin-messages", JSON.stringify(appState.messages));
  } catch (e) {
    console.warn("Could not save to localStorage:", e);
  }
}

/**
 * Load messages from localStorage
 */
function loadMessages() {
  try {
    const saved = localStorage.getItem("boatin-messages");
    if (saved) {
      appState.messages = JSON.parse(saved);
    }
  } catch (e) {
    console.warn("Could not load from localStorage:", e);
  }
}

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

/**
 * Initialize the application
 */
function init() {
  // Cache DOM elements
  dom.messagesContainer = document.getElementById("messagesContainer");
  dom.messageTextInput = document.getElementById("messageTextInput");
  dom.sendMessageBtn = document.getElementById("sendMessageBtn");
  dom.clearMemoryBtn = document.getElementById("clearMemoryBtn");
  dom.effortMode = document.getElementById("effortMode");
  dom.liveSearchBtn = document.getElementById("liveSearchBtn");

  if (!dom.messagesContainer || !dom.messageTextInput) return;

  // Load previous messages
  loadMessages();

  // Wire send button
  if (dom.sendMessageBtn) {
    dom.sendMessageBtn.addEventListener("click", () => {
      const text = (dom.messageTextInput?.value || "").trim();
      if (text && !appState.isGenerating) {
        dom.messageTextInput.value = "";
        handleMessage(text);
      }
    });
  }

  // Wire enter key
  if (dom.messageTextInput) {
    dom.messageTextInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !appState.isGenerating) {
        e.preventDefault();
        dom.sendMessageBtn?.click();
      }
    });
  }

  // Wire clear button
  if (dom.clearMemoryBtn) {
    dom.clearMemoryBtn.addEventListener("click", () => {
      if (confirm("Clear chat history?")) {
        appState.messages = [{
          role: "assistant",
          content: "Chat cleared. Ready to start fresh.",
          ts: Date.now()
        }];
        persistMessages();
        render();
      }
    });
  }

  // Wire effort selector
  if (dom.effortMode) {
    dom.effortMode.addEventListener("change", (e) => {
      appState.currentEffort = e.target.value;
    });
  }

  // Wire live search toggle
  if (dom.liveSearchBtn) {
    dom.liveSearchBtn.addEventListener("click", () => {
      alert("Live Search: Currently using auto-detection (searches when query matches search keywords)");
    });
  }

  // Initial render
  render();
}

// Start when DOM is ready
document.addEventListener("DOMContentLoaded", init);

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
  });

  // Copy last message
  document.getElementById("copyLastBtn")?.addEventListener("click", () => {
    const last = [...appState.messages].reverse().find(m => m.role === "assistant");
    if (last) {
      navigator.clipboard.writeText(last.content)
        .then(() => showToast("✅ Copied!"))
        .catch(() => showToast("❌ Copy failed"));
    }
  });

  // Retry last message
  document.getElementById("retryBtn")?.addEventListener("click", () => {
    const lastUser = [...appState.messages].reverse().find(m => m.role === "user");
    if (lastUser) {
      // Remove last assistant message and retry
      const lastIdx = appState.messages.map(m => m.role).lastIndexOf("assistant");
      if (lastIdx !== -1) appState.messages.splice(lastIdx, 1);
      handleMessage(lastUser.content);
    }
  });

  // Live search toggle
  document.getElementById("liveSearchBtn")?.addEventListener("click", () => {
    const sel = document.getElementById("modelSelect");
    if (!sel) return;
    const isSearch = ["tavily", "exa", "bytez"].includes(sel.value);
    if (isSearch) {
      sel.value = "nvidia/nemotron-3-super-120b-a12b";
      showToast("💬 Chat mode");
    } else {
      sel.value = "tavily";
      showToast("⚡ Live Search on");
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
      recognition.start();
    }
  });

  recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add("recording");
    micBtn.textContent = "⏹️";
    showToast("🎙️ Listening...");
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim();
    if (transcript) {
      document.getElementById("messageTextInput").value = transcript;
      // Auto-send after voice input
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

  fileInput?.addEventListener("change", (e) => {
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
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = "1";
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { toast.style.opacity = "0"; }, duration);
}

// ═══════════════════════════════════════════════════════════════
// MODEL SELECTION AWARE HANDLER
// ═══════════════════════════════════════════════════════════════

async function handleMessage(text) {
  if (!text.trim() || appState.isGenerating) return;

  const modelSelect = document.getElementById("modelSelect");
  const selectedModel = modelSelect?.value || MODELS.DEFAULT;
  const autoModeEnabled = document.getElementById("autoModeToggle")?.checked;

  // Add user message
  appState.messages.push({ role: "user", content: text, ts: Date.now() });

  // Add thinking indicator
  const thinkingId = Date.now() + "_think";
  appState.messages.push({
    role: "assistant",
    content: "...",
    isThinking: true,
    id: thinkingId,
    ts: Date.now()
  });
  appState.isGenerating = true;
  document.getElementById("sendMessageBtn").disabled = true;
  render();

  let result = { ok: false, error: "Unknown error" };

  try {
    const isSearchModel = ["tavily", "exa", "bytez"].includes(selectedModel);
    const autoDetectedSearch = autoModeEnabled && detectQueryType(text) === "search";

    if (isSearchModel || autoDetectedSearch) {
      // Use search engine
      const engine = isSearchModel ? selectedModel : "tavily";

      if (engine === "tavily") result = await tavilySearch(text);
      else if (engine === "exa") result = await exaSearch(text);
      else if (engine === "bytez") result = await bytezSearch(text);

      if (!result.ok) {
        // Fallback chain
        showToast("⚠️ Primary search failed, trying Exa...");
        result = await exaSearch(text);
        if (!result.ok) {
          showToast("⚠️ Exa failed, trying Bytez...");
          result = await bytezSearch(text);
        }
      }

      const content = result.ok
        ? `**${result.provider} Results** (${result.resultCount} found)\n\n${result.text}`
        : `❌ All search engines failed: ${result.error}`;

      // Replace thinking
      const idx = appState.messages.findIndex(m => m.id === thinkingId);
      if (idx !== -1) {
        appState.messages[idx] = {
          role: "assistant",
          content: content,
          provider: result.provider,
          ts: Date.now()
        };
      }
    } else {
      // Use chat model
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
  document.getElementById("sendMessageBtn").disabled = false;
  persistMessages();
  render();
}

// ═══════════════════════════════════════════════════════════════
// RENDER WITH MARKDOWN
// ═══════════════════════════════════════════════════════════════

function render() {
  if (!dom.messagesContainer) return;

  dom.messagesContainer.innerHTML = appState.messages.map(msg => {
    const role = msg.role === "user" ? "You" : "BOATIN";
    const roleClass = msg.role === "user" ? "user" : "assistant";
    const time = new Date(msg.ts).toLocaleTimeString();
    const meta = [
      msg.provider ? `via ${msg.provider}` : "",
      msg.model ? msg.model.split("/")[1] : "",
      msg.tokens ? `${msg.tokens} tok` : ""
    ].filter(Boolean).join(" • ");

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
  }).join("");

  // Syntax highlight code blocks
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
// UPDATED INIT
// ═══════════════════════════════════════════════════════════════

function init() {
  // Cache DOM
  dom.messagesContainer = document.getElementById("messagesContainer");
  dom.messageTextInput = document.getElementById("messageTextInput");
  dom.sendMessageBtn = document.getElementById("sendMessageBtn");
  dom.clearMemoryBtn = document.getElementById("clearMemoryBtn");
  dom.effortMode = document.getElementById("effortMode");

  // Load messages
  loadMessages();

  // Send button
  dom.sendMessageBtn?.addEventListener("click", () => {
    const text = (dom.messageTextInput?.value || "").trim();
    if (text) {
      dom.messageTextInput.value = "";
      handleMessage(text);
    }
  });

  // Enter key (Shift+Enter = new line)
  dom.messageTextInput?.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      dom.sendMessageBtn?.click();
    }
  });

  // Clear button
  dom.clearMemoryBtn?.addEventListener("click", () => {
    if (confirm("Clear all chat history?")) {
      appState.messages = [{
        role: "assistant",
        content: "Chat cleared. Ready!",
        ts: Date.now()
      }];
      persistMessages();
      render();
    }
  });

  // Effort
  dom.effortMode?.addEventListener("change", (e) => {
    appState.currentEffort = e.target.value;
  });

  // Init modules
  initTabs();
  initScrollButton();
  initActions();
  initVoice();
  initFileAttach();

  // Initial render
  render();
}

document.addEventListener("DOMContentLoaded", init);
