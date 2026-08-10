# BOATIN · UP-17

**Browser-based AI chat powered by NVIDIA NIM — hosted on GitHub Pages with a Cloudflare Worker proxy.**

---

## What is this?

BOATIN (UP-17) is a single-page AI chat app that runs entirely in the browser. It connects to [NVIDIA NIM](https://build.nvidia.com) models through a Cloudflare Worker proxy (`boatin.uplinkstudio.workers.dev`) that keeps the API key secure on the server side. No backend, no database, no login — just open and chat.

---

## Project Structure

```
├── index.html      — App shell, modals, markup
├── app.js          — All logic: models, chat, agent, search, image gen
├── styles.css      — Liquid Glass theme, layout, animations
└── worker-1.js     — Cloudflare Worker proxy (deploy separately)
```

---

## Features

### 💬 Chat
- Streaming responses with live cursor
- Multi-turn conversation with full context
- Markdown rendering with code syntax highlighting
- Edit any past user message, regenerate last response
- Copy, Listen (TTS), Save code blocks to file
- File & image attachment (vision models)

### 🌐 Web Pulse (Live Search)
- Searches Wikipedia, DuckDuckGo, Reddit, Stack Overflow, Hacker News, WikiNews — up to 50 sources
- Synthesizes a live-grounded answer with clickable source citations
- Select any **Research •** model from the Web Pulse category to activate

### 🚀 Power House Agent
- Autonomous 4-step coding agent
- **Plan → Build → Self-review → Fix** loop — no placeholders, no half-finished code
- Produces complete, runnable single-file HTML/CSS/JS apps
- Live Preview button opens the result in a sandboxed iframe directly in the app

### 🎨 Image Generation
- Supported models: Flux.1 Dev, Flux.1 Schnell, Stable Diffusion 3.5 Large, Qwen Image, Qwen Image 2512
- Auto-routes to Worker `/image` endpoint, not the chat completions path
- Download generated images directly from the chat

### 🌤️ Weather
- Real-time weather via Open-Meteo (no API key needed)
- Current conditions + 3-day forecast
- Trigger via **Actions → Weather** or just ask "weather in [city]"

### ⚙️ Settings (hidden, accessible via `Ctrl/Cmd + ,`)
- Custom system prompt
- Font size (Small / Medium / Large)
- Accent theme color swatches

---

## Model Categories

| Category | Models |
|---|---|
| 🏆 Recommended | Nemotron 3 Super 120B, Llama 3.3 70B, Llama 3.1 8B, Mistral Nemo 12B |
| 🌐 Web Pulse | Research · Nemotron Super, Research · Llama 8B, Research · Llama 3B, Research · Mistral, Research · Nemotron (quick) |
| 🚀 Power House | Power House Agent (autonomous coding) |
| 🧠 Reasoning | Nemotron 3 Super 120B, Llama 3.1 8B |
| 💻 Coding | Nemotron 3 Super 120B, Llama 3.1 8B |
| 👁️ Vision | Nemotron Nano 12B VL, Llama 3.2 11B Vision |
| ⚡ Fast | Llama 3.2 3B, Llama 3.1 8B, Mistral Nemo 12B |

---

## Setup

### 1. Deploy the Cloudflare Worker

1. Go to [Cloudflare Workers](https://workers.cloudflare.com/) and create a new Worker
2. Paste the contents of `worker-1.js`
3. Add a secret: **Settings → Variables → Secret** → name it `NVIDIA_API_KEY`, paste your key
4. Deploy — note the worker URL (e.g. `https://boatin.uplinkstudio.workers.dev/`)

### 2. Set the Worker URL in app.js

```js
// Line 2 in app.js
const WORKER_PROXY_URL = "https://your-worker.workers.dev/";
```

### 3. Deploy the Frontend

Push `index.html`, `app.js`, and `styles.css` to a GitHub repo and enable **GitHub Pages** (Settings → Pages → Deploy from branch → main).

### 4. Add your GitHub Pages origin to the Worker

The Worker's CORS list already allows any `*.github.io` origin by default, so no extra configuration needed.

---

## Worker API Routes

| Route | Method | Description |
|---|---|---|
| `GET /` or `/health` | GET | Health check, returns `{ status: "ok" }` |
| `/` | POST | Chat completions proxy → NVIDIA NIM |
| `/image` | POST | Image generation (Flux, SD3.5, Qwen Image) |
| `/image/edit` | POST | Image editing (multipart/form-data) |
| `/search` | POST | Web search (no API key needed) |
| `/weather` | POST | Weather via Open-Meteo (no API key needed) |

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Enter` | Send message |
| `Shift + Enter` | New line |
| `Ctrl/Cmd + K` | Focus search |
| `Ctrl/Cmd + ,` | Open settings |
| `Ctrl/Cmd + /` | Show shortcuts |
| `Ctrl/Cmd + N` | Clear chat |
| `Esc` | Close modal / lightbox |

---

## Tech Stack

- **Frontend:** Vanilla HTML / CSS / JS — no build step, no framework
- **AI:** [NVIDIA NIM](https://build.nvidia.com) (OpenAI-compatible API)
- **Proxy:** Cloudflare Workers (Edge runtime, free tier)
- **Search:** Wikipedia API, DuckDuckGo, Reddit JSON, Stack Exchange API, Hacker News Algolia API
- **Weather:** [Open-Meteo](https://open-meteo.com/) (free, no key)
- **Hosting:** GitHub Pages

---

## Version History

| Version | Notes |
|---|---|
| UP-17 | Current release |
| UP-16 | Previous release |

---

## License

Personal project — not for redistribution.
