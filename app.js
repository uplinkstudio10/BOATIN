/* ═══════════════════════════════════════════════════════════════
   BOATIN — Best Edition
   Full-featured AI chat + live search
   ═══════════════════════════════════════════════════════════════ */
const API_KEYS = {
  NVIDIA: "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",
  TAVILY: "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"
};

const EFFORT_TOKENS = { low: 4096, mid: 16384, high: 32768, max: 65536 };
const SEARCH_RE = /search|find|research|news|latest|trends|who is|what is|when did|how many|current|today|price of/i;
const VISION_MODELS = [
  "meta/llama-3.2-90b-vision-instruct",
  "meta/llama-3.2-11b-vision-instruct",
  "nvidia/llama-3.1-nemotron-nano-vl-8b-v1",
  "nvidia/nemotron-nano-12b-v2-vl"
];
const DEFAULT_VISION = "meta/llama-3.2-11b-vision-instruct";

const state = {
  sessions: {},
  currentId: null,
  messages: [],
  busy: false,
  abort: null,
  effort: "mid",
  liveForce: false,
  autoSearch: true,
  stream: true,
  keepContext: true,
  attachedFile: null,
  attachedImageDataUrl: null
};

/* ── Persistence ─────────────────────────────────────────────── */
function loadSessions() {
  try {
    const raw = localStorage.getItem("boatin_sessions");
    if (raw) state.sessions = JSON.parse(raw);
  } catch (_) {}
  const ids = Object.keys(state.sessions);
  if (ids.length) {
    state.currentId = ids.sort((a, b) => state.sessions[b].updated - state.sessions[a].updated)[0];
    state.messages = state.sessions[state.currentId].messages || [];
  } else {
    newSession(true);
  }
}

function saveSessions() {
  if (!state.currentId) return;
  state.sessions[state.currentId] = {
    title: state.sessions[state.currentId]?.title || "New chat",
    messages: state.messages,
    updated: Date.now()
  };
  try {
    localStorage.setItem("boatin_sessions", JSON.stringify(state.sessions));
  } catch (_) {}
}

function newSession(silent) {
  const id = "s_" + Date.now();
  state.currentId = id;
  state.messages = [];
  state.sessions[id] = { title: "New chat", messages: [], updated: Date.now() };
  if (!silent) {
    saveSessions();
    render();
  }
}

function switchSession(id) {
  if (!state.sessions[id]) return;
  state.currentId = id;
  state.messages = state.sessions[id].messages || [];
  render();
  closeSessions();
}

function deleteSession(id, e) {
  e?.stopPropagation();
  delete state.sessions[id];
  if (state.currentId === id) {
    const remaining = Object.keys(state.sessions);
    if (remaining.length) switchSession(remaining[0]);
    else newSession();
  }
  saveSessions();
  renderSessionsList();
}

/* ── Init ────────────────────────────────────────────────────── */
function init() {
  loadSessions();
  bindUI();
  render();
}

function bindUI() {
  // Tabs
  document.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const panel = document.getElementById("panel-" + btn.dataset.panel);
      if (panel) panel.classList.add("active");
    });
  });

  // Effort chips
  document.querySelectorAll("#effortChips .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#effortChips .chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.effort = chip.dataset.effort;
    });
  });

  // Toggles
  bindToggle("autoSearchToggle", (on) => (state.autoSearch = on));
  bindToggle("streamToggle", (on) => (state.stream = on));
  bindToggle("contextToggle", (on) => (state.keepContext = on));

  // Composer
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("sendBtn");

  sendBtn.addEventListener("click", () => send());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
  });

  // Live
  document.getElementById("liveBtn").addEventListener("click", () => {
    state.liveForce = !state.liveForce;
    document.getElementById("liveBtn").classList.toggle("on", state.liveForce);
  });

  // Attach
  document.getElementById("attachBtn").addEventListener("click", () => {
    document.getElementById("fileInput").click();
  });
  document.getElementById("fileInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    state.attachedFile = file;
    state.attachedImageDataUrl = null;
    if (file.type.startsWith("image/")) {
      try {
        state.attachedImageDataUrl = await fileToDataUrl(file);
        document.getElementById("attachName").innerHTML =
          `<img src="${state.attachedImageDataUrl}" class="attach-thumb" alt=""> ${escapeHtml(file.name)}`;
      } catch (_) {
        document.getElementById("attachName").textContent = file.name;
      }
    } else {
      document.getElementById("attachName").textContent = file.name;
    }
    document.getElementById("attachBar").hidden = false;
  });
  document.getElementById("attachRemove").addEventListener("click", () => {
    state.attachedFile = null;
    state.attachedImageDataUrl = null;
    document.getElementById("fileInput").value = "";
    document.getElementById("attachBar").hidden = true;
  });

  // Clear
  document.getElementById("clearBtn").addEventListener("click", () => {
    if (confirm("Clear this chat?")) {
      state.messages = [];
      if (state.sessions[state.currentId]) {
        state.sessions[state.currentId].messages = [];
        state.sessions[state.currentId].title = "New chat";
      }
      saveSessions();
      render();
    }
  });

  // Actions
  document.getElementById("actExport").addEventListener("click", exportChat);
  document.getElementById("actCopyLast").addEventListener("click", copyLast);
  document.getElementById("actRegen").addEventListener("click", regenerate);
  document.getElementById("actStop").addEventListener("click", stopGeneration);

  // Sessions
  document.getElementById("sessionsBtn").addEventListener("click", openSessions);
  document.getElementById("sessionsBackdrop").addEventListener("click", closeSessions);
  document.getElementById("sessionClose").addEventListener("click", closeSessions);
  document.getElementById("sessionNew").addEventListener("click", () => {
    newSession();
    closeSessions();
  });

  // Scroll FAB
  const msgs = document.getElementById("messages");
  msgs.addEventListener("scroll", () => {
    const nearBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80;
    document.getElementById("scrollBottomBtn").classList.toggle("visible", !nearBottom);
  });
  document.getElementById("scrollBottomBtn").addEventListener("click", () => {
    msgs.scrollTop = msgs.scrollHeight;
  });
}

function bindToggle(id, cb) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("click", () => {
    const on = !el.classList.contains("on");
    el.classList.toggle("on", on);
    el.setAttribute("aria-pressed", on);
    cb(on);
  });
}

/* ── Send / Chat ─────────────────────────────────────────────── */
async function send() {
  if (state.busy) return;
  const input = document.getElementById("input");
  let text = (input.value || "").trim();
  if (!text && !state.attachedFile) return;

  let imageDataUrl = null;
  let imageName = null;

  if (state.attachedFile) {
    if (state.attachedFile.type.startsWith("image/") && state.attachedImageDataUrl) {
      imageDataUrl = state.attachedImageDataUrl;
      imageName = state.attachedFile.name;
      if (!text) text = "Describe this image in detail. What do you see?";
    } else {
      try {
        const content = await readTextFile(state.attachedFile);
        text = (text ? text + "\n\n" : "") + `[Attached: ${state.attachedFile.name}]\n${content}`;
      } catch (e) {
        text = (text ? text + "\n\n" : "") + `[Attached: ${state.attachedFile.name} — could not read]`;
      }
    }
    state.attachedFile = null;
    state.attachedImageDataUrl = null;
    document.getElementById("attachBar").hidden = true;
    document.getElementById("fileInput").value = "";
  }

  input.value = "";
  input.style.height = "auto";

  state.messages.push({
    role: "user",
    content: text,
    ts: Date.now(),
    image: imageDataUrl || undefined,
    imageName: imageName || undefined
  });

  if (state.messages.filter((m) => m.role === "user").length === 1) {
    const title = (imageName ? "🖼 " : "") + (text.slice(0, 36) + (text.length > 36 ? "…" : ""));
    if (state.sessions[state.currentId]) state.sessions[state.currentId].title = title;
  }

  render();
  await runAssistant(text, false, imageDataUrl);
}

async function runAssistant(userText, isRegen = false, imageDataUrl = null) {
  state.busy = true;
  setBusyUI(true);

  // Auto-pick vision model when image present
  let usedModel = currentModel();
  if (imageDataUrl && !VISION_MODELS.includes(usedModel)) {
    usedModel = DEFAULT_VISION;
    const sel = document.getElementById("modelSelect");
    if (sel) sel.value = usedModel;
  }

  const pendingIdx = state.messages.length;
  state.messages.push({
    role: "assistant",
    content: "",
    ts: Date.now(),
    pending: true,
    model: usedModel
  });
  render();

  const wantSearch = !imageDataUrl && (state.liveForce || (state.autoSearch && SEARCH_RE.test(userText)));
  let reply = "";

  try {
    if (imageDataUrl) {
      updatePending("Looking at image…");
      reply = await callModel(null, userText, false, usedModel, imageDataUrl);
    } else if (wantSearch) {
      updatePending("Searching the web…");
      const searchResult = await tavilySearch(userText);
      if (searchResult.ok) {
        updatePending("Reading results…");
        const context = `Web search results for "${userText}":\n\n${searchResult.text}\n\nBased on the above, answer the user helpfully. Cite sources when relevant.`;
        reply = await callModel(context, userText, true, usedModel);
      } else {
        reply = await callModel(null, userText, false, usedModel);
      }
    } else {
      reply = await callModel(null, userText, false, usedModel);
    }
  } catch (err) {
    if (err.name === "AbortError") {
      reply = state.messages[pendingIdx]?.content || "(stopped)";
    } else {
      // Fallback
      const fb = document.getElementById("fallbackSelect")?.value || "retry";
      const maxRetries = parseInt(document.getElementById("retrySelect")?.value || "2", 10);
      let tried = 0;
      let lastErr = err;

      while (tried < maxRetries) {
        tried++;
        try {
          if (fb === "search") {
            const sr = await tavilySearch(userText);
            reply = sr.ok ? sr.text : `Error: ${sr.error}`;
            break;
          } else if (fb === "llama") {
            usedModel = "meta/llama-3.3-70b-instruct";
            reply = await callModel(null, userText, false, usedModel);
            break;
          } else if (fb === "mistral") {
            usedModel = "mistralai/mistral-large-2-instruct";
            reply = await callModel(null, userText, false, usedModel);
            break;
          } else {
            reply = await callModel(null, userText, false);
            break;
          }
        } catch (e2) {
          lastErr = e2;
        }
      }
      if (!reply) {
        reply = `Error: ${lastErr.message}`;
        state.messages[pendingIdx].error = true;
      }
    }
  }

  state.messages[pendingIdx] = {
    role: "assistant",
    content: reply || "No response.",
    ts: Date.now(),
    model: usedModel,
    error: state.messages[pendingIdx]?.error
  };

  state.busy = false;
  state.abort = null;
  setBusyUI(false);
  saveSessions();
  render();
}

function updatePending(label) {
  const last = state.messages[state.messages.length - 1];
  if (last?.pending) {
    last.pendingLabel = label;
    render();
  }
}

function currentModel() {
  return document.getElementById("modelSelect")?.value || "nvidia/nemotron-3-super-120b-a12b";
}

async function callModel(systemExtra, userText, isSearch, forceModel, imageDataUrl) {
  const model = forceModel || currentModel();
  const maxTokens = EFFORT_TOKENS[state.effort] || 16384;
  const isVision = !!imageDataUrl || VISION_MODELS.includes(model);

  const messages = [];
  messages.push({
    role: "system",
    content:
      "You are BOATIN, a sharp and helpful AI assistant. Be clear, concise, and accurate. Use markdown when useful." +
      (imageDataUrl ? " You can see and describe images the user shares." : "") +
      (systemExtra ? "\n\n" + systemExtra : "")
  });

  if (state.keepContext && !imageDataUrl) {
    const history = state.messages
      .filter((m) => !m.pending && m.content && !m.image)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }));
    if (history.length && history[history.length - 1].role === "user") history.pop();
    messages.push(...history);
  }

  // Multimodal user message when image present
  if (imageDataUrl) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: userText || "Describe this image in detail." },
        { type: "image_url", image_url: { url: imageDataUrl } }
      ]
    });
  } else {
    messages.push({ role: "user", content: userText });
  }

  const controller = new AbortController();
  state.abort = controller;

  // Streaming often flaky with vision payloads — disable for images
  const useStream = state.stream && !imageDataUrl;

  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.7,
    stream: useStream
  };

  const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEYS.NVIDIA}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: controller.signal
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${t.slice(0, 180)}`);
  }

  if (useStream && res.body) {
    return streamResponse(res);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function streamResponse(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";

  const pendingIdx = state.messages.length - 1;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content || "";
        if (delta) {
          full += delta;
          if (state.messages[pendingIdx]) {
            state.messages[pendingIdx].content = full;
            state.messages[pendingIdx].pending = true;
            state.messages[pendingIdx].streaming = true;
          }
          renderStreaming(pendingIdx);
        }
      } catch (_) {}
    }
  }
  return full;
}

function renderStreaming(idx) {
  const container = document.getElementById("messages");
  const el = container?.children[idx];
  if (!el) {
    render();
    return;
  }
  const msg = state.messages[idx];
  const body = el.querySelector(".msg-body");
  if (body) {
    body.innerHTML = renderMarkdown(msg.content) + '<span class="streaming-cursor"></span>';
    if (typeof hljs !== "undefined") {
      body.querySelectorAll("pre code").forEach((b) => {
        try { hljs.highlightElement(b); } catch (_) {}
      });
    }
  }
  container.scrollTop = container.scrollHeight;
}

/* ── Search ──────────────────────────────────────────────────── */
async function tavilySearch(query) {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: API_KEYS.TAVILY,
        query,
        max_results: 10,
        include_answer: true
      })
    });
    if (!res.ok) throw new Error(`Tavily ${res.status}`);
    const data = await res.json();
    let text = "";
    if (data.answer) text += `**Summary:** ${data.answer}\n\n`;
    (data.results || []).forEach((r, i) => {
      text += `**${i + 1}. ${r.title}**\n${(r.content || "").slice(0, 320)}\n${r.url ? `[source](${r.url})` : ""}\n\n`;
    });
    return { ok: true, text: text || "No results." };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ── Helpers ─────────────────────────────────────────────────── */
function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(0, 24000));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    // Resize large images to keep payload reasonable (~1.5MP max)
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxSide = 1280;
      let { width, height } = img;
      if (width > maxSide || height > maxSide) {
        const scale = maxSide / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      // fallback: raw file reader
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    };
    img.src = url;
  });
}

function setBusyUI(busy) {
  document.getElementById("sendBtn").disabled = busy;
  document.getElementById("actStop").disabled = !busy;
  document.getElementById("statusDot").style.background = busy ? "#ff9f0a" : "var(--accent)";
}

function stopGeneration() {
  if (state.abort) state.abort.abort();
}

function regenerate() {
  if (state.busy) return;
  let lastUser = null;
  let lastImage = null;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].role === "user") {
      lastUser = state.messages[i].content;
      lastImage = state.messages[i].image || null;
      if (state.messages[i + 1]?.role === "assistant") {
        state.messages.splice(i + 1);
      }
      break;
    }
  }
  if (lastUser || lastImage) {
    render();
    runAssistant(lastUser || "Describe this image.", true, lastImage);
  }
}

function copyLast() {
  const last = [...state.messages].reverse().find((m) => m.role === "assistant" && m.content);
  if (last) {
    navigator.clipboard.writeText(last.content).then(() => {
      alert("Copied last reply");
    });
  }
}

function exportChat() {
  const lines = state.messages.map((m) => {
    const who = m.role === "user" ? "You" : "BOATIN";
    return `### ${who}\n${m.content}\n`;
  });
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `boatin-${state.currentId}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMarkdown(text) {
  if (typeof marked !== "undefined") {
    try {
      marked.setOptions({ breaks: true, gfm: true });
      return marked.parse(text || "");
    } catch (_) {}
  }
  return escapeHtml(text || "").replace(/\n/g, "<br>");
}

/* ── Render ──────────────────────────────────────────────────── */
function render() {
  const container = document.getElementById("messages");
  if (!container) return;

  if (!state.messages.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="logo">BOATIN</div>
        <p>Ask anything. Toggle <strong>⚡ Live</strong> for real-time web search.</p>
      </div>`;
    return;
  }

  container.innerHTML = state.messages
    .map((msg, i) => {
      if (msg.pending && !msg.streaming && !msg.content) {
        return `
          <div class="msg assistant pending">
            <span class="msg-role">BOATIN</span>
            <div class="thinking">
              <div class="thinking-bars"><i></i><i></i><i></i><i></i><i></i></div>
              <span class="thinking-label">${escapeHtml(msg.pendingLabel || "Thinking…")}</span>
            </div>
          </div>`;
      }

      const isUser = msg.role === "user";
      let body;
      if (isUser) {
        const imgHtml = msg.image
          ? `<img src="${msg.image}" class="msg-image" alt="${escapeHtml(msg.imageName || "image")}" loading="lazy">`
          : "";
        body = imgHtml + (msg.content ? `<p>${escapeHtml(msg.content)}</p>` : "");
      } else {
        body = renderMarkdown(msg.content) + (msg.streaming ? '<span class="streaming-cursor"></span>' : "");
      }

      const modelBadge = !isUser && msg.model
        ? `<span class="msg-model">${escapeHtml(msg.model.split("/").pop())}</span>`
        : "";

      const actions = !isUser && !msg.pending
        ? `<div class="msg-actions">
             <button class="msg-act" data-copy="${i}">Copy</button>
           </div>`
        : "";

      return `
        <div class="msg ${msg.role}${msg.pending ? " pending" : ""}${msg.error ? " error" : ""}">
          <span class="msg-role">${isUser ? "You" : "BOATIN"}</span>
          <div class="msg-body">${body}</div>
          <div class="msg-meta">
            <span class="msg-time">${new Date(msg.ts).toLocaleTimeString()}</span>
            ${modelBadge}
            ${actions}
          </div>
        </div>`;
    })
    .join("");

  // highlight + copy buttons
  if (typeof hljs !== "undefined") {
    container.querySelectorAll("pre code").forEach((b) => {
      try { hljs.highlightElement(b); } catch (_) {}
    });
  }
  container.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.copy, 10);
      const m = state.messages[idx];
      if (m) navigator.clipboard.writeText(m.content);
      btn.textContent = "✓";
      setTimeout(() => (btn.textContent = "Copy"), 1200);
    });
  });

  container.scrollTop = container.scrollHeight;
}

/* ── Sessions modal ──────────────────────────────────────────── */
function openSessions() {
  renderSessionsList();
  document.getElementById("sessionsModal").hidden = false;
}

function closeSessions() {
  document.getElementById("sessionsModal").hidden = true;
}

function renderSessionsList() {
  const list = document.getElementById("sessionsList");
  const ids = Object.keys(state.sessions).sort(
    (a, b) => (state.sessions[b].updated || 0) - (state.sessions[a].updated || 0)
  );
  if (!ids.length) {
    list.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:20px">No sessions yet</p>`;
    return;
  }
  list.innerHTML = ids
    .map((id) => {
      const s = state.sessions[id];
      const active = id === state.currentId ? " active" : "";
      const date = new Date(s.updated || 0).toLocaleDateString();
      return `
        <div class="session-item${active}" data-id="${id}">
          <div class="s-title">${escapeHtml(s.title || "Chat")}</div>
          <div class="s-meta">${date}</div>
          <button class="s-del" data-del="${id}">🗑</button>
        </div>`;
    })
    .join("");

  list.querySelectorAll(".session-item").forEach((el) => {
    el.addEventListener("click", () => switchSession(el.dataset.id));
  });
  list.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", (e) => deleteSession(btn.dataset.del, e));
  });
}

document.addEventListener("DOMContentLoaded", init);
