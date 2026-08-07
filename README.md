# ⚡ Uplink Studio (UP-04)

A fast, **mobile-first** AI chat interface powered by **NVIDIA NIM** — one self-contained HTML file on GitHub Pages, backed by a Cloudflare Worker proxy.

🔗 **Live demo:** [CLICK 👆🏻](https://uplinkstudio10.github.io/BOATIN/)

---

## ✨ Features

### Chat core
- 💬 Clean **mobile-first** UI with markdown + syntax-highlighted code
- ⚡ **Streaming** replies (token-by-token) with stop button
- 🧠 **Effort** control — Low / Mid / High / Max (temperature, tokens, style)
- 🔀 **Auto Mode** — picks model category from your message (coding, vision, reasoning, news…)
- 🔁 **Fallback** — if a model fails, retries the next one automatically
- 🌐 Replies match your language (**Bangladeshi Bangla**, **Indian Bangla**, English, Hindi…)
- 🟢 Smooth **thinking** animation + ultra-smooth UI transitions

### Categories (top tabs — touch friendly)
| Tab | What it does |
|---|---|
| 🎯 **Model** | Pick a verified NVIDIA model |
| ⚡ **Effort** | Low → Max depth / length |
| 🤖 **Auto** | Auto Mode ON / OFF |
| 🔁 **Fallback** | Fallback ON / OFF |
| 🚀 **Actions** | Web Pulse, Best/Coding/Vision/Fast models, prompts, copy/speak last, Clear |

### Web Pulse (live web search)
- 🌐 **Server-side search** via Worker `POST /search` (avoids browser CORS)
- Parallel sources: DuckDuckGo, Bing, Google (via Jina), Wikipedia, Reddit + deep page reads
- Grok-style answers: direct lead, facts, uncertainty, bottom line
- 📎 Clickable **Sources** under the answer
- Auto-falls back to normal chat if search evidence is empty

### Coding
- Dedicated coding entry: **Nemotron 3 Ultra 550B** (`nvidia/nemotron-3-ultra-550b-a55b`)

### UX extras
- 🔊 **Speak** pill (Grok-style) — reads the last assistant reply (TTS)
- Voice language in Settings: Auto / bn-IN / bn-BD / en-US / en-IN / hi-IN
- ✏️ **Edit & resend** last user message
- ↻ **Regenerate** last answer (under the message, not in header)
- ■ **Stop** generation (AbortController) + `Esc`
- 📋 Copy message / copy code / save code file
- ↓ **Scroll-to-latest** floating button when you’re scrolled up
- 📎 Attach images/files for vision / context
- 🔒 No user API key in the browser — key stays in Cloudflare Worker Secret
- Single chat session (no multi-chat clutter)

---

## 🧩 Architecture

```
Browser (index.html)
    │
    ├─ chat ──────────► Cloudflare Worker  POST /        ──► NVIDIA /v1/chat/completions
    ├─ image ─────────► Cloudflare Worker  POST /image   ──► NVIDIA image / GenAI paths
    ├─ image edit ────► Cloudflare Worker  POST /image/edit
    └─ web search ────► Cloudflare Worker  POST /search  ──► Jina / DDG / Wiki / Reddit (server-side)
                              │
                              └─ evidence text + sources JSON ──► chat model synthesizes answer
```

The frontend **never** sees the NVIDIA API key.

> Web search must go through the Worker. Browser-only fetches to Jina/Google are blocked by CORS and will look like “AI-only” answers.

---

## 🤖 Model Catalog (UP-74)

| Category | Models |
|---|---|
| 🏆 Recommended | Nemotron 3 Super 120B, DeepSeek V3.2, Llama 3.3 70B, Llama 3.1 405B |
| 🌐 Web Pulse | Kimi K2.6 (+ multi-model synth fallbacks) |
| 🧠 Reasoning | DeepSeek R1, GPT-OSS 120B, QwQ 32B |
| 💻 Coding | **Nemotron 3 Ultra 550B** only |
| 👁️ Vision | Nemotron Nano 12B VL, Llama 3.2 Vision 90B/11B, Phi-3.5 Vision |
| ⚡ Fast | Llama 3.2 3B, Llama 3.1 8B, Mistral Nemo 12B, Gemma 2 9B, Phi-4 Mini |

> Exact availability depends on your NVIDIA account / free tier. Prefer **Fallback ON**.

### Effort presets

| Level | Style | max_tokens |
|---|---|---|
| Low | Fast, short | 4,096 |
| Mid | Balanced | 16,384 |
| High | Deep / full modules | 32,768 |
| Max | Maximum output budget | 65,536 |

---

## 🚀 Setup (your own copy)

### 1. Cloudflare Worker
1. Deploy the latest `worker.js` as a Worker  
2. Add Secret: **`NVIDIA_API_KEY`**  
3. Set `ALLOWED_ORIGINS` to your GitHub Pages origin (e.g. `https://youruser.github.io`)  
4. Confirm health: `GET https://YOUR_WORKER/health` → `"status":"ok"`, `"hasKey":true`

Worker routes:

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Status JSON |
| POST | `/` | Chat completions proxy |
| POST | `/image` | Image generation |
| POST | `/image/edit` | Image edit (multipart) |
| POST | `/search` | **Live web search** (required for Web Pulse) |

### 2. Frontend
1. Open `index.html`  
2. Set:
   ```js
   const WORKER_PROXY_URL = "https://YOUR_WORKER.workers.dev/";
   ```
3. Push to GitHub and enable **GitHub Pages**  
4. Hard-refresh the site after each deploy (`Ctrl/Cmd+Shift+R`)

---

## ⚠️ Model Availability

NVIDIA renames and retires models often. If you see `404` / `410`:

1. Open the model card on [build.nvidia.com](https://build.nvidia.com/models)  
2. Copy the exact `model="..."` string from its sample  
3. Update `NVIDIA_MODEL_GROUPS` in `index.html`

### Web Pulse tips
- Deploy Worker with **`POST /search`** or search will fail / look like pure model memory  
- If synthesizer models fail, UI falls back to normal Nemotron chat  
- For pure chat without the web, pick **Nemotron** or leave Auto Mode on  

### Image tips
- Image generation is optional; many free-tier image models 404  
- Prefer chat + vision models for photo analysis  

---

## ⚙️ Limits

- NVIDIA free tier is rate-limited and meant for prototyping  
- One shared API key — heavy public traffic will hit limits fast  
- Search providers can rate-limit; Web Pulse shows a clear error when evidence is missing  

---

## 📁 Project files

| File | Role |
|---|---|
| `index.html` | Full UI + client logic (**UP-74**) |
| `worker.js` | Cloudflare proxy (chat + image + **search**) |
| `README.md` | This doc |

---

Built with 🟢 vanilla JS, [marked.js](https://marked.js.org/), and [highlight.js](https://highlightjs.org/).
