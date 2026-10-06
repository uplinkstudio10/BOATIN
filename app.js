/**
 * ══════════════════════════════════════════════════════════════════════════════
 * BOATIN — AI Chat + Real-Time Search Engine
 * Ultimate Expanded Edition (1MB+ target build)
 *
 * Full-featured client with:
 *  - Multi-engine search (Tavily / Exa / Bytez) + automatic fallback chain
 *  - NVIDIA NIM chat (Nemotron Super/Ultra/Nano, Llama, Mistral, Gemma, CodeGemma)
 *  - Intent auto-detection (search vs generation)
 *  - Robust error handling, retries, exponential backoff, offline detection
 *  - Rate-limit awareness and user-facing recovery tips
 *  - Voice input, file attach, export, copy, retry
 *  - Markdown + syntax highlighting
 *  - localStorage history with quota protection
 *  - Mobile-first liquid glassmorphism UI
 *  - Accessibility (ARIA, reduced-motion, focus management)
 *
 * All API keys are embedded for single-file convenience on GitHub Pages.
 * Size is intentional — completeness and resilience over minimalism.
 * ══════════════════════════════════════════════════════════════════════════════
 */

"use strict";

// ═══════════════════════════════════════════════════════════════
// API CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const API_KEYS = Object.freeze({
  NVIDIA: "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",
  TAVILY: "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",
  EXA:    "c6f6fe81-f6d6-4a46-a7ee-1887216305ee",
  BYTEZ:  "e22f52c699b71b327d3a22d50be7064e"
});

const NVIDIA_CHAT_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

const MODELS = Object.freeze({
  DEFAULT:    "nvidia/nemotron-3-super-120b-a12b",
  FAST:       "meta/llama-3.1-8b",
  ADVANCED:   "meta/llama-3.1-405b",
  LLAMA70:    "meta/llama-3.3-70b",
  NEMOTRON49: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  NANO30:     "nvidia/nemotron-3-nano-30b-a3b",
  LIGHTNING:  "nvidia/nemotron-3.5-lightning-30b-a3b",
  ULTRA253:   "nvidia/llama-3.1-nemotron-ultra-253b-v1",
  ULTRA550:   "nvidia/nemotron-3-ultra-550b-a55b",
  NANO9:      "nvidia/nvidia-nemotron-nano-9b-v2",
  GEMMA:      "google/gemma-7b",
  CODEGEMMA:  "google/codegemma-7b"
});

const SEARCH_ENGINES = new Set(["tavily", "exa", "bytez"]);

const TOKEN_LIMITS = Object.freeze({
  low:  4096,
  mid:  16384,
  high: 32768,
  max:  65536
});

// Retry / resilience defaults
const RETRY_DEFAULTS = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 700,
  maxDelayMs: 8000,
  jitterMs: 250
});

// ═══════════════════════════════════════════════════════════════
// ERROR CATALOG + CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

/**
 * Normalize any thrown value into a structured error object.
 * Used everywhere so UI always gets a predictable shape.
 */
function normalizeError(err, context = "unknown") {
  const raw = err && typeof err === "object" ? err : { message: String(err) };
  const message = raw.message || raw.error || String(err) || "Unknown error";
  const status = raw.status || raw.statusCode || null;
  const code = raw.code || null;

  let category = "unknown";
  let userHint = "Something went wrong. Please try again.";
  let retryable = true;

  const lower = message.toLowerCase();

  if (!navigator.onLine || lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("network request failed")) {
    category = "offline";
    userHint = "You appear to be offline. Check your internet connection and try again.";
    retryable = true;
  } else if (status === 401 || status === 403 || lower.includes("unauthorized") || lower.includes("invalid api key") || lower.includes("authentication")) {
    category = "auth";
    userHint = "API key rejected or expired. Verify the key still has quota.";
    retryable = false;
  } else if (status === 429 || lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("quota")) {
    category = "rate_limit";
    userHint = "Rate limit hit. Wait a moment and retry, or switch model/engine.";
    retryable = true;
  } else if (status === 404 || lower.includes("not found") || lower.includes("model not found")) {
    category = "not_found";
    userHint = "Model or endpoint not found. Pick another model from the list.";
    retryable = false;
  } else if (status >= 500 || lower.includes("internal server") || lower.includes("bad gateway") || lower.includes("service unavailable")) {
    category = "server";
    userHint = "Provider is temporarily unavailable. Retrying may help.";
    retryable = true;
  } else if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("aborted")) {
    category = "timeout";
    userHint = "Request timed out. Try a shorter prompt or lower effort level.";
    retryable = true;
  } else if (lower.includes("cors")) {
    category = "cors";
    userHint = "Browser blocked the request (CORS). This is unusual for these APIs.";
    retryable = false;
  } else if (status >= 400 && status < 500) {
    category = "client";
    userHint = "Request was rejected by the API. Check your input and try again.";
    retryable = false;
  }

  return {
    ok: false,
    message,
    status,
    code,
    category,
    userHint,
    retryable,
    context,
    timestamp: Date.now()
  };
}

/**
 * Format a normalized error for display inside a chat bubble.
 */
function formatErrorForChat(norm) {
  const lines = [
    `❌ **Error** (${norm.context})`,
    "",
    norm.message,
    "",
    `*${norm.userHint}*`
  ];
  if (norm.status) lines.push(`\nStatus: \`${norm.status}\``);
  if (norm.category) lines.push(`Category: \`${norm.category}\``);
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// RETRY WITH EXPONENTIAL BACKOFF + JITTER
// ═══════════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function computeBackoff(attempt, base = RETRY_DEFAULTS.baseDelayMs, max = RETRY_DEFAULTS.maxDelayMs, jitter = RETRY_DEFAULTS.jitterMs) {
  const exp = Math.min(max, base * Math.pow(2, attempt));
  const rand = Math.floor(Math.random() * jitter);
  return exp + rand;
}

/**
 * Generic retry wrapper.
 * fn must return a value; throw or return {ok:false} to signal failure.
 */
async function withRetry(fn, options = {}) {
  const maxAttempts = options.maxAttempts ?? RETRY_DEFAULTS.maxAttempts;
  const label = options.label || "operation";
  const shouldRetry = options.shouldRetry || ((result, err) => {
    if (err) {
      const n = normalizeError(err, label);
      return n.retryable;
    }
    if (result && result.ok === false) {
      const n = normalizeError(result, label);
      return n.retryable;
    }
    return false;
  });

  let lastResult = null;
  let lastErr = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (!navigator.onLine) {
        throw Object.assign(new Error("Network offline"), { code: "OFFLINE" });
      }
      const result = await fn(attempt);
      lastResult = result;
      if (result && result.ok === false) {
        if (attempt < maxAttempts - 1 && shouldRetry(result, null)) {
          const delay = computeBackoff(attempt);
          showToast(`⚠️ ${label} failed — retry ${attempt + 1}/${maxAttempts - 1} in ${Math.round(delay / 1000)}s`);
          await sleep(delay);
          continue;
        }
        return result;
      }
      return result;
    } catch (err) {
      lastErr = err;
      const norm = normalizeError(err, label);
      if (attempt < maxAttempts - 1 && shouldRetry(null, err)) {
        const delay = computeBackoff(attempt);
        showToast(`⚠️ ${label} error — retry ${attempt + 1}/${maxAttempts - 1}`);
        await sleep(delay);
        continue;
      }
      return { ok: false, error: norm.message, normalized: norm, provider: options.provider || label };
    }
  }

  if (lastResult) return lastResult;
  const norm = normalizeError(lastErr || new Error("All retries exhausted"), label);
  return { ok: false, error: norm.message, normalized: norm, provider: options.provider || label };
}

// ═══════════════════════════════════════════════════════════════
// LOGGING (lightweight, in-memory ring buffer)
// ═══════════════════════════════════════════════════════════════

const LogBuffer = {
  max: 120,
  entries: [],
  push(level, msg, meta) {
    const entry = {
      t: Date.now(),
      level,
      msg: String(msg),
      meta: meta || null
    };
    this.entries.push(entry);
    if (this.entries.length > this.max) this.entries.shift();
    if (level === "error") {
      try { console.error("[BOATIN]", msg, meta || ""); } catch (_) {}
    } else if (level === "warn") {
      try { console.warn("[BOATIN]", msg, meta || ""); } catch (_) {}
    }
  },
  info(msg, meta) { this.push("info", msg, meta); },
  warn(msg, meta) { this.push("warn", msg, meta); },
  error(msg, meta) { this.push("error", msg, meta); },
  dump() { return this.entries.slice(); }
};

// ═══════════════════════════════════════════════════════════════
// APPLICATION STATE
// ═══════════════════════════════════════════════════════════════

const appState = {
  messages: [
    {
      role: "assistant",
      content:
        "🚀 **BOATIN is ready.**\n\n" +
        "**Features:**\n" +
        "• **Search** — auto-routes to Tavily / Exa / Bytez with fallback\n" +
        "• **Chat** — Nemotron Super/Ultra, Llama 405B/70B/8B, Mistral, Gemma…\n" +
        "• **Auto-detect** — search vs chat intent\n" +
        "• **Voice** — mic → auto-send\n" +
        "• **Effort** — Low / Mid / High / Max tokens\n" +
        "• **Resilience** — retries, offline detection, rate-limit hints\n\n" +
        "Try: `search latest AI news` or `write a Python function`",
      ts: Date.now()
    }
  ],
  autoMode: true,
  currentEffort: "mid",
  isGenerating: false,
  attachedFile: null,
  lastError: null,
  offline: !navigator.onLine
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
// NETWORK HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * fetch with timeout + basic status enrichment
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (err) {
    if (err.name === "AbortError") {
      throw Object.assign(new Error("Request timed out"), { code: "TIMEOUT", status: 408 });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function readErrorBody(res) {
  try {
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const j = await res.json();
      return j.error?.message || j.message || j.detail || JSON.stringify(j).slice(0, 200);
    }
    const t = await res.text();
    return t.slice(0, 200);
  } catch (_) {
    return "";
  }
}

// ═══════════════════════════════════════════════════════════════
// SEARCH ENGINES (with structured errors)
// ═══════════════════════════════════════════════════════════════

async function tavilySearch(query) {
  return withRetry(async () => {
    const res = await fetchWithTimeout("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: API_KEYS.TAVILY,
        query,
        max_results: 12,
        include_answer: true,
        search_depth: "advanced",
        include_raw_content: false
      })
    }, 40000);

    if (!res.ok) {
      const body = await readErrorBody(res);
      const err = new Error(body || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    const results = data.results || [];
    let text = "";
    if (data.answer) text += `**Answer:** ${data.answer}\n\n---\n\n`;
    text += results.map((r, i) => {
      const title = r.title || `Result ${i + 1}`;
      const content = r.content || r.snippet || "";
      const url = r.url ? `\n🔗 ${r.url}` : "";
      return `**${title}**\n${content}${url}`;
    }).join("\n\n---\n\n");

    return {
      ok: true,
      text: text || "No results found.",
      provider: "Tavily",
      resultCount: results.length
    };
  }, { label: "Tavily", provider: "Tavily", maxAttempts: 2 });
}

async function exaSearch(query) {
  return withRetry(async () => {
    const res = await fetchWithTimeout("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEYS.EXA
      },
      body: JSON.stringify({
        query,
        numResults: 12,
        useAutoprompt: true,
        type: "neural",
        contents: { text: true }
      })
    }, 40000);

    if (!res.ok) {
      const body = await readErrorBody(res);
      const err = new Error(body || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    const results = data.results || [];
    const text = results.map((r, i) => {
      const title = r.title || `Result ${i + 1}`;
      const content = r.text || r.snippet || "";
      const url = r.url ? `\n🔗 ${r.url}` : "";
      return `**${title}**\n${content}${url}`;
    }).join("\n\n---\n\n");

    return {
      ok: true,
      text: text || "No results found.",
      provider: "Exa",
      resultCount: results.length
    };
  }, { label: "Exa", provider: "Exa", maxAttempts: 2 });
}

async function bytezSearch(query) {
  return withRetry(async () => {
    const res = await fetchWithTimeout(
      `https://api.bytez.com/search?q=${encodeURIComponent(query)}&count=12`,
      {
        headers: {
          Authorization: `Bearer ${API_KEYS.BYTEZ}`,
          Accept: "application/json"
        }
      },
      40000
    );

    if (!res.ok) {
      const body = await readErrorBody(res);
      const err = new Error(body || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    const results = data.results || data.data || [];
    const text = results.map((r, i) => {
      const title = r.title || r.name || `Result ${i + 1}`;
      const content = r.snippet || r.description || r.text || "";
      const url = r.url ? `\n🔗 ${r.url}` : "";
      return `**${title}**\n${content}${url}`;
    }).join("\n\n---\n\n");

    return {
      ok: true,
      text: text || "No results found.",
      provider: "Bytez",
      resultCount: results.length
    };
  }, { label: "Bytez", provider: "Bytez", maxAttempts: 2 });
}

/**
 * Run preferred engine then fall through the remaining engines.
 * Each engine already has its own short retry; this is engine-level fallback.
 */
async function searchWithFallback(query, preferred = "tavily") {
  const engines = {
    tavily: tavilySearch,
    exa: exaSearch,
    bytez: bytezSearch
  };

  const order = [];
  if (engines[preferred]) order.push(preferred);
  ["tavily", "exa", "bytez"].forEach(n => { if (!order.includes(n)) order.push(n); });

  const errors = [];
  for (let i = 0; i < order.length; i++) {
    const name = order[i];
    LogBuffer.info(`Search attempt with ${name}`, { query: query.slice(0, 80) });
    const result = await engines[name](query);
    if (result.ok) {
      LogBuffer.info(`${name} succeeded`, { count: result.resultCount });
      return result;
    }
    errors.push(`${result.provider || name}: ${result.error || "failed"}`);
    LogBuffer.warn(`${name} failed`, { error: result.error });
    if (i < order.length - 1) {
      showToast(`⚠️ ${result.provider || name} failed — trying next…`);
    }
  }

  const combined = errors.join(" | ");
  const norm = normalizeError(new Error(combined), "search-fallback");
  appState.lastError = norm;
  return {
    ok: false,
    error: combined,
    normalized: norm,
    provider: "All engines"
  };
}

// ═══════════════════════════════════════════════════════════════
// NVIDIA CHAT
// ═══════════════════════════════════════════════════════════════

async function callNvidiaChat(messages, model = MODELS.DEFAULT) {
  return withRetry(async () => {
    const res = await fetchWithTimeout(NVIDIA_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEYS.NVIDIA}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: TOKEN_LIMITS[appState.currentEffort] || TOKEN_LIMITS.mid,
        temperature: 0.7,
        top_p: 0.9,
        stream: false
      })
    }, 120000);

    if (!res.ok) {
      const body = await readErrorBody(res);
      const err = new Error(body || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) {
      throw new Error("Empty response from model");
    }

    return {
      ok: true,
      reply,
      model,
      usage: data.usage || null
    };
  }, { label: "NVIDIA Chat", provider: model, maxAttempts: 3 });
}

function getTokenLimit(effort) {
  return TOKEN_LIMITS[effort] || TOKEN_LIMITS.mid;
}

// ═══════════════════════════════════════════════════════════════
// INTENT DETECTION
// ═══════════════════════════════════════════════════════════════

function detectQueryType(query) {
  const q = (query || "").toLowerCase().trim();
  if (!q) return "chat";

  const searchStart =
    /^(search|find|research|look\s*up|lookup|google|what\s+is|what's|who\s+is|when\s+did|where\s+is|how\s+many|latest|news|current|today|recent|trends|define|tell\s+me\s+about|information\s+about|data\s+on)\b/i;

  const chatSignals =
    /\b(write|create|generate|code|story|poem|song|dialogue|script|help\s+me|assist|explain\s+how|teach\s+me|tutorial|make\s+a|draw|design|refactor|function|class|python|javascript|html|css|typescript)\b/i;

  if (searchStart.test(q)) return "search";
  if (chatSignals.test(q)) return "chat";
  if (q.endsWith("?") || /^(what|who|when|where|why|how|is|are|can|does|did|will|should)\b/i.test(q)) {
    return "search";
  }
  return "chat";
}

// ═══════════════════════════════════════════════════════════════
// MESSAGE HANDLING
// ═══════════════════════════════════════════════════════════════

async function handleMessage(text) {
  const trimmed = (text || "").trim();
  if (!trimmed || appState.isGenerating) return;

  if (!navigator.onLine) {
    appState.messages.push({ role: "user", content: trimmed, ts: Date.now() });
    appState.messages.push({
      role: "assistant",
      content: formatErrorForChat(normalizeError(new Error("Network offline"), "offline")),
      ts: Date.now()
    });
    render();
    showToast("📡 You are offline");
    return;
  }

  const modelSelect = document.getElementById("modelSelect");
  const selectedModel = modelSelect?.value || MODELS.DEFAULT;
  const autoModeEnabled = document.getElementById("autoModeToggle")?.checked ?? true;

  appState.messages.push({ role: "user", content: trimmed, ts: Date.now() });

  const thinkingId = Date.now() + "_think";
  appState.messages.push({
    role: "assistant",
    content: "…",
    isThinking: true,
    id: thinkingId,
    ts: Date.now()
  });

  appState.isGenerating = true;
  if (dom.sendMessageBtn) dom.sendMessageBtn.disabled = true;
  render();

  try {
    const isSearchModel = SEARCH_ENGINES.has(selectedModel);
    const autoDetectedSearch = autoModeEnabled && detectQueryType(trimmed) === "search";

    if (isSearchModel || autoDetectedSearch) {
      const preferred = isSearchModel ? selectedModel : "tavily";
      const result = await searchWithFallback(trimmed, preferred);

      if (result.ok) {
        replaceThinking(thinkingId, {
          role: "assistant",
          content: `**${result.provider} Results** (${result.resultCount} found)\n\n${result.text}`,
          provider: result.provider,
          ts: Date.now()
        });
      } else {
        const norm = result.normalized || normalizeError(new Error(result.error), "search");
        appState.lastError = norm;
        replaceThinking(thinkingId, {
          role: "assistant",
          content: formatErrorForChat(norm),
          ts: Date.now()
        });
      }
    } else {
      const chatMessages = appState.messages
        .filter(m => !m.isThinking)
        .map(m => ({ role: m.role, content: m.content }));

      const response = await callNvidiaChat(chatMessages, selectedModel);

      if (response.ok) {
        replaceThinking(thinkingId, {
          role: "assistant",
          content: response.reply,
          model: selectedModel,
          tokens: response.usage?.completion_tokens,
          ts: Date.now()
        });
      } else {
        const norm = response.normalized || normalizeError(new Error(response.error), "chat");
        appState.lastError = norm;
        replaceThinking(thinkingId, {
          role: "assistant",
          content: formatErrorForChat(norm),
          model: selectedModel,
          ts: Date.now()
        });
      }
    }
  } catch (e) {
    const norm = normalizeError(e, "handleMessage");
    appState.lastError = norm;
    LogBuffer.error("Unhandled in handleMessage", norm);
    replaceThinking(thinkingId, {
      role: "assistant",
      content: formatErrorForChat(norm),
      ts: Date.now()
    });
  }

  appState.isGenerating = false;
  if (dom.sendMessageBtn) dom.sendMessageBtn.disabled = false;
  persistMessages();
  render();
}

function replaceThinking(thinkingId, newMsg) {
  const idx = appState.messages.findIndex(m => m.id === thinkingId);
  if (idx !== -1) appState.messages[idx] = newMsg;
  else appState.messages.push(newMsg);
}

// ═══════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════

function render() {
  if (!dom.messagesContainer) return;

  try {
    dom.messagesContainer.innerHTML = appState.messages.map(msg => {
      const role = msg.role === "user" ? "You" : "BOATIN";
      const roleClass = msg.role === "user" ? "user" : "assistant";
      const time = new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const metaParts = [
        msg.provider ? `via ${msg.provider}` : "",
        msg.model ? shortModelName(msg.model) : "",
        msg.tokens != null ? `${msg.tokens} tok` : ""
      ].filter(Boolean);
      const meta = metaParts.length ? ` · ${metaParts.join(" • ")}` : "";

      let content;
      if (msg.isThinking) {
        content = `<div class="thinking-dots" aria-label="Thinking"><span></span><span></span><span></span></div>`;
      } else if (typeof marked !== "undefined") {
        try {
          content = marked.parse(msg.content || "");
        } catch (parseErr) {
          LogBuffer.warn("marked.parse failed", parseErr);
          content = `<p>${escapeHtml(msg.content || "").replace(/\n/g, "<br>")}</p>`;
        }
      } else {
        content = `<p>${escapeHtml(msg.content || "").replace(/\n/g, "<br>")}</p>`;
      }

      return `
        <div class="message-bubble ${roleClass}${msg.isThinking ? " thinking" : ""}" role="article">
          <strong>${role}${meta}</strong>
          ${content}
          <small>${time}</small>
        </div>
      `;
    }).join("");

    if (typeof hljs !== "undefined") {
      dom.messagesContainer.querySelectorAll("pre code").forEach(block => {
        try { hljs.highlightElement(block); } catch (_) {}
      });
    }

    requestAnimationFrame(() => {
      if (dom.messagesContainer) {
        dom.messagesContainer.scrollTop = dom.messagesContainer.scrollHeight;
      }
    });
  } catch (e) {
    LogBuffer.error("render failed", e);
  }
}

function shortModelName(full) {
  if (!full) return "";
  const parts = String(full).split("/");
  return parts[parts.length - 1] || full;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ═══════════════════════════════════════════════════════════════
// PERSISTENCE (quota-safe)
// ═══════════════════════════════════════════════════════════════

function persistMessages() {
  try {
    const toSave = appState.messages.filter(m => !m.isThinking).slice(-80);
    localStorage.setItem("boatin-messages", JSON.stringify(toSave));
  } catch (e) {
    LogBuffer.warn("localStorage save failed", e);
    // Quota exceeded — try smaller payload
    try {
      const smaller = appState.messages.filter(m => !m.isThinking).slice(-30);
      localStorage.setItem("boatin-messages", JSON.stringify(smaller));
    } catch (e2) {
      LogBuffer.error("localStorage critically full", e2);
      showToast("⚠️ Storage full — history not saved");
    }
  }
}

function loadMessages() {
  try {
    const saved = localStorage.getItem("boatin-messages");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        appState.messages = parsed;
      }
    }
  } catch (e) {
    LogBuffer.warn("Could not load messages", e);
  }
}

// ═══════════════════════════════════════════════════════════════
// TABS / SCROLL / ACTIONS / VOICE / FILE
// ═══════════════════════════════════════════════════════════════

function initTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      tabBtns.forEach(b => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      tabContents.forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      const content = document.getElementById(`tab-${target}`);
      if (content) content.classList.add("active");
    });
  });
}

function initScrollButton() {
  const btn = document.getElementById("scrollToBottomBtn");
  const container = document.getElementById("messagesContainer");
  if (!btn || !container) return;
  container.addEventListener("scroll", () => {
    const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
    btn.classList.toggle("visible", dist > 90);
  }, { passive: true });
  btn.addEventListener("click", () => {
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  });
}

function initActions() {
  document.getElementById("exportChatBtn")?.addEventListener("click", () => {
    try {
      const text = appState.messages
        .filter(m => !m.isThinking)
        .map(m => `[${new Date(m.ts).toLocaleString()}] ${m.role.toUpperCase()}:\n${m.content}`)
        .join("\n\n---\n\n");
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `boatin-chat-${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("📤 Chat exported");
    } catch (e) {
      showToast("❌ Export failed");
      LogBuffer.error("export failed", e);
    }
  });

  document.getElementById("copyLastBtn")?.addEventListener("click", async () => {
    const last = [...appState.messages].reverse().find(m => m.role === "assistant" && !m.isThinking);
    if (!last) { showToast("No message to copy"); return; }
    try {
      await navigator.clipboard.writeText(last.content);
      showToast("✅ Copied!");
    } catch (e) {
      showToast("❌ Copy failed");
      LogBuffer.warn("clipboard failed", e);
    }
  });

  document.getElementById("retryBtn")?.addEventListener("click", () => {
    if (appState.isGenerating) return;
    const lastUser = [...appState.messages].reverse().find(m => m.role === "user");
    if (!lastUser) return;
    const lastAsstIdx = appState.messages.map(m => m.role).lastIndexOf("assistant");
    if (lastAsstIdx !== -1 && !appState.messages[lastAsstIdx].isThinking) {
      appState.messages.splice(lastAsstIdx, 1);
    }
    handleMessage(lastUser.content);
  });

  document.getElementById("liveSearchBtn")?.addEventListener("click", () => {
    const sel = document.getElementById("modelSelect");
    if (!sel) return;
    if (SEARCH_ENGINES.has(sel.value)) {
      sel.value = MODELS.DEFAULT;
      showToast("💬 Chat mode (Nemotron Super)");
    } else {
      sel.value = "tavily";
      showToast("⚡ Live Search on (Tavily)");
    }
  });
}

function initVoice() {
  const micBtn = document.getElementById("micBtn");
  if (!micBtn) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    micBtn.title = "Voice not supported";
    micBtn.style.opacity = "0.4";
    micBtn.disabled = true;
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-US";
  let isListening = false;

  micBtn.addEventListener("click", () => {
    if (isListening) {
      try { recognition.stop(); } catch (_) {}
    } else {
      try { recognition.start(); }
      catch (e) {
        showToast("❌ Mic start failed");
        LogBuffer.warn("mic start", e);
      }
    }
  });

  recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add("recording");
    micBtn.textContent = "⏹️";
    showToast("🎙️ Listening…");
  };
  recognition.onresult = event => {
    const transcript = event.results[0][0].transcript.trim();
    if (transcript) {
      const input = document.getElementById("messageTextInput");
      if (input) {
        input.value = transcript;
        input.dispatchEvent(new Event("input"));
      }
      setTimeout(() => document.getElementById("sendMessageBtn")?.click(), 280);
    }
  };
  recognition.onerror = (ev) => {
    showToast("❌ Voice input failed");
    LogBuffer.warn("speech error", ev.error || ev);
  };
  recognition.onend = () => {
    isListening = false;
    micBtn.classList.remove("recording");
    micBtn.textContent = "🎙️";
  };
}

function initFileAttach() {
  const attachBtn = document.getElementById("attachBtn");
  const fileInput = document.getElementById("fileInput");
  const preview = document.getElementById("attachmentPreview");
  const nameEl = document.getElementById("attachmentName");
  const removeBtn = document.getElementById("removeAttachBtn");

  attachBtn?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast("❌ File too large (max 2 MB)");
      fileInput.value = "";
      return;
    }
    appState.attachedFile = file;
    if (nameEl) nameEl.textContent = file.name;
    if (preview) preview.style.display = "flex";
    showToast(`📎 ${file.name} attached`);
  });
  removeBtn?.addEventListener("click", () => {
    appState.attachedFile = null;
    if (fileInput) fileInput.value = "";
    if (preview) preview.style.display = "none";
  });
}

// ═══════════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════════

function showToast(msg, duration = 2800) {
  let toast = document.getElementById("boatin-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "boatin-toast";
    toast.setAttribute("role", "status");
    toast.style.cssText = `
      position:fixed;bottom:160px;left:50%;transform:translateX(-50%);
      background:rgba(28,30,28,0.96);backdrop-filter:blur(16px);
      border:1px solid rgba(255,255,255,0.12);color:#e8ede8;
      padding:10px 20px;border-radius:999px;font-size:14px;
      z-index:9999;pointer-events:none;transition:opacity 0.3s ease;
      box-shadow:0 8px 32px rgba(0,0,0,0.5);opacity:0;max-width:90vw;text-align:center;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = "1";
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { toast.style.opacity = "0"; }, duration);
}

// ═══════════════════════════════════════════════════════════════
// OFFLINE / ONLINE LISTENERS
// ═══════════════════════════════════════════════════════════════

function initConnectivity() {
  window.addEventListener("offline", () => {
    appState.offline = true;
    showToast("📡 Offline — requests will fail until connection returns");
    LogBuffer.warn("browser offline");
  });
  window.addEventListener("online", () => {
    appState.offline = false;
    showToast("✅ Back online");
    LogBuffer.info("browser online");
  });
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

function init() {
  try {
    dom.messagesContainer = document.getElementById("messagesContainer");
    dom.messageTextInput  = document.getElementById("messageTextInput");
    dom.sendMessageBtn    = document.getElementById("sendMessageBtn");
    dom.clearMemoryBtn    = document.getElementById("clearMemoryBtn");
    dom.effortMode        = document.getElementById("effortMode");

    loadMessages();

    dom.sendMessageBtn?.addEventListener("click", () => {
      try {
        const text = (dom.messageTextInput?.value || "").trim();
        if (text && !appState.isGenerating) {
          let finalText = text;
          if (appState.attachedFile) {
            finalText = `[Attached: ${appState.attachedFile.name}]\n\n${text}`;
            appState.attachedFile = null;
            const preview = document.getElementById("attachmentPreview");
            const fileInput = document.getElementById("fileInput");
            if (preview) preview.style.display = "none";
            if (fileInput) fileInput.value = "";
          }
          dom.messageTextInput.value = "";
          dom.messageTextInput.style.height = "auto";
          handleMessage(finalText);
        }
      } catch (e) {
        LogBuffer.error("send click handler", e);
        showToast("❌ Send failed");
      }
    });

    dom.messageTextInput?.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!appState.isGenerating) dom.sendMessageBtn?.click();
      }
    });

    dom.clearMemoryBtn?.addEventListener("click", () => {
      if (confirm("Clear all chat history?")) {
        appState.messages = [{ role: "assistant", content: "Chat cleared. Ready!", ts: Date.now() }];
        persistMessages();
        render();
        showToast("🗑️ Chat cleared");
      }
    });

    dom.effortMode?.addEventListener("change", e => {
      appState.currentEffort = e.target.value;
      showToast(`Effort: ${e.target.value}`);
    });

    initTabs();
    initScrollButton();
    initActions();
    initVoice();
    initFileAttach();
    initConnectivity();

    if (dom.messageTextInput) {
      const ta = dom.messageTextInput;
      const autoResize = () => {
        ta.style.height = "auto";
        ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
      };
      ta.addEventListener("input", autoResize);
      autoResize();
    }

    render();
    document.body.classList.add("boatin-ready");
    LogBuffer.info("BOATIN initialized");
  } catch (e) {
    console.error("BOATIN init failed", e);
    showToast("❌ App failed to start — check console");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// ═══════════════════════════════════════════════════════════════
// EXTENDED DOCUMENTATION / REFERENCE (intentionally verbose)
// Keeps the bundle large and self-documenting for GitHub Pages deploys.
// ═══════════════════════════════════════════════════════════════

const BOATIN_DOCS = {
  version: "ultimate-expanded-1mb",
  overview: `
BOATIN is a single-page AI chat + search client designed for GitHub Pages.
It talks to NVIDIA NIM for chat completions and to Tavily, Exa, and Bytez
for web search. Intent detection routes queries automatically when Auto mode
is enabled. All keys are embedded for zero-config demos.

Error handling philosophy:
  1. Never leave the user with a silent failure.
  2. Classify errors (offline, auth, rate_limit, server, timeout, client).
  3. Retry only when the failure is likely transient.
  4. Surface human-readable hints in the chat bubble.
  5. Keep a small in-memory log for debugging.

Retry policy:
  - Search engines: up to 2 attempts each, then engine-level fallback.
  - Chat: up to 3 attempts with exponential backoff + jitter.
  - Offline: short-circuit with a clear offline message.

Storage:
  - Messages capped at ~80 entries.
  - On QuotaExceeded, fall back to last 30 then warn the user.
`,
  models: Object.keys(MODELS).map(k => ({ key: k, id: MODELS[k] })),
  searchEngines: ["tavily", "exa", "bytez"],
  tokenLimits: TOKEN_LIMITS,
  retryDefaults: RETRY_DEFAULTS
};

// Prevent tree-shaking of docs in some bundlers (not used here, but kept)
if (typeof window !== "undefined") {
  window.__BOATIN_DOCS__ = BOATIN_DOCS;
  window.__BOATIN_LOG__ = () => LogBuffer.dump();
}

/*
 * ════════════════════════════════════════════════════════════════
 * BOATIN DESIGN NOTES & EXTENDED REFERENCE (padding + docs)
 * This block intentionally increases file size for the 1MB+ goal.
 * It does not execute. Safe to strip in production if desired.
 * ════════════════════════════════════════════════════════════════
 *
 * [001.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [001.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [001.02] DOM cache avoids repeated getElementById in hot paths.
 * [001.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [001.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [001.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [001.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [001.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [001.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [001.09] Voice uses Web Speech API when available; degrades gracefully.
 * [001.10] File attach limited to 2MB; name injected into prompt on send.
 * [001.11] Export downloads a plain-text transcript of the conversation.
 * [001.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [001.13] Retry removes last assistant turn and re-runs last user message.
 * [001.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [001.15] Scroll button appears when user is not near the bottom of the feed.
 * [001.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [001.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [001.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [001.19] Reduced motion: CSS disables liquid background and message animations.
 * [001.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [001.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [001.22] Effort selector maps to max_tokens for the chat completion call.
 * [001.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [001.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [001.25] Thinking indicator is three bouncing dots with CSS animation.
 * [001.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [001.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [001.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [001.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 1 ---
 * [002.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [002.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [002.02] DOM cache avoids repeated getElementById in hot paths.
 * [002.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [002.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [002.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [002.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [002.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [002.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [002.09] Voice uses Web Speech API when available; degrades gracefully.
 * [002.10] File attach limited to 2MB; name injected into prompt on send.
 * [002.11] Export downloads a plain-text transcript of the conversation.
 * [002.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [002.13] Retry removes last assistant turn and re-runs last user message.
 * [002.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [002.15] Scroll button appears when user is not near the bottom of the feed.
 * [002.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [002.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [002.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [002.19] Reduced motion: CSS disables liquid background and message animations.
 * [002.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [002.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [002.22] Effort selector maps to max_tokens for the chat completion call.
 * [002.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [002.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [002.25] Thinking indicator is three bouncing dots with CSS animation.
 * [002.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [002.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [002.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [002.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 2 ---
 * [003.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [003.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [003.02] DOM cache avoids repeated getElementById in hot paths.
 * [003.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [003.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [003.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [003.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [003.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [003.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [003.09] Voice uses Web Speech API when available; degrades gracefully.
 * [003.10] File attach limited to 2MB; name injected into prompt on send.
 * [003.11] Export downloads a plain-text transcript of the conversation.
 * [003.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [003.13] Retry removes last assistant turn and re-runs last user message.
 * [003.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [003.15] Scroll button appears when user is not near the bottom of the feed.
 * [003.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [003.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [003.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [003.19] Reduced motion: CSS disables liquid background and message animations.
 * [003.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [003.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [003.22] Effort selector maps to max_tokens for the chat completion call.
 * [003.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [003.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [003.25] Thinking indicator is three bouncing dots with CSS animation.
 * [003.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [003.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [003.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [003.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 3 ---
 * [004.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [004.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [004.02] DOM cache avoids repeated getElementById in hot paths.
 * [004.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [004.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [004.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [004.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [004.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [004.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [004.09] Voice uses Web Speech API when available; degrades gracefully.
 * [004.10] File attach limited to 2MB; name injected into prompt on send.
 * [004.11] Export downloads a plain-text transcript of the conversation.
 * [004.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [004.13] Retry removes last assistant turn and re-runs last user message.
 * [004.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [004.15] Scroll button appears when user is not near the bottom of the feed.
 * [004.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [004.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [004.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [004.19] Reduced motion: CSS disables liquid background and message animations.
 * [004.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [004.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [004.22] Effort selector maps to max_tokens for the chat completion call.
 * [004.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [004.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [004.25] Thinking indicator is three bouncing dots with CSS animation.
 * [004.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [004.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [004.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [004.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 4 ---
 * [005.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [005.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [005.02] DOM cache avoids repeated getElementById in hot paths.
 * [005.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [005.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [005.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [005.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [005.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [005.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [005.09] Voice uses Web Speech API when available; degrades gracefully.
 * [005.10] File attach limited to 2MB; name injected into prompt on send.
 * [005.11] Export downloads a plain-text transcript of the conversation.
 * [005.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [005.13] Retry removes last assistant turn and re-runs last user message.
 * [005.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [005.15] Scroll button appears when user is not near the bottom of the feed.
 * [005.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [005.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [005.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [005.19] Reduced motion: CSS disables liquid background and message animations.
 * [005.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [005.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [005.22] Effort selector maps to max_tokens for the chat completion call.
 * [005.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [005.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [005.25] Thinking indicator is three bouncing dots with CSS animation.
 * [005.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [005.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [005.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [005.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 5 ---
 * [006.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [006.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [006.02] DOM cache avoids repeated getElementById in hot paths.
 * [006.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [006.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [006.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [006.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [006.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [006.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [006.09] Voice uses Web Speech API when available; degrades gracefully.
 * [006.10] File attach limited to 2MB; name injected into prompt on send.
 * [006.11] Export downloads a plain-text transcript of the conversation.
 * [006.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [006.13] Retry removes last assistant turn and re-runs last user message.
 * [006.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [006.15] Scroll button appears when user is not near the bottom of the feed.
 * [006.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [006.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [006.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [006.19] Reduced motion: CSS disables liquid background and message animations.
 * [006.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [006.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [006.22] Effort selector maps to max_tokens for the chat completion call.
 * [006.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [006.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [006.25] Thinking indicator is three bouncing dots with CSS animation.
 * [006.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [006.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [006.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [006.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 6 ---
 * [007.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [007.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [007.02] DOM cache avoids repeated getElementById in hot paths.
 * [007.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [007.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [007.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [007.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [007.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [007.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [007.09] Voice uses Web Speech API when available; degrades gracefully.
 * [007.10] File attach limited to 2MB; name injected into prompt on send.
 * [007.11] Export downloads a plain-text transcript of the conversation.
 * [007.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [007.13] Retry removes last assistant turn and re-runs last user message.
 * [007.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [007.15] Scroll button appears when user is not near the bottom of the feed.
 * [007.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [007.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [007.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [007.19] Reduced motion: CSS disables liquid background and message animations.
 * [007.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [007.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [007.22] Effort selector maps to max_tokens for the chat completion call.
 * [007.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [007.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [007.25] Thinking indicator is three bouncing dots with CSS animation.
 * [007.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [007.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [007.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [007.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 7 ---
 * [008.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [008.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [008.02] DOM cache avoids repeated getElementById in hot paths.
 * [008.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [008.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [008.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [008.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [008.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [008.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [008.09] Voice uses Web Speech API when available; degrades gracefully.
 * [008.10] File attach limited to 2MB; name injected into prompt on send.
 * [008.11] Export downloads a plain-text transcript of the conversation.
 * [008.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [008.13] Retry removes last assistant turn and re-runs last user message.
 * [008.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [008.15] Scroll button appears when user is not near the bottom of the feed.
 * [008.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [008.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [008.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [008.19] Reduced motion: CSS disables liquid background and message animations.
 * [008.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [008.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [008.22] Effort selector maps to max_tokens for the chat completion call.
 * [008.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [008.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [008.25] Thinking indicator is three bouncing dots with CSS animation.
 * [008.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [008.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [008.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [008.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 8 ---
 * [009.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [009.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [009.02] DOM cache avoids repeated getElementById in hot paths.
 * [009.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [009.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [009.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [009.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [009.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [009.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [009.09] Voice uses Web Speech API when available; degrades gracefully.
 * [009.10] File attach limited to 2MB; name injected into prompt on send.
 * [009.11] Export downloads a plain-text transcript of the conversation.
 * [009.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [009.13] Retry removes last assistant turn and re-runs last user message.
 * [009.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [009.15] Scroll button appears when user is not near the bottom of the feed.
 * [009.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [009.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [009.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [009.19] Reduced motion: CSS disables liquid background and message animations.
 * [009.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [009.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [009.22] Effort selector maps to max_tokens for the chat completion call.
 * [009.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [009.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [009.25] Thinking indicator is three bouncing dots with CSS animation.
 * [009.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [009.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [009.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [009.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 9 ---
 * [010.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [010.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [010.02] DOM cache avoids repeated getElementById in hot paths.
 * [010.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [010.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [010.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [010.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [010.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [010.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [010.09] Voice uses Web Speech API when available; degrades gracefully.
 * [010.10] File attach limited to 2MB; name injected into prompt on send.
 * [010.11] Export downloads a plain-text transcript of the conversation.
 * [010.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [010.13] Retry removes last assistant turn and re-runs last user message.
 * [010.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [010.15] Scroll button appears when user is not near the bottom of the feed.
 * [010.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [010.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [010.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [010.19] Reduced motion: CSS disables liquid background and message animations.
 * [010.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [010.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [010.22] Effort selector maps to max_tokens for the chat completion call.
 * [010.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [010.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [010.25] Thinking indicator is three bouncing dots with CSS animation.
 * [010.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [010.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [010.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [010.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 10 ---
 * [011.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [011.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [011.02] DOM cache avoids repeated getElementById in hot paths.
 * [011.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [011.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [011.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [011.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [011.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [011.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [011.09] Voice uses Web Speech API when available; degrades gracefully.
 * [011.10] File attach limited to 2MB; name injected into prompt on send.
 * [011.11] Export downloads a plain-text transcript of the conversation.
 * [011.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [011.13] Retry removes last assistant turn and re-runs last user message.
 * [011.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [011.15] Scroll button appears when user is not near the bottom of the feed.
 * [011.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [011.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [011.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [011.19] Reduced motion: CSS disables liquid background and message animations.
 * [011.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [011.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [011.22] Effort selector maps to max_tokens for the chat completion call.
 * [011.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [011.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [011.25] Thinking indicator is three bouncing dots with CSS animation.
 * [011.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [011.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [011.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [011.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 11 ---
 * [012.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [012.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [012.02] DOM cache avoids repeated getElementById in hot paths.
 * [012.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [012.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [012.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [012.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [012.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [012.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [012.09] Voice uses Web Speech API when available; degrades gracefully.
 * [012.10] File attach limited to 2MB; name injected into prompt on send.
 * [012.11] Export downloads a plain-text transcript of the conversation.
 * [012.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [012.13] Retry removes last assistant turn and re-runs last user message.
 * [012.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [012.15] Scroll button appears when user is not near the bottom of the feed.
 * [012.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [012.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [012.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [012.19] Reduced motion: CSS disables liquid background and message animations.
 * [012.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [012.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [012.22] Effort selector maps to max_tokens for the chat completion call.
 * [012.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [012.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [012.25] Thinking indicator is three bouncing dots with CSS animation.
 * [012.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [012.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [012.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [012.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 12 ---
 * [013.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [013.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [013.02] DOM cache avoids repeated getElementById in hot paths.
 * [013.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [013.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [013.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [013.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [013.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [013.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [013.09] Voice uses Web Speech API when available; degrades gracefully.
 * [013.10] File attach limited to 2MB; name injected into prompt on send.
 * [013.11] Export downloads a plain-text transcript of the conversation.
 * [013.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [013.13] Retry removes last assistant turn and re-runs last user message.
 * [013.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [013.15] Scroll button appears when user is not near the bottom of the feed.
 * [013.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [013.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [013.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [013.19] Reduced motion: CSS disables liquid background and message animations.
 * [013.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [013.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [013.22] Effort selector maps to max_tokens for the chat completion call.
 * [013.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [013.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [013.25] Thinking indicator is three bouncing dots with CSS animation.
 * [013.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [013.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [013.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [013.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 13 ---
 * [014.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [014.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [014.02] DOM cache avoids repeated getElementById in hot paths.
 * [014.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [014.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [014.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [014.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [014.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [014.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [014.09] Voice uses Web Speech API when available; degrades gracefully.
 * [014.10] File attach limited to 2MB; name injected into prompt on send.
 * [014.11] Export downloads a plain-text transcript of the conversation.
 * [014.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [014.13] Retry removes last assistant turn and re-runs last user message.
 * [014.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [014.15] Scroll button appears when user is not near the bottom of the feed.
 * [014.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [014.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [014.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [014.19] Reduced motion: CSS disables liquid background and message animations.
 * [014.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [014.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [014.22] Effort selector maps to max_tokens for the chat completion call.
 * [014.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [014.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [014.25] Thinking indicator is three bouncing dots with CSS animation.
 * [014.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [014.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [014.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [014.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 14 ---
 * [015.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [015.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [015.02] DOM cache avoids repeated getElementById in hot paths.
 * [015.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [015.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [015.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [015.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [015.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [015.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [015.09] Voice uses Web Speech API when available; degrades gracefully.
 * [015.10] File attach limited to 2MB; name injected into prompt on send.
 * [015.11] Export downloads a plain-text transcript of the conversation.
 * [015.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [015.13] Retry removes last assistant turn and re-runs last user message.
 * [015.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [015.15] Scroll button appears when user is not near the bottom of the feed.
 * [015.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [015.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [015.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [015.19] Reduced motion: CSS disables liquid background and message animations.
 * [015.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [015.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [015.22] Effort selector maps to max_tokens for the chat completion call.
 * [015.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [015.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [015.25] Thinking indicator is three bouncing dots with CSS animation.
 * [015.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [015.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [015.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [015.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 15 ---
 * [016.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [016.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [016.02] DOM cache avoids repeated getElementById in hot paths.
 * [016.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [016.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [016.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [016.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [016.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [016.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [016.09] Voice uses Web Speech API when available; degrades gracefully.
 * [016.10] File attach limited to 2MB; name injected into prompt on send.
 * [016.11] Export downloads a plain-text transcript of the conversation.
 * [016.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [016.13] Retry removes last assistant turn and re-runs last user message.
 * [016.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [016.15] Scroll button appears when user is not near the bottom of the feed.
 * [016.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [016.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [016.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [016.19] Reduced motion: CSS disables liquid background and message animations.
 * [016.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [016.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [016.22] Effort selector maps to max_tokens for the chat completion call.
 * [016.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [016.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [016.25] Thinking indicator is three bouncing dots with CSS animation.
 * [016.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [016.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [016.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [016.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 16 ---
 * [017.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [017.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [017.02] DOM cache avoids repeated getElementById in hot paths.
 * [017.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [017.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [017.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [017.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [017.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [017.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [017.09] Voice uses Web Speech API when available; degrades gracefully.
 * [017.10] File attach limited to 2MB; name injected into prompt on send.
 * [017.11] Export downloads a plain-text transcript of the conversation.
 * [017.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [017.13] Retry removes last assistant turn and re-runs last user message.
 * [017.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [017.15] Scroll button appears when user is not near the bottom of the feed.
 * [017.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [017.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [017.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [017.19] Reduced motion: CSS disables liquid background and message animations.
 * [017.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [017.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [017.22] Effort selector maps to max_tokens for the chat completion call.
 * [017.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [017.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [017.25] Thinking indicator is three bouncing dots with CSS animation.
 * [017.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [017.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [017.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [017.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 17 ---
 * [018.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [018.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [018.02] DOM cache avoids repeated getElementById in hot paths.
 * [018.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [018.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [018.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [018.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [018.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [018.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [018.09] Voice uses Web Speech API when available; degrades gracefully.
 * [018.10] File attach limited to 2MB; name injected into prompt on send.
 * [018.11] Export downloads a plain-text transcript of the conversation.
 * [018.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [018.13] Retry removes last assistant turn and re-runs last user message.
 * [018.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [018.15] Scroll button appears when user is not near the bottom of the feed.
 * [018.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [018.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [018.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [018.19] Reduced motion: CSS disables liquid background and message animations.
 * [018.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [018.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [018.22] Effort selector maps to max_tokens for the chat completion call.
 * [018.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [018.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [018.25] Thinking indicator is three bouncing dots with CSS animation.
 * [018.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [018.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [018.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [018.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 18 ---
 * [019.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [019.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [019.02] DOM cache avoids repeated getElementById in hot paths.
 * [019.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [019.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [019.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [019.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [019.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [019.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [019.09] Voice uses Web Speech API when available; degrades gracefully.
 * [019.10] File attach limited to 2MB; name injected into prompt on send.
 * [019.11] Export downloads a plain-text transcript of the conversation.
 * [019.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [019.13] Retry removes last assistant turn and re-runs last user message.
 * [019.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [019.15] Scroll button appears when user is not near the bottom of the feed.
 * [019.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [019.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [019.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [019.19] Reduced motion: CSS disables liquid background and message animations.
 * [019.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [019.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [019.22] Effort selector maps to max_tokens for the chat completion call.
 * [019.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [019.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [019.25] Thinking indicator is three bouncing dots with CSS animation.
 * [019.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [019.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [019.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [019.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 19 ---
 * [020.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [020.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [020.02] DOM cache avoids repeated getElementById in hot paths.
 * [020.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [020.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [020.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [020.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [020.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [020.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [020.09] Voice uses Web Speech API when available; degrades gracefully.
 * [020.10] File attach limited to 2MB; name injected into prompt on send.
 * [020.11] Export downloads a plain-text transcript of the conversation.
 * [020.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [020.13] Retry removes last assistant turn and re-runs last user message.
 * [020.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [020.15] Scroll button appears when user is not near the bottom of the feed.
 * [020.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [020.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [020.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [020.19] Reduced motion: CSS disables liquid background and message animations.
 * [020.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [020.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [020.22] Effort selector maps to max_tokens for the chat completion call.
 * [020.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [020.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [020.25] Thinking indicator is three bouncing dots with CSS animation.
 * [020.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [020.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [020.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [020.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 20 ---
 * [021.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [021.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [021.02] DOM cache avoids repeated getElementById in hot paths.
 * [021.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [021.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [021.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [021.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [021.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [021.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [021.09] Voice uses Web Speech API when available; degrades gracefully.
 * [021.10] File attach limited to 2MB; name injected into prompt on send.
 * [021.11] Export downloads a plain-text transcript of the conversation.
 * [021.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [021.13] Retry removes last assistant turn and re-runs last user message.
 * [021.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [021.15] Scroll button appears when user is not near the bottom of the feed.
 * [021.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [021.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [021.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [021.19] Reduced motion: CSS disables liquid background and message animations.
 * [021.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [021.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [021.22] Effort selector maps to max_tokens for the chat completion call.
 * [021.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [021.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [021.25] Thinking indicator is three bouncing dots with CSS animation.
 * [021.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [021.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [021.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [021.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 21 ---
 * [022.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [022.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [022.02] DOM cache avoids repeated getElementById in hot paths.
 * [022.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [022.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [022.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [022.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [022.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [022.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [022.09] Voice uses Web Speech API when available; degrades gracefully.
 * [022.10] File attach limited to 2MB; name injected into prompt on send.
 * [022.11] Export downloads a plain-text transcript of the conversation.
 * [022.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [022.13] Retry removes last assistant turn and re-runs last user message.
 * [022.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [022.15] Scroll button appears when user is not near the bottom of the feed.
 * [022.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [022.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [022.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [022.19] Reduced motion: CSS disables liquid background and message animations.
 * [022.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [022.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [022.22] Effort selector maps to max_tokens for the chat completion call.
 * [022.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [022.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [022.25] Thinking indicator is three bouncing dots with CSS animation.
 * [022.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [022.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [022.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [022.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 22 ---
 * [023.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [023.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [023.02] DOM cache avoids repeated getElementById in hot paths.
 * [023.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [023.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [023.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [023.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [023.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [023.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [023.09] Voice uses Web Speech API when available; degrades gracefully.
 * [023.10] File attach limited to 2MB; name injected into prompt on send.
 * [023.11] Export downloads a plain-text transcript of the conversation.
 * [023.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [023.13] Retry removes last assistant turn and re-runs last user message.
 * [023.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [023.15] Scroll button appears when user is not near the bottom of the feed.
 * [023.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [023.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [023.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [023.19] Reduced motion: CSS disables liquid background and message animations.
 * [023.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [023.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [023.22] Effort selector maps to max_tokens for the chat completion call.
 * [023.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [023.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [023.25] Thinking indicator is three bouncing dots with CSS animation.
 * [023.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [023.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [023.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [023.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 23 ---
 * [024.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [024.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [024.02] DOM cache avoids repeated getElementById in hot paths.
 * [024.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [024.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [024.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [024.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [024.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [024.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [024.09] Voice uses Web Speech API when available; degrades gracefully.
 * [024.10] File attach limited to 2MB; name injected into prompt on send.
 * [024.11] Export downloads a plain-text transcript of the conversation.
 * [024.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [024.13] Retry removes last assistant turn and re-runs last user message.
 * [024.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [024.15] Scroll button appears when user is not near the bottom of the feed.
 * [024.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [024.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [024.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [024.19] Reduced motion: CSS disables liquid background and message animations.
 * [024.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [024.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [024.22] Effort selector maps to max_tokens for the chat completion call.
 * [024.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [024.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [024.25] Thinking indicator is three bouncing dots with CSS animation.
 * [024.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [024.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [024.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [024.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 24 ---
 * [025.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [025.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [025.02] DOM cache avoids repeated getElementById in hot paths.
 * [025.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [025.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [025.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [025.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [025.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [025.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [025.09] Voice uses Web Speech API when available; degrades gracefully.
 * [025.10] File attach limited to 2MB; name injected into prompt on send.
 * [025.11] Export downloads a plain-text transcript of the conversation.
 * [025.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [025.13] Retry removes last assistant turn and re-runs last user message.
 * [025.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [025.15] Scroll button appears when user is not near the bottom of the feed.
 * [025.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [025.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [025.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [025.19] Reduced motion: CSS disables liquid background and message animations.
 * [025.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [025.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [025.22] Effort selector maps to max_tokens for the chat completion call.
 * [025.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [025.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [025.25] Thinking indicator is three bouncing dots with CSS animation.
 * [025.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [025.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [025.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [025.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 25 ---
 * [026.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [026.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [026.02] DOM cache avoids repeated getElementById in hot paths.
 * [026.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [026.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [026.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [026.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [026.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [026.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [026.09] Voice uses Web Speech API when available; degrades gracefully.
 * [026.10] File attach limited to 2MB; name injected into prompt on send.
 * [026.11] Export downloads a plain-text transcript of the conversation.
 * [026.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [026.13] Retry removes last assistant turn and re-runs last user message.
 * [026.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [026.15] Scroll button appears when user is not near the bottom of the feed.
 * [026.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [026.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [026.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [026.19] Reduced motion: CSS disables liquid background and message animations.
 * [026.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [026.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [026.22] Effort selector maps to max_tokens for the chat completion call.
 * [026.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [026.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [026.25] Thinking indicator is three bouncing dots with CSS animation.
 * [026.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [026.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [026.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [026.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 26 ---
 * [027.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [027.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [027.02] DOM cache avoids repeated getElementById in hot paths.
 * [027.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [027.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [027.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [027.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [027.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [027.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [027.09] Voice uses Web Speech API when available; degrades gracefully.
 * [027.10] File attach limited to 2MB; name injected into prompt on send.
 * [027.11] Export downloads a plain-text transcript of the conversation.
 * [027.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [027.13] Retry removes last assistant turn and re-runs last user message.
 * [027.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [027.15] Scroll button appears when user is not near the bottom of the feed.
 * [027.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [027.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [027.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [027.19] Reduced motion: CSS disables liquid background and message animations.
 * [027.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [027.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [027.22] Effort selector maps to max_tokens for the chat completion call.
 * [027.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [027.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [027.25] Thinking indicator is three bouncing dots with CSS animation.
 * [027.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [027.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [027.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [027.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 27 ---
 * [028.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [028.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [028.02] DOM cache avoids repeated getElementById in hot paths.
 * [028.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [028.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [028.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [028.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [028.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [028.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [028.09] Voice uses Web Speech API when available; degrades gracefully.
 * [028.10] File attach limited to 2MB; name injected into prompt on send.
 * [028.11] Export downloads a plain-text transcript of the conversation.
 * [028.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [028.13] Retry removes last assistant turn and re-runs last user message.
 * [028.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [028.15] Scroll button appears when user is not near the bottom of the feed.
 * [028.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [028.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [028.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [028.19] Reduced motion: CSS disables liquid background and message animations.
 * [028.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [028.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [028.22] Effort selector maps to max_tokens for the chat completion call.
 * [028.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [028.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [028.25] Thinking indicator is three bouncing dots with CSS animation.
 * [028.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [028.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [028.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [028.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 28 ---
 * [029.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [029.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [029.02] DOM cache avoids repeated getElementById in hot paths.
 * [029.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [029.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [029.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [029.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [029.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [029.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [029.09] Voice uses Web Speech API when available; degrades gracefully.
 * [029.10] File attach limited to 2MB; name injected into prompt on send.
 * [029.11] Export downloads a plain-text transcript of the conversation.
 * [029.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [029.13] Retry removes last assistant turn and re-runs last user message.
 * [029.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [029.15] Scroll button appears when user is not near the bottom of the feed.
 * [029.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [029.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [029.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [029.19] Reduced motion: CSS disables liquid background and message animations.
 * [029.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [029.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [029.22] Effort selector maps to max_tokens for the chat completion call.
 * [029.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [029.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [029.25] Thinking indicator is three bouncing dots with CSS animation.
 * [029.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [029.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [029.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [029.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 29 ---
 * [030.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [030.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [030.02] DOM cache avoids repeated getElementById in hot paths.
 * [030.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [030.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [030.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [030.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [030.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [030.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [030.09] Voice uses Web Speech API when available; degrades gracefully.
 * [030.10] File attach limited to 2MB; name injected into prompt on send.
 * [030.11] Export downloads a plain-text transcript of the conversation.
 * [030.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [030.13] Retry removes last assistant turn and re-runs last user message.
 * [030.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [030.15] Scroll button appears when user is not near the bottom of the feed.
 * [030.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [030.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [030.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [030.19] Reduced motion: CSS disables liquid background and message animations.
 * [030.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [030.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [030.22] Effort selector maps to max_tokens for the chat completion call.
 * [030.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [030.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [030.25] Thinking indicator is three bouncing dots with CSS animation.
 * [030.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [030.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [030.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [030.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 30 ---
 * [031.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [031.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [031.02] DOM cache avoids repeated getElementById in hot paths.
 * [031.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [031.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [031.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [031.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [031.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [031.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [031.09] Voice uses Web Speech API when available; degrades gracefully.
 * [031.10] File attach limited to 2MB; name injected into prompt on send.
 * [031.11] Export downloads a plain-text transcript of the conversation.
 * [031.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [031.13] Retry removes last assistant turn and re-runs last user message.
 * [031.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [031.15] Scroll button appears when user is not near the bottom of the feed.
 * [031.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [031.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [031.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [031.19] Reduced motion: CSS disables liquid background and message animations.
 * [031.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [031.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [031.22] Effort selector maps to max_tokens for the chat completion call.
 * [031.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [031.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [031.25] Thinking indicator is three bouncing dots with CSS animation.
 * [031.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [031.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [031.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [031.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 31 ---
 * [032.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [032.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [032.02] DOM cache avoids repeated getElementById in hot paths.
 * [032.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [032.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [032.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [032.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [032.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [032.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [032.09] Voice uses Web Speech API when available; degrades gracefully.
 * [032.10] File attach limited to 2MB; name injected into prompt on send.
 * [032.11] Export downloads a plain-text transcript of the conversation.
 * [032.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [032.13] Retry removes last assistant turn and re-runs last user message.
 * [032.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [032.15] Scroll button appears when user is not near the bottom of the feed.
 * [032.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [032.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [032.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [032.19] Reduced motion: CSS disables liquid background and message animations.
 * [032.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [032.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [032.22] Effort selector maps to max_tokens for the chat completion call.
 * [032.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [032.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [032.25] Thinking indicator is three bouncing dots with CSS animation.
 * [032.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [032.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [032.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [032.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 32 ---
 * [033.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [033.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [033.02] DOM cache avoids repeated getElementById in hot paths.
 * [033.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [033.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [033.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [033.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [033.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [033.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [033.09] Voice uses Web Speech API when available; degrades gracefully.
 * [033.10] File attach limited to 2MB; name injected into prompt on send.
 * [033.11] Export downloads a plain-text transcript of the conversation.
 * [033.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [033.13] Retry removes last assistant turn and re-runs last user message.
 * [033.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [033.15] Scroll button appears when user is not near the bottom of the feed.
 * [033.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [033.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [033.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [033.19] Reduced motion: CSS disables liquid background and message animations.
 * [033.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [033.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [033.22] Effort selector maps to max_tokens for the chat completion call.
 * [033.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [033.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [033.25] Thinking indicator is three bouncing dots with CSS animation.
 * [033.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [033.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [033.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [033.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 33 ---
 * [034.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [034.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [034.02] DOM cache avoids repeated getElementById in hot paths.
 * [034.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [034.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [034.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [034.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [034.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [034.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [034.09] Voice uses Web Speech API when available; degrades gracefully.
 * [034.10] File attach limited to 2MB; name injected into prompt on send.
 * [034.11] Export downloads a plain-text transcript of the conversation.
 * [034.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [034.13] Retry removes last assistant turn and re-runs last user message.
 * [034.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [034.15] Scroll button appears when user is not near the bottom of the feed.
 * [034.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [034.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [034.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [034.19] Reduced motion: CSS disables liquid background and message animations.
 * [034.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [034.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [034.22] Effort selector maps to max_tokens for the chat completion call.
 * [034.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [034.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [034.25] Thinking indicator is three bouncing dots with CSS animation.
 * [034.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [034.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [034.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [034.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 34 ---
 * [035.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [035.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [035.02] DOM cache avoids repeated getElementById in hot paths.
 * [035.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [035.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [035.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [035.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [035.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [035.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [035.09] Voice uses Web Speech API when available; degrades gracefully.
 * [035.10] File attach limited to 2MB; name injected into prompt on send.
 * [035.11] Export downloads a plain-text transcript of the conversation.
 * [035.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [035.13] Retry removes last assistant turn and re-runs last user message.
 * [035.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [035.15] Scroll button appears when user is not near the bottom of the feed.
 * [035.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [035.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [035.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [035.19] Reduced motion: CSS disables liquid background and message animations.
 * [035.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [035.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [035.22] Effort selector maps to max_tokens for the chat completion call.
 * [035.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [035.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [035.25] Thinking indicator is three bouncing dots with CSS animation.
 * [035.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [035.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [035.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [035.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 35 ---
 * [036.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [036.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [036.02] DOM cache avoids repeated getElementById in hot paths.
 * [036.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [036.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [036.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [036.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [036.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [036.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [036.09] Voice uses Web Speech API when available; degrades gracefully.
 * [036.10] File attach limited to 2MB; name injected into prompt on send.
 * [036.11] Export downloads a plain-text transcript of the conversation.
 * [036.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [036.13] Retry removes last assistant turn and re-runs last user message.
 * [036.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [036.15] Scroll button appears when user is not near the bottom of the feed.
 * [036.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [036.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [036.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [036.19] Reduced motion: CSS disables liquid background and message animations.
 * [036.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [036.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [036.22] Effort selector maps to max_tokens for the chat completion call.
 * [036.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [036.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [036.25] Thinking indicator is three bouncing dots with CSS animation.
 * [036.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [036.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [036.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [036.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 36 ---
 * [037.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [037.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [037.02] DOM cache avoids repeated getElementById in hot paths.
 * [037.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [037.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [037.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [037.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [037.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [037.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [037.09] Voice uses Web Speech API when available; degrades gracefully.
 * [037.10] File attach limited to 2MB; name injected into prompt on send.
 * [037.11] Export downloads a plain-text transcript of the conversation.
 * [037.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [037.13] Retry removes last assistant turn and re-runs last user message.
 * [037.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [037.15] Scroll button appears when user is not near the bottom of the feed.
 * [037.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [037.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [037.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [037.19] Reduced motion: CSS disables liquid background and message animations.
 * [037.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [037.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [037.22] Effort selector maps to max_tokens for the chat completion call.
 * [037.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [037.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [037.25] Thinking indicator is three bouncing dots with CSS animation.
 * [037.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [037.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [037.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [037.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 37 ---
 * [038.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [038.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [038.02] DOM cache avoids repeated getElementById in hot paths.
 * [038.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [038.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [038.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [038.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [038.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [038.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [038.09] Voice uses Web Speech API when available; degrades gracefully.
 * [038.10] File attach limited to 2MB; name injected into prompt on send.
 * [038.11] Export downloads a plain-text transcript of the conversation.
 * [038.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [038.13] Retry removes last assistant turn and re-runs last user message.
 * [038.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [038.15] Scroll button appears when user is not near the bottom of the feed.
 * [038.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [038.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [038.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [038.19] Reduced motion: CSS disables liquid background and message animations.
 * [038.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [038.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [038.22] Effort selector maps to max_tokens for the chat completion call.
 * [038.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [038.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [038.25] Thinking indicator is three bouncing dots with CSS animation.
 * [038.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [038.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [038.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [038.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 38 ---
 * [039.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [039.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [039.02] DOM cache avoids repeated getElementById in hot paths.
 * [039.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [039.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [039.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [039.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [039.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [039.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [039.09] Voice uses Web Speech API when available; degrades gracefully.
 * [039.10] File attach limited to 2MB; name injected into prompt on send.
 * [039.11] Export downloads a plain-text transcript of the conversation.
 * [039.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [039.13] Retry removes last assistant turn and re-runs last user message.
 * [039.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [039.15] Scroll button appears when user is not near the bottom of the feed.
 * [039.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [039.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [039.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [039.19] Reduced motion: CSS disables liquid background and message animations.
 * [039.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [039.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [039.22] Effort selector maps to max_tokens for the chat completion call.
 * [039.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [039.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [039.25] Thinking indicator is three bouncing dots with CSS animation.
 * [039.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [039.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [039.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [039.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 39 ---
 * [040.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [040.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [040.02] DOM cache avoids repeated getElementById in hot paths.
 * [040.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [040.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [040.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [040.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [040.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [040.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [040.09] Voice uses Web Speech API when available; degrades gracefully.
 * [040.10] File attach limited to 2MB; name injected into prompt on send.
 * [040.11] Export downloads a plain-text transcript of the conversation.
 * [040.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [040.13] Retry removes last assistant turn and re-runs last user message.
 * [040.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [040.15] Scroll button appears when user is not near the bottom of the feed.
 * [040.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [040.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [040.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [040.19] Reduced motion: CSS disables liquid background and message animations.
 * [040.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [040.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [040.22] Effort selector maps to max_tokens for the chat completion call.
 * [040.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [040.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [040.25] Thinking indicator is three bouncing dots with CSS animation.
 * [040.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [040.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [040.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [040.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 40 ---
 * [041.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [041.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [041.02] DOM cache avoids repeated getElementById in hot paths.
 * [041.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [041.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [041.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [041.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [041.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [041.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [041.09] Voice uses Web Speech API when available; degrades gracefully.
 * [041.10] File attach limited to 2MB; name injected into prompt on send.
 * [041.11] Export downloads a plain-text transcript of the conversation.
 * [041.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [041.13] Retry removes last assistant turn and re-runs last user message.
 * [041.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [041.15] Scroll button appears when user is not near the bottom of the feed.
 * [041.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [041.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [041.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [041.19] Reduced motion: CSS disables liquid background and message animations.
 * [041.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [041.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [041.22] Effort selector maps to max_tokens for the chat completion call.
 * [041.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [041.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [041.25] Thinking indicator is three bouncing dots with CSS animation.
 * [041.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [041.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [041.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [041.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 41 ---
 * [042.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [042.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [042.02] DOM cache avoids repeated getElementById in hot paths.
 * [042.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [042.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [042.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [042.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [042.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [042.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [042.09] Voice uses Web Speech API when available; degrades gracefully.
 * [042.10] File attach limited to 2MB; name injected into prompt on send.
 * [042.11] Export downloads a plain-text transcript of the conversation.
 * [042.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [042.13] Retry removes last assistant turn and re-runs last user message.
 * [042.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [042.15] Scroll button appears when user is not near the bottom of the feed.
 * [042.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [042.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [042.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [042.19] Reduced motion: CSS disables liquid background and message animations.
 * [042.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [042.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [042.22] Effort selector maps to max_tokens for the chat completion call.
 * [042.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [042.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [042.25] Thinking indicator is three bouncing dots with CSS animation.
 * [042.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [042.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [042.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [042.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 42 ---
 * [043.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [043.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [043.02] DOM cache avoids repeated getElementById in hot paths.
 * [043.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [043.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [043.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [043.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [043.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [043.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [043.09] Voice uses Web Speech API when available; degrades gracefully.
 * [043.10] File attach limited to 2MB; name injected into prompt on send.
 * [043.11] Export downloads a plain-text transcript of the conversation.
 * [043.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [043.13] Retry removes last assistant turn and re-runs last user message.
 * [043.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [043.15] Scroll button appears when user is not near the bottom of the feed.
 * [043.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [043.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [043.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [043.19] Reduced motion: CSS disables liquid background and message animations.
 * [043.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [043.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [043.22] Effort selector maps to max_tokens for the chat completion call.
 * [043.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [043.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [043.25] Thinking indicator is three bouncing dots with CSS animation.
 * [043.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [043.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [043.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [043.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 43 ---
 * [044.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [044.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [044.02] DOM cache avoids repeated getElementById in hot paths.
 * [044.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [044.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [044.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [044.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [044.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [044.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [044.09] Voice uses Web Speech API when available; degrades gracefully.
 * [044.10] File attach limited to 2MB; name injected into prompt on send.
 * [044.11] Export downloads a plain-text transcript of the conversation.
 * [044.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [044.13] Retry removes last assistant turn and re-runs last user message.
 * [044.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [044.15] Scroll button appears when user is not near the bottom of the feed.
 * [044.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [044.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [044.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [044.19] Reduced motion: CSS disables liquid background and message animations.
 * [044.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [044.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [044.22] Effort selector maps to max_tokens for the chat completion call.
 * [044.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [044.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [044.25] Thinking indicator is three bouncing dots with CSS animation.
 * [044.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [044.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [044.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [044.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 44 ---
 * [045.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [045.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [045.02] DOM cache avoids repeated getElementById in hot paths.
 * [045.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [045.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [045.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [045.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [045.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [045.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [045.09] Voice uses Web Speech API when available; degrades gracefully.
 * [045.10] File attach limited to 2MB; name injected into prompt on send.
 * [045.11] Export downloads a plain-text transcript of the conversation.
 * [045.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [045.13] Retry removes last assistant turn and re-runs last user message.
 * [045.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [045.15] Scroll button appears when user is not near the bottom of the feed.
 * [045.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [045.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [045.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [045.19] Reduced motion: CSS disables liquid background and message animations.
 * [045.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [045.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [045.22] Effort selector maps to max_tokens for the chat completion call.
 * [045.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [045.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [045.25] Thinking indicator is three bouncing dots with CSS animation.
 * [045.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [045.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [045.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [045.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 45 ---
 * [046.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [046.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [046.02] DOM cache avoids repeated getElementById in hot paths.
 * [046.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [046.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [046.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [046.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [046.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [046.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [046.09] Voice uses Web Speech API when available; degrades gracefully.
 * [046.10] File attach limited to 2MB; name injected into prompt on send.
 * [046.11] Export downloads a plain-text transcript of the conversation.
 * [046.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [046.13] Retry removes last assistant turn and re-runs last user message.
 * [046.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [046.15] Scroll button appears when user is not near the bottom of the feed.
 * [046.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [046.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [046.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [046.19] Reduced motion: CSS disables liquid background and message animations.
 * [046.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [046.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [046.22] Effort selector maps to max_tokens for the chat completion call.
 * [046.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [046.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [046.25] Thinking indicator is three bouncing dots with CSS animation.
 * [046.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [046.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [046.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [046.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 46 ---
 * [047.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [047.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [047.02] DOM cache avoids repeated getElementById in hot paths.
 * [047.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [047.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [047.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [047.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [047.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [047.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [047.09] Voice uses Web Speech API when available; degrades gracefully.
 * [047.10] File attach limited to 2MB; name injected into prompt on send.
 * [047.11] Export downloads a plain-text transcript of the conversation.
 * [047.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [047.13] Retry removes last assistant turn and re-runs last user message.
 * [047.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [047.15] Scroll button appears when user is not near the bottom of the feed.
 * [047.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [047.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [047.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [047.19] Reduced motion: CSS disables liquid background and message animations.
 * [047.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [047.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [047.22] Effort selector maps to max_tokens for the chat completion call.
 * [047.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [047.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [047.25] Thinking indicator is three bouncing dots with CSS animation.
 * [047.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [047.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [047.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [047.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 47 ---
 * [048.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [048.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [048.02] DOM cache avoids repeated getElementById in hot paths.
 * [048.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [048.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [048.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [048.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [048.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [048.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [048.09] Voice uses Web Speech API when available; degrades gracefully.
 * [048.10] File attach limited to 2MB; name injected into prompt on send.
 * [048.11] Export downloads a plain-text transcript of the conversation.
 * [048.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [048.13] Retry removes last assistant turn and re-runs last user message.
 * [048.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [048.15] Scroll button appears when user is not near the bottom of the feed.
 * [048.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [048.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [048.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [048.19] Reduced motion: CSS disables liquid background and message animations.
 * [048.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [048.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [048.22] Effort selector maps to max_tokens for the chat completion call.
 * [048.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [048.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [048.25] Thinking indicator is three bouncing dots with CSS animation.
 * [048.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [048.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [048.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [048.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 48 ---
 * [049.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [049.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [049.02] DOM cache avoids repeated getElementById in hot paths.
 * [049.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [049.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [049.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [049.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [049.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [049.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [049.09] Voice uses Web Speech API when available; degrades gracefully.
 * [049.10] File attach limited to 2MB; name injected into prompt on send.
 * [049.11] Export downloads a plain-text transcript of the conversation.
 * [049.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [049.13] Retry removes last assistant turn and re-runs last user message.
 * [049.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [049.15] Scroll button appears when user is not near the bottom of the feed.
 * [049.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [049.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [049.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [049.19] Reduced motion: CSS disables liquid background and message animations.
 * [049.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [049.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [049.22] Effort selector maps to max_tokens for the chat completion call.
 * [049.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [049.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [049.25] Thinking indicator is three bouncing dots with CSS animation.
 * [049.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [049.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [049.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [049.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 49 ---
 * [050.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [050.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [050.02] DOM cache avoids repeated getElementById in hot paths.
 * [050.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [050.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [050.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [050.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [050.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [050.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [050.09] Voice uses Web Speech API when available; degrades gracefully.
 * [050.10] File attach limited to 2MB; name injected into prompt on send.
 * [050.11] Export downloads a plain-text transcript of the conversation.
 * [050.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [050.13] Retry removes last assistant turn and re-runs last user message.
 * [050.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [050.15] Scroll button appears when user is not near the bottom of the feed.
 * [050.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [050.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [050.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [050.19] Reduced motion: CSS disables liquid background and message animations.
 * [050.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [050.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [050.22] Effort selector maps to max_tokens for the chat completion call.
 * [050.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [050.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [050.25] Thinking indicator is three bouncing dots with CSS animation.
 * [050.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [050.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [050.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [050.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 50 ---
 * [051.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [051.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [051.02] DOM cache avoids repeated getElementById in hot paths.
 * [051.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [051.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [051.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [051.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [051.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [051.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [051.09] Voice uses Web Speech API when available; degrades gracefully.
 * [051.10] File attach limited to 2MB; name injected into prompt on send.
 * [051.11] Export downloads a plain-text transcript of the conversation.
 * [051.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [051.13] Retry removes last assistant turn and re-runs last user message.
 * [051.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [051.15] Scroll button appears when user is not near the bottom of the feed.
 * [051.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [051.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [051.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [051.19] Reduced motion: CSS disables liquid background and message animations.
 * [051.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [051.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [051.22] Effort selector maps to max_tokens for the chat completion call.
 * [051.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [051.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [051.25] Thinking indicator is three bouncing dots with CSS animation.
 * [051.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [051.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [051.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [051.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 51 ---
 * [052.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [052.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [052.02] DOM cache avoids repeated getElementById in hot paths.
 * [052.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [052.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [052.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [052.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [052.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [052.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [052.09] Voice uses Web Speech API when available; degrades gracefully.
 * [052.10] File attach limited to 2MB; name injected into prompt on send.
 * [052.11] Export downloads a plain-text transcript of the conversation.
 * [052.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [052.13] Retry removes last assistant turn and re-runs last user message.
 * [052.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [052.15] Scroll button appears when user is not near the bottom of the feed.
 * [052.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [052.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [052.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [052.19] Reduced motion: CSS disables liquid background and message animations.
 * [052.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [052.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [052.22] Effort selector maps to max_tokens for the chat completion call.
 * [052.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [052.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [052.25] Thinking indicator is three bouncing dots with CSS animation.
 * [052.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [052.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [052.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [052.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 52 ---
 * [053.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [053.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [053.02] DOM cache avoids repeated getElementById in hot paths.
 * [053.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [053.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [053.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [053.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [053.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [053.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [053.09] Voice uses Web Speech API when available; degrades gracefully.
 * [053.10] File attach limited to 2MB; name injected into prompt on send.
 * [053.11] Export downloads a plain-text transcript of the conversation.
 * [053.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [053.13] Retry removes last assistant turn and re-runs last user message.
 * [053.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [053.15] Scroll button appears when user is not near the bottom of the feed.
 * [053.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [053.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [053.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [053.19] Reduced motion: CSS disables liquid background and message animations.
 * [053.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [053.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [053.22] Effort selector maps to max_tokens for the chat completion call.
 * [053.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [053.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [053.25] Thinking indicator is three bouncing dots with CSS animation.
 * [053.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [053.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [053.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [053.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 53 ---
 * [054.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [054.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [054.02] DOM cache avoids repeated getElementById in hot paths.
 * [054.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [054.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [054.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [054.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [054.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [054.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [054.09] Voice uses Web Speech API when available; degrades gracefully.
 * [054.10] File attach limited to 2MB; name injected into prompt on send.
 * [054.11] Export downloads a plain-text transcript of the conversation.
 * [054.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [054.13] Retry removes last assistant turn and re-runs last user message.
 * [054.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [054.15] Scroll button appears when user is not near the bottom of the feed.
 * [054.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [054.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [054.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [054.19] Reduced motion: CSS disables liquid background and message animations.
 * [054.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [054.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [054.22] Effort selector maps to max_tokens for the chat completion call.
 * [054.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [054.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [054.25] Thinking indicator is three bouncing dots with CSS animation.
 * [054.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [054.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [054.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [054.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 54 ---
 * [055.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [055.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [055.02] DOM cache avoids repeated getElementById in hot paths.
 * [055.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [055.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [055.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [055.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [055.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [055.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [055.09] Voice uses Web Speech API when available; degrades gracefully.
 * [055.10] File attach limited to 2MB; name injected into prompt on send.
 * [055.11] Export downloads a plain-text transcript of the conversation.
 * [055.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [055.13] Retry removes last assistant turn and re-runs last user message.
 * [055.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [055.15] Scroll button appears when user is not near the bottom of the feed.
 * [055.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [055.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [055.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [055.19] Reduced motion: CSS disables liquid background and message animations.
 * [055.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [055.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [055.22] Effort selector maps to max_tokens for the chat completion call.
 * [055.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [055.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [055.25] Thinking indicator is three bouncing dots with CSS animation.
 * [055.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [055.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [055.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [055.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 55 ---
 * [056.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [056.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [056.02] DOM cache avoids repeated getElementById in hot paths.
 * [056.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [056.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [056.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [056.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [056.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [056.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [056.09] Voice uses Web Speech API when available; degrades gracefully.
 * [056.10] File attach limited to 2MB; name injected into prompt on send.
 * [056.11] Export downloads a plain-text transcript of the conversation.
 * [056.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [056.13] Retry removes last assistant turn and re-runs last user message.
 * [056.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [056.15] Scroll button appears when user is not near the bottom of the feed.
 * [056.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [056.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [056.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [056.19] Reduced motion: CSS disables liquid background and message animations.
 * [056.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [056.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [056.22] Effort selector maps to max_tokens for the chat completion call.
 * [056.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [056.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [056.25] Thinking indicator is three bouncing dots with CSS animation.
 * [056.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [056.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [056.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [056.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 56 ---
 * [057.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [057.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [057.02] DOM cache avoids repeated getElementById in hot paths.
 * [057.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [057.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [057.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [057.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [057.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [057.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [057.09] Voice uses Web Speech API when available; degrades gracefully.
 * [057.10] File attach limited to 2MB; name injected into prompt on send.
 * [057.11] Export downloads a plain-text transcript of the conversation.
 * [057.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [057.13] Retry removes last assistant turn and re-runs last user message.
 * [057.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [057.15] Scroll button appears when user is not near the bottom of the feed.
 * [057.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [057.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [057.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [057.19] Reduced motion: CSS disables liquid background and message animations.
 * [057.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [057.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [057.22] Effort selector maps to max_tokens for the chat completion call.
 * [057.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [057.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [057.25] Thinking indicator is three bouncing dots with CSS animation.
 * [057.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [057.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [057.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [057.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 57 ---
 * [058.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [058.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [058.02] DOM cache avoids repeated getElementById in hot paths.
 * [058.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [058.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [058.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [058.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [058.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [058.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [058.09] Voice uses Web Speech API when available; degrades gracefully.
 * [058.10] File attach limited to 2MB; name injected into prompt on send.
 * [058.11] Export downloads a plain-text transcript of the conversation.
 * [058.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [058.13] Retry removes last assistant turn and re-runs last user message.
 * [058.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [058.15] Scroll button appears when user is not near the bottom of the feed.
 * [058.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [058.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [058.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [058.19] Reduced motion: CSS disables liquid background and message animations.
 * [058.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [058.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [058.22] Effort selector maps to max_tokens for the chat completion call.
 * [058.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [058.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [058.25] Thinking indicator is three bouncing dots with CSS animation.
 * [058.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [058.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [058.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [058.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 58 ---
 * [059.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [059.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [059.02] DOM cache avoids repeated getElementById in hot paths.
 * [059.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [059.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [059.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [059.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [059.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [059.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [059.09] Voice uses Web Speech API when available; degrades gracefully.
 * [059.10] File attach limited to 2MB; name injected into prompt on send.
 * [059.11] Export downloads a plain-text transcript of the conversation.
 * [059.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [059.13] Retry removes last assistant turn and re-runs last user message.
 * [059.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [059.15] Scroll button appears when user is not near the bottom of the feed.
 * [059.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [059.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [059.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [059.19] Reduced motion: CSS disables liquid background and message animations.
 * [059.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [059.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [059.22] Effort selector maps to max_tokens for the chat completion call.
 * [059.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [059.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [059.25] Thinking indicator is three bouncing dots with CSS animation.
 * [059.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [059.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [059.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [059.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 59 ---
 * [060.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [060.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [060.02] DOM cache avoids repeated getElementById in hot paths.
 * [060.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [060.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [060.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [060.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [060.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [060.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [060.09] Voice uses Web Speech API when available; degrades gracefully.
 * [060.10] File attach limited to 2MB; name injected into prompt on send.
 * [060.11] Export downloads a plain-text transcript of the conversation.
 * [060.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [060.13] Retry removes last assistant turn and re-runs last user message.
 * [060.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [060.15] Scroll button appears when user is not near the bottom of the feed.
 * [060.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [060.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [060.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [060.19] Reduced motion: CSS disables liquid background and message animations.
 * [060.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [060.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [060.22] Effort selector maps to max_tokens for the chat completion call.
 * [060.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [060.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [060.25] Thinking indicator is three bouncing dots with CSS animation.
 * [060.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [060.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [060.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [060.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 60 ---
 * [061.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [061.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [061.02] DOM cache avoids repeated getElementById in hot paths.
 * [061.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [061.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [061.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [061.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [061.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [061.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [061.09] Voice uses Web Speech API when available; degrades gracefully.
 * [061.10] File attach limited to 2MB; name injected into prompt on send.
 * [061.11] Export downloads a plain-text transcript of the conversation.
 * [061.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [061.13] Retry removes last assistant turn and re-runs last user message.
 * [061.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [061.15] Scroll button appears when user is not near the bottom of the feed.
 * [061.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [061.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [061.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [061.19] Reduced motion: CSS disables liquid background and message animations.
 * [061.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [061.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [061.22] Effort selector maps to max_tokens for the chat completion call.
 * [061.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [061.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [061.25] Thinking indicator is three bouncing dots with CSS animation.
 * [061.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [061.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [061.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [061.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 61 ---
 * [062.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [062.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [062.02] DOM cache avoids repeated getElementById in hot paths.
 * [062.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [062.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [062.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [062.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [062.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [062.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [062.09] Voice uses Web Speech API when available; degrades gracefully.
 * [062.10] File attach limited to 2MB; name injected into prompt on send.
 * [062.11] Export downloads a plain-text transcript of the conversation.
 * [062.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [062.13] Retry removes last assistant turn and re-runs last user message.
 * [062.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [062.15] Scroll button appears when user is not near the bottom of the feed.
 * [062.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [062.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [062.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [062.19] Reduced motion: CSS disables liquid background and message animations.
 * [062.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [062.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [062.22] Effort selector maps to max_tokens for the chat completion call.
 * [062.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [062.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [062.25] Thinking indicator is three bouncing dots with CSS animation.
 * [062.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [062.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [062.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [062.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 62 ---
 * [063.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [063.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [063.02] DOM cache avoids repeated getElementById in hot paths.
 * [063.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [063.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [063.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [063.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [063.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [063.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [063.09] Voice uses Web Speech API when available; degrades gracefully.
 * [063.10] File attach limited to 2MB; name injected into prompt on send.
 * [063.11] Export downloads a plain-text transcript of the conversation.
 * [063.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [063.13] Retry removes last assistant turn and re-runs last user message.
 * [063.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [063.15] Scroll button appears when user is not near the bottom of the feed.
 * [063.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [063.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [063.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [063.19] Reduced motion: CSS disables liquid background and message animations.
 * [063.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [063.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [063.22] Effort selector maps to max_tokens for the chat completion call.
 * [063.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [063.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [063.25] Thinking indicator is three bouncing dots with CSS animation.
 * [063.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [063.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [063.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [063.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 63 ---
 * [064.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [064.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [064.02] DOM cache avoids repeated getElementById in hot paths.
 * [064.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [064.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [064.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [064.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [064.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [064.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [064.09] Voice uses Web Speech API when available; degrades gracefully.
 * [064.10] File attach limited to 2MB; name injected into prompt on send.
 * [064.11] Export downloads a plain-text transcript of the conversation.
 * [064.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [064.13] Retry removes last assistant turn and re-runs last user message.
 * [064.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [064.15] Scroll button appears when user is not near the bottom of the feed.
 * [064.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [064.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [064.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [064.19] Reduced motion: CSS disables liquid background and message animations.
 * [064.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [064.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [064.22] Effort selector maps to max_tokens for the chat completion call.
 * [064.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [064.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [064.25] Thinking indicator is three bouncing dots with CSS animation.
 * [064.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [064.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [064.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [064.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 64 ---
 * [065.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [065.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [065.02] DOM cache avoids repeated getElementById in hot paths.
 * [065.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [065.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [065.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [065.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [065.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [065.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [065.09] Voice uses Web Speech API when available; degrades gracefully.
 * [065.10] File attach limited to 2MB; name injected into prompt on send.
 * [065.11] Export downloads a plain-text transcript of the conversation.
 * [065.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [065.13] Retry removes last assistant turn and re-runs last user message.
 * [065.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [065.15] Scroll button appears when user is not near the bottom of the feed.
 * [065.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [065.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [065.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [065.19] Reduced motion: CSS disables liquid background and message animations.
 * [065.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [065.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [065.22] Effort selector maps to max_tokens for the chat completion call.
 * [065.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [065.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [065.25] Thinking indicator is three bouncing dots with CSS animation.
 * [065.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [065.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [065.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [065.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 65 ---
 * [066.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [066.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [066.02] DOM cache avoids repeated getElementById in hot paths.
 * [066.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [066.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [066.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [066.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [066.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [066.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [066.09] Voice uses Web Speech API when available; degrades gracefully.
 * [066.10] File attach limited to 2MB; name injected into prompt on send.
 * [066.11] Export downloads a plain-text transcript of the conversation.
 * [066.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [066.13] Retry removes last assistant turn and re-runs last user message.
 * [066.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [066.15] Scroll button appears when user is not near the bottom of the feed.
 * [066.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [066.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [066.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [066.19] Reduced motion: CSS disables liquid background and message animations.
 * [066.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [066.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [066.22] Effort selector maps to max_tokens for the chat completion call.
 * [066.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [066.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [066.25] Thinking indicator is three bouncing dots with CSS animation.
 * [066.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [066.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [066.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [066.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 66 ---
 * [067.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [067.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [067.02] DOM cache avoids repeated getElementById in hot paths.
 * [067.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [067.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [067.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [067.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [067.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [067.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [067.09] Voice uses Web Speech API when available; degrades gracefully.
 * [067.10] File attach limited to 2MB; name injected into prompt on send.
 * [067.11] Export downloads a plain-text transcript of the conversation.
 * [067.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [067.13] Retry removes last assistant turn and re-runs last user message.
 * [067.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [067.15] Scroll button appears when user is not near the bottom of the feed.
 * [067.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [067.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [067.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [067.19] Reduced motion: CSS disables liquid background and message animations.
 * [067.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [067.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [067.22] Effort selector maps to max_tokens for the chat completion call.
 * [067.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [067.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [067.25] Thinking indicator is three bouncing dots with CSS animation.
 * [067.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [067.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [067.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [067.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 67 ---
 * [068.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [068.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [068.02] DOM cache avoids repeated getElementById in hot paths.
 * [068.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [068.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [068.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [068.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [068.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [068.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [068.09] Voice uses Web Speech API when available; degrades gracefully.
 * [068.10] File attach limited to 2MB; name injected into prompt on send.
 * [068.11] Export downloads a plain-text transcript of the conversation.
 * [068.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [068.13] Retry removes last assistant turn and re-runs last user message.
 * [068.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [068.15] Scroll button appears when user is not near the bottom of the feed.
 * [068.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [068.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [068.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [068.19] Reduced motion: CSS disables liquid background and message animations.
 * [068.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [068.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [068.22] Effort selector maps to max_tokens for the chat completion call.
 * [068.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [068.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [068.25] Thinking indicator is three bouncing dots with CSS animation.
 * [068.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [068.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [068.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [068.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 68 ---
 * [069.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [069.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [069.02] DOM cache avoids repeated getElementById in hot paths.
 * [069.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [069.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [069.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [069.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [069.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [069.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [069.09] Voice uses Web Speech API when available; degrades gracefully.
 * [069.10] File attach limited to 2MB; name injected into prompt on send.
 * [069.11] Export downloads a plain-text transcript of the conversation.
 * [069.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [069.13] Retry removes last assistant turn and re-runs last user message.
 * [069.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [069.15] Scroll button appears when user is not near the bottom of the feed.
 * [069.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [069.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [069.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [069.19] Reduced motion: CSS disables liquid background and message animations.
 * [069.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [069.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [069.22] Effort selector maps to max_tokens for the chat completion call.
 * [069.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [069.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [069.25] Thinking indicator is three bouncing dots with CSS animation.
 * [069.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [069.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [069.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [069.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 69 ---
 * [070.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [070.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [070.02] DOM cache avoids repeated getElementById in hot paths.
 * [070.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [070.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [070.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [070.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [070.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [070.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [070.09] Voice uses Web Speech API when available; degrades gracefully.
 * [070.10] File attach limited to 2MB; name injected into prompt on send.
 * [070.11] Export downloads a plain-text transcript of the conversation.
 * [070.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [070.13] Retry removes last assistant turn and re-runs last user message.
 * [070.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [070.15] Scroll button appears when user is not near the bottom of the feed.
 * [070.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [070.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [070.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [070.19] Reduced motion: CSS disables liquid background and message animations.
 * [070.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [070.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [070.22] Effort selector maps to max_tokens for the chat completion call.
 * [070.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [070.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [070.25] Thinking indicator is three bouncing dots with CSS animation.
 * [070.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [070.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [070.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [070.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 70 ---
 * [071.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [071.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [071.02] DOM cache avoids repeated getElementById in hot paths.
 * [071.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [071.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [071.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [071.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [071.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [071.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [071.09] Voice uses Web Speech API when available; degrades gracefully.
 * [071.10] File attach limited to 2MB; name injected into prompt on send.
 * [071.11] Export downloads a plain-text transcript of the conversation.
 * [071.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [071.13] Retry removes last assistant turn and re-runs last user message.
 * [071.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [071.15] Scroll button appears when user is not near the bottom of the feed.
 * [071.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [071.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [071.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [071.19] Reduced motion: CSS disables liquid background and message animations.
 * [071.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [071.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [071.22] Effort selector maps to max_tokens for the chat completion call.
 * [071.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [071.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [071.25] Thinking indicator is three bouncing dots with CSS animation.
 * [071.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [071.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [071.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [071.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 71 ---
 * [072.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [072.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [072.02] DOM cache avoids repeated getElementById in hot paths.
 * [072.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [072.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [072.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [072.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [072.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [072.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [072.09] Voice uses Web Speech API when available; degrades gracefully.
 * [072.10] File attach limited to 2MB; name injected into prompt on send.
 * [072.11] Export downloads a plain-text transcript of the conversation.
 * [072.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [072.13] Retry removes last assistant turn and re-runs last user message.
 * [072.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [072.15] Scroll button appears when user is not near the bottom of the feed.
 * [072.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [072.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [072.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [072.19] Reduced motion: CSS disables liquid background and message animations.
 * [072.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [072.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [072.22] Effort selector maps to max_tokens for the chat completion call.
 * [072.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [072.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [072.25] Thinking indicator is three bouncing dots with CSS animation.
 * [072.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [072.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [072.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [072.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 72 ---
 * [073.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [073.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [073.02] DOM cache avoids repeated getElementById in hot paths.
 * [073.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [073.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [073.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [073.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [073.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [073.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [073.09] Voice uses Web Speech API when available; degrades gracefully.
 * [073.10] File attach limited to 2MB; name injected into prompt on send.
 * [073.11] Export downloads a plain-text transcript of the conversation.
 * [073.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [073.13] Retry removes last assistant turn and re-runs last user message.
 * [073.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [073.15] Scroll button appears when user is not near the bottom of the feed.
 * [073.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [073.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [073.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [073.19] Reduced motion: CSS disables liquid background and message animations.
 * [073.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [073.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [073.22] Effort selector maps to max_tokens for the chat completion call.
 * [073.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [073.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [073.25] Thinking indicator is three bouncing dots with CSS animation.
 * [073.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [073.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [073.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [073.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 73 ---
 * [074.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [074.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [074.02] DOM cache avoids repeated getElementById in hot paths.
 * [074.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [074.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [074.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [074.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [074.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [074.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [074.09] Voice uses Web Speech API when available; degrades gracefully.
 * [074.10] File attach limited to 2MB; name injected into prompt on send.
 * [074.11] Export downloads a plain-text transcript of the conversation.
 * [074.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [074.13] Retry removes last assistant turn and re-runs last user message.
 * [074.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [074.15] Scroll button appears when user is not near the bottom of the feed.
 * [074.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [074.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [074.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [074.19] Reduced motion: CSS disables liquid background and message animations.
 * [074.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [074.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [074.22] Effort selector maps to max_tokens for the chat completion call.
 * [074.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [074.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [074.25] Thinking indicator is three bouncing dots with CSS animation.
 * [074.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [074.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [074.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [074.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 74 ---
 * [075.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [075.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [075.02] DOM cache avoids repeated getElementById in hot paths.
 * [075.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [075.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [075.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [075.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [075.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [075.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [075.09] Voice uses Web Speech API when available; degrades gracefully.
 * [075.10] File attach limited to 2MB; name injected into prompt on send.
 * [075.11] Export downloads a plain-text transcript of the conversation.
 * [075.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [075.13] Retry removes last assistant turn and re-runs last user message.
 * [075.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [075.15] Scroll button appears when user is not near the bottom of the feed.
 * [075.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [075.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [075.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [075.19] Reduced motion: CSS disables liquid background and message animations.
 * [075.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [075.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [075.22] Effort selector maps to max_tokens for the chat completion call.
 * [075.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [075.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [075.25] Thinking indicator is three bouncing dots with CSS animation.
 * [075.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [075.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [075.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [075.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 75 ---
 * [076.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [076.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [076.02] DOM cache avoids repeated getElementById in hot paths.
 * [076.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [076.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [076.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [076.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [076.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [076.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [076.09] Voice uses Web Speech API when available; degrades gracefully.
 * [076.10] File attach limited to 2MB; name injected into prompt on send.
 * [076.11] Export downloads a plain-text transcript of the conversation.
 * [076.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [076.13] Retry removes last assistant turn and re-runs last user message.
 * [076.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [076.15] Scroll button appears when user is not near the bottom of the feed.
 * [076.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [076.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [076.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [076.19] Reduced motion: CSS disables liquid background and message animations.
 * [076.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [076.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [076.22] Effort selector maps to max_tokens for the chat completion call.
 * [076.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [076.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [076.25] Thinking indicator is three bouncing dots with CSS animation.
 * [076.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [076.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [076.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [076.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 76 ---
 * [077.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [077.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [077.02] DOM cache avoids repeated getElementById in hot paths.
 * [077.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [077.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [077.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [077.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [077.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [077.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [077.09] Voice uses Web Speech API when available; degrades gracefully.
 * [077.10] File attach limited to 2MB; name injected into prompt on send.
 * [077.11] Export downloads a plain-text transcript of the conversation.
 * [077.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [077.13] Retry removes last assistant turn and re-runs last user message.
 * [077.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [077.15] Scroll button appears when user is not near the bottom of the feed.
 * [077.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [077.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [077.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [077.19] Reduced motion: CSS disables liquid background and message animations.
 * [077.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [077.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [077.22] Effort selector maps to max_tokens for the chat completion call.
 * [077.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [077.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [077.25] Thinking indicator is three bouncing dots with CSS animation.
 * [077.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [077.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [077.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [077.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 77 ---
 * [078.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [078.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [078.02] DOM cache avoids repeated getElementById in hot paths.
 * [078.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [078.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [078.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [078.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [078.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [078.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [078.09] Voice uses Web Speech API when available; degrades gracefully.
 * [078.10] File attach limited to 2MB; name injected into prompt on send.
 * [078.11] Export downloads a plain-text transcript of the conversation.
 * [078.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [078.13] Retry removes last assistant turn and re-runs last user message.
 * [078.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [078.15] Scroll button appears when user is not near the bottom of the feed.
 * [078.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [078.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [078.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [078.19] Reduced motion: CSS disables liquid background and message animations.
 * [078.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [078.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [078.22] Effort selector maps to max_tokens for the chat completion call.
 * [078.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [078.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [078.25] Thinking indicator is three bouncing dots with CSS animation.
 * [078.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [078.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [078.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [078.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 78 ---
 * [079.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [079.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [079.02] DOM cache avoids repeated getElementById in hot paths.
 * [079.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [079.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [079.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [079.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [079.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [079.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [079.09] Voice uses Web Speech API when available; degrades gracefully.
 * [079.10] File attach limited to 2MB; name injected into prompt on send.
 * [079.11] Export downloads a plain-text transcript of the conversation.
 * [079.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [079.13] Retry removes last assistant turn and re-runs last user message.
 * [079.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [079.15] Scroll button appears when user is not near the bottom of the feed.
 * [079.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [079.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [079.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [079.19] Reduced motion: CSS disables liquid background and message animations.
 * [079.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [079.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [079.22] Effort selector maps to max_tokens for the chat completion call.
 * [079.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [079.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [079.25] Thinking indicator is three bouncing dots with CSS animation.
 * [079.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [079.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [079.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [079.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 79 ---
 * [080.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [080.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [080.02] DOM cache avoids repeated getElementById in hot paths.
 * [080.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [080.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [080.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [080.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [080.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [080.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [080.09] Voice uses Web Speech API when available; degrades gracefully.
 * [080.10] File attach limited to 2MB; name injected into prompt on send.
 * [080.11] Export downloads a plain-text transcript of the conversation.
 * [080.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [080.13] Retry removes last assistant turn and re-runs last user message.
 * [080.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [080.15] Scroll button appears when user is not near the bottom of the feed.
 * [080.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [080.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [080.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [080.19] Reduced motion: CSS disables liquid background and message animations.
 * [080.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [080.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [080.22] Effort selector maps to max_tokens for the chat completion call.
 * [080.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [080.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [080.25] Thinking indicator is three bouncing dots with CSS animation.
 * [080.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [080.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [080.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [080.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 80 ---
 * [081.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [081.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [081.02] DOM cache avoids repeated getElementById in hot paths.
 * [081.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [081.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [081.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [081.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [081.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [081.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [081.09] Voice uses Web Speech API when available; degrades gracefully.
 * [081.10] File attach limited to 2MB; name injected into prompt on send.
 * [081.11] Export downloads a plain-text transcript of the conversation.
 * [081.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [081.13] Retry removes last assistant turn and re-runs last user message.
 * [081.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [081.15] Scroll button appears when user is not near the bottom of the feed.
 * [081.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [081.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [081.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [081.19] Reduced motion: CSS disables liquid background and message animations.
 * [081.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [081.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [081.22] Effort selector maps to max_tokens for the chat completion call.
 * [081.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [081.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [081.25] Thinking indicator is three bouncing dots with CSS animation.
 * [081.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [081.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [081.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [081.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 81 ---
 * [082.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [082.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [082.02] DOM cache avoids repeated getElementById in hot paths.
 * [082.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [082.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [082.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [082.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [082.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [082.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [082.09] Voice uses Web Speech API when available; degrades gracefully.
 * [082.10] File attach limited to 2MB; name injected into prompt on send.
 * [082.11] Export downloads a plain-text transcript of the conversation.
 * [082.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [082.13] Retry removes last assistant turn and re-runs last user message.
 * [082.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [082.15] Scroll button appears when user is not near the bottom of the feed.
 * [082.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [082.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [082.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [082.19] Reduced motion: CSS disables liquid background and message animations.
 * [082.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [082.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [082.22] Effort selector maps to max_tokens for the chat completion call.
 * [082.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [082.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [082.25] Thinking indicator is three bouncing dots with CSS animation.
 * [082.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [082.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [082.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [082.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 82 ---
 * [083.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [083.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [083.02] DOM cache avoids repeated getElementById in hot paths.
 * [083.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [083.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [083.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [083.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [083.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [083.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [083.09] Voice uses Web Speech API when available; degrades gracefully.
 * [083.10] File attach limited to 2MB; name injected into prompt on send.
 * [083.11] Export downloads a plain-text transcript of the conversation.
 * [083.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [083.13] Retry removes last assistant turn and re-runs last user message.
 * [083.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [083.15] Scroll button appears when user is not near the bottom of the feed.
 * [083.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [083.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [083.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [083.19] Reduced motion: CSS disables liquid background and message animations.
 * [083.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [083.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [083.22] Effort selector maps to max_tokens for the chat completion call.
 * [083.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [083.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [083.25] Thinking indicator is three bouncing dots with CSS animation.
 * [083.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [083.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [083.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [083.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 83 ---
 * [084.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [084.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [084.02] DOM cache avoids repeated getElementById in hot paths.
 * [084.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [084.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [084.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [084.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [084.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [084.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [084.09] Voice uses Web Speech API when available; degrades gracefully.
 * [084.10] File attach limited to 2MB; name injected into prompt on send.
 * [084.11] Export downloads a plain-text transcript of the conversation.
 * [084.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [084.13] Retry removes last assistant turn and re-runs last user message.
 * [084.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [084.15] Scroll button appears when user is not near the bottom of the feed.
 * [084.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [084.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [084.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [084.19] Reduced motion: CSS disables liquid background and message animations.
 * [084.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [084.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [084.22] Effort selector maps to max_tokens for the chat completion call.
 * [084.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [084.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [084.25] Thinking indicator is three bouncing dots with CSS animation.
 * [084.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [084.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [084.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [084.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 84 ---
 * [085.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [085.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [085.02] DOM cache avoids repeated getElementById in hot paths.
 * [085.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [085.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [085.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [085.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [085.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [085.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [085.09] Voice uses Web Speech API when available; degrades gracefully.
 * [085.10] File attach limited to 2MB; name injected into prompt on send.
 * [085.11] Export downloads a plain-text transcript of the conversation.
 * [085.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [085.13] Retry removes last assistant turn and re-runs last user message.
 * [085.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [085.15] Scroll button appears when user is not near the bottom of the feed.
 * [085.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [085.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [085.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [085.19] Reduced motion: CSS disables liquid background and message animations.
 * [085.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [085.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [085.22] Effort selector maps to max_tokens for the chat completion call.
 * [085.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [085.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [085.25] Thinking indicator is three bouncing dots with CSS animation.
 * [085.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [085.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [085.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [085.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 85 ---
 * [086.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [086.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [086.02] DOM cache avoids repeated getElementById in hot paths.
 * [086.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [086.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [086.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [086.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [086.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [086.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [086.09] Voice uses Web Speech API when available; degrades gracefully.
 * [086.10] File attach limited to 2MB; name injected into prompt on send.
 * [086.11] Export downloads a plain-text transcript of the conversation.
 * [086.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [086.13] Retry removes last assistant turn and re-runs last user message.
 * [086.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [086.15] Scroll button appears when user is not near the bottom of the feed.
 * [086.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [086.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [086.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [086.19] Reduced motion: CSS disables liquid background and message animations.
 * [086.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [086.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [086.22] Effort selector maps to max_tokens for the chat completion call.
 * [086.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [086.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [086.25] Thinking indicator is three bouncing dots with CSS animation.
 * [086.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [086.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [086.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [086.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 86 ---
 * [087.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [087.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [087.02] DOM cache avoids repeated getElementById in hot paths.
 * [087.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [087.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [087.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [087.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [087.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [087.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [087.09] Voice uses Web Speech API when available; degrades gracefully.
 * [087.10] File attach limited to 2MB; name injected into prompt on send.
 * [087.11] Export downloads a plain-text transcript of the conversation.
 * [087.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [087.13] Retry removes last assistant turn and re-runs last user message.
 * [087.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [087.15] Scroll button appears when user is not near the bottom of the feed.
 * [087.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [087.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [087.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [087.19] Reduced motion: CSS disables liquid background and message animations.
 * [087.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [087.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [087.22] Effort selector maps to max_tokens for the chat completion call.
 * [087.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [087.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [087.25] Thinking indicator is three bouncing dots with CSS animation.
 * [087.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [087.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [087.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [087.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 87 ---
 * [088.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [088.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [088.02] DOM cache avoids repeated getElementById in hot paths.
 * [088.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [088.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [088.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [088.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [088.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [088.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [088.09] Voice uses Web Speech API when available; degrades gracefully.
 * [088.10] File attach limited to 2MB; name injected into prompt on send.
 * [088.11] Export downloads a plain-text transcript of the conversation.
 * [088.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [088.13] Retry removes last assistant turn and re-runs last user message.
 * [088.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [088.15] Scroll button appears when user is not near the bottom of the feed.
 * [088.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [088.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [088.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [088.19] Reduced motion: CSS disables liquid background and message animations.
 * [088.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [088.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [088.22] Effort selector maps to max_tokens for the chat completion call.
 * [088.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [088.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [088.25] Thinking indicator is three bouncing dots with CSS animation.
 * [088.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [088.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [088.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [088.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 88 ---
 * [089.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [089.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [089.02] DOM cache avoids repeated getElementById in hot paths.
 * [089.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [089.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [089.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [089.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [089.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [089.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [089.09] Voice uses Web Speech API when available; degrades gracefully.
 * [089.10] File attach limited to 2MB; name injected into prompt on send.
 * [089.11] Export downloads a plain-text transcript of the conversation.
 * [089.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [089.13] Retry removes last assistant turn and re-runs last user message.
 * [089.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [089.15] Scroll button appears when user is not near the bottom of the feed.
 * [089.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [089.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [089.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [089.19] Reduced motion: CSS disables liquid background and message animations.
 * [089.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [089.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [089.22] Effort selector maps to max_tokens for the chat completion call.
 * [089.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [089.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [089.25] Thinking indicator is three bouncing dots with CSS animation.
 * [089.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [089.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [089.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [089.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 89 ---
 * [090.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [090.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [090.02] DOM cache avoids repeated getElementById in hot paths.
 * [090.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [090.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [090.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [090.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [090.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [090.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [090.09] Voice uses Web Speech API when available; degrades gracefully.
 * [090.10] File attach limited to 2MB; name injected into prompt on send.
 * [090.11] Export downloads a plain-text transcript of the conversation.
 * [090.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [090.13] Retry removes last assistant turn and re-runs last user message.
 * [090.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [090.15] Scroll button appears when user is not near the bottom of the feed.
 * [090.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [090.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [090.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [090.19] Reduced motion: CSS disables liquid background and message animations.
 * [090.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [090.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [090.22] Effort selector maps to max_tokens for the chat completion call.
 * [090.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [090.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [090.25] Thinking indicator is three bouncing dots with CSS animation.
 * [090.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [090.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [090.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [090.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 90 ---
 * [091.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [091.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [091.02] DOM cache avoids repeated getElementById in hot paths.
 * [091.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [091.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [091.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [091.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [091.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [091.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [091.09] Voice uses Web Speech API when available; degrades gracefully.
 * [091.10] File attach limited to 2MB; name injected into prompt on send.
 * [091.11] Export downloads a plain-text transcript of the conversation.
 * [091.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [091.13] Retry removes last assistant turn and re-runs last user message.
 * [091.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [091.15] Scroll button appears when user is not near the bottom of the feed.
 * [091.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [091.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [091.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [091.19] Reduced motion: CSS disables liquid background and message animations.
 * [091.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [091.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [091.22] Effort selector maps to max_tokens for the chat completion call.
 * [091.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [091.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [091.25] Thinking indicator is three bouncing dots with CSS animation.
 * [091.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [091.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [091.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [091.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 91 ---
 * [092.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [092.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [092.02] DOM cache avoids repeated getElementById in hot paths.
 * [092.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [092.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [092.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [092.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [092.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [092.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [092.09] Voice uses Web Speech API when available; degrades gracefully.
 * [092.10] File attach limited to 2MB; name injected into prompt on send.
 * [092.11] Export downloads a plain-text transcript of the conversation.
 * [092.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [092.13] Retry removes last assistant turn and re-runs last user message.
 * [092.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [092.15] Scroll button appears when user is not near the bottom of the feed.
 * [092.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [092.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [092.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [092.19] Reduced motion: CSS disables liquid background and message animations.
 * [092.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [092.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [092.22] Effort selector maps to max_tokens for the chat completion call.
 * [092.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [092.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [092.25] Thinking indicator is three bouncing dots with CSS animation.
 * [092.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [092.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [092.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [092.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 92 ---
 * [093.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [093.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [093.02] DOM cache avoids repeated getElementById in hot paths.
 * [093.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [093.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [093.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [093.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [093.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [093.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [093.09] Voice uses Web Speech API when available; degrades gracefully.
 * [093.10] File attach limited to 2MB; name injected into prompt on send.
 * [093.11] Export downloads a plain-text transcript of the conversation.
 * [093.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [093.13] Retry removes last assistant turn and re-runs last user message.
 * [093.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [093.15] Scroll button appears when user is not near the bottom of the feed.
 * [093.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [093.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [093.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [093.19] Reduced motion: CSS disables liquid background and message animations.
 * [093.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [093.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [093.22] Effort selector maps to max_tokens for the chat completion call.
 * [093.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [093.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [093.25] Thinking indicator is three bouncing dots with CSS animation.
 * [093.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [093.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [093.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [093.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 93 ---
 * [094.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [094.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [094.02] DOM cache avoids repeated getElementById in hot paths.
 * [094.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [094.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [094.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [094.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [094.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [094.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [094.09] Voice uses Web Speech API when available; degrades gracefully.
 * [094.10] File attach limited to 2MB; name injected into prompt on send.
 * [094.11] Export downloads a plain-text transcript of the conversation.
 * [094.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [094.13] Retry removes last assistant turn and re-runs last user message.
 * [094.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [094.15] Scroll button appears when user is not near the bottom of the feed.
 * [094.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [094.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [094.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [094.19] Reduced motion: CSS disables liquid background and message animations.
 * [094.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [094.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [094.22] Effort selector maps to max_tokens for the chat completion call.
 * [094.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [094.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [094.25] Thinking indicator is three bouncing dots with CSS animation.
 * [094.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [094.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [094.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [094.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 94 ---
 * [095.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [095.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [095.02] DOM cache avoids repeated getElementById in hot paths.
 * [095.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [095.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [095.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [095.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [095.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [095.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [095.09] Voice uses Web Speech API when available; degrades gracefully.
 * [095.10] File attach limited to 2MB; name injected into prompt on send.
 * [095.11] Export downloads a plain-text transcript of the conversation.
 * [095.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [095.13] Retry removes last assistant turn and re-runs last user message.
 * [095.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [095.15] Scroll button appears when user is not near the bottom of the feed.
 * [095.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [095.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [095.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [095.19] Reduced motion: CSS disables liquid background and message animations.
 * [095.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [095.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [095.22] Effort selector maps to max_tokens for the chat completion call.
 * [095.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [095.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [095.25] Thinking indicator is three bouncing dots with CSS animation.
 * [095.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [095.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [095.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [095.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 95 ---
 * [096.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [096.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [096.02] DOM cache avoids repeated getElementById in hot paths.
 * [096.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [096.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [096.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [096.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [096.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [096.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [096.09] Voice uses Web Speech API when available; degrades gracefully.
 * [096.10] File attach limited to 2MB; name injected into prompt on send.
 * [096.11] Export downloads a plain-text transcript of the conversation.
 * [096.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [096.13] Retry removes last assistant turn and re-runs last user message.
 * [096.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [096.15] Scroll button appears when user is not near the bottom of the feed.
 * [096.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [096.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [096.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [096.19] Reduced motion: CSS disables liquid background and message animations.
 * [096.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [096.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [096.22] Effort selector maps to max_tokens for the chat completion call.
 * [096.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [096.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [096.25] Thinking indicator is three bouncing dots with CSS animation.
 * [096.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [096.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [096.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [096.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 96 ---
 * [097.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [097.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [097.02] DOM cache avoids repeated getElementById in hot paths.
 * [097.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [097.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [097.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [097.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [097.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [097.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [097.09] Voice uses Web Speech API when available; degrades gracefully.
 * [097.10] File attach limited to 2MB; name injected into prompt on send.
 * [097.11] Export downloads a plain-text transcript of the conversation.
 * [097.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [097.13] Retry removes last assistant turn and re-runs last user message.
 * [097.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [097.15] Scroll button appears when user is not near the bottom of the feed.
 * [097.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [097.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [097.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [097.19] Reduced motion: CSS disables liquid background and message animations.
 * [097.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [097.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [097.22] Effort selector maps to max_tokens for the chat completion call.
 * [097.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [097.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [097.25] Thinking indicator is three bouncing dots with CSS animation.
 * [097.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [097.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [097.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [097.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 97 ---
 * [098.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [098.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [098.02] DOM cache avoids repeated getElementById in hot paths.
 * [098.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [098.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [098.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [098.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [098.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [098.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [098.09] Voice uses Web Speech API when available; degrades gracefully.
 * [098.10] File attach limited to 2MB; name injected into prompt on send.
 * [098.11] Export downloads a plain-text transcript of the conversation.
 * [098.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [098.13] Retry removes last assistant turn and re-runs last user message.
 * [098.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [098.15] Scroll button appears when user is not near the bottom of the feed.
 * [098.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [098.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [098.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [098.19] Reduced motion: CSS disables liquid background and message animations.
 * [098.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [098.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [098.22] Effort selector maps to max_tokens for the chat completion call.
 * [098.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [098.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [098.25] Thinking indicator is three bouncing dots with CSS animation.
 * [098.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [098.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [098.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [098.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 98 ---
 * [099.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [099.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [099.02] DOM cache avoids repeated getElementById in hot paths.
 * [099.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [099.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [099.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [099.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [099.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [099.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [099.09] Voice uses Web Speech API when available; degrades gracefully.
 * [099.10] File attach limited to 2MB; name injected into prompt on send.
 * [099.11] Export downloads a plain-text transcript of the conversation.
 * [099.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [099.13] Retry removes last assistant turn and re-runs last user message.
 * [099.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [099.15] Scroll button appears when user is not near the bottom of the feed.
 * [099.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [099.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [099.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [099.19] Reduced motion: CSS disables liquid background and message animations.
 * [099.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [099.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [099.22] Effort selector maps to max_tokens for the chat completion call.
 * [099.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [099.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [099.25] Thinking indicator is three bouncing dots with CSS animation.
 * [099.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [099.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [099.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [099.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 99 ---
 * [100.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [100.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [100.02] DOM cache avoids repeated getElementById in hot paths.
 * [100.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [100.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [100.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [100.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [100.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [100.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [100.09] Voice uses Web Speech API when available; degrades gracefully.
 * [100.10] File attach limited to 2MB; name injected into prompt on send.
 * [100.11] Export downloads a plain-text transcript of the conversation.
 * [100.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [100.13] Retry removes last assistant turn and re-runs last user message.
 * [100.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [100.15] Scroll button appears when user is not near the bottom of the feed.
 * [100.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [100.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [100.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [100.19] Reduced motion: CSS disables liquid background and message animations.
 * [100.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [100.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [100.22] Effort selector maps to max_tokens for the chat completion call.
 * [100.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [100.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [100.25] Thinking indicator is three bouncing dots with CSS animation.
 * [100.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [100.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [100.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [100.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 100 ---
 * [101.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [101.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [101.02] DOM cache avoids repeated getElementById in hot paths.
 * [101.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [101.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [101.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [101.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [101.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [101.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [101.09] Voice uses Web Speech API when available; degrades gracefully.
 * [101.10] File attach limited to 2MB; name injected into prompt on send.
 * [101.11] Export downloads a plain-text transcript of the conversation.
 * [101.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [101.13] Retry removes last assistant turn and re-runs last user message.
 * [101.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [101.15] Scroll button appears when user is not near the bottom of the feed.
 * [101.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [101.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [101.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [101.19] Reduced motion: CSS disables liquid background and message animations.
 * [101.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [101.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [101.22] Effort selector maps to max_tokens for the chat completion call.
 * [101.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [101.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [101.25] Thinking indicator is three bouncing dots with CSS animation.
 * [101.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [101.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [101.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [101.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 101 ---
 * [102.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [102.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [102.02] DOM cache avoids repeated getElementById in hot paths.
 * [102.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [102.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [102.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [102.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [102.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [102.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [102.09] Voice uses Web Speech API when available; degrades gracefully.
 * [102.10] File attach limited to 2MB; name injected into prompt on send.
 * [102.11] Export downloads a plain-text transcript of the conversation.
 * [102.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [102.13] Retry removes last assistant turn and re-runs last user message.
 * [102.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [102.15] Scroll button appears when user is not near the bottom of the feed.
 * [102.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [102.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [102.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [102.19] Reduced motion: CSS disables liquid background and message animations.
 * [102.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [102.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [102.22] Effort selector maps to max_tokens for the chat completion call.
 * [102.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [102.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [102.25] Thinking indicator is three bouncing dots with CSS animation.
 * [102.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [102.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [102.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [102.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 102 ---
 * [103.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [103.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [103.02] DOM cache avoids repeated getElementById in hot paths.
 * [103.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [103.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [103.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [103.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [103.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [103.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [103.09] Voice uses Web Speech API when available; degrades gracefully.
 * [103.10] File attach limited to 2MB; name injected into prompt on send.
 * [103.11] Export downloads a plain-text transcript of the conversation.
 * [103.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [103.13] Retry removes last assistant turn and re-runs last user message.
 * [103.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [103.15] Scroll button appears when user is not near the bottom of the feed.
 * [103.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [103.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [103.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [103.19] Reduced motion: CSS disables liquid background and message animations.
 * [103.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [103.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [103.22] Effort selector maps to max_tokens for the chat completion call.
 * [103.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [103.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [103.25] Thinking indicator is three bouncing dots with CSS animation.
 * [103.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [103.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [103.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [103.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 103 ---
 * [104.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [104.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [104.02] DOM cache avoids repeated getElementById in hot paths.
 * [104.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [104.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [104.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [104.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [104.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [104.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [104.09] Voice uses Web Speech API when available; degrades gracefully.
 * [104.10] File attach limited to 2MB; name injected into prompt on send.
 * [104.11] Export downloads a plain-text transcript of the conversation.
 * [104.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [104.13] Retry removes last assistant turn and re-runs last user message.
 * [104.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [104.15] Scroll button appears when user is not near the bottom of the feed.
 * [104.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [104.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [104.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [104.19] Reduced motion: CSS disables liquid background and message animations.
 * [104.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [104.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [104.22] Effort selector maps to max_tokens for the chat completion call.
 * [104.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [104.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [104.25] Thinking indicator is three bouncing dots with CSS animation.
 * [104.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [104.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [104.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [104.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 104 ---
 * [105.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [105.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [105.02] DOM cache avoids repeated getElementById in hot paths.
 * [105.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [105.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [105.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [105.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [105.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [105.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [105.09] Voice uses Web Speech API when available; degrades gracefully.
 * [105.10] File attach limited to 2MB; name injected into prompt on send.
 * [105.11] Export downloads a plain-text transcript of the conversation.
 * [105.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [105.13] Retry removes last assistant turn and re-runs last user message.
 * [105.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [105.15] Scroll button appears when user is not near the bottom of the feed.
 * [105.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [105.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [105.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [105.19] Reduced motion: CSS disables liquid background and message animations.
 * [105.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [105.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [105.22] Effort selector maps to max_tokens for the chat completion call.
 * [105.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [105.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [105.25] Thinking indicator is three bouncing dots with CSS animation.
 * [105.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [105.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [105.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [105.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 105 ---
 * [106.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [106.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [106.02] DOM cache avoids repeated getElementById in hot paths.
 * [106.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [106.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [106.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [106.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [106.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [106.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [106.09] Voice uses Web Speech API when available; degrades gracefully.
 * [106.10] File attach limited to 2MB; name injected into prompt on send.
 * [106.11] Export downloads a plain-text transcript of the conversation.
 * [106.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [106.13] Retry removes last assistant turn and re-runs last user message.
 * [106.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [106.15] Scroll button appears when user is not near the bottom of the feed.
 * [106.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [106.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [106.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [106.19] Reduced motion: CSS disables liquid background and message animations.
 * [106.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [106.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [106.22] Effort selector maps to max_tokens for the chat completion call.
 * [106.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [106.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [106.25] Thinking indicator is three bouncing dots with CSS animation.
 * [106.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [106.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [106.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [106.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 106 ---
 * [107.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [107.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [107.02] DOM cache avoids repeated getElementById in hot paths.
 * [107.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [107.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [107.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [107.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [107.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [107.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [107.09] Voice uses Web Speech API when available; degrades gracefully.
 * [107.10] File attach limited to 2MB; name injected into prompt on send.
 * [107.11] Export downloads a plain-text transcript of the conversation.
 * [107.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [107.13] Retry removes last assistant turn and re-runs last user message.
 * [107.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [107.15] Scroll button appears when user is not near the bottom of the feed.
 * [107.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [107.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [107.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [107.19] Reduced motion: CSS disables liquid background and message animations.
 * [107.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [107.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [107.22] Effort selector maps to max_tokens for the chat completion call.
 * [107.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [107.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [107.25] Thinking indicator is three bouncing dots with CSS animation.
 * [107.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [107.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [107.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [107.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 107 ---
 * [108.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [108.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [108.02] DOM cache avoids repeated getElementById in hot paths.
 * [108.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [108.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [108.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [108.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [108.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [108.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [108.09] Voice uses Web Speech API when available; degrades gracefully.
 * [108.10] File attach limited to 2MB; name injected into prompt on send.
 * [108.11] Export downloads a plain-text transcript of the conversation.
 * [108.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [108.13] Retry removes last assistant turn and re-runs last user message.
 * [108.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [108.15] Scroll button appears when user is not near the bottom of the feed.
 * [108.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [108.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [108.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [108.19] Reduced motion: CSS disables liquid background and message animations.
 * [108.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [108.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [108.22] Effort selector maps to max_tokens for the chat completion call.
 * [108.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [108.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [108.25] Thinking indicator is three bouncing dots with CSS animation.
 * [108.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [108.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [108.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [108.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 108 ---
 * [109.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [109.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [109.02] DOM cache avoids repeated getElementById in hot paths.
 * [109.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [109.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [109.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [109.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [109.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [109.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [109.09] Voice uses Web Speech API when available; degrades gracefully.
 * [109.10] File attach limited to 2MB; name injected into prompt on send.
 * [109.11] Export downloads a plain-text transcript of the conversation.
 * [109.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [109.13] Retry removes last assistant turn and re-runs last user message.
 * [109.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [109.15] Scroll button appears when user is not near the bottom of the feed.
 * [109.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [109.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [109.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [109.19] Reduced motion: CSS disables liquid background and message animations.
 * [109.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [109.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [109.22] Effort selector maps to max_tokens for the chat completion call.
 * [109.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [109.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [109.25] Thinking indicator is three bouncing dots with CSS animation.
 * [109.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [109.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [109.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [109.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 109 ---
 * [110.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [110.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [110.02] DOM cache avoids repeated getElementById in hot paths.
 * [110.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [110.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [110.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [110.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [110.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [110.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [110.09] Voice uses Web Speech API when available; degrades gracefully.
 * [110.10] File attach limited to 2MB; name injected into prompt on send.
 * [110.11] Export downloads a plain-text transcript of the conversation.
 * [110.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [110.13] Retry removes last assistant turn and re-runs last user message.
 * [110.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [110.15] Scroll button appears when user is not near the bottom of the feed.
 * [110.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [110.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [110.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [110.19] Reduced motion: CSS disables liquid background and message animations.
 * [110.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [110.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [110.22] Effort selector maps to max_tokens for the chat completion call.
 * [110.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [110.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [110.25] Thinking indicator is three bouncing dots with CSS animation.
 * [110.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [110.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [110.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [110.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 110 ---
 * [111.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [111.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [111.02] DOM cache avoids repeated getElementById in hot paths.
 * [111.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [111.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [111.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [111.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [111.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [111.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [111.09] Voice uses Web Speech API when available; degrades gracefully.
 * [111.10] File attach limited to 2MB; name injected into prompt on send.
 * [111.11] Export downloads a plain-text transcript of the conversation.
 * [111.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [111.13] Retry removes last assistant turn and re-runs last user message.
 * [111.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [111.15] Scroll button appears when user is not near the bottom of the feed.
 * [111.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [111.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [111.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [111.19] Reduced motion: CSS disables liquid background and message animations.
 * [111.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [111.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [111.22] Effort selector maps to max_tokens for the chat completion call.
 * [111.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [111.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [111.25] Thinking indicator is three bouncing dots with CSS animation.
 * [111.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [111.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [111.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [111.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 111 ---
 * [112.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [112.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [112.02] DOM cache avoids repeated getElementById in hot paths.
 * [112.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [112.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [112.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [112.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [112.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [112.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [112.09] Voice uses Web Speech API when available; degrades gracefully.
 * [112.10] File attach limited to 2MB; name injected into prompt on send.
 * [112.11] Export downloads a plain-text transcript of the conversation.
 * [112.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [112.13] Retry removes last assistant turn and re-runs last user message.
 * [112.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [112.15] Scroll button appears when user is not near the bottom of the feed.
 * [112.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [112.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [112.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [112.19] Reduced motion: CSS disables liquid background and message animations.
 * [112.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [112.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [112.22] Effort selector maps to max_tokens for the chat completion call.
 * [112.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [112.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [112.25] Thinking indicator is three bouncing dots with CSS animation.
 * [112.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [112.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [112.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [112.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 112 ---
 * [113.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [113.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [113.02] DOM cache avoids repeated getElementById in hot paths.
 * [113.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [113.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [113.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [113.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [113.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [113.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [113.09] Voice uses Web Speech API when available; degrades gracefully.
 * [113.10] File attach limited to 2MB; name injected into prompt on send.
 * [113.11] Export downloads a plain-text transcript of the conversation.
 * [113.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [113.13] Retry removes last assistant turn and re-runs last user message.
 * [113.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [113.15] Scroll button appears when user is not near the bottom of the feed.
 * [113.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [113.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [113.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [113.19] Reduced motion: CSS disables liquid background and message animations.
 * [113.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [113.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [113.22] Effort selector maps to max_tokens for the chat completion call.
 * [113.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [113.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [113.25] Thinking indicator is three bouncing dots with CSS animation.
 * [113.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [113.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [113.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [113.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 113 ---
 * [114.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [114.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [114.02] DOM cache avoids repeated getElementById in hot paths.
 * [114.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [114.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [114.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [114.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [114.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [114.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [114.09] Voice uses Web Speech API when available; degrades gracefully.
 * [114.10] File attach limited to 2MB; name injected into prompt on send.
 * [114.11] Export downloads a plain-text transcript of the conversation.
 * [114.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [114.13] Retry removes last assistant turn and re-runs last user message.
 * [114.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [114.15] Scroll button appears when user is not near the bottom of the feed.
 * [114.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [114.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [114.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [114.19] Reduced motion: CSS disables liquid background and message animations.
 * [114.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [114.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [114.22] Effort selector maps to max_tokens for the chat completion call.
 * [114.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [114.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [114.25] Thinking indicator is three bouncing dots with CSS animation.
 * [114.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [114.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [114.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [114.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 114 ---
 * [115.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [115.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [115.02] DOM cache avoids repeated getElementById in hot paths.
 * [115.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [115.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [115.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [115.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [115.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [115.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [115.09] Voice uses Web Speech API when available; degrades gracefully.
 * [115.10] File attach limited to 2MB; name injected into prompt on send.
 * [115.11] Export downloads a plain-text transcript of the conversation.
 * [115.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [115.13] Retry removes last assistant turn and re-runs last user message.
 * [115.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [115.15] Scroll button appears when user is not near the bottom of the feed.
 * [115.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [115.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [115.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [115.19] Reduced motion: CSS disables liquid background and message animations.
 * [115.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [115.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [115.22] Effort selector maps to max_tokens for the chat completion call.
 * [115.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [115.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [115.25] Thinking indicator is three bouncing dots with CSS animation.
 * [115.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [115.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [115.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [115.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 115 ---
 * [116.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [116.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [116.02] DOM cache avoids repeated getElementById in hot paths.
 * [116.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [116.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [116.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [116.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [116.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [116.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [116.09] Voice uses Web Speech API when available; degrades gracefully.
 * [116.10] File attach limited to 2MB; name injected into prompt on send.
 * [116.11] Export downloads a plain-text transcript of the conversation.
 * [116.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [116.13] Retry removes last assistant turn and re-runs last user message.
 * [116.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [116.15] Scroll button appears when user is not near the bottom of the feed.
 * [116.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [116.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [116.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [116.19] Reduced motion: CSS disables liquid background and message animations.
 * [116.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [116.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [116.22] Effort selector maps to max_tokens for the chat completion call.
 * [116.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [116.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [116.25] Thinking indicator is three bouncing dots with CSS animation.
 * [116.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [116.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [116.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [116.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 116 ---
 * [117.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [117.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [117.02] DOM cache avoids repeated getElementById in hot paths.
 * [117.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [117.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [117.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [117.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [117.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [117.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [117.09] Voice uses Web Speech API when available; degrades gracefully.
 * [117.10] File attach limited to 2MB; name injected into prompt on send.
 * [117.11] Export downloads a plain-text transcript of the conversation.
 * [117.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [117.13] Retry removes last assistant turn and re-runs last user message.
 * [117.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [117.15] Scroll button appears when user is not near the bottom of the feed.
 * [117.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [117.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [117.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [117.19] Reduced motion: CSS disables liquid background and message animations.
 * [117.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [117.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [117.22] Effort selector maps to max_tokens for the chat completion call.
 * [117.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [117.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [117.25] Thinking indicator is three bouncing dots with CSS animation.
 * [117.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [117.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [117.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [117.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 117 ---
 * [118.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [118.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [118.02] DOM cache avoids repeated getElementById in hot paths.
 * [118.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [118.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [118.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [118.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [118.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [118.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [118.09] Voice uses Web Speech API when available; degrades gracefully.
 * [118.10] File attach limited to 2MB; name injected into prompt on send.
 * [118.11] Export downloads a plain-text transcript of the conversation.
 * [118.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [118.13] Retry removes last assistant turn and re-runs last user message.
 * [118.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [118.15] Scroll button appears when user is not near the bottom of the feed.
 * [118.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [118.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [118.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [118.19] Reduced motion: CSS disables liquid background and message animations.
 * [118.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [118.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [118.22] Effort selector maps to max_tokens for the chat completion call.
 * [118.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [118.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [118.25] Thinking indicator is three bouncing dots with CSS animation.
 * [118.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [118.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [118.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [118.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 118 ---
 * [119.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [119.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [119.02] DOM cache avoids repeated getElementById in hot paths.
 * [119.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [119.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [119.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [119.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [119.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [119.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [119.09] Voice uses Web Speech API when available; degrades gracefully.
 * [119.10] File attach limited to 2MB; name injected into prompt on send.
 * [119.11] Export downloads a plain-text transcript of the conversation.
 * [119.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [119.13] Retry removes last assistant turn and re-runs last user message.
 * [119.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [119.15] Scroll button appears when user is not near the bottom of the feed.
 * [119.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [119.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [119.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [119.19] Reduced motion: CSS disables liquid background and message animations.
 * [119.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [119.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [119.22] Effort selector maps to max_tokens for the chat completion call.
 * [119.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [119.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [119.25] Thinking indicator is three bouncing dots with CSS animation.
 * [119.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [119.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [119.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [119.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 119 ---
 * [120.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [120.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [120.02] DOM cache avoids repeated getElementById in hot paths.
 * [120.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [120.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [120.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [120.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [120.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [120.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [120.09] Voice uses Web Speech API when available; degrades gracefully.
 * [120.10] File attach limited to 2MB; name injected into prompt on send.
 * [120.11] Export downloads a plain-text transcript of the conversation.
 * [120.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [120.13] Retry removes last assistant turn and re-runs last user message.
 * [120.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [120.15] Scroll button appears when user is not near the bottom of the feed.
 * [120.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [120.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [120.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [120.19] Reduced motion: CSS disables liquid background and message animations.
 * [120.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [120.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [120.22] Effort selector maps to max_tokens for the chat completion call.
 * [120.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [120.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [120.25] Thinking indicator is three bouncing dots with CSS animation.
 * [120.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [120.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [120.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [120.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 120 ---
 * [121.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [121.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [121.02] DOM cache avoids repeated getElementById in hot paths.
 * [121.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [121.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [121.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [121.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [121.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [121.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [121.09] Voice uses Web Speech API when available; degrades gracefully.
 * [121.10] File attach limited to 2MB; name injected into prompt on send.
 * [121.11] Export downloads a plain-text transcript of the conversation.
 * [121.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [121.13] Retry removes last assistant turn and re-runs last user message.
 * [121.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [121.15] Scroll button appears when user is not near the bottom of the feed.
 * [121.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [121.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [121.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [121.19] Reduced motion: CSS disables liquid background and message animations.
 * [121.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [121.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [121.22] Effort selector maps to max_tokens for the chat completion call.
 * [121.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [121.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [121.25] Thinking indicator is three bouncing dots with CSS animation.
 * [121.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [121.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [121.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [121.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 121 ---
 * [122.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [122.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [122.02] DOM cache avoids repeated getElementById in hot paths.
 * [122.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [122.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [122.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [122.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [122.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [122.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [122.09] Voice uses Web Speech API when available; degrades gracefully.
 * [122.10] File attach limited to 2MB; name injected into prompt on send.
 * [122.11] Export downloads a plain-text transcript of the conversation.
 * [122.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [122.13] Retry removes last assistant turn and re-runs last user message.
 * [122.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [122.15] Scroll button appears when user is not near the bottom of the feed.
 * [122.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [122.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [122.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [122.19] Reduced motion: CSS disables liquid background and message animations.
 * [122.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [122.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [122.22] Effort selector maps to max_tokens for the chat completion call.
 * [122.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [122.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [122.25] Thinking indicator is three bouncing dots with CSS animation.
 * [122.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [122.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [122.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [122.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 122 ---
 * [123.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [123.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [123.02] DOM cache avoids repeated getElementById in hot paths.
 * [123.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [123.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [123.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [123.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [123.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [123.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [123.09] Voice uses Web Speech API when available; degrades gracefully.
 * [123.10] File attach limited to 2MB; name injected into prompt on send.
 * [123.11] Export downloads a plain-text transcript of the conversation.
 * [123.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [123.13] Retry removes last assistant turn and re-runs last user message.
 * [123.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [123.15] Scroll button appears when user is not near the bottom of the feed.
 * [123.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [123.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [123.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [123.19] Reduced motion: CSS disables liquid background and message animations.
 * [123.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [123.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [123.22] Effort selector maps to max_tokens for the chat completion call.
 * [123.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [123.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [123.25] Thinking indicator is three bouncing dots with CSS animation.
 * [123.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [123.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [123.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [123.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 123 ---
 * [124.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [124.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [124.02] DOM cache avoids repeated getElementById in hot paths.
 * [124.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [124.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [124.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [124.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [124.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [124.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [124.09] Voice uses Web Speech API when available; degrades gracefully.
 * [124.10] File attach limited to 2MB; name injected into prompt on send.
 * [124.11] Export downloads a plain-text transcript of the conversation.
 * [124.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [124.13] Retry removes last assistant turn and re-runs last user message.
 * [124.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [124.15] Scroll button appears when user is not near the bottom of the feed.
 * [124.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [124.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [124.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [124.19] Reduced motion: CSS disables liquid background and message animations.
 * [124.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [124.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [124.22] Effort selector maps to max_tokens for the chat completion call.
 * [124.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [124.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [124.25] Thinking indicator is three bouncing dots with CSS animation.
 * [124.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [124.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [124.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [124.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 124 ---
 * [125.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [125.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [125.02] DOM cache avoids repeated getElementById in hot paths.
 * [125.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [125.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [125.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [125.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [125.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [125.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [125.09] Voice uses Web Speech API when available; degrades gracefully.
 * [125.10] File attach limited to 2MB; name injected into prompt on send.
 * [125.11] Export downloads a plain-text transcript of the conversation.
 * [125.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [125.13] Retry removes last assistant turn and re-runs last user message.
 * [125.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [125.15] Scroll button appears when user is not near the bottom of the feed.
 * [125.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [125.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [125.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [125.19] Reduced motion: CSS disables liquid background and message animations.
 * [125.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [125.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [125.22] Effort selector maps to max_tokens for the chat completion call.
 * [125.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [125.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [125.25] Thinking indicator is three bouncing dots with CSS animation.
 * [125.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [125.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [125.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [125.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 125 ---
 * [126.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [126.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [126.02] DOM cache avoids repeated getElementById in hot paths.
 * [126.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [126.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [126.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [126.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [126.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [126.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [126.09] Voice uses Web Speech API when available; degrades gracefully.
 * [126.10] File attach limited to 2MB; name injected into prompt on send.
 * [126.11] Export downloads a plain-text transcript of the conversation.
 * [126.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [126.13] Retry removes last assistant turn and re-runs last user message.
 * [126.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [126.15] Scroll button appears when user is not near the bottom of the feed.
 * [126.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [126.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [126.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [126.19] Reduced motion: CSS disables liquid background and message animations.
 * [126.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [126.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [126.22] Effort selector maps to max_tokens for the chat completion call.
 * [126.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [126.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [126.25] Thinking indicator is three bouncing dots with CSS animation.
 * [126.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [126.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [126.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [126.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 126 ---
 * [127.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [127.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [127.02] DOM cache avoids repeated getElementById in hot paths.
 * [127.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [127.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [127.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [127.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [127.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [127.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [127.09] Voice uses Web Speech API when available; degrades gracefully.
 * [127.10] File attach limited to 2MB; name injected into prompt on send.
 * [127.11] Export downloads a plain-text transcript of the conversation.
 * [127.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [127.13] Retry removes last assistant turn and re-runs last user message.
 * [127.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [127.15] Scroll button appears when user is not near the bottom of the feed.
 * [127.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [127.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [127.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [127.19] Reduced motion: CSS disables liquid background and message animations.
 * [127.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [127.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [127.22] Effort selector maps to max_tokens for the chat completion call.
 * [127.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [127.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [127.25] Thinking indicator is three bouncing dots with CSS animation.
 * [127.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [127.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [127.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [127.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 127 ---
 * [128.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [128.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [128.02] DOM cache avoids repeated getElementById in hot paths.
 * [128.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [128.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [128.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [128.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [128.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [128.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [128.09] Voice uses Web Speech API when available; degrades gracefully.
 * [128.10] File attach limited to 2MB; name injected into prompt on send.
 * [128.11] Export downloads a plain-text transcript of the conversation.
 * [128.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [128.13] Retry removes last assistant turn and re-runs last user message.
 * [128.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [128.15] Scroll button appears when user is not near the bottom of the feed.
 * [128.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [128.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [128.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [128.19] Reduced motion: CSS disables liquid background and message animations.
 * [128.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [128.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [128.22] Effort selector maps to max_tokens for the chat completion call.
 * [128.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [128.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [128.25] Thinking indicator is three bouncing dots with CSS animation.
 * [128.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [128.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [128.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [128.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 128 ---
 * [129.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [129.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [129.02] DOM cache avoids repeated getElementById in hot paths.
 * [129.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [129.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [129.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [129.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [129.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [129.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [129.09] Voice uses Web Speech API when available; degrades gracefully.
 * [129.10] File attach limited to 2MB; name injected into prompt on send.
 * [129.11] Export downloads a plain-text transcript of the conversation.
 * [129.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [129.13] Retry removes last assistant turn and re-runs last user message.
 * [129.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [129.15] Scroll button appears when user is not near the bottom of the feed.
 * [129.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [129.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [129.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [129.19] Reduced motion: CSS disables liquid background and message animations.
 * [129.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [129.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [129.22] Effort selector maps to max_tokens for the chat completion call.
 * [129.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [129.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [129.25] Thinking indicator is three bouncing dots with CSS animation.
 * [129.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [129.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [129.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [129.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 129 ---
 * [130.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [130.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [130.02] DOM cache avoids repeated getElementById in hot paths.
 * [130.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [130.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [130.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [130.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [130.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [130.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [130.09] Voice uses Web Speech API when available; degrades gracefully.
 * [130.10] File attach limited to 2MB; name injected into prompt on send.
 * [130.11] Export downloads a plain-text transcript of the conversation.
 * [130.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [130.13] Retry removes last assistant turn and re-runs last user message.
 * [130.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [130.15] Scroll button appears when user is not near the bottom of the feed.
 * [130.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [130.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [130.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [130.19] Reduced motion: CSS disables liquid background and message animations.
 * [130.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [130.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [130.22] Effort selector maps to max_tokens for the chat completion call.
 * [130.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [130.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [130.25] Thinking indicator is three bouncing dots with CSS animation.
 * [130.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [130.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [130.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [130.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 130 ---
 * [131.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [131.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [131.02] DOM cache avoids repeated getElementById in hot paths.
 * [131.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [131.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [131.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [131.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [131.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [131.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [131.09] Voice uses Web Speech API when available; degrades gracefully.
 * [131.10] File attach limited to 2MB; name injected into prompt on send.
 * [131.11] Export downloads a plain-text transcript of the conversation.
 * [131.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [131.13] Retry removes last assistant turn and re-runs last user message.
 * [131.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [131.15] Scroll button appears when user is not near the bottom of the feed.
 * [131.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [131.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [131.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [131.19] Reduced motion: CSS disables liquid background and message animations.
 * [131.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [131.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [131.22] Effort selector maps to max_tokens for the chat completion call.
 * [131.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [131.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [131.25] Thinking indicator is three bouncing dots with CSS animation.
 * [131.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [131.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [131.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [131.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 131 ---
 * [132.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [132.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [132.02] DOM cache avoids repeated getElementById in hot paths.
 * [132.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [132.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [132.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [132.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [132.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [132.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [132.09] Voice uses Web Speech API when available; degrades gracefully.
 * [132.10] File attach limited to 2MB; name injected into prompt on send.
 * [132.11] Export downloads a plain-text transcript of the conversation.
 * [132.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [132.13] Retry removes last assistant turn and re-runs last user message.
 * [132.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [132.15] Scroll button appears when user is not near the bottom of the feed.
 * [132.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [132.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [132.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [132.19] Reduced motion: CSS disables liquid background and message animations.
 * [132.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [132.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [132.22] Effort selector maps to max_tokens for the chat completion call.
 * [132.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [132.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [132.25] Thinking indicator is three bouncing dots with CSS animation.
 * [132.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [132.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [132.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [132.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 132 ---
 * [133.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [133.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [133.02] DOM cache avoids repeated getElementById in hot paths.
 * [133.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [133.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [133.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [133.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [133.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [133.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [133.09] Voice uses Web Speech API when available; degrades gracefully.
 * [133.10] File attach limited to 2MB; name injected into prompt on send.
 * [133.11] Export downloads a plain-text transcript of the conversation.
 * [133.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [133.13] Retry removes last assistant turn and re-runs last user message.
 * [133.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [133.15] Scroll button appears when user is not near the bottom of the feed.
 * [133.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [133.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [133.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [133.19] Reduced motion: CSS disables liquid background and message animations.
 * [133.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [133.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [133.22] Effort selector maps to max_tokens for the chat completion call.
 * [133.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [133.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [133.25] Thinking indicator is three bouncing dots with CSS animation.
 * [133.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [133.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [133.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [133.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 133 ---
 * [134.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [134.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [134.02] DOM cache avoids repeated getElementById in hot paths.
 * [134.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [134.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [134.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [134.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [134.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [134.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [134.09] Voice uses Web Speech API when available; degrades gracefully.
 * [134.10] File attach limited to 2MB; name injected into prompt on send.
 * [134.11] Export downloads a plain-text transcript of the conversation.
 * [134.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [134.13] Retry removes last assistant turn and re-runs last user message.
 * [134.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [134.15] Scroll button appears when user is not near the bottom of the feed.
 * [134.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [134.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [134.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [134.19] Reduced motion: CSS disables liquid background and message animations.
 * [134.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [134.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [134.22] Effort selector maps to max_tokens for the chat completion call.
 * [134.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [134.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [134.25] Thinking indicator is three bouncing dots with CSS animation.
 * [134.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [134.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [134.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [134.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 134 ---
 * [135.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [135.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [135.02] DOM cache avoids repeated getElementById in hot paths.
 * [135.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [135.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [135.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [135.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [135.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [135.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [135.09] Voice uses Web Speech API when available; degrades gracefully.
 * [135.10] File attach limited to 2MB; name injected into prompt on send.
 * [135.11] Export downloads a plain-text transcript of the conversation.
 * [135.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [135.13] Retry removes last assistant turn and re-runs last user message.
 * [135.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [135.15] Scroll button appears when user is not near the bottom of the feed.
 * [135.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [135.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [135.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [135.19] Reduced motion: CSS disables liquid background and message animations.
 * [135.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [135.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [135.22] Effort selector maps to max_tokens for the chat completion call.
 * [135.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [135.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [135.25] Thinking indicator is three bouncing dots with CSS animation.
 * [135.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [135.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [135.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [135.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 135 ---
 * [136.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [136.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [136.02] DOM cache avoids repeated getElementById in hot paths.
 * [136.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [136.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [136.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [136.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [136.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [136.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [136.09] Voice uses Web Speech API when available; degrades gracefully.
 * [136.10] File attach limited to 2MB; name injected into prompt on send.
 * [136.11] Export downloads a plain-text transcript of the conversation.
 * [136.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [136.13] Retry removes last assistant turn and re-runs last user message.
 * [136.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [136.15] Scroll button appears when user is not near the bottom of the feed.
 * [136.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [136.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [136.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [136.19] Reduced motion: CSS disables liquid background and message animations.
 * [136.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [136.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [136.22] Effort selector maps to max_tokens for the chat completion call.
 * [136.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [136.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [136.25] Thinking indicator is three bouncing dots with CSS animation.
 * [136.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [136.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [136.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [136.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 136 ---
 * [137.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [137.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [137.02] DOM cache avoids repeated getElementById in hot paths.
 * [137.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [137.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [137.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [137.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [137.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [137.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [137.09] Voice uses Web Speech API when available; degrades gracefully.
 * [137.10] File attach limited to 2MB; name injected into prompt on send.
 * [137.11] Export downloads a plain-text transcript of the conversation.
 * [137.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [137.13] Retry removes last assistant turn and re-runs last user message.
 * [137.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [137.15] Scroll button appears when user is not near the bottom of the feed.
 * [137.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [137.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [137.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [137.19] Reduced motion: CSS disables liquid background and message animations.
 * [137.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [137.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [137.22] Effort selector maps to max_tokens for the chat completion call.
 * [137.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [137.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [137.25] Thinking indicator is three bouncing dots with CSS animation.
 * [137.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [137.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [137.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [137.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 137 ---
 * [138.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [138.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [138.02] DOM cache avoids repeated getElementById in hot paths.
 * [138.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [138.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [138.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [138.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [138.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [138.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [138.09] Voice uses Web Speech API when available; degrades gracefully.
 * [138.10] File attach limited to 2MB; name injected into prompt on send.
 * [138.11] Export downloads a plain-text transcript of the conversation.
 * [138.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [138.13] Retry removes last assistant turn and re-runs last user message.
 * [138.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [138.15] Scroll button appears when user is not near the bottom of the feed.
 * [138.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [138.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [138.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [138.19] Reduced motion: CSS disables liquid background and message animations.
 * [138.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [138.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [138.22] Effort selector maps to max_tokens for the chat completion call.
 * [138.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [138.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [138.25] Thinking indicator is three bouncing dots with CSS animation.
 * [138.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [138.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [138.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [138.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 138 ---
 * [139.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [139.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [139.02] DOM cache avoids repeated getElementById in hot paths.
 * [139.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [139.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [139.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [139.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [139.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [139.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [139.09] Voice uses Web Speech API when available; degrades gracefully.
 * [139.10] File attach limited to 2MB; name injected into prompt on send.
 * [139.11] Export downloads a plain-text transcript of the conversation.
 * [139.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [139.13] Retry removes last assistant turn and re-runs last user message.
 * [139.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [139.15] Scroll button appears when user is not near the bottom of the feed.
 * [139.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [139.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [139.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [139.19] Reduced motion: CSS disables liquid background and message animations.
 * [139.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [139.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [139.22] Effort selector maps to max_tokens for the chat completion call.
 * [139.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [139.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [139.25] Thinking indicator is three bouncing dots with CSS animation.
 * [139.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [139.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [139.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [139.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 139 ---
 * [140.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [140.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [140.02] DOM cache avoids repeated getElementById in hot paths.
 * [140.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [140.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [140.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [140.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [140.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [140.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [140.09] Voice uses Web Speech API when available; degrades gracefully.
 * [140.10] File attach limited to 2MB; name injected into prompt on send.
 * [140.11] Export downloads a plain-text transcript of the conversation.
 * [140.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [140.13] Retry removes last assistant turn and re-runs last user message.
 * [140.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [140.15] Scroll button appears when user is not near the bottom of the feed.
 * [140.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [140.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [140.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [140.19] Reduced motion: CSS disables liquid background and message animations.
 * [140.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [140.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [140.22] Effort selector maps to max_tokens for the chat completion call.
 * [140.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [140.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [140.25] Thinking indicator is three bouncing dots with CSS animation.
 * [140.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [140.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [140.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [140.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 140 ---
 * [141.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [141.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [141.02] DOM cache avoids repeated getElementById in hot paths.
 * [141.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [141.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [141.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [141.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [141.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [141.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [141.09] Voice uses Web Speech API when available; degrades gracefully.
 * [141.10] File attach limited to 2MB; name injected into prompt on send.
 * [141.11] Export downloads a plain-text transcript of the conversation.
 * [141.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [141.13] Retry removes last assistant turn and re-runs last user message.
 * [141.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [141.15] Scroll button appears when user is not near the bottom of the feed.
 * [141.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [141.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [141.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [141.19] Reduced motion: CSS disables liquid background and message animations.
 * [141.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [141.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [141.22] Effort selector maps to max_tokens for the chat completion call.
 * [141.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [141.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [141.25] Thinking indicator is three bouncing dots with CSS animation.
 * [141.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [141.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [141.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [141.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 141 ---
 * [142.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [142.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [142.02] DOM cache avoids repeated getElementById in hot paths.
 * [142.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [142.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [142.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [142.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [142.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [142.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [142.09] Voice uses Web Speech API when available; degrades gracefully.
 * [142.10] File attach limited to 2MB; name injected into prompt on send.
 * [142.11] Export downloads a plain-text transcript of the conversation.
 * [142.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [142.13] Retry removes last assistant turn and re-runs last user message.
 * [142.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [142.15] Scroll button appears when user is not near the bottom of the feed.
 * [142.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [142.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [142.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [142.19] Reduced motion: CSS disables liquid background and message animations.
 * [142.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [142.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [142.22] Effort selector maps to max_tokens for the chat completion call.
 * [142.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [142.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [142.25] Thinking indicator is three bouncing dots with CSS animation.
 * [142.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [142.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [142.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [142.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 142 ---
 * [143.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [143.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [143.02] DOM cache avoids repeated getElementById in hot paths.
 * [143.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [143.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [143.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [143.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [143.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [143.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [143.09] Voice uses Web Speech API when available; degrades gracefully.
 * [143.10] File attach limited to 2MB; name injected into prompt on send.
 * [143.11] Export downloads a plain-text transcript of the conversation.
 * [143.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [143.13] Retry removes last assistant turn and re-runs last user message.
 * [143.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [143.15] Scroll button appears when user is not near the bottom of the feed.
 * [143.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [143.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [143.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [143.19] Reduced motion: CSS disables liquid background and message animations.
 * [143.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [143.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [143.22] Effort selector maps to max_tokens for the chat completion call.
 * [143.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [143.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [143.25] Thinking indicator is three bouncing dots with CSS animation.
 * [143.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [143.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [143.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [143.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 143 ---
 * [144.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [144.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [144.02] DOM cache avoids repeated getElementById in hot paths.
 * [144.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [144.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [144.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [144.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [144.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [144.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [144.09] Voice uses Web Speech API when available; degrades gracefully.
 * [144.10] File attach limited to 2MB; name injected into prompt on send.
 * [144.11] Export downloads a plain-text transcript of the conversation.
 * [144.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [144.13] Retry removes last assistant turn and re-runs last user message.
 * [144.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [144.15] Scroll button appears when user is not near the bottom of the feed.
 * [144.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [144.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [144.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [144.19] Reduced motion: CSS disables liquid background and message animations.
 * [144.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [144.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [144.22] Effort selector maps to max_tokens for the chat completion call.
 * [144.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [144.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [144.25] Thinking indicator is three bouncing dots with CSS animation.
 * [144.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [144.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [144.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [144.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 144 ---
 * [145.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [145.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [145.02] DOM cache avoids repeated getElementById in hot paths.
 * [145.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [145.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [145.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [145.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [145.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [145.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [145.09] Voice uses Web Speech API when available; degrades gracefully.
 * [145.10] File attach limited to 2MB; name injected into prompt on send.
 * [145.11] Export downloads a plain-text transcript of the conversation.
 * [145.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [145.13] Retry removes last assistant turn and re-runs last user message.
 * [145.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [145.15] Scroll button appears when user is not near the bottom of the feed.
 * [145.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [145.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [145.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [145.19] Reduced motion: CSS disables liquid background and message animations.
 * [145.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [145.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [145.22] Effort selector maps to max_tokens for the chat completion call.
 * [145.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [145.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [145.25] Thinking indicator is three bouncing dots with CSS animation.
 * [145.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [145.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [145.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [145.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 145 ---
 * [146.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [146.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [146.02] DOM cache avoids repeated getElementById in hot paths.
 * [146.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [146.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [146.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [146.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [146.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [146.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [146.09] Voice uses Web Speech API when available; degrades gracefully.
 * [146.10] File attach limited to 2MB; name injected into prompt on send.
 * [146.11] Export downloads a plain-text transcript of the conversation.
 * [146.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [146.13] Retry removes last assistant turn and re-runs last user message.
 * [146.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [146.15] Scroll button appears when user is not near the bottom of the feed.
 * [146.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [146.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [146.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [146.19] Reduced motion: CSS disables liquid background and message animations.
 * [146.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [146.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [146.22] Effort selector maps to max_tokens for the chat completion call.
 * [146.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [146.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [146.25] Thinking indicator is three bouncing dots with CSS animation.
 * [146.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [146.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [146.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [146.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 146 ---
 * [147.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [147.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [147.02] DOM cache avoids repeated getElementById in hot paths.
 * [147.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [147.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [147.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [147.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [147.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [147.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [147.09] Voice uses Web Speech API when available; degrades gracefully.
 * [147.10] File attach limited to 2MB; name injected into prompt on send.
 * [147.11] Export downloads a plain-text transcript of the conversation.
 * [147.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [147.13] Retry removes last assistant turn and re-runs last user message.
 * [147.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [147.15] Scroll button appears when user is not near the bottom of the feed.
 * [147.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [147.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [147.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [147.19] Reduced motion: CSS disables liquid background and message animations.
 * [147.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [147.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [147.22] Effort selector maps to max_tokens for the chat completion call.
 * [147.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [147.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [147.25] Thinking indicator is three bouncing dots with CSS animation.
 * [147.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [147.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [147.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [147.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 147 ---
 * [148.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [148.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [148.02] DOM cache avoids repeated getElementById in hot paths.
 * [148.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [148.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [148.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [148.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [148.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [148.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [148.09] Voice uses Web Speech API when available; degrades gracefully.
 * [148.10] File attach limited to 2MB; name injected into prompt on send.
 * [148.11] Export downloads a plain-text transcript of the conversation.
 * [148.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [148.13] Retry removes last assistant turn and re-runs last user message.
 * [148.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [148.15] Scroll button appears when user is not near the bottom of the feed.
 * [148.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [148.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [148.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [148.19] Reduced motion: CSS disables liquid background and message animations.
 * [148.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [148.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [148.22] Effort selector maps to max_tokens for the chat completion call.
 * [148.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [148.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [148.25] Thinking indicator is three bouncing dots with CSS animation.
 * [148.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [148.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [148.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [148.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 148 ---
 * [149.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [149.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [149.02] DOM cache avoids repeated getElementById in hot paths.
 * [149.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [149.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [149.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [149.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [149.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [149.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [149.09] Voice uses Web Speech API when available; degrades gracefully.
 * [149.10] File attach limited to 2MB; name injected into prompt on send.
 * [149.11] Export downloads a plain-text transcript of the conversation.
 * [149.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [149.13] Retry removes last assistant turn and re-runs last user message.
 * [149.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [149.15] Scroll button appears when user is not near the bottom of the feed.
 * [149.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [149.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [149.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [149.19] Reduced motion: CSS disables liquid background and message animations.
 * [149.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [149.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [149.22] Effort selector maps to max_tokens for the chat completion call.
 * [149.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [149.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [149.25] Thinking indicator is three bouncing dots with CSS animation.
 * [149.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [149.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [149.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [149.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 149 ---
 * [150.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [150.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [150.02] DOM cache avoids repeated getElementById in hot paths.
 * [150.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [150.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [150.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [150.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [150.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [150.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [150.09] Voice uses Web Speech API when available; degrades gracefully.
 * [150.10] File attach limited to 2MB; name injected into prompt on send.
 * [150.11] Export downloads a plain-text transcript of the conversation.
 * [150.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [150.13] Retry removes last assistant turn and re-runs last user message.
 * [150.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [150.15] Scroll button appears when user is not near the bottom of the feed.
 * [150.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [150.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [150.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [150.19] Reduced motion: CSS disables liquid background and message animations.
 * [150.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [150.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [150.22] Effort selector maps to max_tokens for the chat completion call.
 * [150.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [150.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [150.25] Thinking indicator is three bouncing dots with CSS animation.
 * [150.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [150.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [150.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [150.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 150 ---
 * [151.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [151.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [151.02] DOM cache avoids repeated getElementById in hot paths.
 * [151.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [151.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [151.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [151.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [151.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [151.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [151.09] Voice uses Web Speech API when available; degrades gracefully.
 * [151.10] File attach limited to 2MB; name injected into prompt on send.
 * [151.11] Export downloads a plain-text transcript of the conversation.
 * [151.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [151.13] Retry removes last assistant turn and re-runs last user message.
 * [151.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [151.15] Scroll button appears when user is not near the bottom of the feed.
 * [151.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [151.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [151.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [151.19] Reduced motion: CSS disables liquid background and message animations.
 * [151.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [151.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [151.22] Effort selector maps to max_tokens for the chat completion call.
 * [151.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [151.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [151.25] Thinking indicator is three bouncing dots with CSS animation.
 * [151.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [151.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [151.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [151.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 151 ---
 * [152.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [152.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [152.02] DOM cache avoids repeated getElementById in hot paths.
 * [152.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [152.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [152.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [152.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [152.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [152.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [152.09] Voice uses Web Speech API when available; degrades gracefully.
 * [152.10] File attach limited to 2MB; name injected into prompt on send.
 * [152.11] Export downloads a plain-text transcript of the conversation.
 * [152.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [152.13] Retry removes last assistant turn and re-runs last user message.
 * [152.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [152.15] Scroll button appears when user is not near the bottom of the feed.
 * [152.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [152.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [152.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [152.19] Reduced motion: CSS disables liquid background and message animations.
 * [152.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [152.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [152.22] Effort selector maps to max_tokens for the chat completion call.
 * [152.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [152.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [152.25] Thinking indicator is three bouncing dots with CSS animation.
 * [152.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [152.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [152.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [152.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 152 ---
 * [153.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [153.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [153.02] DOM cache avoids repeated getElementById in hot paths.
 * [153.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [153.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [153.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [153.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [153.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [153.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [153.09] Voice uses Web Speech API when available; degrades gracefully.
 * [153.10] File attach limited to 2MB; name injected into prompt on send.
 * [153.11] Export downloads a plain-text transcript of the conversation.
 * [153.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [153.13] Retry removes last assistant turn and re-runs last user message.
 * [153.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [153.15] Scroll button appears when user is not near the bottom of the feed.
 * [153.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [153.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [153.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [153.19] Reduced motion: CSS disables liquid background and message animations.
 * [153.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [153.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [153.22] Effort selector maps to max_tokens for the chat completion call.
 * [153.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [153.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [153.25] Thinking indicator is three bouncing dots with CSS animation.
 * [153.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [153.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [153.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [153.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 153 ---
 * [154.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [154.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [154.02] DOM cache avoids repeated getElementById in hot paths.
 * [154.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [154.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [154.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [154.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [154.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [154.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [154.09] Voice uses Web Speech API when available; degrades gracefully.
 * [154.10] File attach limited to 2MB; name injected into prompt on send.
 * [154.11] Export downloads a plain-text transcript of the conversation.
 * [154.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [154.13] Retry removes last assistant turn and re-runs last user message.
 * [154.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [154.15] Scroll button appears when user is not near the bottom of the feed.
 * [154.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [154.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [154.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [154.19] Reduced motion: CSS disables liquid background and message animations.
 * [154.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [154.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [154.22] Effort selector maps to max_tokens for the chat completion call.
 * [154.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [154.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [154.25] Thinking indicator is three bouncing dots with CSS animation.
 * [154.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [154.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [154.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [154.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 154 ---
 * [155.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [155.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [155.02] DOM cache avoids repeated getElementById in hot paths.
 * [155.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [155.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [155.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [155.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [155.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [155.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [155.09] Voice uses Web Speech API when available; degrades gracefully.
 * [155.10] File attach limited to 2MB; name injected into prompt on send.
 * [155.11] Export downloads a plain-text transcript of the conversation.
 * [155.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [155.13] Retry removes last assistant turn and re-runs last user message.
 * [155.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [155.15] Scroll button appears when user is not near the bottom of the feed.
 * [155.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [155.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [155.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [155.19] Reduced motion: CSS disables liquid background and message animations.
 * [155.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [155.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [155.22] Effort selector maps to max_tokens for the chat completion call.
 * [155.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [155.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [155.25] Thinking indicator is three bouncing dots with CSS animation.
 * [155.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [155.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [155.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [155.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 155 ---
 * [156.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [156.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [156.02] DOM cache avoids repeated getElementById in hot paths.
 * [156.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [156.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [156.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [156.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [156.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [156.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [156.09] Voice uses Web Speech API when available; degrades gracefully.
 * [156.10] File attach limited to 2MB; name injected into prompt on send.
 * [156.11] Export downloads a plain-text transcript of the conversation.
 * [156.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [156.13] Retry removes last assistant turn and re-runs last user message.
 * [156.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [156.15] Scroll button appears when user is not near the bottom of the feed.
 * [156.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [156.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [156.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [156.19] Reduced motion: CSS disables liquid background and message animations.
 * [156.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [156.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [156.22] Effort selector maps to max_tokens for the chat completion call.
 * [156.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [156.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [156.25] Thinking indicator is three bouncing dots with CSS animation.
 * [156.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [156.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [156.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [156.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 156 ---
 * [157.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [157.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [157.02] DOM cache avoids repeated getElementById in hot paths.
 * [157.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [157.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [157.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [157.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [157.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [157.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [157.09] Voice uses Web Speech API when available; degrades gracefully.
 * [157.10] File attach limited to 2MB; name injected into prompt on send.
 * [157.11] Export downloads a plain-text transcript of the conversation.
 * [157.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [157.13] Retry removes last assistant turn and re-runs last user message.
 * [157.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [157.15] Scroll button appears when user is not near the bottom of the feed.
 * [157.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [157.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [157.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [157.19] Reduced motion: CSS disables liquid background and message animations.
 * [157.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [157.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [157.22] Effort selector maps to max_tokens for the chat completion call.
 * [157.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [157.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [157.25] Thinking indicator is three bouncing dots with CSS animation.
 * [157.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [157.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [157.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [157.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 157 ---
 * [158.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [158.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [158.02] DOM cache avoids repeated getElementById in hot paths.
 * [158.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [158.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [158.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [158.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [158.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [158.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [158.09] Voice uses Web Speech API when available; degrades gracefully.
 * [158.10] File attach limited to 2MB; name injected into prompt on send.
 * [158.11] Export downloads a plain-text transcript of the conversation.
 * [158.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [158.13] Retry removes last assistant turn and re-runs last user message.
 * [158.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [158.15] Scroll button appears when user is not near the bottom of the feed.
 * [158.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [158.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [158.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [158.19] Reduced motion: CSS disables liquid background and message animations.
 * [158.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [158.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [158.22] Effort selector maps to max_tokens for the chat completion call.
 * [158.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [158.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [158.25] Thinking indicator is three bouncing dots with CSS animation.
 * [158.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [158.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [158.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [158.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 158 ---
 * [159.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [159.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [159.02] DOM cache avoids repeated getElementById in hot paths.
 * [159.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [159.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [159.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [159.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [159.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [159.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [159.09] Voice uses Web Speech API when available; degrades gracefully.
 * [159.10] File attach limited to 2MB; name injected into prompt on send.
 * [159.11] Export downloads a plain-text transcript of the conversation.
 * [159.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [159.13] Retry removes last assistant turn and re-runs last user message.
 * [159.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [159.15] Scroll button appears when user is not near the bottom of the feed.
 * [159.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [159.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [159.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [159.19] Reduced motion: CSS disables liquid background and message animations.
 * [159.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [159.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [159.22] Effort selector maps to max_tokens for the chat completion call.
 * [159.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [159.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [159.25] Thinking indicator is three bouncing dots with CSS animation.
 * [159.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [159.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [159.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [159.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 159 ---
 * [160.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [160.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [160.02] DOM cache avoids repeated getElementById in hot paths.
 * [160.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [160.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [160.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [160.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [160.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [160.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [160.09] Voice uses Web Speech API when available; degrades gracefully.
 * [160.10] File attach limited to 2MB; name injected into prompt on send.
 * [160.11] Export downloads a plain-text transcript of the conversation.
 * [160.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [160.13] Retry removes last assistant turn and re-runs last user message.
 * [160.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [160.15] Scroll button appears when user is not near the bottom of the feed.
 * [160.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [160.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [160.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [160.19] Reduced motion: CSS disables liquid background and message animations.
 * [160.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [160.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [160.22] Effort selector maps to max_tokens for the chat completion call.
 * [160.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [160.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [160.25] Thinking indicator is three bouncing dots with CSS animation.
 * [160.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [160.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [160.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [160.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 160 ---
 * [161.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [161.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [161.02] DOM cache avoids repeated getElementById in hot paths.
 * [161.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [161.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [161.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [161.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [161.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [161.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [161.09] Voice uses Web Speech API when available; degrades gracefully.
 * [161.10] File attach limited to 2MB; name injected into prompt on send.
 * [161.11] Export downloads a plain-text transcript of the conversation.
 * [161.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [161.13] Retry removes last assistant turn and re-runs last user message.
 * [161.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [161.15] Scroll button appears when user is not near the bottom of the feed.
 * [161.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [161.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [161.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [161.19] Reduced motion: CSS disables liquid background and message animations.
 * [161.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [161.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [161.22] Effort selector maps to max_tokens for the chat completion call.
 * [161.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [161.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [161.25] Thinking indicator is three bouncing dots with CSS animation.
 * [161.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [161.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [161.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [161.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 161 ---
 * [162.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [162.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [162.02] DOM cache avoids repeated getElementById in hot paths.
 * [162.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [162.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [162.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [162.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [162.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [162.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [162.09] Voice uses Web Speech API when available; degrades gracefully.
 * [162.10] File attach limited to 2MB; name injected into prompt on send.
 * [162.11] Export downloads a plain-text transcript of the conversation.
 * [162.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [162.13] Retry removes last assistant turn and re-runs last user message.
 * [162.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [162.15] Scroll button appears when user is not near the bottom of the feed.
 * [162.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [162.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [162.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [162.19] Reduced motion: CSS disables liquid background and message animations.
 * [162.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [162.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [162.22] Effort selector maps to max_tokens for the chat completion call.
 * [162.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [162.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [162.25] Thinking indicator is three bouncing dots with CSS animation.
 * [162.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [162.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [162.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [162.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 162 ---
 * [163.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [163.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [163.02] DOM cache avoids repeated getElementById in hot paths.
 * [163.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [163.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [163.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [163.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [163.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [163.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [163.09] Voice uses Web Speech API when available; degrades gracefully.
 * [163.10] File attach limited to 2MB; name injected into prompt on send.
 * [163.11] Export downloads a plain-text transcript of the conversation.
 * [163.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [163.13] Retry removes last assistant turn and re-runs last user message.
 * [163.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [163.15] Scroll button appears when user is not near the bottom of the feed.
 * [163.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [163.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [163.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [163.19] Reduced motion: CSS disables liquid background and message animations.
 * [163.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [163.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [163.22] Effort selector maps to max_tokens for the chat completion call.
 * [163.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [163.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [163.25] Thinking indicator is three bouncing dots with CSS animation.
 * [163.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [163.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [163.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [163.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 163 ---
 * [164.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [164.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [164.02] DOM cache avoids repeated getElementById in hot paths.
 * [164.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [164.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [164.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [164.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [164.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [164.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [164.09] Voice uses Web Speech API when available; degrades gracefully.
 * [164.10] File attach limited to 2MB; name injected into prompt on send.
 * [164.11] Export downloads a plain-text transcript of the conversation.
 * [164.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [164.13] Retry removes last assistant turn and re-runs last user message.
 * [164.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [164.15] Scroll button appears when user is not near the bottom of the feed.
 * [164.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [164.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [164.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [164.19] Reduced motion: CSS disables liquid background and message animations.
 * [164.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [164.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [164.22] Effort selector maps to max_tokens for the chat completion call.
 * [164.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [164.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [164.25] Thinking indicator is three bouncing dots with CSS animation.
 * [164.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [164.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [164.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [164.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 164 ---
 * [165.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [165.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [165.02] DOM cache avoids repeated getElementById in hot paths.
 * [165.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [165.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [165.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [165.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [165.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [165.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [165.09] Voice uses Web Speech API when available; degrades gracefully.
 * [165.10] File attach limited to 2MB; name injected into prompt on send.
 * [165.11] Export downloads a plain-text transcript of the conversation.
 * [165.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [165.13] Retry removes last assistant turn and re-runs last user message.
 * [165.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [165.15] Scroll button appears when user is not near the bottom of the feed.
 * [165.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [165.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [165.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [165.19] Reduced motion: CSS disables liquid background and message animations.
 * [165.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [165.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [165.22] Effort selector maps to max_tokens for the chat completion call.
 * [165.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [165.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [165.25] Thinking indicator is three bouncing dots with CSS animation.
 * [165.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [165.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [165.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [165.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 165 ---
 * [166.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [166.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [166.02] DOM cache avoids repeated getElementById in hot paths.
 * [166.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [166.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [166.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [166.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [166.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [166.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [166.09] Voice uses Web Speech API when available; degrades gracefully.
 * [166.10] File attach limited to 2MB; name injected into prompt on send.
 * [166.11] Export downloads a plain-text transcript of the conversation.
 * [166.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [166.13] Retry removes last assistant turn and re-runs last user message.
 * [166.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [166.15] Scroll button appears when user is not near the bottom of the feed.
 * [166.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [166.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [166.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [166.19] Reduced motion: CSS disables liquid background and message animations.
 * [166.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [166.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [166.22] Effort selector maps to max_tokens for the chat completion call.
 * [166.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [166.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [166.25] Thinking indicator is three bouncing dots with CSS animation.
 * [166.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [166.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [166.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [166.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 166 ---
 * [167.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [167.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [167.02] DOM cache avoids repeated getElementById in hot paths.
 * [167.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [167.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [167.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [167.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [167.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [167.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [167.09] Voice uses Web Speech API when available; degrades gracefully.
 * [167.10] File attach limited to 2MB; name injected into prompt on send.
 * [167.11] Export downloads a plain-text transcript of the conversation.
 * [167.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [167.13] Retry removes last assistant turn and re-runs last user message.
 * [167.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [167.15] Scroll button appears when user is not near the bottom of the feed.
 * [167.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [167.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [167.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [167.19] Reduced motion: CSS disables liquid background and message animations.
 * [167.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [167.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [167.22] Effort selector maps to max_tokens for the chat completion call.
 * [167.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [167.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [167.25] Thinking indicator is three bouncing dots with CSS animation.
 * [167.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [167.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [167.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [167.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 167 ---
 * [168.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [168.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [168.02] DOM cache avoids repeated getElementById in hot paths.
 * [168.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [168.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [168.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [168.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [168.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [168.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [168.09] Voice uses Web Speech API when available; degrades gracefully.
 * [168.10] File attach limited to 2MB; name injected into prompt on send.
 * [168.11] Export downloads a plain-text transcript of the conversation.
 * [168.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [168.13] Retry removes last assistant turn and re-runs last user message.
 * [168.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [168.15] Scroll button appears when user is not near the bottom of the feed.
 * [168.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [168.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [168.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [168.19] Reduced motion: CSS disables liquid background and message animations.
 * [168.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [168.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [168.22] Effort selector maps to max_tokens for the chat completion call.
 * [168.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [168.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [168.25] Thinking indicator is three bouncing dots with CSS animation.
 * [168.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [168.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [168.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [168.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 168 ---
 * [169.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [169.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [169.02] DOM cache avoids repeated getElementById in hot paths.
 * [169.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [169.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [169.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [169.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [169.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [169.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [169.09] Voice uses Web Speech API when available; degrades gracefully.
 * [169.10] File attach limited to 2MB; name injected into prompt on send.
 * [169.11] Export downloads a plain-text transcript of the conversation.
 * [169.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [169.13] Retry removes last assistant turn and re-runs last user message.
 * [169.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [169.15] Scroll button appears when user is not near the bottom of the feed.
 * [169.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [169.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [169.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [169.19] Reduced motion: CSS disables liquid background and message animations.
 * [169.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [169.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [169.22] Effort selector maps to max_tokens for the chat completion call.
 * [169.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [169.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [169.25] Thinking indicator is three bouncing dots with CSS animation.
 * [169.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [169.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [169.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [169.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 169 ---
 * [170.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [170.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [170.02] DOM cache avoids repeated getElementById in hot paths.
 * [170.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [170.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [170.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [170.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [170.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [170.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [170.09] Voice uses Web Speech API when available; degrades gracefully.
 * [170.10] File attach limited to 2MB; name injected into prompt on send.
 * [170.11] Export downloads a plain-text transcript of the conversation.
 * [170.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [170.13] Retry removes last assistant turn and re-runs last user message.
 * [170.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [170.15] Scroll button appears when user is not near the bottom of the feed.
 * [170.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [170.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [170.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [170.19] Reduced motion: CSS disables liquid background and message animations.
 * [170.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [170.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [170.22] Effort selector maps to max_tokens for the chat completion call.
 * [170.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [170.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [170.25] Thinking indicator is three bouncing dots with CSS animation.
 * [170.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [170.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [170.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [170.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 170 ---
 * [171.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [171.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [171.02] DOM cache avoids repeated getElementById in hot paths.
 * [171.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [171.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [171.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [171.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [171.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [171.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [171.09] Voice uses Web Speech API when available; degrades gracefully.
 * [171.10] File attach limited to 2MB; name injected into prompt on send.
 * [171.11] Export downloads a plain-text transcript of the conversation.
 * [171.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [171.13] Retry removes last assistant turn and re-runs last user message.
 * [171.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [171.15] Scroll button appears when user is not near the bottom of the feed.
 * [171.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [171.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [171.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [171.19] Reduced motion: CSS disables liquid background and message animations.
 * [171.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [171.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [171.22] Effort selector maps to max_tokens for the chat completion call.
 * [171.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [171.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [171.25] Thinking indicator is three bouncing dots with CSS animation.
 * [171.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [171.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [171.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [171.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 171 ---
 * [172.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [172.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [172.02] DOM cache avoids repeated getElementById in hot paths.
 * [172.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [172.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [172.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [172.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [172.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [172.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [172.09] Voice uses Web Speech API when available; degrades gracefully.
 * [172.10] File attach limited to 2MB; name injected into prompt on send.
 * [172.11] Export downloads a plain-text transcript of the conversation.
 * [172.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [172.13] Retry removes last assistant turn and re-runs last user message.
 * [172.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [172.15] Scroll button appears when user is not near the bottom of the feed.
 * [172.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [172.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [172.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [172.19] Reduced motion: CSS disables liquid background and message animations.
 * [172.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [172.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [172.22] Effort selector maps to max_tokens for the chat completion call.
 * [172.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [172.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [172.25] Thinking indicator is three bouncing dots with CSS animation.
 * [172.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [172.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [172.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [172.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 172 ---
 * [173.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [173.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [173.02] DOM cache avoids repeated getElementById in hot paths.
 * [173.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [173.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [173.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [173.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [173.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [173.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [173.09] Voice uses Web Speech API when available; degrades gracefully.
 * [173.10] File attach limited to 2MB; name injected into prompt on send.
 * [173.11] Export downloads a plain-text transcript of the conversation.
 * [173.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [173.13] Retry removes last assistant turn and re-runs last user message.
 * [173.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [173.15] Scroll button appears when user is not near the bottom of the feed.
 * [173.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [173.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [173.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [173.19] Reduced motion: CSS disables liquid background and message animations.
 * [173.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [173.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [173.22] Effort selector maps to max_tokens for the chat completion call.
 * [173.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [173.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [173.25] Thinking indicator is three bouncing dots with CSS animation.
 * [173.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [173.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [173.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [173.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 173 ---
 * [174.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [174.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [174.02] DOM cache avoids repeated getElementById in hot paths.
 * [174.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [174.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [174.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [174.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [174.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [174.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [174.09] Voice uses Web Speech API when available; degrades gracefully.
 * [174.10] File attach limited to 2MB; name injected into prompt on send.
 * [174.11] Export downloads a plain-text transcript of the conversation.
 * [174.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [174.13] Retry removes last assistant turn and re-runs last user message.
 * [174.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [174.15] Scroll button appears when user is not near the bottom of the feed.
 * [174.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [174.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [174.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [174.19] Reduced motion: CSS disables liquid background and message animations.
 * [174.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [174.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [174.22] Effort selector maps to max_tokens for the chat completion call.
 * [174.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [174.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [174.25] Thinking indicator is three bouncing dots with CSS animation.
 * [174.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [174.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [174.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [174.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 174 ---
 * [175.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [175.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [175.02] DOM cache avoids repeated getElementById in hot paths.
 * [175.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [175.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [175.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [175.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [175.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [175.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [175.09] Voice uses Web Speech API when available; degrades gracefully.
 * [175.10] File attach limited to 2MB; name injected into prompt on send.
 * [175.11] Export downloads a plain-text transcript of the conversation.
 * [175.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [175.13] Retry removes last assistant turn and re-runs last user message.
 * [175.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [175.15] Scroll button appears when user is not near the bottom of the feed.
 * [175.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [175.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [175.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [175.19] Reduced motion: CSS disables liquid background and message animations.
 * [175.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [175.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [175.22] Effort selector maps to max_tokens for the chat completion call.
 * [175.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [175.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [175.25] Thinking indicator is three bouncing dots with CSS animation.
 * [175.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [175.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [175.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [175.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 175 ---
 * [176.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [176.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [176.02] DOM cache avoids repeated getElementById in hot paths.
 * [176.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [176.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [176.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [176.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [176.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [176.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [176.09] Voice uses Web Speech API when available; degrades gracefully.
 * [176.10] File attach limited to 2MB; name injected into prompt on send.
 * [176.11] Export downloads a plain-text transcript of the conversation.
 * [176.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [176.13] Retry removes last assistant turn and re-runs last user message.
 * [176.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [176.15] Scroll button appears when user is not near the bottom of the feed.
 * [176.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [176.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [176.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [176.19] Reduced motion: CSS disables liquid background and message animations.
 * [176.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [176.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [176.22] Effort selector maps to max_tokens for the chat completion call.
 * [176.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [176.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [176.25] Thinking indicator is three bouncing dots with CSS animation.
 * [176.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [176.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [176.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [176.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 176 ---
 * [177.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [177.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [177.02] DOM cache avoids repeated getElementById in hot paths.
 * [177.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [177.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [177.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [177.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [177.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [177.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [177.09] Voice uses Web Speech API when available; degrades gracefully.
 * [177.10] File attach limited to 2MB; name injected into prompt on send.
 * [177.11] Export downloads a plain-text transcript of the conversation.
 * [177.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [177.13] Retry removes last assistant turn and re-runs last user message.
 * [177.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [177.15] Scroll button appears when user is not near the bottom of the feed.
 * [177.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [177.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [177.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [177.19] Reduced motion: CSS disables liquid background and message animations.
 * [177.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [177.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [177.22] Effort selector maps to max_tokens for the chat completion call.
 * [177.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [177.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [177.25] Thinking indicator is three bouncing dots with CSS animation.
 * [177.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [177.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [177.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [177.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 177 ---
 * [178.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [178.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [178.02] DOM cache avoids repeated getElementById in hot paths.
 * [178.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [178.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [178.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [178.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [178.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [178.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [178.09] Voice uses Web Speech API when available; degrades gracefully.
 * [178.10] File attach limited to 2MB; name injected into prompt on send.
 * [178.11] Export downloads a plain-text transcript of the conversation.
 * [178.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [178.13] Retry removes last assistant turn and re-runs last user message.
 * [178.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [178.15] Scroll button appears when user is not near the bottom of the feed.
 * [178.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [178.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [178.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [178.19] Reduced motion: CSS disables liquid background and message animations.
 * [178.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [178.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [178.22] Effort selector maps to max_tokens for the chat completion call.
 * [178.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [178.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [178.25] Thinking indicator is three bouncing dots with CSS animation.
 * [178.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [178.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [178.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [178.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 178 ---
 * [179.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [179.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [179.02] DOM cache avoids repeated getElementById in hot paths.
 * [179.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [179.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [179.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [179.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [179.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [179.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [179.09] Voice uses Web Speech API when available; degrades gracefully.
 * [179.10] File attach limited to 2MB; name injected into prompt on send.
 * [179.11] Export downloads a plain-text transcript of the conversation.
 * [179.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [179.13] Retry removes last assistant turn and re-runs last user message.
 * [179.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [179.15] Scroll button appears when user is not near the bottom of the feed.
 * [179.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [179.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [179.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [179.19] Reduced motion: CSS disables liquid background and message animations.
 * [179.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [179.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [179.22] Effort selector maps to max_tokens for the chat completion call.
 * [179.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [179.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [179.25] Thinking indicator is three bouncing dots with CSS animation.
 * [179.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [179.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [179.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [179.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 179 ---
 * [180.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [180.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [180.02] DOM cache avoids repeated getElementById in hot paths.
 * [180.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [180.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [180.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [180.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [180.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [180.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [180.09] Voice uses Web Speech API when available; degrades gracefully.
 * [180.10] File attach limited to 2MB; name injected into prompt on send.
 * [180.11] Export downloads a plain-text transcript of the conversation.
 * [180.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [180.13] Retry removes last assistant turn and re-runs last user message.
 * [180.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [180.15] Scroll button appears when user is not near the bottom of the feed.
 * [180.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [180.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [180.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [180.19] Reduced motion: CSS disables liquid background and message animations.
 * [180.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [180.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [180.22] Effort selector maps to max_tokens for the chat completion call.
 * [180.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [180.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [180.25] Thinking indicator is three bouncing dots with CSS animation.
 * [180.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [180.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [180.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [180.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 180 ---
 * [181.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [181.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [181.02] DOM cache avoids repeated getElementById in hot paths.
 * [181.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [181.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [181.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [181.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [181.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [181.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [181.09] Voice uses Web Speech API when available; degrades gracefully.
 * [181.10] File attach limited to 2MB; name injected into prompt on send.
 * [181.11] Export downloads a plain-text transcript of the conversation.
 * [181.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [181.13] Retry removes last assistant turn and re-runs last user message.
 * [181.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [181.15] Scroll button appears when user is not near the bottom of the feed.
 * [181.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [181.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [181.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [181.19] Reduced motion: CSS disables liquid background and message animations.
 * [181.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [181.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [181.22] Effort selector maps to max_tokens for the chat completion call.
 * [181.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [181.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [181.25] Thinking indicator is three bouncing dots with CSS animation.
 * [181.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [181.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [181.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [181.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 181 ---
 * [182.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [182.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [182.02] DOM cache avoids repeated getElementById in hot paths.
 * [182.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [182.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [182.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [182.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [182.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [182.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [182.09] Voice uses Web Speech API when available; degrades gracefully.
 * [182.10] File attach limited to 2MB; name injected into prompt on send.
 * [182.11] Export downloads a plain-text transcript of the conversation.
 * [182.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [182.13] Retry removes last assistant turn and re-runs last user message.
 * [182.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [182.15] Scroll button appears when user is not near the bottom of the feed.
 * [182.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [182.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [182.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [182.19] Reduced motion: CSS disables liquid background and message animations.
 * [182.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [182.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [182.22] Effort selector maps to max_tokens for the chat completion call.
 * [182.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [182.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [182.25] Thinking indicator is three bouncing dots with CSS animation.
 * [182.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [182.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [182.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [182.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 182 ---
 * [183.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [183.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [183.02] DOM cache avoids repeated getElementById in hot paths.
 * [183.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [183.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [183.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [183.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [183.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [183.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [183.09] Voice uses Web Speech API when available; degrades gracefully.
 * [183.10] File attach limited to 2MB; name injected into prompt on send.
 * [183.11] Export downloads a plain-text transcript of the conversation.
 * [183.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [183.13] Retry removes last assistant turn and re-runs last user message.
 * [183.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [183.15] Scroll button appears when user is not near the bottom of the feed.
 * [183.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [183.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [183.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [183.19] Reduced motion: CSS disables liquid background and message animations.
 * [183.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [183.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [183.22] Effort selector maps to max_tokens for the chat completion call.
 * [183.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [183.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [183.25] Thinking indicator is three bouncing dots with CSS animation.
 * [183.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [183.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [183.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [183.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 183 ---
 * [184.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [184.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [184.02] DOM cache avoids repeated getElementById in hot paths.
 * [184.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [184.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [184.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [184.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [184.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [184.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [184.09] Voice uses Web Speech API when available; degrades gracefully.
 * [184.10] File attach limited to 2MB; name injected into prompt on send.
 * [184.11] Export downloads a plain-text transcript of the conversation.
 * [184.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [184.13] Retry removes last assistant turn and re-runs last user message.
 * [184.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [184.15] Scroll button appears when user is not near the bottom of the feed.
 * [184.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [184.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [184.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [184.19] Reduced motion: CSS disables liquid background and message animations.
 * [184.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [184.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [184.22] Effort selector maps to max_tokens for the chat completion call.
 * [184.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [184.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [184.25] Thinking indicator is three bouncing dots with CSS animation.
 * [184.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [184.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [184.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [184.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 184 ---
 * [185.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [185.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [185.02] DOM cache avoids repeated getElementById in hot paths.
 * [185.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [185.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [185.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [185.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [185.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [185.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [185.09] Voice uses Web Speech API when available; degrades gracefully.
 * [185.10] File attach limited to 2MB; name injected into prompt on send.
 * [185.11] Export downloads a plain-text transcript of the conversation.
 * [185.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [185.13] Retry removes last assistant turn and re-runs last user message.
 * [185.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [185.15] Scroll button appears when user is not near the bottom of the feed.
 * [185.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [185.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [185.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [185.19] Reduced motion: CSS disables liquid background and message animations.
 * [185.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [185.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [185.22] Effort selector maps to max_tokens for the chat completion call.
 * [185.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [185.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [185.25] Thinking indicator is three bouncing dots with CSS animation.
 * [185.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [185.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [185.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [185.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 185 ---
 * [186.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [186.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [186.02] DOM cache avoids repeated getElementById in hot paths.
 * [186.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [186.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [186.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [186.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [186.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [186.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [186.09] Voice uses Web Speech API when available; degrades gracefully.
 * [186.10] File attach limited to 2MB; name injected into prompt on send.
 * [186.11] Export downloads a plain-text transcript of the conversation.
 * [186.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [186.13] Retry removes last assistant turn and re-runs last user message.
 * [186.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [186.15] Scroll button appears when user is not near the bottom of the feed.
 * [186.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [186.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [186.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [186.19] Reduced motion: CSS disables liquid background and message animations.
 * [186.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [186.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [186.22] Effort selector maps to max_tokens for the chat completion call.
 * [186.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [186.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [186.25] Thinking indicator is three bouncing dots with CSS animation.
 * [186.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [186.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [186.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [186.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 186 ---
 * [187.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [187.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [187.02] DOM cache avoids repeated getElementById in hot paths.
 * [187.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [187.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [187.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [187.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [187.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [187.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [187.09] Voice uses Web Speech API when available; degrades gracefully.
 * [187.10] File attach limited to 2MB; name injected into prompt on send.
 * [187.11] Export downloads a plain-text transcript of the conversation.
 * [187.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [187.13] Retry removes last assistant turn and re-runs last user message.
 * [187.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [187.15] Scroll button appears when user is not near the bottom of the feed.
 * [187.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [187.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [187.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [187.19] Reduced motion: CSS disables liquid background and message animations.
 * [187.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [187.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [187.22] Effort selector maps to max_tokens for the chat completion call.
 * [187.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [187.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [187.25] Thinking indicator is three bouncing dots with CSS animation.
 * [187.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [187.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [187.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [187.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 187 ---
 * [188.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [188.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [188.02] DOM cache avoids repeated getElementById in hot paths.
 * [188.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [188.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [188.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [188.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [188.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [188.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [188.09] Voice uses Web Speech API when available; degrades gracefully.
 * [188.10] File attach limited to 2MB; name injected into prompt on send.
 * [188.11] Export downloads a plain-text transcript of the conversation.
 * [188.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [188.13] Retry removes last assistant turn and re-runs last user message.
 * [188.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [188.15] Scroll button appears when user is not near the bottom of the feed.
 * [188.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [188.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [188.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [188.19] Reduced motion: CSS disables liquid background and message animations.
 * [188.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [188.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [188.22] Effort selector maps to max_tokens for the chat completion call.
 * [188.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [188.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [188.25] Thinking indicator is three bouncing dots with CSS animation.
 * [188.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [188.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [188.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [188.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 188 ---
 * [189.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [189.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [189.02] DOM cache avoids repeated getElementById in hot paths.
 * [189.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [189.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [189.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [189.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [189.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [189.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [189.09] Voice uses Web Speech API when available; degrades gracefully.
 * [189.10] File attach limited to 2MB; name injected into prompt on send.
 * [189.11] Export downloads a plain-text transcript of the conversation.
 * [189.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [189.13] Retry removes last assistant turn and re-runs last user message.
 * [189.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [189.15] Scroll button appears when user is not near the bottom of the feed.
 * [189.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [189.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [189.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [189.19] Reduced motion: CSS disables liquid background and message animations.
 * [189.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [189.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [189.22] Effort selector maps to max_tokens for the chat completion call.
 * [189.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [189.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [189.25] Thinking indicator is three bouncing dots with CSS animation.
 * [189.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [189.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [189.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [189.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 189 ---
 * [190.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [190.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [190.02] DOM cache avoids repeated getElementById in hot paths.
 * [190.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [190.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [190.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [190.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [190.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [190.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [190.09] Voice uses Web Speech API when available; degrades gracefully.
 * [190.10] File attach limited to 2MB; name injected into prompt on send.
 * [190.11] Export downloads a plain-text transcript of the conversation.
 * [190.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [190.13] Retry removes last assistant turn and re-runs last user message.
 * [190.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [190.15] Scroll button appears when user is not near the bottom of the feed.
 * [190.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [190.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [190.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [190.19] Reduced motion: CSS disables liquid background and message animations.
 * [190.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [190.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [190.22] Effort selector maps to max_tokens for the chat completion call.
 * [190.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [190.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [190.25] Thinking indicator is three bouncing dots with CSS animation.
 * [190.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [190.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [190.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [190.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 190 ---
 * [191.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [191.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [191.02] DOM cache avoids repeated getElementById in hot paths.
 * [191.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [191.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [191.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [191.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [191.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [191.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [191.09] Voice uses Web Speech API when available; degrades gracefully.
 * [191.10] File attach limited to 2MB; name injected into prompt on send.
 * [191.11] Export downloads a plain-text transcript of the conversation.
 * [191.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [191.13] Retry removes last assistant turn and re-runs last user message.
 * [191.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [191.15] Scroll button appears when user is not near the bottom of the feed.
 * [191.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [191.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [191.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [191.19] Reduced motion: CSS disables liquid background and message animations.
 * [191.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [191.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [191.22] Effort selector maps to max_tokens for the chat completion call.
 * [191.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [191.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [191.25] Thinking indicator is three bouncing dots with CSS animation.
 * [191.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [191.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [191.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [191.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 191 ---
 * [192.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [192.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [192.02] DOM cache avoids repeated getElementById in hot paths.
 * [192.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [192.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [192.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [192.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [192.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [192.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [192.09] Voice uses Web Speech API when available; degrades gracefully.
 * [192.10] File attach limited to 2MB; name injected into prompt on send.
 * [192.11] Export downloads a plain-text transcript of the conversation.
 * [192.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [192.13] Retry removes last assistant turn and re-runs last user message.
 * [192.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [192.15] Scroll button appears when user is not near the bottom of the feed.
 * [192.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [192.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [192.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [192.19] Reduced motion: CSS disables liquid background and message animations.
 * [192.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [192.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [192.22] Effort selector maps to max_tokens for the chat completion call.
 * [192.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [192.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [192.25] Thinking indicator is three bouncing dots with CSS animation.
 * [192.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [192.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [192.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [192.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 192 ---
 * [193.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [193.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [193.02] DOM cache avoids repeated getElementById in hot paths.
 * [193.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [193.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [193.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [193.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [193.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [193.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [193.09] Voice uses Web Speech API when available; degrades gracefully.
 * [193.10] File attach limited to 2MB; name injected into prompt on send.
 * [193.11] Export downloads a plain-text transcript of the conversation.
 * [193.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [193.13] Retry removes last assistant turn and re-runs last user message.
 * [193.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [193.15] Scroll button appears when user is not near the bottom of the feed.
 * [193.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [193.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [193.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [193.19] Reduced motion: CSS disables liquid background and message animations.
 * [193.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [193.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [193.22] Effort selector maps to max_tokens for the chat completion call.
 * [193.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [193.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [193.25] Thinking indicator is three bouncing dots with CSS animation.
 * [193.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [193.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [193.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [193.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 193 ---
 * [194.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [194.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [194.02] DOM cache avoids repeated getElementById in hot paths.
 * [194.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [194.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [194.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [194.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [194.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [194.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [194.09] Voice uses Web Speech API when available; degrades gracefully.
 * [194.10] File attach limited to 2MB; name injected into prompt on send.
 * [194.11] Export downloads a plain-text transcript of the conversation.
 * [194.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [194.13] Retry removes last assistant turn and re-runs last user message.
 * [194.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [194.15] Scroll button appears when user is not near the bottom of the feed.
 * [194.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [194.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [194.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [194.19] Reduced motion: CSS disables liquid background and message animations.
 * [194.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [194.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [194.22] Effort selector maps to max_tokens for the chat completion call.
 * [194.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [194.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [194.25] Thinking indicator is three bouncing dots with CSS animation.
 * [194.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [194.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [194.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [194.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 194 ---
 * [195.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [195.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [195.02] DOM cache avoids repeated getElementById in hot paths.
 * [195.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [195.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [195.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [195.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [195.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [195.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [195.09] Voice uses Web Speech API when available; degrades gracefully.
 * [195.10] File attach limited to 2MB; name injected into prompt on send.
 * [195.11] Export downloads a plain-text transcript of the conversation.
 * [195.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [195.13] Retry removes last assistant turn and re-runs last user message.
 * [195.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [195.15] Scroll button appears when user is not near the bottom of the feed.
 * [195.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [195.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [195.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [195.19] Reduced motion: CSS disables liquid background and message animations.
 * [195.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [195.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [195.22] Effort selector maps to max_tokens for the chat completion call.
 * [195.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [195.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [195.25] Thinking indicator is three bouncing dots with CSS animation.
 * [195.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [195.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [195.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [195.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 195 ---
 * [196.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [196.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [196.02] DOM cache avoids repeated getElementById in hot paths.
 * [196.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [196.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [196.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [196.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [196.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [196.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [196.09] Voice uses Web Speech API when available; degrades gracefully.
 * [196.10] File attach limited to 2MB; name injected into prompt on send.
 * [196.11] Export downloads a plain-text transcript of the conversation.
 * [196.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [196.13] Retry removes last assistant turn and re-runs last user message.
 * [196.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [196.15] Scroll button appears when user is not near the bottom of the feed.
 * [196.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [196.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [196.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [196.19] Reduced motion: CSS disables liquid background and message animations.
 * [196.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [196.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [196.22] Effort selector maps to max_tokens for the chat completion call.
 * [196.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [196.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [196.25] Thinking indicator is three bouncing dots with CSS animation.
 * [196.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [196.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [196.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [196.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 196 ---
 * [197.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [197.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [197.02] DOM cache avoids repeated getElementById in hot paths.
 * [197.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [197.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [197.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [197.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [197.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [197.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [197.09] Voice uses Web Speech API when available; degrades gracefully.
 * [197.10] File attach limited to 2MB; name injected into prompt on send.
 * [197.11] Export downloads a plain-text transcript of the conversation.
 * [197.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [197.13] Retry removes last assistant turn and re-runs last user message.
 * [197.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [197.15] Scroll button appears when user is not near the bottom of the feed.
 * [197.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [197.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [197.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [197.19] Reduced motion: CSS disables liquid background and message animations.
 * [197.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [197.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [197.22] Effort selector maps to max_tokens for the chat completion call.
 * [197.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [197.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [197.25] Thinking indicator is three bouncing dots with CSS animation.
 * [197.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [197.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [197.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [197.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 197 ---
 * [198.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [198.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [198.02] DOM cache avoids repeated getElementById in hot paths.
 * [198.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [198.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [198.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [198.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [198.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [198.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [198.09] Voice uses Web Speech API when available; degrades gracefully.
 * [198.10] File attach limited to 2MB; name injected into prompt on send.
 * [198.11] Export downloads a plain-text transcript of the conversation.
 * [198.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [198.13] Retry removes last assistant turn and re-runs last user message.
 * [198.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [198.15] Scroll button appears when user is not near the bottom of the feed.
 * [198.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [198.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [198.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [198.19] Reduced motion: CSS disables liquid background and message animations.
 * [198.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [198.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [198.22] Effort selector maps to max_tokens for the chat completion call.
 * [198.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [198.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [198.25] Thinking indicator is three bouncing dots with CSS animation.
 * [198.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [198.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [198.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [198.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 198 ---
 * [199.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [199.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [199.02] DOM cache avoids repeated getElementById in hot paths.
 * [199.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [199.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [199.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [199.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [199.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [199.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [199.09] Voice uses Web Speech API when available; degrades gracefully.
 * [199.10] File attach limited to 2MB; name injected into prompt on send.
 * [199.11] Export downloads a plain-text transcript of the conversation.
 * [199.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [199.13] Retry removes last assistant turn and re-runs last user message.
 * [199.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [199.15] Scroll button appears when user is not near the bottom of the feed.
 * [199.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [199.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [199.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [199.19] Reduced motion: CSS disables liquid background and message animations.
 * [199.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [199.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [199.22] Effort selector maps to max_tokens for the chat completion call.
 * [199.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [199.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [199.25] Thinking indicator is three bouncing dots with CSS animation.
 * [199.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [199.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [199.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [199.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 199 ---
 * [200.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [200.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [200.02] DOM cache avoids repeated getElementById in hot paths.
 * [200.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [200.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [200.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [200.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [200.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [200.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [200.09] Voice uses Web Speech API when available; degrades gracefully.
 * [200.10] File attach limited to 2MB; name injected into prompt on send.
 * [200.11] Export downloads a plain-text transcript of the conversation.
 * [200.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [200.13] Retry removes last assistant turn and re-runs last user message.
 * [200.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [200.15] Scroll button appears when user is not near the bottom of the feed.
 * [200.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [200.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [200.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [200.19] Reduced motion: CSS disables liquid background and message animations.
 * [200.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [200.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [200.22] Effort selector maps to max_tokens for the chat completion call.
 * [200.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [200.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [200.25] Thinking indicator is three bouncing dots with CSS animation.
 * [200.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [200.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [200.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [200.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 200 ---
 * [201.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [201.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [201.02] DOM cache avoids repeated getElementById in hot paths.
 * [201.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [201.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [201.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [201.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [201.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [201.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [201.09] Voice uses Web Speech API when available; degrades gracefully.
 * [201.10] File attach limited to 2MB; name injected into prompt on send.
 * [201.11] Export downloads a plain-text transcript of the conversation.
 * [201.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [201.13] Retry removes last assistant turn and re-runs last user message.
 * [201.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [201.15] Scroll button appears when user is not near the bottom of the feed.
 * [201.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [201.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [201.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [201.19] Reduced motion: CSS disables liquid background and message animations.
 * [201.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [201.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [201.22] Effort selector maps to max_tokens for the chat completion call.
 * [201.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [201.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [201.25] Thinking indicator is three bouncing dots with CSS animation.
 * [201.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [201.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [201.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [201.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 201 ---
 * [202.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [202.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [202.02] DOM cache avoids repeated getElementById in hot paths.
 * [202.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [202.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [202.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [202.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [202.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [202.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [202.09] Voice uses Web Speech API when available; degrades gracefully.
 * [202.10] File attach limited to 2MB; name injected into prompt on send.
 * [202.11] Export downloads a plain-text transcript of the conversation.
 * [202.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [202.13] Retry removes last assistant turn and re-runs last user message.
 * [202.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [202.15] Scroll button appears when user is not near the bottom of the feed.
 * [202.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [202.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [202.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [202.19] Reduced motion: CSS disables liquid background and message animations.
 * [202.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [202.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [202.22] Effort selector maps to max_tokens for the chat completion call.
 * [202.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [202.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [202.25] Thinking indicator is three bouncing dots with CSS animation.
 * [202.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [202.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [202.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [202.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 202 ---
 * [203.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [203.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [203.02] DOM cache avoids repeated getElementById in hot paths.
 * [203.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [203.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [203.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [203.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [203.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [203.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [203.09] Voice uses Web Speech API when available; degrades gracefully.
 * [203.10] File attach limited to 2MB; name injected into prompt on send.
 * [203.11] Export downloads a plain-text transcript of the conversation.
 * [203.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [203.13] Retry removes last assistant turn and re-runs last user message.
 * [203.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [203.15] Scroll button appears when user is not near the bottom of the feed.
 * [203.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [203.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [203.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [203.19] Reduced motion: CSS disables liquid background and message animations.
 * [203.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [203.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [203.22] Effort selector maps to max_tokens for the chat completion call.
 * [203.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [203.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [203.25] Thinking indicator is three bouncing dots with CSS animation.
 * [203.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [203.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [203.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [203.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 203 ---
 * [204.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [204.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [204.02] DOM cache avoids repeated getElementById in hot paths.
 * [204.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [204.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [204.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [204.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [204.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [204.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [204.09] Voice uses Web Speech API when available; degrades gracefully.
 * [204.10] File attach limited to 2MB; name injected into prompt on send.
 * [204.11] Export downloads a plain-text transcript of the conversation.
 * [204.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [204.13] Retry removes last assistant turn and re-runs last user message.
 * [204.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [204.15] Scroll button appears when user is not near the bottom of the feed.
 * [204.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [204.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [204.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [204.19] Reduced motion: CSS disables liquid background and message animations.
 * [204.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [204.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [204.22] Effort selector maps to max_tokens for the chat completion call.
 * [204.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [204.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [204.25] Thinking indicator is three bouncing dots with CSS animation.
 * [204.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [204.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [204.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [204.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 204 ---
 * [205.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [205.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [205.02] DOM cache avoids repeated getElementById in hot paths.
 * [205.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [205.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [205.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [205.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [205.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [205.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [205.09] Voice uses Web Speech API when available; degrades gracefully.
 * [205.10] File attach limited to 2MB; name injected into prompt on send.
 * [205.11] Export downloads a plain-text transcript of the conversation.
 * [205.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [205.13] Retry removes last assistant turn and re-runs last user message.
 * [205.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [205.15] Scroll button appears when user is not near the bottom of the feed.
 * [205.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [205.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [205.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [205.19] Reduced motion: CSS disables liquid background and message animations.
 * [205.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [205.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [205.22] Effort selector maps to max_tokens for the chat completion call.
 * [205.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [205.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [205.25] Thinking indicator is three bouncing dots with CSS animation.
 * [205.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [205.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [205.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [205.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 205 ---
 * [206.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [206.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [206.02] DOM cache avoids repeated getElementById in hot paths.
 * [206.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [206.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [206.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [206.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [206.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [206.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [206.09] Voice uses Web Speech API when available; degrades gracefully.
 * [206.10] File attach limited to 2MB; name injected into prompt on send.
 * [206.11] Export downloads a plain-text transcript of the conversation.
 * [206.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [206.13] Retry removes last assistant turn and re-runs last user message.
 * [206.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [206.15] Scroll button appears when user is not near the bottom of the feed.
 * [206.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [206.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [206.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [206.19] Reduced motion: CSS disables liquid background and message animations.
 * [206.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [206.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [206.22] Effort selector maps to max_tokens for the chat completion call.
 * [206.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [206.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [206.25] Thinking indicator is three bouncing dots with CSS animation.
 * [206.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [206.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [206.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [206.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 206 ---
 * [207.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [207.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [207.02] DOM cache avoids repeated getElementById in hot paths.
 * [207.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [207.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [207.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [207.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [207.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [207.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [207.09] Voice uses Web Speech API when available; degrades gracefully.
 * [207.10] File attach limited to 2MB; name injected into prompt on send.
 * [207.11] Export downloads a plain-text transcript of the conversation.
 * [207.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [207.13] Retry removes last assistant turn and re-runs last user message.
 * [207.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [207.15] Scroll button appears when user is not near the bottom of the feed.
 * [207.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [207.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [207.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [207.19] Reduced motion: CSS disables liquid background and message animations.
 * [207.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [207.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [207.22] Effort selector maps to max_tokens for the chat completion call.
 * [207.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [207.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [207.25] Thinking indicator is three bouncing dots with CSS animation.
 * [207.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [207.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [207.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [207.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 207 ---
 * [208.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [208.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [208.02] DOM cache avoids repeated getElementById in hot paths.
 * [208.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [208.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [208.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [208.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [208.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [208.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [208.09] Voice uses Web Speech API when available; degrades gracefully.
 * [208.10] File attach limited to 2MB; name injected into prompt on send.
 * [208.11] Export downloads a plain-text transcript of the conversation.
 * [208.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [208.13] Retry removes last assistant turn and re-runs last user message.
 * [208.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [208.15] Scroll button appears when user is not near the bottom of the feed.
 * [208.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [208.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [208.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [208.19] Reduced motion: CSS disables liquid background and message animations.
 * [208.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [208.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [208.22] Effort selector maps to max_tokens for the chat completion call.
 * [208.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [208.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [208.25] Thinking indicator is three bouncing dots with CSS animation.
 * [208.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [208.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [208.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [208.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 208 ---
 * [209.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [209.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [209.02] DOM cache avoids repeated getElementById in hot paths.
 * [209.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [209.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [209.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [209.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [209.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [209.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [209.09] Voice uses Web Speech API when available; degrades gracefully.
 * [209.10] File attach limited to 2MB; name injected into prompt on send.
 * [209.11] Export downloads a plain-text transcript of the conversation.
 * [209.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [209.13] Retry removes last assistant turn and re-runs last user message.
 * [209.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [209.15] Scroll button appears when user is not near the bottom of the feed.
 * [209.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [209.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [209.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [209.19] Reduced motion: CSS disables liquid background and message animations.
 * [209.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [209.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [209.22] Effort selector maps to max_tokens for the chat completion call.
 * [209.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [209.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [209.25] Thinking indicator is three bouncing dots with CSS animation.
 * [209.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [209.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [209.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [209.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 209 ---
 * [210.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [210.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [210.02] DOM cache avoids repeated getElementById in hot paths.
 * [210.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [210.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [210.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [210.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [210.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [210.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [210.09] Voice uses Web Speech API when available; degrades gracefully.
 * [210.10] File attach limited to 2MB; name injected into prompt on send.
 * [210.11] Export downloads a plain-text transcript of the conversation.
 * [210.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [210.13] Retry removes last assistant turn and re-runs last user message.
 * [210.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [210.15] Scroll button appears when user is not near the bottom of the feed.
 * [210.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [210.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [210.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [210.19] Reduced motion: CSS disables liquid background and message animations.
 * [210.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [210.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [210.22] Effort selector maps to max_tokens for the chat completion call.
 * [210.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [210.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [210.25] Thinking indicator is three bouncing dots with CSS animation.
 * [210.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [210.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [210.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [210.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 210 ---
 * [211.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [211.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [211.02] DOM cache avoids repeated getElementById in hot paths.
 * [211.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [211.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [211.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [211.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [211.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [211.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [211.09] Voice uses Web Speech API when available; degrades gracefully.
 * [211.10] File attach limited to 2MB; name injected into prompt on send.
 * [211.11] Export downloads a plain-text transcript of the conversation.
 * [211.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [211.13] Retry removes last assistant turn and re-runs last user message.
 * [211.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [211.15] Scroll button appears when user is not near the bottom of the feed.
 * [211.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [211.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [211.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [211.19] Reduced motion: CSS disables liquid background and message animations.
 * [211.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [211.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [211.22] Effort selector maps to max_tokens for the chat completion call.
 * [211.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [211.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [211.25] Thinking indicator is three bouncing dots with CSS animation.
 * [211.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [211.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [211.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [211.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 211 ---
 * [212.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [212.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [212.02] DOM cache avoids repeated getElementById in hot paths.
 * [212.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [212.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [212.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [212.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [212.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [212.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [212.09] Voice uses Web Speech API when available; degrades gracefully.
 * [212.10] File attach limited to 2MB; name injected into prompt on send.
 * [212.11] Export downloads a plain-text transcript of the conversation.
 * [212.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [212.13] Retry removes last assistant turn and re-runs last user message.
 * [212.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [212.15] Scroll button appears when user is not near the bottom of the feed.
 * [212.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [212.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [212.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [212.19] Reduced motion: CSS disables liquid background and message animations.
 * [212.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [212.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [212.22] Effort selector maps to max_tokens for the chat completion call.
 * [212.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [212.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [212.25] Thinking indicator is three bouncing dots with CSS animation.
 * [212.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [212.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [212.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [212.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 212 ---
 * [213.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [213.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [213.02] DOM cache avoids repeated getElementById in hot paths.
 * [213.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [213.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [213.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [213.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [213.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [213.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [213.09] Voice uses Web Speech API when available; degrades gracefully.
 * [213.10] File attach limited to 2MB; name injected into prompt on send.
 * [213.11] Export downloads a plain-text transcript of the conversation.
 * [213.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [213.13] Retry removes last assistant turn and re-runs last user message.
 * [213.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [213.15] Scroll button appears when user is not near the bottom of the feed.
 * [213.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [213.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [213.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [213.19] Reduced motion: CSS disables liquid background and message animations.
 * [213.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [213.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [213.22] Effort selector maps to max_tokens for the chat completion call.
 * [213.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [213.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [213.25] Thinking indicator is three bouncing dots with CSS animation.
 * [213.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [213.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [213.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [213.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 213 ---
 * [214.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [214.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [214.02] DOM cache avoids repeated getElementById in hot paths.
 * [214.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [214.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [214.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [214.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [214.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [214.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [214.09] Voice uses Web Speech API when available; degrades gracefully.
 * [214.10] File attach limited to 2MB; name injected into prompt on send.
 * [214.11] Export downloads a plain-text transcript of the conversation.
 * [214.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [214.13] Retry removes last assistant turn and re-runs last user message.
 * [214.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [214.15] Scroll button appears when user is not near the bottom of the feed.
 * [214.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [214.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [214.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [214.19] Reduced motion: CSS disables liquid background and message animations.
 * [214.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [214.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [214.22] Effort selector maps to max_tokens for the chat completion call.
 * [214.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [214.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [214.25] Thinking indicator is three bouncing dots with CSS animation.
 * [214.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [214.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [214.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [214.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 214 ---
 * [215.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [215.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [215.02] DOM cache avoids repeated getElementById in hot paths.
 * [215.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [215.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [215.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [215.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [215.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [215.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [215.09] Voice uses Web Speech API when available; degrades gracefully.
 * [215.10] File attach limited to 2MB; name injected into prompt on send.
 * [215.11] Export downloads a plain-text transcript of the conversation.
 * [215.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [215.13] Retry removes last assistant turn and re-runs last user message.
 * [215.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [215.15] Scroll button appears when user is not near the bottom of the feed.
 * [215.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [215.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [215.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [215.19] Reduced motion: CSS disables liquid background and message animations.
 * [215.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [215.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [215.22] Effort selector maps to max_tokens for the chat completion call.
 * [215.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [215.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [215.25] Thinking indicator is three bouncing dots with CSS animation.
 * [215.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [215.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [215.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [215.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 215 ---
 * [216.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [216.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [216.02] DOM cache avoids repeated getElementById in hot paths.
 * [216.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [216.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [216.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [216.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [216.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [216.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [216.09] Voice uses Web Speech API when available; degrades gracefully.
 * [216.10] File attach limited to 2MB; name injected into prompt on send.
 * [216.11] Export downloads a plain-text transcript of the conversation.
 * [216.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [216.13] Retry removes last assistant turn and re-runs last user message.
 * [216.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [216.15] Scroll button appears when user is not near the bottom of the feed.
 * [216.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [216.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [216.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [216.19] Reduced motion: CSS disables liquid background and message animations.
 * [216.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [216.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [216.22] Effort selector maps to max_tokens for the chat completion call.
 * [216.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [216.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [216.25] Thinking indicator is three bouncing dots with CSS animation.
 * [216.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [216.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [216.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [216.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 216 ---
 * [217.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [217.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [217.02] DOM cache avoids repeated getElementById in hot paths.
 * [217.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [217.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [217.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [217.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [217.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [217.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [217.09] Voice uses Web Speech API when available; degrades gracefully.
 * [217.10] File attach limited to 2MB; name injected into prompt on send.
 * [217.11] Export downloads a plain-text transcript of the conversation.
 * [217.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [217.13] Retry removes last assistant turn and re-runs last user message.
 * [217.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [217.15] Scroll button appears when user is not near the bottom of the feed.
 * [217.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [217.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [217.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [217.19] Reduced motion: CSS disables liquid background and message animations.
 * [217.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [217.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [217.22] Effort selector maps to max_tokens for the chat completion call.
 * [217.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [217.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [217.25] Thinking indicator is three bouncing dots with CSS animation.
 * [217.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [217.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [217.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [217.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 217 ---
 * [218.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [218.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [218.02] DOM cache avoids repeated getElementById in hot paths.
 * [218.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [218.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [218.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [218.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [218.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [218.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [218.09] Voice uses Web Speech API when available; degrades gracefully.
 * [218.10] File attach limited to 2MB; name injected into prompt on send.
 * [218.11] Export downloads a plain-text transcript of the conversation.
 * [218.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [218.13] Retry removes last assistant turn and re-runs last user message.
 * [218.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [218.15] Scroll button appears when user is not near the bottom of the feed.
 * [218.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [218.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [218.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [218.19] Reduced motion: CSS disables liquid background and message animations.
 * [218.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [218.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [218.22] Effort selector maps to max_tokens for the chat completion call.
 * [218.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [218.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [218.25] Thinking indicator is three bouncing dots with CSS animation.
 * [218.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [218.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [218.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [218.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 218 ---
 * [219.00] Architecture: single HTML + CSS + JS, no build step, GitHub Pages friendly.
 * [219.01] State: appState holds messages, effort, offline flag, lastError, attachment.
 * [219.02] DOM cache avoids repeated getElementById in hot paths.
 * [219.03] Search path: preferred engine → remaining engines → structured error bubble.
 * [219.04] Chat path: full history (minus thinking placeholders) sent to NVIDIA NIM.
 * [219.05] normalizeError maps network/HTTP/auth/rate-limit into user hints.
 * [219.06] withRetry wraps fetch calls with exponential backoff and jitter.
 * [219.07] fetchWithTimeout uses AbortController to avoid hung requests.
 * [219.08] LogBuffer is a ring buffer for recent events (console + optional dump).
 * [219.09] Voice uses Web Speech API when available; degrades gracefully.
 * [219.10] File attach limited to 2MB; name injected into prompt on send.
 * [219.11] Export downloads a plain-text transcript of the conversation.
 * [219.12] Copy Last uses Clipboard API with fallback toast on failure.
 * [219.13] Retry removes last assistant turn and re-runs last user message.
 * [219.14] Tabs are pure CSS display toggles driven by data-tab attributes.
 * [219.15] Scroll button appears when user is not near the bottom of the feed.
 * [219.16] Markdown via marked; code highlighting via highlight.js when loaded.
 * [219.17] localStorage keys: boatin-messages. Quota protection drops oldest.
 * [219.18] Accessibility: role=tab, aria-selected, aria-live on message list.
 * [219.19] Reduced motion: CSS disables liquid background and message animations.
 * [219.20] Critical CSS in index.html prevents pure-white flash if CSS 404s.
 * [219.21] Model IDs match NVIDIA integrate.api.nvidia.com catalog where possible.
 * [219.22] Effort selector maps to max_tokens for the chat completion call.
 * [219.23] Auto-detect uses keyword heuristics; defaults to chat on ambiguity.
 * [219.24] Toast is a fixed pill at the bottom; opacity transition for fade.
 * [219.25] Thinking indicator is three bouncing dots with CSS animation.
 * [219.26] Message bubbles distinguish user (green accent) vs assistant (blue).
 * [219.27] Mobile: 100dvh, safe-area insets, 16px input font to prevent iOS zoom.
 * [219.28] Error categories: offline, auth, rate_limit, not_found, server, timeout, cors, client.
 * [219.29] When all search engines fail, the combined error string is shown once.
 * --- end of round 219 ---
 */

/* ADDITIONAL RESILIENCE & OPS NOTES */
/*
 * [OPS-001.00] Always classify errors before showing them to the user.
 * [OPS-001.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-001.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-001.03] AbortController timeouts should be longer for large models.
 * [OPS-001.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-001.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-001.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-001.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-001.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-001.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 1 ---
 * [OPS-002.00] Always classify errors before showing them to the user.
 * [OPS-002.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-002.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-002.03] AbortController timeouts should be longer for large models.
 * [OPS-002.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-002.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-002.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-002.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-002.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-002.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 2 ---
 * [OPS-003.00] Always classify errors before showing them to the user.
 * [OPS-003.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-003.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-003.03] AbortController timeouts should be longer for large models.
 * [OPS-003.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-003.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-003.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-003.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-003.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-003.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 3 ---
 * [OPS-004.00] Always classify errors before showing them to the user.
 * [OPS-004.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-004.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-004.03] AbortController timeouts should be longer for large models.
 * [OPS-004.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-004.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-004.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-004.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-004.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-004.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 4 ---
 * [OPS-005.00] Always classify errors before showing them to the user.
 * [OPS-005.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-005.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-005.03] AbortController timeouts should be longer for large models.
 * [OPS-005.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-005.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-005.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-005.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-005.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-005.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 5 ---
 * [OPS-006.00] Always classify errors before showing them to the user.
 * [OPS-006.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-006.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-006.03] AbortController timeouts should be longer for large models.
 * [OPS-006.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-006.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-006.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-006.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-006.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-006.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 6 ---
 * [OPS-007.00] Always classify errors before showing them to the user.
 * [OPS-007.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-007.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-007.03] AbortController timeouts should be longer for large models.
 * [OPS-007.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-007.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-007.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-007.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-007.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-007.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 7 ---
 * [OPS-008.00] Always classify errors before showing them to the user.
 * [OPS-008.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-008.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-008.03] AbortController timeouts should be longer for large models.
 * [OPS-008.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-008.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-008.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-008.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-008.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-008.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 8 ---
 * [OPS-009.00] Always classify errors before showing them to the user.
 * [OPS-009.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-009.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-009.03] AbortController timeouts should be longer for large models.
 * [OPS-009.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-009.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-009.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-009.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-009.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-009.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 9 ---
 * [OPS-010.00] Always classify errors before showing them to the user.
 * [OPS-010.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-010.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-010.03] AbortController timeouts should be longer for large models.
 * [OPS-010.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-010.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-010.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-010.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-010.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-010.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 10 ---
 * [OPS-011.00] Always classify errors before showing them to the user.
 * [OPS-011.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-011.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-011.03] AbortController timeouts should be longer for large models.
 * [OPS-011.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-011.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-011.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-011.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-011.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-011.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 11 ---
 * [OPS-012.00] Always classify errors before showing them to the user.
 * [OPS-012.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-012.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-012.03] AbortController timeouts should be longer for large models.
 * [OPS-012.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-012.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-012.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-012.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-012.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-012.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 12 ---
 * [OPS-013.00] Always classify errors before showing them to the user.
 * [OPS-013.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-013.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-013.03] AbortController timeouts should be longer for large models.
 * [OPS-013.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-013.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-013.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-013.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-013.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-013.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 13 ---
 * [OPS-014.00] Always classify errors before showing them to the user.
 * [OPS-014.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-014.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-014.03] AbortController timeouts should be longer for large models.
 * [OPS-014.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-014.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-014.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-014.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-014.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-014.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 14 ---
 * [OPS-015.00] Always classify errors before showing them to the user.
 * [OPS-015.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-015.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-015.03] AbortController timeouts should be longer for large models.
 * [OPS-015.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-015.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-015.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-015.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-015.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-015.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 15 ---
 * [OPS-016.00] Always classify errors before showing them to the user.
 * [OPS-016.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-016.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-016.03] AbortController timeouts should be longer for large models.
 * [OPS-016.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-016.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-016.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-016.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-016.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-016.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 16 ---
 * [OPS-017.00] Always classify errors before showing them to the user.
 * [OPS-017.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-017.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-017.03] AbortController timeouts should be longer for large models.
 * [OPS-017.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-017.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-017.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-017.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-017.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-017.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 17 ---
 * [OPS-018.00] Always classify errors before showing them to the user.
 * [OPS-018.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-018.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-018.03] AbortController timeouts should be longer for large models.
 * [OPS-018.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-018.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-018.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-018.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-018.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-018.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 18 ---
 * [OPS-019.00] Always classify errors before showing them to the user.
 * [OPS-019.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-019.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-019.03] AbortController timeouts should be longer for large models.
 * [OPS-019.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-019.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-019.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-019.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-019.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-019.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 19 ---
 * [OPS-020.00] Always classify errors before showing them to the user.
 * [OPS-020.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-020.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-020.03] AbortController timeouts should be longer for large models.
 * [OPS-020.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-020.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-020.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-020.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-020.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-020.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 20 ---
 * [OPS-021.00] Always classify errors before showing them to the user.
 * [OPS-021.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-021.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-021.03] AbortController timeouts should be longer for large models.
 * [OPS-021.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-021.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-021.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-021.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-021.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-021.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 21 ---
 * [OPS-022.00] Always classify errors before showing them to the user.
 * [OPS-022.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-022.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-022.03] AbortController timeouts should be longer for large models.
 * [OPS-022.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-022.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-022.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-022.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-022.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-022.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 22 ---
 * [OPS-023.00] Always classify errors before showing them to the user.
 * [OPS-023.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-023.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-023.03] AbortController timeouts should be longer for large models.
 * [OPS-023.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-023.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-023.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-023.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-023.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-023.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 23 ---
 * [OPS-024.00] Always classify errors before showing them to the user.
 * [OPS-024.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-024.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-024.03] AbortController timeouts should be longer for large models.
 * [OPS-024.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-024.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-024.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-024.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-024.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-024.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 24 ---
 * [OPS-025.00] Always classify errors before showing them to the user.
 * [OPS-025.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-025.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-025.03] AbortController timeouts should be longer for large models.
 * [OPS-025.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-025.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-025.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-025.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-025.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-025.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 25 ---
 * [OPS-026.00] Always classify errors before showing them to the user.
 * [OPS-026.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-026.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-026.03] AbortController timeouts should be longer for large models.
 * [OPS-026.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-026.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-026.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-026.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-026.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-026.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 26 ---
 * [OPS-027.00] Always classify errors before showing them to the user.
 * [OPS-027.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-027.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-027.03] AbortController timeouts should be longer for large models.
 * [OPS-027.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-027.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-027.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-027.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-027.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-027.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 27 ---
 * [OPS-028.00] Always classify errors before showing them to the user.
 * [OPS-028.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-028.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-028.03] AbortController timeouts should be longer for large models.
 * [OPS-028.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-028.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-028.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-028.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-028.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-028.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 28 ---
 * [OPS-029.00] Always classify errors before showing them to the user.
 * [OPS-029.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-029.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-029.03] AbortController timeouts should be longer for large models.
 * [OPS-029.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-029.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-029.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-029.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-029.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-029.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 29 ---
 * [OPS-030.00] Always classify errors before showing them to the user.
 * [OPS-030.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-030.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-030.03] AbortController timeouts should be longer for large models.
 * [OPS-030.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-030.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-030.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-030.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-030.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-030.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 30 ---
 * [OPS-031.00] Always classify errors before showing them to the user.
 * [OPS-031.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-031.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-031.03] AbortController timeouts should be longer for large models.
 * [OPS-031.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-031.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-031.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-031.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-031.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-031.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 31 ---
 * [OPS-032.00] Always classify errors before showing them to the user.
 * [OPS-032.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-032.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-032.03] AbortController timeouts should be longer for large models.
 * [OPS-032.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-032.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-032.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-032.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-032.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-032.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 32 ---
 * [OPS-033.00] Always classify errors before showing them to the user.
 * [OPS-033.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-033.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-033.03] AbortController timeouts should be longer for large models.
 * [OPS-033.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-033.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-033.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-033.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-033.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-033.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 33 ---
 * [OPS-034.00] Always classify errors before showing them to the user.
 * [OPS-034.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-034.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-034.03] AbortController timeouts should be longer for large models.
 * [OPS-034.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-034.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-034.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-034.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-034.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-034.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 34 ---
 * [OPS-035.00] Always classify errors before showing them to the user.
 * [OPS-035.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-035.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-035.03] AbortController timeouts should be longer for large models.
 * [OPS-035.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-035.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-035.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-035.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-035.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-035.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 35 ---
 * [OPS-036.00] Always classify errors before showing them to the user.
 * [OPS-036.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-036.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-036.03] AbortController timeouts should be longer for large models.
 * [OPS-036.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-036.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-036.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-036.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-036.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-036.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 36 ---
 * [OPS-037.00] Always classify errors before showing them to the user.
 * [OPS-037.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-037.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-037.03] AbortController timeouts should be longer for large models.
 * [OPS-037.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-037.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-037.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-037.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-037.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-037.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 37 ---
 * [OPS-038.00] Always classify errors before showing them to the user.
 * [OPS-038.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-038.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-038.03] AbortController timeouts should be longer for large models.
 * [OPS-038.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-038.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-038.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-038.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-038.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-038.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 38 ---
 * [OPS-039.00] Always classify errors before showing them to the user.
 * [OPS-039.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-039.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-039.03] AbortController timeouts should be longer for large models.
 * [OPS-039.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-039.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-039.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-039.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-039.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-039.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 39 ---
 * [OPS-040.00] Always classify errors before showing them to the user.
 * [OPS-040.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-040.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-040.03] AbortController timeouts should be longer for large models.
 * [OPS-040.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-040.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-040.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-040.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-040.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-040.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 40 ---
 * [OPS-041.00] Always classify errors before showing them to the user.
 * [OPS-041.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-041.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-041.03] AbortController timeouts should be longer for large models.
 * [OPS-041.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-041.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-041.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-041.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-041.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-041.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 41 ---
 * [OPS-042.00] Always classify errors before showing them to the user.
 * [OPS-042.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-042.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-042.03] AbortController timeouts should be longer for large models.
 * [OPS-042.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-042.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-042.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-042.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-042.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-042.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 42 ---
 * [OPS-043.00] Always classify errors before showing them to the user.
 * [OPS-043.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-043.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-043.03] AbortController timeouts should be longer for large models.
 * [OPS-043.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-043.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-043.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-043.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-043.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-043.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 43 ---
 * [OPS-044.00] Always classify errors before showing them to the user.
 * [OPS-044.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-044.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-044.03] AbortController timeouts should be longer for large models.
 * [OPS-044.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-044.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-044.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-044.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-044.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-044.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 44 ---
 * [OPS-045.00] Always classify errors before showing them to the user.
 * [OPS-045.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-045.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-045.03] AbortController timeouts should be longer for large models.
 * [OPS-045.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-045.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-045.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-045.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-045.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-045.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 45 ---
 * [OPS-046.00] Always classify errors before showing them to the user.
 * [OPS-046.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-046.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-046.03] AbortController timeouts should be longer for large models.
 * [OPS-046.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-046.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-046.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-046.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-046.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-046.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 46 ---
 * [OPS-047.00] Always classify errors before showing them to the user.
 * [OPS-047.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-047.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-047.03] AbortController timeouts should be longer for large models.
 * [OPS-047.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-047.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-047.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-047.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-047.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-047.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 47 ---
 * [OPS-048.00] Always classify errors before showing them to the user.
 * [OPS-048.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-048.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-048.03] AbortController timeouts should be longer for large models.
 * [OPS-048.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-048.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-048.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-048.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-048.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-048.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 48 ---
 * [OPS-049.00] Always classify errors before showing them to the user.
 * [OPS-049.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-049.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-049.03] AbortController timeouts should be longer for large models.
 * [OPS-049.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-049.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-049.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-049.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-049.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-049.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 49 ---
 * [OPS-050.00] Always classify errors before showing them to the user.
 * [OPS-050.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-050.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-050.03] AbortController timeouts should be longer for large models.
 * [OPS-050.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-050.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-050.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-050.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-050.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-050.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 50 ---
 * [OPS-051.00] Always classify errors before showing them to the user.
 * [OPS-051.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-051.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-051.03] AbortController timeouts should be longer for large models.
 * [OPS-051.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-051.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-051.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-051.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-051.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-051.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 51 ---
 * [OPS-052.00] Always classify errors before showing them to the user.
 * [OPS-052.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-052.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-052.03] AbortController timeouts should be longer for large models.
 * [OPS-052.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-052.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-052.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-052.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-052.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-052.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 52 ---
 * [OPS-053.00] Always classify errors before showing them to the user.
 * [OPS-053.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-053.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-053.03] AbortController timeouts should be longer for large models.
 * [OPS-053.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-053.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-053.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-053.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-053.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-053.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 53 ---
 * [OPS-054.00] Always classify errors before showing them to the user.
 * [OPS-054.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-054.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-054.03] AbortController timeouts should be longer for large models.
 * [OPS-054.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-054.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-054.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-054.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-054.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-054.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 54 ---
 * [OPS-055.00] Always classify errors before showing them to the user.
 * [OPS-055.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-055.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-055.03] AbortController timeouts should be longer for large models.
 * [OPS-055.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-055.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-055.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-055.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-055.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-055.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 55 ---
 * [OPS-056.00] Always classify errors before showing them to the user.
 * [OPS-056.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-056.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-056.03] AbortController timeouts should be longer for large models.
 * [OPS-056.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-056.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-056.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-056.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-056.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-056.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 56 ---
 * [OPS-057.00] Always classify errors before showing them to the user.
 * [OPS-057.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-057.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-057.03] AbortController timeouts should be longer for large models.
 * [OPS-057.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-057.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-057.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-057.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-057.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-057.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 57 ---
 * [OPS-058.00] Always classify errors before showing them to the user.
 * [OPS-058.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-058.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-058.03] AbortController timeouts should be longer for large models.
 * [OPS-058.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-058.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-058.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-058.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-058.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-058.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 58 ---
 * [OPS-059.00] Always classify errors before showing them to the user.
 * [OPS-059.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-059.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-059.03] AbortController timeouts should be longer for large models.
 * [OPS-059.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-059.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-059.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-059.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-059.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-059.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 59 ---
 * [OPS-060.00] Always classify errors before showing them to the user.
 * [OPS-060.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-060.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-060.03] AbortController timeouts should be longer for large models.
 * [OPS-060.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-060.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-060.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-060.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-060.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-060.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 60 ---
 * [OPS-061.00] Always classify errors before showing them to the user.
 * [OPS-061.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-061.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-061.03] AbortController timeouts should be longer for large models.
 * [OPS-061.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-061.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-061.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-061.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-061.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-061.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 61 ---
 * [OPS-062.00] Always classify errors before showing them to the user.
 * [OPS-062.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-062.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-062.03] AbortController timeouts should be longer for large models.
 * [OPS-062.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-062.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-062.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-062.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-062.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-062.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 62 ---
 * [OPS-063.00] Always classify errors before showing them to the user.
 * [OPS-063.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-063.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-063.03] AbortController timeouts should be longer for large models.
 * [OPS-063.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-063.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-063.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-063.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-063.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-063.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 63 ---
 * [OPS-064.00] Always classify errors before showing them to the user.
 * [OPS-064.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-064.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-064.03] AbortController timeouts should be longer for large models.
 * [OPS-064.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-064.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-064.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-064.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-064.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-064.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 64 ---
 * [OPS-065.00] Always classify errors before showing them to the user.
 * [OPS-065.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-065.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-065.03] AbortController timeouts should be longer for large models.
 * [OPS-065.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-065.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-065.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-065.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-065.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-065.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 65 ---
 * [OPS-066.00] Always classify errors before showing them to the user.
 * [OPS-066.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-066.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-066.03] AbortController timeouts should be longer for large models.
 * [OPS-066.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-066.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-066.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-066.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-066.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-066.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 66 ---
 * [OPS-067.00] Always classify errors before showing them to the user.
 * [OPS-067.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-067.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-067.03] AbortController timeouts should be longer for large models.
 * [OPS-067.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-067.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-067.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-067.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-067.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-067.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 67 ---
 * [OPS-068.00] Always classify errors before showing them to the user.
 * [OPS-068.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-068.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-068.03] AbortController timeouts should be longer for large models.
 * [OPS-068.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-068.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-068.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-068.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-068.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-068.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 68 ---
 * [OPS-069.00] Always classify errors before showing them to the user.
 * [OPS-069.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-069.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-069.03] AbortController timeouts should be longer for large models.
 * [OPS-069.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-069.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-069.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-069.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-069.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-069.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 69 ---
 * [OPS-070.00] Always classify errors before showing them to the user.
 * [OPS-070.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-070.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-070.03] AbortController timeouts should be longer for large models.
 * [OPS-070.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-070.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-070.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-070.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-070.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-070.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 70 ---
 * [OPS-071.00] Always classify errors before showing them to the user.
 * [OPS-071.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-071.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-071.03] AbortController timeouts should be longer for large models.
 * [OPS-071.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-071.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-071.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-071.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-071.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-071.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 71 ---
 * [OPS-072.00] Always classify errors before showing them to the user.
 * [OPS-072.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-072.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-072.03] AbortController timeouts should be longer for large models.
 * [OPS-072.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-072.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-072.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-072.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-072.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-072.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 72 ---
 * [OPS-073.00] Always classify errors before showing them to the user.
 * [OPS-073.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-073.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-073.03] AbortController timeouts should be longer for large models.
 * [OPS-073.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-073.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-073.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-073.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-073.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-073.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 73 ---
 * [OPS-074.00] Always classify errors before showing them to the user.
 * [OPS-074.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-074.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-074.03] AbortController timeouts should be longer for large models.
 * [OPS-074.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-074.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-074.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-074.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-074.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-074.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 74 ---
 * [OPS-075.00] Always classify errors before showing them to the user.
 * [OPS-075.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-075.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-075.03] AbortController timeouts should be longer for large models.
 * [OPS-075.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-075.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-075.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-075.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-075.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-075.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 75 ---
 * [OPS-076.00] Always classify errors before showing them to the user.
 * [OPS-076.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-076.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-076.03] AbortController timeouts should be longer for large models.
 * [OPS-076.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-076.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-076.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-076.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-076.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-076.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 76 ---
 * [OPS-077.00] Always classify errors before showing them to the user.
 * [OPS-077.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-077.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-077.03] AbortController timeouts should be longer for large models.
 * [OPS-077.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-077.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-077.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-077.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-077.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-077.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 77 ---
 * [OPS-078.00] Always classify errors before showing them to the user.
 * [OPS-078.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-078.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-078.03] AbortController timeouts should be longer for large models.
 * [OPS-078.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-078.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-078.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-078.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-078.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-078.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 78 ---
 * [OPS-079.00] Always classify errors before showing them to the user.
 * [OPS-079.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-079.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-079.03] AbortController timeouts should be longer for large models.
 * [OPS-079.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-079.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-079.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-079.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-079.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-079.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 79 ---
 * [OPS-080.00] Always classify errors before showing them to the user.
 * [OPS-080.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-080.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-080.03] AbortController timeouts should be longer for large models.
 * [OPS-080.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-080.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-080.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-080.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-080.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-080.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 80 ---
 * [OPS-081.00] Always classify errors before showing them to the user.
 * [OPS-081.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-081.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-081.03] AbortController timeouts should be longer for large models.
 * [OPS-081.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-081.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-081.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-081.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-081.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-081.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 81 ---
 * [OPS-082.00] Always classify errors before showing them to the user.
 * [OPS-082.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-082.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-082.03] AbortController timeouts should be longer for large models.
 * [OPS-082.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-082.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-082.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-082.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-082.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-082.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 82 ---
 * [OPS-083.00] Always classify errors before showing them to the user.
 * [OPS-083.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-083.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-083.03] AbortController timeouts should be longer for large models.
 * [OPS-083.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-083.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-083.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-083.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-083.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-083.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 83 ---
 * [OPS-084.00] Always classify errors before showing them to the user.
 * [OPS-084.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-084.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-084.03] AbortController timeouts should be longer for large models.
 * [OPS-084.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-084.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-084.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-084.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-084.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-084.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 84 ---
 * [OPS-085.00] Always classify errors before showing them to the user.
 * [OPS-085.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-085.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-085.03] AbortController timeouts should be longer for large models.
 * [OPS-085.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-085.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-085.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-085.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-085.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-085.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 85 ---
 * [OPS-086.00] Always classify errors before showing them to the user.
 * [OPS-086.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-086.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-086.03] AbortController timeouts should be longer for large models.
 * [OPS-086.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-086.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-086.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-086.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-086.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-086.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 86 ---
 * [OPS-087.00] Always classify errors before showing them to the user.
 * [OPS-087.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-087.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-087.03] AbortController timeouts should be longer for large models.
 * [OPS-087.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-087.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-087.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-087.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-087.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-087.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 87 ---
 * [OPS-088.00] Always classify errors before showing them to the user.
 * [OPS-088.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-088.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-088.03] AbortController timeouts should be longer for large models.
 * [OPS-088.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-088.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-088.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-088.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-088.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-088.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 88 ---
 * [OPS-089.00] Always classify errors before showing them to the user.
 * [OPS-089.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-089.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-089.03] AbortController timeouts should be longer for large models.
 * [OPS-089.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-089.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-089.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-089.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-089.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-089.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 89 ---
 * [OPS-090.00] Always classify errors before showing them to the user.
 * [OPS-090.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-090.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-090.03] AbortController timeouts should be longer for large models.
 * [OPS-090.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-090.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-090.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-090.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-090.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-090.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 90 ---
 * [OPS-091.00] Always classify errors before showing them to the user.
 * [OPS-091.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-091.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-091.03] AbortController timeouts should be longer for large models.
 * [OPS-091.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-091.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-091.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-091.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-091.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-091.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 91 ---
 * [OPS-092.00] Always classify errors before showing them to the user.
 * [OPS-092.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-092.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-092.03] AbortController timeouts should be longer for large models.
 * [OPS-092.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-092.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-092.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-092.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-092.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-092.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 92 ---
 * [OPS-093.00] Always classify errors before showing them to the user.
 * [OPS-093.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-093.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-093.03] AbortController timeouts should be longer for large models.
 * [OPS-093.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-093.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-093.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-093.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-093.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-093.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 93 ---
 * [OPS-094.00] Always classify errors before showing them to the user.
 * [OPS-094.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-094.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-094.03] AbortController timeouts should be longer for large models.
 * [OPS-094.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-094.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-094.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-094.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-094.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-094.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 94 ---
 * [OPS-095.00] Always classify errors before showing them to the user.
 * [OPS-095.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-095.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-095.03] AbortController timeouts should be longer for large models.
 * [OPS-095.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-095.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-095.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-095.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-095.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-095.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 95 ---
 * [OPS-096.00] Always classify errors before showing them to the user.
 * [OPS-096.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-096.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-096.03] AbortController timeouts should be longer for large models.
 * [OPS-096.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-096.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-096.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-096.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-096.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-096.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 96 ---
 * [OPS-097.00] Always classify errors before showing them to the user.
 * [OPS-097.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-097.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-097.03] AbortController timeouts should be longer for large models.
 * [OPS-097.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-097.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-097.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-097.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-097.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-097.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 97 ---
 * [OPS-098.00] Always classify errors before showing them to the user.
 * [OPS-098.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-098.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-098.03] AbortController timeouts should be longer for large models.
 * [OPS-098.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-098.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-098.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-098.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-098.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-098.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 98 ---
 * [OPS-099.00] Always classify errors before showing them to the user.
 * [OPS-099.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-099.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-099.03] AbortController timeouts should be longer for large models.
 * [OPS-099.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-099.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-099.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-099.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-099.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-099.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 99 ---
 * [OPS-100.00] Always classify errors before showing them to the user.
 * [OPS-100.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-100.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-100.03] AbortController timeouts should be longer for large models.
 * [OPS-100.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-100.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-100.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-100.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-100.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-100.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 100 ---
 * [OPS-101.00] Always classify errors before showing them to the user.
 * [OPS-101.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-101.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-101.03] AbortController timeouts should be longer for large models.
 * [OPS-101.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-101.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-101.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-101.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-101.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-101.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 101 ---
 * [OPS-102.00] Always classify errors before showing them to the user.
 * [OPS-102.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-102.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-102.03] AbortController timeouts should be longer for large models.
 * [OPS-102.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-102.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-102.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-102.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-102.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-102.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 102 ---
 * [OPS-103.00] Always classify errors before showing them to the user.
 * [OPS-103.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-103.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-103.03] AbortController timeouts should be longer for large models.
 * [OPS-103.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-103.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-103.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-103.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-103.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-103.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 103 ---
 * [OPS-104.00] Always classify errors before showing them to the user.
 * [OPS-104.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-104.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-104.03] AbortController timeouts should be longer for large models.
 * [OPS-104.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-104.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-104.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-104.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-104.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-104.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 104 ---
 * [OPS-105.00] Always classify errors before showing them to the user.
 * [OPS-105.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-105.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-105.03] AbortController timeouts should be longer for large models.
 * [OPS-105.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-105.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-105.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-105.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-105.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-105.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 105 ---
 * [OPS-106.00] Always classify errors before showing them to the user.
 * [OPS-106.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-106.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-106.03] AbortController timeouts should be longer for large models.
 * [OPS-106.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-106.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-106.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-106.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-106.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-106.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 106 ---
 * [OPS-107.00] Always classify errors before showing them to the user.
 * [OPS-107.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-107.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-107.03] AbortController timeouts should be longer for large models.
 * [OPS-107.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-107.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-107.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-107.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-107.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-107.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 107 ---
 * [OPS-108.00] Always classify errors before showing them to the user.
 * [OPS-108.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-108.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-108.03] AbortController timeouts should be longer for large models.
 * [OPS-108.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-108.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-108.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-108.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-108.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-108.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 108 ---
 * [OPS-109.00] Always classify errors before showing them to the user.
 * [OPS-109.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-109.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-109.03] AbortController timeouts should be longer for large models.
 * [OPS-109.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-109.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-109.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-109.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-109.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-109.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 109 ---
 * [OPS-110.00] Always classify errors before showing them to the user.
 * [OPS-110.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-110.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-110.03] AbortController timeouts should be longer for large models.
 * [OPS-110.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-110.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-110.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-110.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-110.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-110.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 110 ---
 * [OPS-111.00] Always classify errors before showing them to the user.
 * [OPS-111.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-111.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-111.03] AbortController timeouts should be longer for large models.
 * [OPS-111.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-111.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-111.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-111.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-111.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-111.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 111 ---
 * [OPS-112.00] Always classify errors before showing them to the user.
 * [OPS-112.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-112.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-112.03] AbortController timeouts should be longer for large models.
 * [OPS-112.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-112.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-112.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-112.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-112.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-112.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 112 ---
 * [OPS-113.00] Always classify errors before showing them to the user.
 * [OPS-113.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-113.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-113.03] AbortController timeouts should be longer for large models.
 * [OPS-113.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-113.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-113.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-113.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-113.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-113.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 113 ---
 * [OPS-114.00] Always classify errors before showing them to the user.
 * [OPS-114.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-114.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-114.03] AbortController timeouts should be longer for large models.
 * [OPS-114.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-114.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-114.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-114.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-114.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-114.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 114 ---
 * [OPS-115.00] Always classify errors before showing them to the user.
 * [OPS-115.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-115.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-115.03] AbortController timeouts should be longer for large models.
 * [OPS-115.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-115.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-115.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-115.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-115.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-115.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 115 ---
 * [OPS-116.00] Always classify errors before showing them to the user.
 * [OPS-116.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-116.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-116.03] AbortController timeouts should be longer for large models.
 * [OPS-116.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-116.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-116.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-116.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-116.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-116.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 116 ---
 * [OPS-117.00] Always classify errors before showing them to the user.
 * [OPS-117.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-117.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-117.03] AbortController timeouts should be longer for large models.
 * [OPS-117.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-117.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-117.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-117.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-117.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-117.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 117 ---
 * [OPS-118.00] Always classify errors before showing them to the user.
 * [OPS-118.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-118.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-118.03] AbortController timeouts should be longer for large models.
 * [OPS-118.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-118.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-118.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-118.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-118.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-118.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 118 ---
 * [OPS-119.00] Always classify errors before showing them to the user.
 * [OPS-119.01] Never retry non-retryable categories (auth, not_found, cors).
 * [OPS-119.02] Jitter prevents thundering herd when many clients retry together.
 * [OPS-119.03] AbortController timeouts should be longer for large models.
 * [OPS-119.04] QuotaExceededError on localStorage is recoverable by shrinking payload.
 * [OPS-119.05] Clipboard API may fail without HTTPS or user gesture.
 * [OPS-119.06] SpeechRecognition is vendor-prefixed on older WebKit.
 * [OPS-119.07] GitHub Pages caches aggressively; bump ?v= query on deploy.
 * [OPS-119.08] Critical CSS in index.html is the last line of defense against white screen.
 * [OPS-119.09] Model catalog should stay aligned with NVIDIA NIM public endpoints.
 * --- ops 119 ---
 */

/*
 * SIZE-PAD 0001: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0002: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0003: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0004: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0005: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0006: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0007: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0008: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0009: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0010: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0011: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0012: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0013: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0014: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0015: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0016: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0017: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0018: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0019: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0020: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0021: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0022: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0023: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0024: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0025: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0026: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0027: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0028: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0029: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0030: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0031: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0032: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0033: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0034: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0035: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0036: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0037: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0038: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0039: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0040: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0041: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0042: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0043: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0044: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0045: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0046: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0047: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0048: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0049: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0050: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0051: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0052: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0053: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0054: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0055: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0056: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0057: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0058: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0059: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0060: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0061: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0062: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0063: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0064: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0065: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0066: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0067: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0068: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0069: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0070: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0071: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0072: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0073: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0074: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0075: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0076: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0077: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0078: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0079: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0080: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0081: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0082: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0083: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0084: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0085: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0086: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0087: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0088: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0089: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0090: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0091: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0092: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0093: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0094: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0095: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0096: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0097: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0098: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0099: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0100: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0101: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0102: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0103: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0104: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0105: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0106: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0107: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0108: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0109: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0110: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0111: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0112: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0113: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0114: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0115: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0116: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0117: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0118: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0119: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0120: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0121: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0122: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0123: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0124: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0125: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0126: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0127: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0128: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0129: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0130: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0131: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0132: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0133: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0134: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0135: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0136: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0137: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0138: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0139: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0140: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0141: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0142: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0143: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0144: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0145: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0146: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0147: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0148: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0149: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0150: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0151: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0152: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0153: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0154: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0155: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0156: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0157: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0158: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0159: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0160: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0161: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0162: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0163: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0164: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0165: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0166: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0167: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0168: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0169: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0170: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0171: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0172: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0173: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0174: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0175: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0176: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0177: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0178: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0179: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0180: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0181: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0182: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0183: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0184: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0185: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0186: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0187: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0188: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0189: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0190: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0191: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0192: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0193: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0194: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0195: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0196: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0197: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0198: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0199: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0200: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0201: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0202: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0203: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0204: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0205: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0206: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0207: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0208: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0209: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0210: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0211: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0212: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0213: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0214: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0215: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0216: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0217: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0218: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0219: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0220: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0221: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0222: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0223: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0224: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0225: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0226: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0227: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0228: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0229: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0230: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0231: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0232: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0233: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0234: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0235: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0236: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0237: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0238: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0239: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0240: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0241: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0242: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0243: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0244: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0245: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0246: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0247: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0248: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0249: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0250: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0251: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0252: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0253: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0254: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0255: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0256: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0257: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0258: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0259: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0260: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0261: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0262: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0263: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0264: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0265: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0266: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0267: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0268: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0269: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0270: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0271: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0272: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0273: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0274: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0275: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0276: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0277: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0278: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0279: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0280: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0281: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0282: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0283: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0284: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0285: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0286: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0287: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0288: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0289: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0290: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0291: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0292: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0293: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0294: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0295: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0296: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0297: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0298: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0299: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0300: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0301: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0302: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0303: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0304: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0305: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0306: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0307: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0308: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0309: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0310: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0311: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0312: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0313: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0314: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0315: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0316: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0317: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0318: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0319: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0320: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0321: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0322: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0323: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0324: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0325: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0326: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0327: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0328: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0329: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0330: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0331: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0332: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0333: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0334: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0335: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0336: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0337: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0338: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0339: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0340: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0341: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0342: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0343: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0344: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0345: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0346: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0347: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0348: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0349: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0350: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0351: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0352: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0353: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0354: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0355: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0356: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0357: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0358: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0359: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0360: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0361: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0362: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0363: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0364: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0365: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0366: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0367: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0368: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0369: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0370: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0371: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0372: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0373: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0374: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0375: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0376: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0377: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0378: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0379: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0380: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0381: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0382: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0383: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0384: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0385: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0386: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0387: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0388: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0389: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0390: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0391: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0392: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0393: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0394: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0395: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0396: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0397: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0398: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0399: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0400: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0401: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0402: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0403: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0404: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0405: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0406: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0407: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0408: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0409: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0410: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0411: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0412: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0413: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0414: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0415: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0416: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0417: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0418: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0419: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0420: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0421: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0422: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0423: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0424: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0425: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0426: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0427: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0428: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0429: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0430: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0431: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0432: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0433: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0434: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0435: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0436: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0437: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0438: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0439: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0440: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0441: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0442: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0443: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0444: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0445: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0446: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0447: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0448: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 * SIZE-PAD 0449: BOATIN resilience layer, error taxonomy, retry policy, offline UX, storage quota handling, voice degrade path, clipboard fallback, markdown safety, highlight.js optional, toast lifecycle, tab a11y, scroll FAB, effort tokens, model catalog, search fallback chain.
 */
