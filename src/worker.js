// Period Table sync API.
//
// Each deployment holds a single vault: yours. The server only ever sees:
//   - an auth token   (derived from the passphrase in the browser; we store only its SHA-256)
//   - an encrypted blob (AES-GCM, key never leaves the device)
// It cannot read the data it stores. Whoever creates the vault first (you, on
// first connect) owns it; after that only the same passphrase can read or write.

const KEY = "vault";
const MAX_BODY = 256 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/vault") return json({ error: "not found" }, 404);

    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!/^[0-9a-f]{64}$/.test(token)) return json({ error: "missing token" }, 401);
    const tokenHash = await sha256Hex(token);

    const stored = await env.VAULT.get(KEY, "json");

    if (request.method === "GET") {
      if (!stored) return json({ error: "no vault yet" }, 404);
      if (!timingSafeEqual(stored.auth, tokenHash)) return json({ error: "wrong passphrase" }, 403);
      return json({ iv: stored.iv, data: stored.data, updated: stored.updated });
    }

    if (request.method === "PUT") {
      if (stored && !timingSafeEqual(stored.auth, tokenHash)) {
        return json({ error: "wrong passphrase" }, 403);
      }
      const text = await request.text();
      if (text.length > MAX_BODY) return json({ error: "too large" }, 413);
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return json({ error: "bad json" }, 400);
      }
      if (typeof body.iv !== "string" || typeof body.data !== "string") {
        return json({ error: "expected {iv, data}" }, 400);
      }
      const record = { auth: tokenHash, iv: body.iv, data: body.data, updated: Date.now() };
      await env.VAULT.put(KEY, JSON.stringify(record));
      return json({ ok: true, created: !stored, updated: record.updated });
    }

    if (request.method === "DELETE") {
      if (!stored) return json({ ok: true });
      if (!timingSafeEqual(stored.auth, tokenHash)) return json({ error: "wrong passphrase" }, 403);
      await env.VAULT.delete(KEY);
      return json({ ok: true });
    }

    return json({ error: "method not allowed" }, 405);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
