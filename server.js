/**
 * BOATIN Backend Proxy Server
 * 
 * Handles API requests from frontend
 * Keeps API keys secure (environment variables)
 * Provides rate limiting & caching
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Simple in-memory cache (for production, use Redis)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ═══════════════════════════════════════════════════════════════
// SEARCH ENDPOINTS
// ═══════════════════════════════════════════════════════════════

/**
 * POST /api/search/tavily
 * Proxy request to Tavily Search API
 */
app.post('/api/search/tavily', async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query required' });
    }

    // Check cache
    const cacheKey = `tavily:${query}`;
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      if (Date.now() - cached.time < CACHE_TTL) {
        return res.json({ ...cached.data, cached: true });
      }
      cache.delete(cacheKey);
    }

    // Call Tavily API
    const response = await axios.post('https://api.tavily.com/search', {
      api_key: process.env.TAVILY_API_KEY,
      query: query,
      max_results: 15,
      include_answer: true
    }, {
      timeout: 10000
    });

    const data = response.data;
    const results = (data.results || []).map(r => ({
      title: r.title,
      content: r.content,
      url: r.url
    }));

    const reply = {
      ok: true,
      provider: 'Tavily',
      results: results,
      resultCount: results.length,
      answer: data.answer || null
    };

    // Cache result
    cache.set(cacheKey, { data: reply, time: Date.now() });

    res.json(reply);
  } catch (error) {
    console.error('Tavily error:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
      provider: 'Tavily'
    });
  }
});

/**
 * POST /api/search/exa
 * Proxy request to Exa Search API
 */
app.post('/api/search/exa', async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query required' });
    }

    // Check cache
    const cacheKey = `exa:${query}`;
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      if (Date.now() - cached.time < CACHE_TTL) {
        return res.json({ ...cached.data, cached: true });
      }
      cache.delete(cacheKey);
    }

    // Call Exa API
    const response = await axios.post('https://api.exa.ai/search', {
      query: query,
      numResults: 15,
      useAutoprompt: true,
      type: 'neural'
    }, {
      headers: {
        'x-api-key': process.env.EXA_API_KEY
      },
      timeout: 10000
    });

    const data = response.data;
    const results = (data.results || []).map(r => ({
      title: r.title,
      text: r.text || r.summary || '',
      url: r.url
    }));

    const reply = {
      ok: true,
      provider: 'Exa',
      results: results,
      resultCount: results.length
    };

    // Cache result
    cache.set(cacheKey, { data: reply, time: Date.now() });

    res.json(reply);
  } catch (error) {
    console.error('Exa error:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
      provider: 'Exa'
    });
  }
});

/**
 * POST /api/search/bytez
 * Proxy request to Bytez Search API
 */
app.post('/api/search/bytez', async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query required' });
    }

    // Check cache
    const cacheKey = `bytez:${query}`;
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      if (Date.now() - cached.time < CACHE_TTL) {
        return res.json({ ...cached.data, cached: true });
      }
      cache.delete(cacheKey);
    }

    // Call Bytez API
    const response = await axios.get('https://api.bytez.com/search', {
      params: {
        q: query,
        count: 15
      },
      headers: {
        'Authorization': `Bearer ${process.env.BYTEZ_API_KEY}`
      },
      timeout: 10000
    });

    const data = response.data;
    const results = (data.results || []).map(r => ({
      title: r.title || r.name,
      snippet: r.snippet || r.description || '',
      url: r.url || r.link
    }));

    const reply = {
      ok: true,
      provider: 'Bytez',
      results: results,
      resultCount: results.length
    };

    // Cache result
    cache.set(cacheKey, { data: reply, time: Date.now() });

    res.json(reply);
  } catch (error) {
    console.error('Bytez error:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
      provider: 'Bytez'
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// CHAT ENDPOINT
// ═══════════════════════════════════════════════════════════════

/**
 * POST /api/chat
 * Proxy request to NVIDIA NIM API
 */
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, model, max_tokens } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages required' });
    }

    const selectedModel = model || 'nvidia/nemotron-3-super-120b-a12b';

    const response = await axios.post(
      'https://integrate.api.nvidia.com/v1/chat/completions',
      {
        model: selectedModel,
        messages: messages,
        max_tokens: max_tokens || 2048,
        temperature: 0.7,
        top_p: 0.9
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const data = response.data;
    const reply = data.choices?.[0]?.message?.content || 'No response';

    res.json({
      ok: true,
      reply: reply,
      model: selectedModel,
      usage: data.usage,
      tokens: data.usage?.completion_tokens
    });
  } catch (error) {
    console.error('Chat error:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ═══════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║  BOATIN Backend Proxy Server Ready    ║
╚═══════════════════════════════════════╝

🚀 Server running on port ${PORT}
📡 API endpoints:
   POST /api/search/tavily
   POST /api/search/exa
   POST /api/search/bytez
   POST /api/chat
   GET  /health

🔐 API keys loaded from .env
⚡ Response caching enabled (5 min TTL)
`);
});

module.exports = app;
