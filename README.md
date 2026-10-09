# ⚡ CRAXTEN ∞

> **Browser-based AI Chat App with NVIDIA Serverless API**  
> Unlimited tokens (1M) • No rate limits • No budget restrictions

![License](https://img.shields.io/badge/license-MIT-green)
![Status](https://img.shields.io/badge/status-active-brightgreen)
![Tokens](https://img.shields.io/badge/tokens-1M%20unlimited-blue)

---

## 🎯 Overview

**CRAXTEN** is a lightweight, browser-based AI chat application powered by **NVIDIA Serverless API**. It's a single HTML file with no external dependencies, supporting multiple AI models, four search engines, and hybrid functionality.

### Key Features

✨ **1M UNLIMITED TOKENS** - Fixed max tokens at 1,000,000 — no presets, no limits  
⚡ **NVIDIA Serverless** - Direct API integration  
🚀 **7 AI Models** - Nemotron, Llama, Mistral, Gemma  
🔍 **4 Search Engines** - Tavily, Exa, Bytez, BazaarLink  
💬 **Chat Mode** - Direct conversation with AI (model selector only)  
🔎 **Search Mode** - Real-time web search (search engine selector only)  
🚀 **Hybrid Mode** - Search + AI combined (both selectors visible)  
➕ **New Chat** - One-click fresh conversation  
📋 **Chat History** - With full date & time, export & restore  
🔊 **Listen** - Text-to-speech at the bottom of every AI reply  
📱 **Responsive Design** - Works on mobile & desktop  
🎨 **Modern UI** - Glassmorphism dark theme  

---

## 📦 Installation

### Quick Start

1. **Download the file:**
   ```bash
   # Download craxten-final.html
   ```

2. **Open in browser:**
   ```bash
   # Option 1: Double-click the file
   # Option 2: Open with local server
   python3 -m http.server 8000
   # Then visit: http://localhost:8000/craxten-final.html
   ```

3. **Deploy on GitHub Pages:**
   ```bash
   # 1. Create repository
   git clone https://github.com/your-username/craxten
   cd craxten

   # 2. Add file
   cp craxten-final.html index.html

   # 3. Push to main branch
   git add .
   git commit -m "Initial commit: CRAXTEN app"
   git push origin main

   # 4. Enable GitHub Pages in Settings
   # Settings → Pages → Source: main branch
   # Your app will be at: https://your-username.github.io/craxten/
   ```

---

## 🚀 Usage

### Basic Chat

1. **Select Mode** - Choose from 💬 Chat, 🔍 Search, or 🚀 Hybrid
2. **Configure Settings** - Model / Search engine appear based on mode
3. **Type Message** - Ask anything (1M token limit)
4. **Get Response** - AI responds with thinking animation
5. **🔊 Listen** - Click Listen at the bottom of any AI reply

### Header Buttons

| Button | Action |
|--------|--------|
| ➕ | **New Chat** — start a fresh conversation |
| 📋 | **History** — view past chats with date & time |
| 🗑️ | **Clear** — clear current messages |
| ✕ | **Toggle** — collapse / expand config panel |

### Configuration (mode-aware)

#### 💬 Chat Mode
- Shows **AI Model** selector only
- Search engine is hidden

#### 🔍 Search Mode
- Shows **Search Engine** selector only
- AI model is hidden

#### 🚀 Hybrid Mode
- Shows **both** AI Model and Search Engine

#### 🤖 AI Models (7 available)
- 🚀 Nemotron Super 120B — Best quality
- 👑 Nemotron Ultra 550B — Most powerful
- ⚡ Nemotron Nano 30B — Fast & capable
- 🦙 Llama 405B — Instruction-tuned
- 🦙 Llama 70B — Balanced performance
- 🌊 Mistral Large — Efficient
- 💎 Gemma 7B — Lightweight

#### 🌡️ Temperature (0.0 – 2.0)
- **0.0** — Deterministic
- **0.7** — Default (balanced)
- **2.0** — Maximum creativity

#### 📊 Max Tokens
- **Permanently set to 1,000,000 (1M)**
- No 2K / 4K / 8K / 16K presets in the UI

#### 🔍 Search Engines
- **Tavily** — Fast, accurate results
- **Exa** — Semantic search
- **Bytez** — Model-inference based
- **BazaarLink** — Tavily-compatible web search

### Modes Explained

#### 💬 Chat Mode
Direct conversation with the selected NVIDIA model.

```
User: "Explain quantum computing"
AI: [Direct response from model]
```

#### 🔍 Search Mode
Real-time web search via the selected engine. Results include titles, URLs, and snippets.

```
User: "Latest AI news 2026"
AI: [Search results with links and summaries]
```

#### 🚀 Hybrid Mode
Search first → inject results as context → NVIDIA model answers with citations.

```
User: "Recent developments in AI"
Response: AI analysis grounded in live search results
```

---

## 🔧 Configuration Guide

### Header Toggle (✕ Button)
Click **✕** to collapse/expand the configuration panel.

### Config Tab (⚙️)
- **AI Model** — visible in Chat & Hybrid
- **Search Engine** — visible in Search & Hybrid
- **Temperature** — always visible (0.0–2.0)
- **Max Tokens** — fixed at 1M (not shown as presets)

### Status Tab (📊)
- **API Status** — NVIDIA Serverless
- **Limit** — UNLIMITED · 1M Tokens
- **Messages** — total message count
- **Response Time** — last call latency (ms)

---

## 📋 Features Details

### New Chat (➕ Button)
- Starts a clean conversation
- Clears current messages only
- Keeps full history intact
- Shows welcome message

### Chat History (📋 Button)
- Lists all previous Q&A with **full date & time**
- Click any item to restore the question into the input
- **Export** → downloads JSON backup
- **Clear** → wipes history (with confirmation)

### Voice Synthesis (🔊 Listen)
- Appears at the **bottom of every AI message bubble**
- Uses browser Web Speech API
- Strips HTML before speaking
- Cancels previous speech when clicked again

### Scroll to Bottom (↓ Button)
- Appears when you scroll up
- Jump to latest message instantly

---

## 🎨 UI/UX

### Dark Theme
- **Background:** `#080908`
- **Primary:** `#00ff88` (green)
- **Secondary:** `#00d4ff` (cyan)
- **Accent:** green → cyan gradient

### Animations
- Message slide-in
- Thinking dots
- Modal scale-in
- Smooth transitions

### Responsive
- Desktop (max 1200px)
- Tablet & mobile optimized

---

## 🔐 Security & API Keys

API keys are embedded in the HTML (frontend-only app):

| Service | Key Variable |
|---------|--------------|
| NVIDIA | `NVIDIA_API_KEY` |
| Tavily | `TAVILY_API_KEY` |
| Exa | `EXA_API_KEY` |
| Bytez | `BYTEZ_API_KEY` |
| BazaarLink | `BAZAARLINK_API_KEY` |

### Data Privacy
- Chat history stored in memory only (session)
- Export downloads to your device
- No tracking or analytics
- Only NVIDIA / search APIs receive requests

### Best Practices
- Prefer HTTPS hosting (GitHub Pages, Netlify, etc.)
- Do not share the HTML file publicly if keys must stay private
- Rotate keys if the file is leaked

---

## 🛠️ Customization

### Change API Keys
Open `craxten-final.html` and locate:

```javascript
const NVIDIA_API_KEY = "nvapi-...";
const TAVILY_API_KEY = "tvly-...";
const EXA_API_KEY = "...";
const BYTEZ_API_KEY = "...";
const BAZAARLINK_API_KEY = "sk-bl-...";
```

### Add / Change Models
```javascript
const NVIDIA_MODELS = [
  { value: 'model-id', label: '🎯 Model Name' },
  // add more
];
```

### Color Scheme
Edit hex colors in the `<style>` block (`#00ff88`, `#00d4ff`, `#080908`).

---

## 📱 Deployment

### GitHub Pages
```bash
git init
git add craxten-final.html
git commit -m "Add CRAXTEN"
git branch -M main
git push -u origin main
# Settings → Pages → main branch
```

### Netlify / Vercel
Drag-and-drop the HTML file or use CLI:

```bash
netlify deploy --prod --dir=.
# or
vercel --prod
```

### Self-Hosted
Any static web server (Apache, Nginx, Python `http.server`). No backend required.

---

## ⚙️ Technical Specs

| Item | Detail |
|------|--------|
| Stack | HTML5, CSS3, Vanilla JS |
| Chat API | NVIDIA Integrate (`/v1/chat/completions`) |
| Search | Tavily, Exa, Bytez, BazaarLink |
| Max tokens | 1,000,000 (fixed) |
| Storage | In-memory session + JSON export |
| Dependencies | None (single HTML file) |
| Browsers | Chrome/Edge 90+, Firefox 88+, Safari 14+ |

---

## 🐛 Troubleshooting

| Problem | Fix |
|---------|-----|
| API error | Check internet, key validity, NVIDIA status |
| Empty model dropdown | Refresh page, clear cache, check console (F12) |
| Search no results | Switch engine, check key, try simpler query |
| Thinking stuck | Wait a few seconds, lower complexity, refresh |
| Listen silent | Allow speech in browser settings, check volume |

---

## 📄 License

MIT License — free to use, modify, and distribute.

---

## 🔗 Links

- **NVIDIA Build:** https://build.nvidia.com
- **Tavily:** https://tavily.com
- **Exa:** https://exa.ai
- **BazaarLink:** https://bazaarlink.ai
- **Bytez:** https://bytez.com

---

## 💡 Tips

1. Use **Hybrid** when you need current web facts + AI reasoning  
2. Lower temperature (0.3–0.5) for facts; higher (1.0–1.5) for creative work  
3. Click **➕** often to keep conversations focused  
4. Export history regularly as JSON backup  
5. Prefer **Tavily** or **BazaarLink** for reliable web snippets  

---

## 🎉 Changelog

### v1.1.0 (Current)
- ✅ Max tokens fixed at **1,000,000** (presets removed)
- ✅ **BazaarLink** search engine added (4 engines total)
- ✅ Mode-aware config: Chat hides search, Search hides model
- ✅ **➕ New Chat** button
- ✅ **🔊 Listen** fixed at bottom of AI message bubbles
- ✅ History list shows **full date & time**
- ✅ All five API keys integrated
- ✅ Hybrid mode: search → NVIDIA with context

### v1.0.0
- NVIDIA Serverless integration
- 7 models, Chat / Search / Hybrid
- History export, voice, dark theme
- Single HTML file

---

**CRAXTEN ∞ — Unlimited AI at your fingertips**

⚡ v1.1.0 | MIT License | NVIDIA Serverless
