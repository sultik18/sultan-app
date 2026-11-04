/*
 * Sultan runtime: sign-in, data sync and photo storage on Supabase.
 *
 * The app was first built as a claude.ai artifact, which talks to `window.claude.use("db")`
 * and `window.claude.use("assets")`. This file provides the same small API on top of Supabase,
 * so the app code runs unchanged:
 *   - db.collection(name).onSnapshot / add / doc(id).set|update|delete
 *   - db.doc("collection/id").onSnapshot / set
 *   - assets.upload(blob) / assets.delete(id)
 * Every document lives in one table, public.docs (user_id, collection, id, data jsonb),
 * protected by row-level security. Data is cached on the device so the app opens offline,
 * and writes made offline are queued and sent when the connection returns.
 */
(function () {
  "use strict";
  const cfg = window.SULTAN_CONFIG;
  const sb = window.supabase.createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  window.sb = sb;

  let user = null;
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));

  /* ------------------------------------------------------------------ sign-in screen */
  const css = `
  .gate{position:fixed;inset:0;z-index:100;background:var(--bg);display:flex;align-items:center;justify-content:center;
    padding:max(24px,env(safe-area-inset-top,0px)) max(20px,env(safe-area-inset-right,0px)) max(24px,env(safe-area-inset-bottom,0px)) max(20px,env(safe-area-inset-left,0px))}
  .gate form{width:min(380px,100%);display:flex;flex-direction:column;gap:12px}
  .gate .logo{width:72px;height:72px;border-radius:20px;margin:0 auto 4px;display:block;box-shadow:0 10px 30px rgba(120,60,220,.35)}
  .gate h1{font-family:var(--f-display);font-size:34px;text-align:center;margin:0;letter-spacing:-.03em;
    background:linear-gradient(100deg,#1d5fd1,#a34fd6 55%,#f0285a);-webkit-background-clip:text;background-clip:text;color:transparent}
  .gate p{margin:0 0 6px;text-align:center;color:var(--muted)}
  .gate input{font:inherit;font-size:16px;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--surface);color:var(--ink)}
  .gate button{font:inherit;font-weight:700;font-size:16px;padding:13px;border-radius:12px;border:0;cursor:pointer;color:#fff;
    background:linear-gradient(100deg,#1d5fd1,#a34fd6)}
  .gate button:disabled{opacity:.6}
  .gate .alt{background:none;color:var(--accent);font-weight:600;padding:6px}
  .gate .msg{min-height:1.3em;text-align:center;font-size:14px;color:var(--over)}
  .gate .msg.ok{color:var(--ok)}
  .acct{position:relative}
  .acct > button{width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:var(--surface);color:var(--ink);
    font-weight:700;cursor:pointer;box-shadow:var(--shadow)}
  .acct .menu{position:absolute;right:0;top:46px;z-index:40;background:var(--surface);border:1px solid var(--line);border-radius:14px;
    padding:12px;min-width:220px;box-shadow:0 12px 30px rgba(0,0,0,.2);display:flex;flex-direction:column;gap:8px}
  .acct .menu span{font-size:13px;color:var(--muted);overflow-wrap:anywhere}
  .acct .menu .sync{font-size:12px}
  .acct .menu button{border:0;background:var(--grouped);color:var(--over);font-weight:600;border-radius:10px;padding:9px;cursor:pointer;font:inherit}
  @media (max-width:640px){.acct{order:2}}
  .offline-pill{position:fixed;left:50%;transform:translateX(-50%);top:calc(8px + env(safe-area-inset-top,0px));z-index:90;
    background:var(--ink);color:var(--bg);font-size:12px;font-weight:600;padding:5px 12px;border-radius:999px}`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  function showGate() {
    if (document.getElementById("gate")) return;
    const g = document.createElement("div");
    g.className = "gate";
    g.id = "gate";
    g.innerHTML = `<form id="gate-form" autocomplete="on">
        <img class="logo" src="icons/icon-192.png" alt="">
        <h1>Sultan</h1>
        <p id="gate-sub">Sign in to your spending, reminders and ideas.</p>
        <input id="gate-email" type="email" autocomplete="username" placeholder="Email" required>
        <input id="gate-pass" type="password" autocomplete="current-password" placeholder="Password" minlength="8" required>
        <button id="gate-go" type="submit">Sign in</button>
        <button class="alt" id="gate-mode" type="button">First time here? Create your account</button>
        <div class="msg" id="gate-msg" role="status"></div>
      </form>`;
    document.body.appendChild(g);
    let mode = "in";
    const $ = (id) => document.getElementById(id);
    $("gate-mode").onclick = () => {
      mode = mode === "in" ? "up" : "in";
      $("gate-go").textContent = mode === "in" ? "Sign in" : "Create account";
      $("gate-mode").textContent = mode === "in" ? "First time here? Create your account" : "Already have an account? Sign in";
      $("gate-pass").autocomplete = mode === "in" ? "current-password" : "new-password";
      $("gate-msg").textContent = "";
    };
    $("gate-form").onsubmit = async (e) => {
      e.preventDefault();
      const email = $("gate-email").value.trim(), password = $("gate-pass").value;
      $("gate-go").disabled = true;
      $("gate-msg").className = "msg";
      $("gate-msg").textContent = mode === "in" ? "Signing in…" : "Creating your account…";
      try {
        if (mode === "in") {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw error;
        } else {
          const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
          if (error) throw error;
          if (!data.session) {
            $("gate-msg").className = "msg ok";
            $("gate-msg").textContent = "Check your email and tap the confirmation link, then come back and sign in.";
            mode = "up"; $("gate-mode").click();
          }
        }
      } catch (err) {
        const m = String(err && err.message || "");
        $("gate-msg").textContent =
          /invalid login/i.test(m) ? "That email and password don't match." :
          /not confirmed/i.test(m) ? "Confirm your email first: tap the link we sent you." :
          /signups not allowed|disabled/i.test(m) ? "New accounts are switched off for this app." :
          /fetch|network/i.test(m) ? "You're offline. Connect to the internet to sign in." :
          m || "Something went wrong. Try again.";
      } finally {
        if ($("gate-go")) $("gate-go").disabled = false;
      }
    };
  }
  function hideGate() { const g = document.getElementById("gate"); if (g) g.remove(); }

  function mountAccount() {
    const host = document.querySelector(".appright");
    if (!host || document.getElementById("acct")) return;
    const wrap = document.createElement("div");
    wrap.className = "acct";
    wrap.id = "acct";
    const initial = (user.email || "?").trim()[0].toUpperCase();
    wrap.innerHTML = `<button type="button" aria-label="Account" aria-haspopup="true" aria-expanded="false">${initial}</button>
      <div class="menu" hidden><span>${(user.email || "").replace(/[<>&"]/g, "")}</span><span class="sync" id="acct-sync"></span>
      <button type="button" id="acct-out">Sign out</button></div>`;
    host.appendChild(wrap);
    const btn = wrap.firstElementChild, menu = wrap.querySelector(".menu");
    btn.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", !menu.hidden); updateSyncNote(); };
    document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); } });
    wrap.querySelector("#acct-out").onclick = async () => {
      try { await sb.auth.signOut(); } catch (e) {}
      try { Object.keys(localStorage).filter((k) => k.startsWith("sultan-cache-") || k.startsWith("sultan-outbox-")).forEach((k) => localStorage.removeItem(k)); } catch (e) {}
      location.reload();
    };
  }
  function updateSyncNote() {
    const el = document.getElementById("acct-sync");
    if (!el) return;
    const n = outbox.length;
    el.textContent = !navigator.onLine ? `Offline${n ? ` · ${n} change${n > 1 ? "s" : ""} waiting to sync` : ""}` : n ? `Syncing ${n} change${n > 1 ? "s" : ""}…` : "All changes saved";
  }
  function offlinePill() {
    let p = document.getElementById("offline-pill");
    if (navigator.onLine) { if (p) p.remove(); return; }
    if (!p) { p = document.createElement("div"); p.id = "offline-pill"; p.className = "offline-pill"; p.setAttribute("role", "status"); document.body.appendChild(p); }
    p.textContent = "Offline · changes will sync later";
  }
  window.addEventListener("online", () => { offlinePill(); flush(); refetchAll(); });
  window.addEventListener("offline", offlinePill);

  /* ------------------------------------------------------------------ local store */
  const cols = {};
  const ck = (name) => `sultan-cache-${user.id}:${name}`;
  let outbox = [];
  const obKey = () => `sultan-outbox-${user.id}`;
  function loadOutbox() { try { outbox = JSON.parse(localStorage.getItem(obKey()) || "[]"); } catch (e) { outbox = []; } }
  function saveOutbox() { try { localStorage.setItem(obKey(), JSON.stringify(outbox)); } catch (e) {} updateSyncNote(); }

  function col(name) {
    if (!cols[name]) {
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem(ck(name)) || "null"); } catch (e) {}
      cols[name] = { docs: new Map(cached ? Object.entries(cached) : []), listeners: new Set(), loaded: false, fetching: null, hasCache: !!cached };
    }
    return cols[name];
  }
  function persist(name) {
    try { localStorage.setItem(ck(name), JSON.stringify(Object.fromEntries(cols[name].docs))); } catch (e) {}
  }
  const freeze = (o) => (o && typeof o === "object" ? JSON.parse(JSON.stringify(o)) : o);
  function docSnap(id, data, fromCache) {
    return { id, exists: data !== undefined, data: () => (data === undefined ? undefined : freeze(data)), metadata: { fromCache, hasPendingWrites: false } };
  }
  function notify(name) {
    const c = cols[name];
    const fromCache = !c.loaded;
    const docs = [...c.docs.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, d]) => docSnap(id, d, fromCache));
    const snap = { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache, hasPendingWrites: outbox.length > 0 } };
    for (const l of [...c.listeners]) { try { l(snap); } catch (e) { console.error(e); } }
  }
  function applyOutbox(name) {
    const c = cols[name];
    for (const w of outbox) if (w.col === name) { if (w.op === "del") c.docs.delete(w.id); else c.docs.set(w.id, w.data); }
  }
  async function fetchCol(name) {
    const c = col(name);
    if (c.fetching) return c.fetching;
    c.fetching = (async () => {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("docs").select("id,data").eq("collection", name).range(from, from + 999);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 1000) break;
      }
      c.docs = new Map(rows.map((r) => [r.id, r.data]));
      applyOutbox(name);
      c.loaded = true;
      persist(name);
      notify(name);
    })().finally(() => { c.fetching = null; });
    return c.fetching;
  }
  function refetchAll() { for (const name of Object.keys(cols)) if (cols[name].listeners.size) fetchCol(name).catch(() => {}); }

  /* ------------------------------------------------------------------ writes */
  const isNetErr = (e) => !navigator.onLine || /fetch|network|load failed|timeout/i.test(String((e && e.message) || e));
  async function send(w) {
    if (w.op === "del") {
      const { error } = await sb.from("docs").delete().match({ user_id: user.id, collection: w.col, id: w.id });
      if (error) throw error;
    } else {
      const { error } = await sb.from("docs").upsert(
        { user_id: user.id, collection: w.col, id: w.id, data: w.data, updated_at: new Date().toISOString() },
        { onConflict: "user_id,collection,id" });
      if (error) throw error;
    }
  }
  let flushing = false;
  async function flush() {
    if (flushing || !outbox.length || !navigator.onLine) return;
    flushing = true;
    try {
      while (outbox.length) {
        const w = outbox[0];
        try { await send(w); } catch (e) { if (isNetErr(e)) break; console.error("Dropped a change the server refused", e); }
        outbox.shift();
        saveOutbox();
      }
    } finally { flushing = false; updateSyncNote(); }
  }
  setInterval(flush, 30000);

  async function write(w) {
    const c = col(w.col);
    if (w.op === "del") c.docs.delete(w.id); else c.docs.set(w.id, w.data);
    persist(w.col);
    notify(w.col);
    // keep only the latest pending change per document
    const pendingSame = outbox.findIndex((x) => x.col === w.col && x.id === w.id);
    if (outbox.length || !navigator.onLine) {
      if (pendingSame >= 0) outbox.splice(pendingSame, 1);
      outbox.push(w); saveOutbox(); flush(); return;
    }
    try { await send(w); }
    catch (e) {
      if (isNetErr(e)) { outbox.push(w); saveOutbox(); return; }
      fetchCol(w.col).catch(() => {});
      throw { code: "invalid_argument", message: e.message || String(e) };
    }
  }
  function merge(base, patch) {
    const out = Array.isArray(base) ? base.slice() : { ...(base || {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === "object" && v.__delete__ === true) { delete out[k]; continue; }
      if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) out[k] = merge(out[k], v);
      else out[k] = v;
    }
    return out;
  }
  const randId = (n = 20) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join(""); };

  /* ------------------------------------------------------------------ db API */
  function docRef(name, id) {
    return {
      id, path: `${name}/${id}`,
      async get() { const c = col(name); if (!c.loaded) { try { await fetchCol(name); } catch (e) {} } return docSnap(id, c.docs.get(id), !c.loaded); },
      async set(data) { await write({ op: "set", col: name, id, data: freeze(data) }); },
      async update(data) {
        const cur = col(name).docs.get(id);
        if (cur === undefined) throw { code: "invalid_argument", message: "Document does not exist" };
        await write({ op: "set", col: name, id, data: merge(cur, freeze(data)) });
      },
      async delete() { await write({ op: "del", col: name, id }); },
      onSnapshot(next, err) {
        const wrapped = (qs) => { const d = qs.docs.find((x) => x.id === id); next(d || docSnap(id, undefined, qs.metadata.fromCache)); };
        return listen(name, wrapped, err);
      },
      collection(sub) { return collRef(`${name}/${id}/${sub}`); },
    };
  }
  function listen(name, fn, err) {
    const c = col(name);
    c.listeners.add(fn);
    if (c.hasCache || c.loaded) setTimeout(() => { if (c.listeners.has(fn)) notify(name); }, 0);
    if (!c.loaded) fetchCol(name).catch((e) => { if (!isNetErr(e) && err) err({ code: "unavailable", message: e.message }); });
    return () => c.listeners.delete(fn);
  }
  function collRef(name) {
    const q = {
      path: name,
      where() { return q; }, orderBy() { return q; }, limit() { return q; },
      async get() { const c = col(name); if (!c.loaded) { try { await fetchCol(name); } catch (e) {} } const docs = [...c.docs].map(([id, d]) => docSnap(id, d, !c.loaded)); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: !c.loaded } }; },
      onSnapshot(next, err) { return listen(name, next, err); },
      doc(id) { return docRef(name, id || randId()); },
      async add(data) { const r = docRef(name, randId()); await r.set(data); return r; },
    };
    return q;
  }
  const db = Object.freeze({
    collection: (p) => collRef(p),
    doc: (p) => { const i = p.lastIndexOf("/"); return docRef(p.slice(0, i), p.slice(i + 1)); },
  });

  /* ------------------------------------------------------------------ realtime */
  function startRealtime() {
    sb.channel("docs-" + user.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "docs" }, (p) => {
        const row = p.eventType === "DELETE" ? p.old : p.new;
        if (!row || row.user_id && row.user_id !== user.id) return;
        const name = row.collection, c = cols[name];
        if (!c || !name) return;
        if (outbox.some((w) => w.col === name && w.id === row.id)) return; // our own pending change wins
        if (p.eventType === "DELETE") c.docs.delete(row.id); else c.docs.set(row.id, row.data);
        persist(name);
        notify(name);
      })
      .subscribe();
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { flush(); refetchAll(); } });
  }

  /* ------------------------------------------------------------------ photos */
  const BUCKET = "photos";
  const urlCache = new Map(); // id -> {url, exp}
  const queue = new Set();
  let qTimer = null;
  const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  function photoUrl(id) {
    const hit = urlCache.get(id);
    if (hit && hit.exp > Date.now()) return hit.url;
    queue.add(id);
    clearTimeout(qTimer);
    qTimer = setTimeout(resolvePhotos, 20);
    return BLANK;
  }
  async function resolvePhotos() {
    const ids = [...queue]; queue.clear();
    if (!ids.length || !user) return;
    try {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(ids.map((id) => `${user.id}/${id}`), 60 * 60 * 12);
      if (error) throw error;
      data.forEach((d, k) => { if (d.signedUrl) urlCache.set(ids[k], { url: d.signedUrl, exp: Date.now() + 1000 * 60 * 60 * 11 }); });
    } catch (e) { console.warn("Photo links unavailable", e); }
    document.querySelectorAll("img[data-pid]").forEach((img) => { const h = urlCache.get(img.dataset.pid); if (h && img.src !== h.url) img.src = h.url; });
  }
  window.sultanPhoto = photoUrl;
  const assets = Object.freeze({
    async upload(blob) {
      if (!navigator.onLine) throw { code: "store_unavailable", message: "offline" };
      const a = new Uint8Array(16); crypto.getRandomValues(a);
      const id = [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
      const { error } = await sb.storage.from(BUCKET).upload(`${user.id}/${id}`, blob, { contentType: blob.type || "image/jpeg", upsert: false });
      if (error) throw { code: /size|large/i.test(error.message) ? "too_large" : /mime|type/i.test(error.message) ? "unsupported_type" : "store_unavailable", message: error.message };
      return { id, url: photoUrl(id), sizeBytes: blob.size, contentType: blob.type };
    },
    async delete(id) { await sb.storage.from(BUCKET).remove([`${user.id}/${id}`]); urlCache.delete(id); },
    async list() { return { assets: [], usage: {} }; },
  });

  /* ------------------------------------------------------------------ claude.use() */
  window.claude = Object.freeze({
    async use(name) {
      await ready;
      if (name === "db") return db;
      if (name === "assets") return assets;
      if (name === "sample") return window.SULTAN_SAMPLE || null; // the Ideas chat arrives in a later phase
      return null;
    },
  });

  /* ------------------------------------------------------------------ boot */
  function start(session) {
    if (user) return;
    user = session.user;
    loadOutbox();
    hideGate();
    const go = () => { mountAccount(); offlinePill(); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
    startRealtime();
    flush();
    resolveReady();
  }
  sb.auth.getSession().then(({ data }) => {
    if (data.session) start(data.session);
    else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showGate); else showGate();
  });
  sb.auth.onAuthStateChange((event, session) => {
    if (session && !user) start(session);
    if (event === "SIGNED_OUT" && user) location.reload();
  });

  /* ------------------------------------------------------------------ offline app shell */
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
})();
