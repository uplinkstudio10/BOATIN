/**
 * BOATIN / UplinkStudio — Cloudflare Worker
 * Routes: GET /health | POST / | POST /image | POST /image/edit | POST /search
 * Secret: NVIDIA_API_KEY
 */

const CHAT = "https://integrate.api.nvidia.com/v1";
const GENAI = "https://ai.api.nvidia.com/v1/genai";

const ORIGINS = [
  "https://uplinkstudio10.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://127.0.0.1:3000"
];

const GENAI_PATHS = {
  "black-forest-labs/flux.1-dev": "black-forest-labs/flux.1-dev",
  "black-forest-labs/flux.1-schnell": "black-forest-labs/flux.1-schnell",
  "stabilityai/stable-diffusion-3.5-large": "stabilityai/stable-diffusion-3.5-large",
  "qwen/qwen-image": "qwen/qwen-image",
  "qwen/qwen-image-2512": "qwen/qwen-image-2512"
};

function corsHeaders(origin) {
  var o = origin || "";
  var allow = ORIGINS.indexOf(o) !== -1;
  if (!allow && o) {
    try {
      var host = new URL(o).hostname || "";
      if (host.endsWith(".github.io")) allow = true;
      if (host === "localhost" || host === "127.0.0.1") allow = true;
    } catch (e) {}
  }
  if (!o) allow = true;
  return {
    "Access-Control-Allow-Origin": allow ? (o || "*") : ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, headers)
  });
}

async function passthrough(res, headers) {
  var ct = res.headers.get("Content-Type") || "";
  if (ct.indexOf("text/event-stream") !== -1) {
    return new Response(res.body, {
      status: res.status,
      headers: Object.assign({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive"
      }, headers)
    });
  }
  var text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: Object.assign({
      "Content-Type": ct || "application/json; charset=utf-8"
    }, headers)
  });
}

function normalizeImage(data) {
  if (!data || typeof data !== "object") return data;
  var item = (data.data && data.data[0]) || (data.images && data.images[0]) || (data.artifacts && data.artifacts[0]) || null;
  var b64 = (item && (item.b64_json || item.base64 || item.b64)) || data.b64_json || data.image;
  var url = (item && (item.url || (item.image_url && item.image_url.url))) || data.url || data.image_url;
  if (url) return { data: [{ url: url }] };
  if (b64 && typeof b64 === "string") {
    return { data: [{ b64_json: b64.replace(/^data:image\/\w+;base64,/, "") }] };
  }
  return data;
}

function errorMessage(data, status) {
  if (!data) return "HTTP " + status;
  if (typeof data.error === "string") return data.error;
  if (data.error && data.error.message) return data.error.message;
  if (data.message) return data.message;
  if (data.detail) return data.detail;
  return "HTTP " + status;
}

async function openaiImage(key, model, prompt, extra) {
  extra = extra || {};
  var body = Object.assign({ model: model, prompt: prompt, n: 1 }, extra);
  var res = await fetch(CHAT + "/images/generations", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + key,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(body)
  });
  var text = await res.text();
  var data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data: data };
}

async function genaiImage(key, model, prompt) {
  var path = GENAI_PATHS[model] || model;
  var res = await fetch(GENAI + "/" + path, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + key,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      prompt: prompt,
      cfg_scale: 5,
      aspect_ratio: "1:1",
      seed: 0,
      steps: 25
    })
  });
  var text = await res.text();
  var data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data: data };
}

function isJunkSource(title, href) {
  try {
    var host = new URL(href).hostname.toLowerCase();
    if (/external-content\.duckduckgo|gstatic/i.test(host)) return true;
    if (/\.(png|jpe?g|gif|webp|svg|ico|css|js)(\?|$)/i.test(href)) return true;
    if (/^!?\[?Image\b/i.test(title || "")) return true;
    if ((title || "").length < 3) return true;
    return false;
  } catch (e) {
    return true;
  }
}

async function runWebSearch(query) {
  var q = String(query || "").trim();
  if (!q) return { text: "", sources: [], error: "Empty query" };
  var enc = encodeURIComponent(q);
  var providers = [
    ["google", "https://r.jina.ai/http://www.google.com/search?q=" + enc + "&hl=en&num=15", "html"],
    ["google-news", "https://r.jina.ai/http://news.google.com/search?q=" + enc + "&hl=en-US&gl=US&ceid=US:en", "html"],
    ["bing", "https://r.jina.ai/http://www.bing.com/search?q=" + enc + "&count=15", "html"],
    ["ddg-html", "https://r.jina.ai/http://duckduckgo.com/html/?q=" + enc, "html"],
    ["ddg-api", "https://api.duckduckgo.com/?q=" + enc + "&format=json&no_html=1&skip_disambig=1", "ddg"],
    ["wiki", "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=" + enc + "&utf8=1&format=json&srlimit=5", "wiki"],
    ["reddit", "https://r.jina.ai/http://www.reddit.com/search/?q=" + enc + "&sort=relevance&t=month", "html"]
  ];

  var sources = [];
  var seen = {};
  var chunks = [];
  var lastError = "No results";
  var okCount = 0;

  function push(title, url, snippet) {
    if (sources.length >= 12) return;
    try {
      var u = new URL(String(url).replace(/[),.;]+$/, ""));
      if (u.protocol !== "http:" && u.protocol !== "https:") return;
      var t = String(title || "").replace(/\s+/g, " ").trim();
      t = t.replace(/^!\[[^\]]*\]\s*/g, "").replace(/^\[[^\]]*\]\s*/g, "").trim();
      if (isJunkSource(t, u.href)) return;
      var key = u.hostname.replace(/^www\./, "") + u.pathname;
      if (seen[key]) return;
      seen[key] = true;
      sources.push({
        title: t || u.hostname.replace(/^www\./, ""),
        url: u.href,
        domain: u.hostname.replace(/^www\./, ""),
        snippet: String(snippet || "").slice(0, 240)
      });
    } catch (e) {}
  }

  function extract(raw) {
    var re = /\[([^\]]{2,180})\]\((https?:\/\/[^)\s]+)\)/g;
    var m;
    while ((m = re.exec(raw))) push(m[1], m[2], m[1]);
    var urls = String(raw).match(/https?:\/\/[^\s<>"')]+/g) || [];
    for (var i = 0; i < urls.length && i < 20; i++) push("", urls[i]);
  }

  async function fetchOne(p) {
    var name = p[0];
    var url = p[1];
    var type = p[2];
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 10000);
    try {
      var res = await fetch(url, {
        headers: {
          "Accept": "text/plain, application/json, */*",
          "User-Agent": "BOATIN-Worker/2"
        },
        signal: ctrl.signal
      });
      if (!res.ok) {
        lastError = name + " HTTP " + res.status;
        return null;
      }
      var text = await res.text();
      if (!text || text.trim().length < 20) return null;
      return { name: name, type: type, text: text };
    } catch (e) {
      lastError = (e && e.message) || lastError;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  var hits = await Promise.all(providers.map(fetchOne));
  for (var hi = 0; hi < hits.length; hi++) {
    var hit = hits[hi];
    if (!hit) continue;
    okCount++;
    var name = hit.name;
    var type = hit.type;
    var text = hit.text;

    if (type === "ddg") {
      try {
        var j = JSON.parse(text);
        var bits = [];
        if (j.Heading) bits.push("Topic: " + j.Heading);
        if (j.AbstractText) bits.push(j.AbstractText);
        if (j.Answer) bits.push(j.Answer);
        var rel = j.RelatedTopics || [];
        for (var ri = 0; ri < rel.length && ri < 8; ri++) {
          var x = rel[ri];
          if (x.Text) bits.push("• " + x.Text);
          if (x.FirstURL && x.Text) push(x.Text, x.FirstURL, x.Text);
        }
        var results = j.Results || [];
        for (var rj = 0; rj < results.length && rj < 6; rj++) {
          var r = results[rj];
          if (r.Text && r.FirstURL) push(r.Text, r.FirstURL, r.Text);
        }
        if (j.AbstractURL) push(j.Heading || "Abstract", j.AbstractURL, j.AbstractText || "");
        if (bits.length) chunks.push("[DuckDuckGo Instant]\n" + bits.join("\n"));
      } catch (e) {}
      continue;
    }

    if (type === "wiki") {
      try {
        var wj = JSON.parse(text);
        var list = (wj.query && wj.query.search) || [];
        var wbits = [];
        for (var wi = 0; wi < list.length; wi++) {
          var h = list[wi];
          var title = h.title || "";
          var snippet = String(h.snippet || "").replace(/<[^>]+>/g, "");
          var wurl = "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_"));
          wbits.push("• " + title + ": " + snippet);
          push(title + " — Wikipedia", wurl, snippet);
        }
        if (wbits.length) chunks.push("[Wikipedia]\n" + wbits.join("\n"));
      } catch (e) {}
      continue;
    }

    extract(text);
    var lines = text.replace(/\r/g, "").split("\n");
    var cleanedLines = [];
    for (var li = 0; li < lines.length && cleanedLines.length < 90; li++) {
      var line = lines[li].trim();
      if (line.length > 25 && !/^(Share|Sign in|Accept|Cookie|Privacy|Menu|Subscribe)/i.test(line)) {
        cleanedLines.push(line);
      }
    }
    var cleaned = cleanedLines.join("\n");
    if (cleaned.length > 80) chunks.push("[" + name + "]\n" + cleaned.slice(0, 7000));
  }

  var deep = [];
  for (var si = 0; si < sources.length && deep.length < 5; si++) {
    var s = sources[si];
    if (!/(wikipedia\.org|reddit\.com|duckduckgo|google\.|bing\.|yahoo\.)/i.test(s.domain || "")) {
      deep.push(s);
    }
  }

  if (deep.length) {
    var deepHits = await Promise.all(deep.map(async function (s) {
      try {
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, 9000);
        var bare = s.url.replace(/^https?:\/\//, "");
        var res = await fetch("https://r.jina.ai/http://" + bare, {
          headers: { "Accept": "text/plain" },
          signal: ctrl.signal
        });
        clearTimeout(timer);
        if (!res.ok) return null;
        var body = await res.text();
        if (!body || body.length < 120) return null;
        return "[Full page: " + s.title + " | " + s.url + "]\n" + body.slice(0, 6000);
      } catch (e) {
        return null;
      }
    }));
    for (var di = 0; di < deepHits.length; di++) {
      if (deepHits[di]) chunks.push(deepHits[di]);
    }
  }

  var combined = chunks.join("\n\n---\n\n");
  if (combined.trim().length < 60 && sources.length) {
    combined = sources.map(function (s) {
      return s.title + " (" + s.url + ") " + (s.snippet || "");
    }).join("\n");
  }

  return {
    text: combined.slice(0, 28000),
    sources: sources.slice(0, 10),
    providerCount: okCount,
    error: okCount === 0 ? lastError : undefined
  };
}

export default {
  async fetch(request, env) {
    var headers = corsHeaders(request.headers.get("Origin") || "");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: headers });
    }

    var url = new URL(request.url);
    var path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (request.method === "GET" && (path === "/" || path === "/health")) {
        return jsonResponse({
          status: "ok",
          hasKey: !!env.NVIDIA_API_KEY,
          routes: ["/", "/image", "/image/edit", "/search", "/health"]
        }, 200, headers);
      }

      if (!env.NVIDIA_API_KEY && path !== "/search") {
        return jsonResponse({ error: "NVIDIA_API_KEY secret missing" }, 500, headers);
      }

      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405, headers);
      }

      if (path === "/") {
        var body = await request.text();
        var chatRes = await fetch(CHAT + "/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + env.NVIDIA_API_KEY,
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: body
        });
        return passthrough(chatRes, headers);
      }

      if (path === "/image") {
        var imgBody;
        try {
          imgBody = await request.json();
        } catch (e) {
          return jsonResponse({ error: "Invalid JSON" }, 400, headers);
        }
        var model = imgBody.model;
        var prompt = imgBody.prompt;
        if (!model || !prompt) {
          return jsonResponse({ error: "model and prompt required" }, 400, headers);
        }

        var try1 = await openaiImage(env.NVIDIA_API_KEY, model, prompt, { response_format: "b64_json" });
        if (try1.ok) return jsonResponse(normalizeImage(try1.data) || try1.data, 200, headers);

        try1 = await openaiImage(env.NVIDIA_API_KEY, model, prompt);
        if (try1.ok) return jsonResponse(normalizeImage(try1.data) || try1.data, 200, headers);

        var try2 = await genaiImage(env.NVIDIA_API_KEY, model, prompt);
        if (try2.ok) return jsonResponse(normalizeImage(try2.data) || try2.data, 200, headers);

        var status = try2.status || try1.status || 404;
        var data = try2.data || try1.data || {};
        return jsonResponse({
          error: errorMessage(data, status),
          status: status,
          model: model,
          hint: status === 404
            ? "Image model not available on this NVIDIA tier."
            : undefined,
          nvidia: data
        }, status >= 400 && status < 600 ? status : 502, headers);
      }

      if (path === "/image/edit") {
        var ct = request.headers.get("Content-Type") || "";
        if (ct.indexOf("multipart/form-data") === -1) {
          return jsonResponse({ error: "Expects multipart/form-data" }, 400, headers);
        }
        var form = await request.formData();
        var editRes = await fetch(CHAT + "/images/edits", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + env.NVIDIA_API_KEY,
            "Accept": "application/json"
          },
          body: form
        });
        return passthrough(editRes, headers);
      }

      if (path === "/search") {
        var sBody;
        try {
          sBody = await request.json();
        } catch (e) {
          return jsonResponse({ error: "Invalid JSON" }, 400, headers);
        }
        var query = sBody.query || sBody.q || "";
        if (!String(query).trim()) {
          return jsonResponse({ error: "Missing query" }, 400, headers);
        }
        var result = await runWebSearch(query);
        if (result.error && !result.text) {
          return jsonResponse(result, 502, headers);
        }
        return jsonResponse(result, 200, headers);
      }

      return jsonResponse({
        error: "Route not found",
        path: path,
        routes: ["POST /", "POST /image", "POST /image/edit", "POST /search", "GET /health"]
      }, 404, headers);
    } catch (err) {
      return jsonResponse({
        error: "Proxy error",
        details: (err && err.message) || String(err)
      }, 500, headers);
    }
  }
};
