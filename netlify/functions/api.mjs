import { getStore } from "@netlify/blobs";

const DEF = {
  title: "Lomba Kebersihan & Kerapihan Toko",
  areas: ["Area depan & parkir", "Area penjualan & display", "Kasir", "Gudang", "Toilet & area belakang"],
  juri: Array.from({ length: 8 }, (_, i) => `Juri ${i + 1}`),
  stores: Array.from({ length: 95 }, (_, i) => `Toko ${i + 1}`),
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const r2 = (n) => Math.round(n * 100) / 100;
const key = (name) => "juri:" + encodeURIComponent(name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randPw = () => {
  const ch = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => ch[n % ch.length]).join("");
};

function cleanList(v, max, maxLen = 80) {
  if (!Array.isArray(v)) return [];
  const seen = new Set(), out = [];
  for (const x of v) {
    const t = String(x).trim().replace(/\s+/g, " ").slice(0, maxLen);
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
  }
  return out.slice(0, max);
}

async function getConfig(db) {
  let c = await db.get("config", { type: "json" });
  let changed = false;
  if (!c) { c = {}; changed = true; }
  if (!Array.isArray(c.accounts)) {
    const names = Array.isArray(c.juri) && c.juri.length ? c.juri.map((x) => (typeof x === "string" ? x : x.name)) : DEF.juri;
    c.accounts = names.map((name, i) => ({ id: "juri" + (i + 1), password: randPw(), name }));
    changed = true;
  }
  c = { title: c.title || DEF.title, areas: c.areas || DEF.areas, stores: c.stores || DEF.stores, accounts: c.accounts };
  if (changed) await db.setJSON("config", c);
  return c;
}

const pub = (c, role) => ({
  title: c.title, areas: c.areas, stores: c.stores,
  juri: role === "admin" ? c.accounts.map((a) => a.name) : [],
  ...(role === "admin" ? { accounts: c.accounts } : {}),
});

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Gunakan POST" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "Permintaan tidak valid" }, 400); }

  const ADMIN = String(Netlify.env.get("ADMIN_PIN") || process.env.ADMIN_PIN || "").trim();
  if (!ADMIN) return json({ error: "ADMIN_PIN belum diatur di Netlify (Environment variables), lalu deploy ulang." }, 500);

  const db = getStore({ name: "lomba", consistency: "strong" });
  const cfg = await getConfig(db);

  const id = String(b.id ?? "").trim().toLowerCase();
  const pw = String(b.pw ?? "").trim();
  let role = null, me = null;
  if (id === "admin") { if (pw === ADMIN) role = "admin"; }
  else {
    const u = cfg.accounts.find((a) => a.id.toLowerCase() === id);
    if (u && u.password === pw) { role = "juri"; me = u.name; }
  }
  if (!role) { await sleep(600); return json({ error: "ID atau kata sandi salah." }, 401); }

  const names = cfg.accounts.map((a) => a.name);

  switch (b.action) {
    case "load": {
      const out = { role, name: me, config: pub(cfg, role) };
      if (role === "juri") out.mine = (await db.get(key(me), { type: "json" })) || {};
      return json(out);
    }

    case "submit": {
      if (role !== "juri") return json({ error: "Hanya juri yang bisa menilai" }, 403);
      if (!cfg.stores.includes(b.store)) return json({ error: "Toko tidak dikenali" }, 400);
      const n = b.nilai;
      if (!Array.isArray(n) || n.length !== cfg.areas.length || !n.every((x) => Number.isInteger(x) && x >= 1 && x <= 10))
        return json({ error: "Isi nilai 1–10 untuk semua area" }, 400);
      const k = key(me);
      const mine = (await db.get(k, { type: "json" })) || {};
      mine[b.store] = { nilai: n, ts: Date.now() };
      await db.setJSON(k, mine);
      return json({ ok: true, saved: mine[b.store] });
    }

    case "ranking": {
      if (role !== "admin") return json({ error: "Khusus admin" }, 403);
      const all = {};
      await Promise.all(names.map(async (j) => { all[j] = (await db.get(key(j), { type: "json" })) || {}; }));
      const rows = cfg.stores.map((s) => {
        const per = [];
        for (const j of names) {
          const e = all[j][s];
          if (e && Array.isArray(e.nilai) && e.nilai.length) per.push({ juri: j, nilai: e.nilai, avg: r2(mean(e.nilai)), raw: mean(e.nilai) });
        }
        return { store: s, count: per.length, avg: per.length ? r2(mean(per.map((p) => p.raw))) : null, juri: per.map(({ raw, ...p }) => p) };
      });
      rows.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.count - a.count || a.store.localeCompare(b.store, "id", { numeric: true }));
      let rank = 0, prev = null;
      rows.forEach((r, i) => {
        if (r.avg === null) { r.rank = null; return; }
        if (r.avg !== prev) { rank = i + 1; prev = r.avg; }
        r.rank = rank;
      });
      const progress = names.map((j) => ({ name: j, done: cfg.stores.filter((s) => all[j][s]).length }));
      return json({ rows, progress, total: cfg.stores.length, areas: cfg.areas, updated: Date.now() });
    }

    case "saveConfig": {
      if (role !== "admin") return json({ error: "Khusus admin" }, 403);
      const c = b.config || {};
      const accounts = [], ids = new Set(), nm = new Set();
      for (const a of Array.isArray(c.accounts) ? c.accounts.slice(0, 30) : []) {
        const aid = String(a.id ?? "").trim().toLowerCase();
        const apw = String(a.password ?? "").trim();
        const name = String(a.name ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
        if (!aid && !apw && !name) continue;
        if (!/^[a-z0-9._-]{2,30}$/.test(aid) || aid === "admin") return json({ error: `ID "${aid}" tidak valid (2-30 huruf kecil/angka, tanpa spasi, bukan "admin")` }, 400);
        if (apw.length < 3 || apw.length > 40) return json({ error: `Kata sandi untuk "${aid}" harus 3-40 karakter` }, 400);
        if (!name) return json({ error: `Nama untuk "${aid}" belum diisi` }, 400);
        if (ids.has(aid) || nm.has(name.toLowerCase())) return json({ error: `ID atau nama juri ganda: "${aid}" / "${name}"` }, 400);
        ids.add(aid); nm.add(name.toLowerCase());
        accounts.push({ id: aid, password: apw, name });
      }
      const next = {
        title: String(c.title || DEF.title).trim().slice(0, 100),
        areas: cleanList(c.areas, 12),
        stores: cleanList(c.stores, 300),
        accounts,
      };
      if (!next.areas.length) return json({ error: "Minimal 1 area penilaian" }, 400);
      if (!next.accounts.length) return json({ error: "Minimal 1 akun juri" }, 400);
      if (!next.stores.length) return json({ error: "Minimal 1 toko" }, 400);
      await db.setJSON("config", next);
      return json({ ok: true, config: pub(next, "admin") });
    }

    default:
      return json({ error: "Aksi tidak dikenal" }, 400);
  }
};

export const config = { path: "/api" };
