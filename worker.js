// Uplink Worker — NVIDIA NIM proxy (chat / image / search)
// Secret: NVIDIA_API_KEY

const CHAT = "https://integrate.api.nvidia.com/v1";
const GENAI = "https://ai.api.nvidia.com/v1/genai";
const ORIGINS = [
  "https://luchifer0p09.github.io",
  "https://luchiferop09.github.io",
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

const cors = (o) => ({
  "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin"
});

const json = (data, status, h) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...h }
  });

async function passthrough(res, h) {
  const ct = res.headers.get("Content-Type") || "";
  if (ct.includes("text/event-stream")) {
    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        ...h
      }
    });
  }
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": ct || "application/json; charset=utf-8", ...h }
  });
}

function normImage(data) {
  const item = data?.data?.[0] || data?.images?.[0] || data?.artifacts?.[0];
  if (!item && !data) return null;
  const b64 = item?.b64_json || item?.base64 || item?.b64 || data?.b64_json || data?.image;
  const url = item?.url || item?.image_url?.url || data?.url || data?.image_url;
  if (url) return { data: [{ url }] };
  if (b64 && typeof b64 === "string") {
    return { data: [{ b64_json: b64.replace(/^data:image\/\w+;base64,/, "") }] };
  }
  return data;
}

function errMsg(data, status) {
  return (
    (typeof data?.error === "string" && data.error) ||
    data?.error?.message ||
    data?.message ||
    data?.detail ||
    `HTTP ${status}`
  );
}

async function openaiImage(key, model, prompt, extra = {}) {
  const res = await fetch(`${CHAT}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ model, prompt, n: 1, ...extra })
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

async function genaiImage(key, model, prompt) {
  const path = GENAI_PATHS[model] || model;
  const res = await fetch(`${GENAI}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      prompt,
      cfg_scale: 5,
      aspect_ratio: "1:1",
      seed: 0,
      steps: 25
    })
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

async function runWebSearch(query) {
  const q = String(query || "").trim();
  if (!q) return { text: "", sources: [], error: "Empty query" };
  const enc = encodeURIComponent(q);
  const providers = [
    ["ddg-html", `https://r.jina.ai/http://duckduckgo.com/html/?q=${enc}`, "html"],
    ["bing", `https://r.jina.ai/http://www.bing.com/search?q=${enc}`, "html"],
    ["google", `https://r.jina.ai/http://www.google.com/search?q=${enc}&hl=en&num=10`, "html"],
    ["ddg-api", `https://api.duckduckgo.com/?q=${enc}&format=json&no_html=1&skip_disambig=1`, "ddg"],
    ["wiki", `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc}&utf8=1&format=json&srlimit=5`, "wiki"],
    ["reddit", `https://r.jina.ai/http://www.reddit.com/search/?q=${enc}&sort=relevance&t=week`, "html"]
  ];

  const sources = [];
  const seen = new Set();
  const chunks = [];
  let lastError = "No results";
  let okCount = 0;

  const junk = (title, href) => {
    try {
      const host = new URL(href).hostname.toLowerCase();
      if (/external-content\.duckduckgo|gstatic/i.test(host)) return true;
      if (/\.(png|jpe?g|gif|webp|svg|ico|css|js)(\?|$)/i.test(href)) return true;
      if (/^!?\[?Image\b/i.test(title || "") || (title || "").length < 3) return true;
      return false;
    } catch { return true; }
  };

  const push = (title, url, snippet = "") => {
    if (sources.length >= 12) return;
    try {
      const u = new URL(String(url).replace(/[),.;]+$/, ""));
      if (!/^https?:$/.test(u.protocol)) return;
      let t = String(title || "").replace(/\s+/g, " ").trim()
        .replace(/^!\[[^\]]*\]\s*/g, "").replace(/^\[[^\]]*\]\s*/g, "").trim();
      if (junk(t, u.href)) return;
      const key = u.hostname.replace(/^www\./, "") + u.pathname;
      if (seen.has(key)) return;
      seen.add(key);
      sources.push({
        title: t || u.hostname.replace(/^www\./, ""),
        url: u.href,
        domain: u.hostname.replace(/^www\./, ""),
        snippet: String(snippet || "").slice(0, 240)
      });
    } catch {}
  };

  const extract = (raw) => {
    const re = /\[([^\]]{2,180})\]\((https?:\/\/[^)\s]+)\)/g;
    let m;
    while ((m = re.exec(raw))) push(m[1], m[2], m[1]);
    (String(raw).match(/https?:\/\/[^\s<>"')]+/g) || []).slice(0, 20).forEach((u) => push("", u));
  };

  const fetchOne = async ([name, url, type]) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(url, {
        headers: { Accept: "text/plain, application/json, */*", "User-Agent": "UplinkWorker/74" },
        signal: ctrl.signal
      });
      if (!res.ok) { lastError = `${name} HTTP ${res.status}`; return null; }
      const text = await res.text();
      if (!text || text.trim().length < 20) return null;
      return { name, type, text };
    } catch (e) {
      lastError = e.message || lastError;
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  for (const hit of await Promise.all(providers.map(fetchOne))) {
    if (!hit) continue;
    okCount++;
    const { name, type, text } = hit;

    if (type === "ddg") {
      try {
        const j = JSON.parse(text);
        const bits = [];
        if (j.Heading) bits.push("Topic: " + j.Heading);
        if (j.AbstractText) bits.push(j.AbstractText);
        if (j.Answer) bits.push(j.Answer);
        (j.RelatedTopics || []).slice(0, 8).forEach((x) => {
          if (x.Text) bits.push("• " + x.Text);
          if (x.FirstURL && x.Text) push(x.Text, x.FirstURL, x.Text);
        });
        (j.Results || []).slice(0, 6).forEach((r) => {
          if (r.Text && r.FirstURL) push(r.Text, r.FirstURL, r.Text);
        });
        if (j.AbstractURL) push(j.Heading || "Abstract", j.AbstractURL, j.AbstractText || "");
        if (bits.length) chunks.push("[DuckDuckGo Instant]\n" + bits.join("\n"));
      } catch {}
      continue;
    }

    if (type === "wiki") {
      try {
        const list = JSON.parse(text)?.query?.search || [];
        const bits = [];
        list.forEach((h) => {
          const title = h.title || "";
          const snippet = String(h.snippet || "").replace(/<[^>]+>/g, "");
          const url = "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_"));
          bits.push(`• ${title}: ${snippet}`);
          push(title + " — Wikipedia", url, snippet);
        });
        if (bits.length) chunks.push("[Wikipedia]\n" + bits.join("\n"));
      } catch {}
      continue;
    }

    extract(text);
    const cleaned = text.replace(/\r/g, "").split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 25 && !/^(Share|Sign in|Accept|Cookie|Privacy|Menu|Subscribe)/i.test(l))
      .slice(0, 90).join("\n");
    if (cleaned.length > 80) chunks.push(`[${name}]\n${cleaned.slice(0, 7000)}`);
  }

  const deep = sources
    .filter((s) => !/(wikipedia\.org|reddit\.com|duckduckgo|google\.|bing\.|yahoo\.)/i.test(s.domain || ""))
    .slice(0, 3);

  if (deep.length) {
    const deepHits = await Promise.all(deep.map(async (s) => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 9000);
        const res = await fetch("https://r.jina.ai/http://" + s.url.replace(/^https?:\/\//, ""), {
          headers: { Accept: "text/plain" },
          signal: ctrl.signal
        });
        clearTimeout(t);
        if (!res.ok) return null;
        const body = await res.text();
        if (!body || body.length < 120) return null;
        return `[Full page: ${s.title} | ${s.url}]\n${body.slice(0, 5000)}`;
      } catch { return null; }
    }));
    deepHits.filter(Boolean).forEach((c) => chunks.push(c));
  }

  let combined = chunks.join("\n\n---\n\n");
  if (combined.trim().length < 60 && sources.length) {
    combined = sources.map((s) => `${s.title} (${s.url}) ${s.snippet || ""}`).join("\n");
  }

  return {
    text: combined.slice(0, 24000),
    sources: sources.slice(0, 10),
    providerCount: okCount,
    error: okCount === 0 ? lastError : undefined
  };
}

export default {
  async fetch(request, env) {
    const h = cors(request.headers.get("Origin") || "");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (request.method === "GET" && (path === "/" || path === "/health")) {
        return json({ status: "ok", hasKey: !!env.NVIDIA_API_KEY, routes: ["/", "/image", "/image/edit", "/search", "/health"] }, 200, h);
      }

      if (!env.NVIDIA_API_KEY && path !== "/search") {
        return json({ error: "NVIDIA_API_KEY secret missing" }, 500, h);
      }

      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405, h);
      }

      // Chat completions
      if (path === "/") {
        const body = await request.text();
        const res = await fetch(`${CHAT}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body
        });
        return passthrough(res, h);
      }

      // Image generation
      if (path === "/image") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, h); }
        const model = body.model;
        const prompt = body.prompt;
        if (!model || !prompt) return json({ error: "model and prompt required" }, 400, h);

        let try1 = await openaiImage(env.NVIDIA_API_KEY, model, prompt, { response_format: "b64_json" });
        if (try1.ok) return json(normImage(try1.data) || try1.data, 200, h);

        try1 = await openaiImage(env.NVIDIA_API_KEY, model, prompt);
        if (try1.ok) return json(normImage(try1.data) || try1.data, 200, h);

        const try2 = await genaiImage(env.NVIDIA_API_KEY, model, prompt);
        if (try2.ok) return json(normImage(try2.data) || try2.data, 200, h);

        const status = try2.status || try1.status || 404;
        const data = try2.data || try1.data || {};
        return json({
          error: errMsg(data, status),
          status,
          model,
          hint: status === 404
            ? "Image model not available on this NVIDIA tier. Chat models may still work."
            : undefined,
          tried: ["POST /v1/images/generations", "POST /v1/genai/" + (GENAI_PATHS[model] || model)],
          nvidia: data
        }, status >= 400 && status < 600 ? status : 502, h);
      }

      // Image edit
      if (path === "/image/edit") {
        const ct = request.headers.get("Content-Type") || "";
        if (!ct.includes("multipart/form-data")) {
          return json({ error: "Expects multipart/form-data" }, 400, h);
        }
        const form = await request.formData();
        const res = await fetch(`${CHAT}/images/edits`, {
          method: "POST",
          headers: { Authorization: `Bearer ${env.NVIDIA_API_KEY}`, Accept: "application/json" },
          body: form
        });
        return passthrough(res, h);
      }

      // Live web search (no NVIDIA key required)
      if (path === "/search") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, h); }
        const query = body.query || body.q || "";
        if (!String(query).trim()) return json({ error: "Missing query" }, 400, h);
        const result = await runWebSearch(query);
        if (result.error && !result.text) return json(result, 502, h);
        return json(result, 200, h);
      }

      return json({ error: "Route not found", path, routes: ["POST /", "POST /image", "POST /image/edit", "POST /search", "GET /health"] }, 404, h);
    } catch (err) {
      return json({ error: "Proxy error", details: err?.message || String(err) }, 500, h);
    }
  }
};
