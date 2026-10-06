# BOATIN Backend Architecture

## 🏗️ Two-Tier Architecture

```
┌─────────────────────────────────┐
│  Frontend (Client)              │
│  ┌─────────────────────────────┐│
│  │ index-ultimate.html         ││
│  │ app-ultimate-backend.js     ││ ← Updated to use backend
│  │ styles-ultimate.css         ││
│  └─────────────────────────────┘│
└────────────────┬────────────────┘
                 │
         (HTTPS Requests)
                 │
                 ↓
┌─────────────────────────────────┐
│  Backend Server (Node.js)       │
│  ┌─────────────────────────────┐│
│  │ server.js (Express)         ││
│  │ POST /api/search/tavily     ││
│  │ POST /api/search/exa        ││
│  │ POST /api/search/bytez      ││
│  │ POST /api/chat              ││
│  └─────────────────────────────┘│
│                                 │
│  🔐 API Keys in Environment     │
│  ✅ CORS Enabled               │
│  ✅ Caching (5 min)            │
│  ✅ Error Handling             │
└────────────────┬────────────────┘
                 │
       ┌─────────┼─────────┬──────────┐
       ↓         ↓         ↓          ↓
    NVIDIA    Tavily     Exa       Bytez
    (Chat)   (Search)  (Search)  (Search)
```

## 🔐 Security Benefits

| Feature | Client-Side | Backend Proxy |
|---------|-------------|---------------|
| API Keys | ❌ Exposed | ✅ Hidden |
| Rate Limiting | ❌ No | ✅ Yes |
| Caching | ❌ No | ✅ Yes (5 min) |
| CORS | ❌ Risky | ✅ Controlled |
| Error Handling | ⚠️ Basic | ✅ Advanced |
| Analytics | ❌ No | ✅ Possible |

## 🚀 Deployment Options

### Option A: Heroku (Free tier available)
```bash
heroku login
heroku create boatin-backend
heroku config:set NVIDIA_API_KEY=...
git push heroku main
```
**Frontend connects to:** `https://boatin-backend.herokuapp.com`

### Option B: Railway (Easy, free tier)
```bash
npm install -g @railway/cli
railway init
railway up
```

### Option C: Render (Free tier)
1. Push code to GitHub
2. Connect Render to repo
3. Set environment variables
4. Deploy

### Option D: DigitalOcean (VPS)
```bash
# SSH into droplet
cd /app
git clone <repo>
cd <repo>
npm install
npm start
```

### Option E: AWS Lambda
Requires serverless framework setup

## 📝 Configuration

### Environment Variables (.env)
```
NVIDIA_API_KEY=nvapi-xxx
TAVILY_API_KEY=tvly-xxx
EXA_API_KEY=xxx
BYTEZ_API_KEY=xxx
PORT=3000
NODE_ENV=production
```

### Frontend Configuration
Update in `app-ultimate-backend.js`:
```javascript
const API_BASE_URL = 'https://your-backend-url.com';
```

Or use environment variable:
```javascript
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';
```

## 🔄 Request/Response Flow

### Search Request
```json
Frontend:
POST /api/search/tavily
{
  "query": "latest AI news"
}

Backend:
↓ (calls Tavily API with secret key)
↓
Response:
{
  "ok": true,
  "provider": "Tavily",
  "results": [...],
  "resultCount": 5
}
```

### Chat Request
```json
Frontend:
POST /api/chat
{
  "messages": [{role: "user", content: "hi"}],
  "model": "nvidia/nemotron-3-super-120b-a12b",
  "max_tokens": 16384
}

Backend:
↓ (calls NVIDIA API with secret key)
↓
Response:
{
  "ok": true,
  "reply": "Hello! How can I help?",
  "model": "nvidia/nemotron-3-super-120b-a12b",
  "tokens": 42
}
```

## 🧪 Local Testing

```bash
# Start backend
npm start
# Backend runs on http://localhost:3000

# In another terminal, test frontend
# Point to http://localhost:3000

# Or test with curl
curl -X POST http://localhost:3000/api/search/tavily \
  -H "Content-Type: application/json" \
  -d '{"query": "hello"}'
```

## 📊 Monitoring

### Health Check
```bash
curl http://localhost:3000/health
# Response: {status: "ok", uptime: 1234.56, timestamp: "..."}
```

### Logs
```bash
# Development
npm run dev
# Shows all requests & errors

# Production
# Check deployment platform logs (Heroku, Railway, etc.)
```

## 🔒 Security Checklist

- [ ] API keys in .env (not in code)
- [ ] .env in .gitignore
- [ ] CORS properly configured
- [ ] HTTPS only in production
- [ ] Input validation on backend
- [ ] Error handling without leaking info
- [ ] Rate limiting configured
- [ ] Logging for monitoring

## 🚨 Troubleshooting

### "Cannot connect to backend"
- Verify backend is running
- Check API_BASE_URL in frontend
- Check CORS configuration
- Verify firewall/network

### "API key error"
- Verify .env file has keys
- Check API services are active
- Verify key format

### "Slow responses"
- Check cache (5 min TTL)
- Monitor API rate limits
- Check network latency

---

## 📁 Files Summary

| File | Purpose |
|------|---------|
| `server.js` | Backend server (Express) |
| `package.json` | Node.js dependencies |
| `.env.example` | Environment template |
| `app-ultimate-backend.js` | Frontend (updated) |
| `index-ultimate.html` | UI (unchanged) |
| `styles-ultimate.css` | Styles (unchanged) |

---

**Backend architecture is production-ready!** 🎉
