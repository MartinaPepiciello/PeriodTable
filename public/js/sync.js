// End-to-end encrypted sync with the Cloudflare worker.
//
// From your passphrase we derive, in the browser, with PBKDF2:
//   - a 256-bit AES-GCM key   -> encrypts everything before upload; never leaves the device
//   - a 256-bit auth token    -> proves to the server we may read/write the vault
// Each deployment has a single vault, so there's nothing else to configure.
// The server stores only ciphertext.

import { merge, normalize, sameState } from "./store.js";

const ITERATIONS = 600000;
const META_KEY = "pt.sync.v2";
const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- credentials ----------

export async function deriveCredentials(passphrase) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: enc.encode("period-table/v1"), iterations: ITERATIONS },
      base,
      512,
    ),
  );
  const key = await crypto.subtle.importKey("raw", bits.slice(0, 32), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  return { key, token: hex(bits.slice(32)) };
}

// The AES key is stored as a non-extractable CryptoKey in IndexedDB,
// so even code running on this page can use it but not read it out.
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("period-table", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("keys");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("keys", mode);
    const req = fn(tx.objectStore("keys"));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveCredentials(creds) {
  await idbDo("readwrite", (s) => s.put(creds.key, "aes"));
  localStorage.setItem(META_KEY, JSON.stringify({ token: creds.token }));
}

export async function loadCredentials() {
  const meta = JSON.parse(localStorage.getItem(META_KEY) || "null");
  if (!meta) return null;
  try {
    const key = await idbDo("readonly", (s) => s.get("aes"));
    if (!key) return null;
    return { ...meta, key };
  } catch {
    return null;
  }
}

export async function forgetCredentials() {
  localStorage.removeItem(META_KEY);
  localStorage.removeItem("pt.lastSync");
  try {
    await idbDo("readwrite", (s) => s.delete("aes"));
  } catch {}
}

// ---------- encryption ----------

async function encrypt(key, state) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(state)));
  return { iv: b64(iv), data: b64(new Uint8Array(ct)) };
}

async function decrypt(key, { iv, data }) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(data));
  return normalize(JSON.parse(dec.decode(pt)));
}

// ---------- network ----------

export class SyncError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(creds, method, body) {
  const res = await fetch("/api/vault", {
    method,
    headers: { Authorization: `Bearer ${creds.token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok && !(method === "GET" && res.status === 404)) {
    throw new SyncError(payload.error || `HTTP ${res.status}`, res.status);
  }
  return { status: res.status, payload };
}

// Returns null if the vault doesn't exist yet, else its decrypted state.
export async function pull(creds) {
  const { status, payload } = await api(creds, "GET");
  if (status === 404) return null;
  try {
    return await decrypt(creds.key, payload);
  } catch {
    throw new SyncError("could not decrypt (wrong passphrase?)", 403);
  }
}

export async function push(creds, state) {
  return (await api(creds, "PUT", await encrypt(creds.key, state))).payload;
}

export async function deleteVault(creds) {
  await api(creds, "DELETE");
}

// Pull, merge, push if needed. Returns the merged state.
export async function syncOnce(creds, local) {
  const remote = await pull(creds);
  const merged = remote ? merge(local, remote) : local;
  if (!remote || !sameState(merged, remote)) await push(creds, merged);
  localStorage.setItem("pt.lastSync", String(Date.now()));
  return merged;
}

export function lastSync() {
  const v = Number(localStorage.getItem("pt.lastSync"));
  return v || null;
}

// ---------- helpers ----------

function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function b64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}
