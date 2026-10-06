/**
 * BOATIN Frontend - Backend Integration Version
 * 
 * This version connects to backend proxy server
 * API keys are on server (not exposed to client)
 * All search & chat requests go through backend
 */

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

// ═══════════════════════════════════════════════════════════════
// APPLICATION STATE
// ═══════════════════════════════════════════════════════════════

const appState = {
  messages: [
    {
      role: "assistant",
      content: "🚀 BOATIN is ready (Backend Integration).\n\n**Features:**\n• Search: Tavily, Exa, Bytez via secure backend\n• Chat: NVIDIA models via backend proxy\n• Auto-detect: Routes to best tool\n• Security: API keys hidden on server\n\nType a message to start!",
      ts: Date.now()
    }
  ],
  autoMode: true,
  currentEffort: "mid",
  isGenerating: false
};

// ═══════════════════════════════════════════════════════════════
// BACKEND API CALLS
// ═══════════════════════════════════════════════════════════════

async function tavilySearch(query) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/search/tavily`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({query})
    });
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    if (!data.ok) return {ok: false, error: data.error};
    
    const text = (data.results || [])
      .map(r => `**${r.title}**\n${r.content}`)
      .join("\n\n---\n\n");
    
    return {
      ok: true,
      text: text || "No results",
      provider: "Tavily",
      resultCount: data.resultCount
    };
  } catch (e) {
    return {ok: false, error: e.message};
  }
}

async function exaSearch(query) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/search/exa`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({query})
    });
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    if (!data.ok) return {ok: false, error: data.error};
    
    const text = (data.results || [])
      .map(r => `**${r.title}**\n${r.text}`)
      .join("\n\n---\n\n");
    
    return {
      ok: true,
      text: text || "No results",
      provider: "Exa",
      resultCount: data.resultCount
    };
  } catch (e) {
    return {ok: false, error: e.message};
  }
}

async function bytezSearch(query) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/search/bytez`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({query})
    });
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    if (!data.ok) return {ok: false, error: data.error};
    
    const text = (data.results || [])
      .map(r => `**${r.title}**\n${r.snippet}`)
      .join("\n\n---\n\n");
    
    return {
      ok: true,
      text: text || "No results",
      provider: "Bytez",
      resultCount: data.resultCount
    };
  } catch (e) {
    return {ok: false, error: e.message};
  }
}

async function smartSearch(query) {
  const engines = [tavilySearch, exaSearch, bytezSearch];
  const engine = engines[Math.floor(Math.random() * engines.length)];
  return await engine(query);
}

async function callNvidiaChat(messages, model = "nvidia/nemotron-3-super-120b-a12b") {
  try {
    const res = await fetch(`${API_BASE_URL}/api/chat`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        messages,
        model,
        max_tokens: getTokenLimit(appState.currentEffort)
      })
    });
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    if (!data.ok) return {ok: false, error: data.error};
    
    return {
      ok: true,
      reply: data.reply,
      model: data.model,
      usage: data.usage
    };
  } catch (e) {
    return {ok: false, error: e.message};
  }
}

function getTokenLimit(effort) {
  const limits = {low: 4096, mid: 16384, high: 32768, max: 65536};
  return limits[effort] || limits.mid;
}

// ═══════════════════════════════════════════════════════════════
// AUTO-DETECTION & MESSAGE HANDLING
// ═══════════════════════════════════════════════════════════════

function detectQueryType(query) {
  const q = query.toLowerCase();
  const searchKeywords = /search|find|research|latest|news|trends|current|what|how|when|where|who|define|explain|tell me about/i;
  return searchKeywords.test(q) ? "search" : "chat";
}

async function handleMessage(text) {
  if (!text.trim() || appState.isGenerating) return;

  const modelSelect = document.getElementById("modelSelect");
  const selectedModel = modelSelect?.value || "nvidia/nemotron-3-super-120b-a12b";

  appState.messages.push({role: "user", content: text, ts: Date.now()});
  appState.isGenerating = true;
  document.getElementById("sendMessageBtn").disabled = true;
  render();

  try {
    const isSearchModel = ["tavily", "exa", "bytez"].includes(selectedModel);
    const autoDetectedSearch = document.getElementById("autoModeToggle")?.checked && detectQueryType(text) === "search";

    if (isSearchModel || autoDetectedSearch) {
      const engine = isSearchModel ? selectedModel : "tavily";
      let result = {ok: false};
      
      if (engine === "tavily") result = await tavilySearch(text);
      else if (engine === "exa") result = await exaSearch(text);
      else if (engine === "bytez") result = await bytezSearch(text);

      if (!result.ok) {
        showToast("⚠️ Search failed, trying fallback...");
        result = await exaSearch(text);
      }

      appState.messages.push({
        role: "assistant",
        content: result.ok 
          ? `**${result.provider}** (${result.resultCount} results)\n\n${result.text}`
          : `❌ Error: ${result.error}`,
        provider: result.provider,
        ts: Date.now()
      });
    } else {
      const response = await callNvidiaChat(
        appState.messages.filter(m => !m.isThinking).map(m => ({role: m.role, content: m.content})),
        selectedModel
      );

      appState.messages.push({
        role: "assistant",
        content: response.ok ? response.reply : `❌ Error: ${response.error}`,
        model: selectedModel,
        ts: Date.now()
      });
    }
  } catch (e) {
    appState.messages.push({
      role: "assistant",
      content: `❌ Unexpected error: ${e.message}`,
      ts: Date.now()
    });
  }

  appState.isGenerating = false;
  document.getElementById("sendMessageBtn").disabled = false;
  persistMessages();
  render();
}

// ═══════════════════════════════════════════════════════════════
// UI & PERSISTENCE (rest same as app-ultimate.js)
// ═══════════════════════════════════════════════════════════════

function render() {
  const container = document.getElementById("messagesContainer");
  if (!container) return;

  container.innerHTML = appState.messages.map(msg => {
    const role = msg.role === "user" ? "You" : "BOATIN";
    const roleClass = msg.role === "user" ? "user" : "assistant";
    const time = new Date(msg.ts).toLocaleTimeString();
    const meta = [msg.provider || "", msg.model ? msg.model.split("/")[1] : ""].filter(Boolean).join(" • ");

    return `
      <div class="message-bubble ${roleClass}">
        <strong>${role}${meta ? ` • ${meta}` : ""}</strong>
        <p>${(msg.content || "").replace(/\n/g, "<br>")}</p>
        <small>${time}</small>
      </div>
    `;
  }).join("");

  setTimeout(() => {
    container.scrollTop = container.scrollHeight;
  }, 50);
}

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
    if (saved) appState.messages = JSON.parse(saved);
  } catch (e) {
    console.warn("Could not load from localStorage:", e);
  }
}

function showToast(msg, duration = 2500) {
  let toast = document.getElementById("boatin-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "boatin-toast";
    toast.style.cssText = `
      position: fixed; bottom: 160px; left: 50%; transform: translateX(-50%);
      background: rgba(28, 30, 28, 0.95); color: #e8ede8;
      padding: 10px 20px; border-radius: 999px; font-size: 14px;
      z-index: 9999; backdrop-filter: blur(16px);
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { toast.remove(); }, duration);
}

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

function init() {
  loadMessages();

  const sendBtn = document.getElementById("sendMessageBtn");
  const input = document.getElementById("messageTextInput");
  const clearBtn = document.getElementById("clearMemoryBtn");

  sendBtn?.addEventListener("click", () => {
    const text = (input?.value || "").trim();
    if (text) {
      input.value = "";
      handleMessage(text);
    }
  });

  input?.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendBtn?.click();
    }
  });

  clearBtn?.addEventListener("click", () => {
    if (confirm("Clear chat?")) {
      appState.messages = [{role: "assistant", content: "Chat cleared.", ts: Date.now()}];
      persistMessages();
      render();
    }
  });

  document.getElementById("effortMode")?.addEventListener("change", (e) => {
    appState.currentEffort = e.target.value;
  });

  render();
}

document.addEventListener("DOMContentLoaded", init);
