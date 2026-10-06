# BOATIN Backend Deployment Guide

## 🚀 Quick Start

### 1. Prerequisites
- Node.js 14+ installed
- API keys from: NVIDIA, Tavily, Exa, Bytez

### 2. Setup

```bash
# Clone or download backend files
# - server.js
# - package.json
# - .env.example

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Add your API keys to .env
# NVIDIA_API_KEY=...
# TAVILY_API_KEY=...
# EXA_API_KEY=...
# BYTEZ_API_KEY=...
```

### 3. Run Locally

```bash
npm start
# Server runs on http://localhost:3000
```

Or with auto-reload (development):
```bash
npm run dev
```

### 4. Deploy

**Heroku:**
```bash
heroku login
heroku create boatin-backend
heroku config:set NVIDIA_API_KEY=...
heroku config:set TAVILY_API_KEY=...
heroku config:set EXA_API_KEY=...
heroku config:set BYTEZ_API_KEY=...
git push heroku main
```

**Railway:**
```bash
npm install -g @railway/cli
railway init
railway up
```

**Render:**
1. Connect GitHub repo
2. Create Web Service
3. Set environment variables
4. Deploy

**AWS Lambda + API Gateway:**
```bash
npm install -g serverless
serverless deploy
```

**DigitalOcean App Platform:**
1. Connect GitHub
2. Set environment variables
3. Deploy

### 5. Test

```bash
# Health check
curl http://localhost:3000/health

# Test Tavily search
curl -X POST http://localhost:3000/api/search/tavily \
  -H "Content-Type: application/json" \
  -d '{"query": "hello world"}'

# Test chat
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "hi"}]}'
```

### 6. Connect Frontend

Update `app-ultimate.js` to use backend:

```javascript
// Old (client-side API calls)
const NVIDIA_CHAT_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

// New (server-side proxy)
const API_BASE_URL = "https://your-backend-url.com";

// Update search functions
async function tavilySearch(query) {
  const res = await fetch(`${API_BASE_URL}/api/search/tavily`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({query})
  });
  return res.json();
}

// Update chat function
async function callNvidiaChat(messages, model) {
  const res = await fetch(`${API_BASE_URL}/api/chat`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({messages, model})
  });
  return res.json();
}
```

---

## 🔐 Security

✅ API keys never exposed to frontend
✅ All requests validated
✅ CORS configured
✅ Rate limiting ready (add middleware)
✅ Error handling & logging

## 📊 Features

- Response caching (5 min TTL)
- Error handling
- Health check endpoint
- CORS enabled
- Environment-based config
- Production ready

## 🐛 Troubleshooting

**"Cannot find module"**
```bash
npm install
```

**Port already in use**
```bash
PORT=3001 npm start
```

**API key errors**
- Check .env file has correct keys
- Verify API services are active

---

**Backend ready for production!** 🚀
