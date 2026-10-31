import { getStore } from "@netlify/blobs";

const mk = (g, n, label) => Array.from({ length: n }, (_, i) => ({ g, t: `${label} – pertanyaan ${i + 1}` }));
const DEF = {
  title: "Lomba Kebersihan & Kerapihan Toko",
  juri: Array.from({ length: 8 }, (_, i) => `Juri ${i + 1}`),
  stores: Array.from({ length: 95 }, (_, i) => `Toko ${i + 1}`),
  areas: [
    { name: "Area penjualan", qs: mk("", 4, "Area penjualan") },
    { name: "Gudang", qs: [
      ...mk("Penataan barang", 4, "Penataan barang"), ...mk("Kondisi barang & harga", 4, "Kondisi barang & harga"),
      ...mk("Kebersihan", 4, "Kebersihan"), ...mk("Lorong, kasir & kenyamanan", 4, "Lorong, kasir & kenyamanan")] },
    { name: "Toilet", qs: mk("", 8, "Toilet") },
    { name: "Area parkir", qs: mk("", 4, "Area parkir") },
    { name: "Pelayanan", qs: mk("", 4, "Pelayanan") },
    { name: "Grooming", qs: mk("", 4, "Grooming") },
  ],
};

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const r2 = (n) => Math.round(n * 100) / 100;
const key = (name) => "juri:" + encodeURIComponent(name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qCount = (areas) => areas.reduce((n, a) => n + a.qs.length, 0);
const randPw = () => { const ch = "abcdefghjkmnpqrstuvwxyz23456789"; return Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => ch[n % ch.length]).join(""); };

function assignBlocks(names, accounts) {
  const m = Math.max(accounts.length, 1), base = Math.floor(names.length / m), extra = names.length % m, own = [];
  for (let j = 0; j < m; j++) for (let t = 0; t < base + (j < extra ? 1 : 0); t++) own.push(j);
  return names.map((name, i) => ({ name, juri: [accounts[own[i]]?.id].filter(Boolean) }));
}
function score(nilai, areas) {
  if (!Array.isArray(nilai) || nilai.length !== qCount(areas)) return null;
  let p = 0;
  const areaAvg = areas.map((a) => { const sl = nilai.slice(p, p + a.qs.length); p += a.qs.length; return mean(sl); });
  return { areaAvg, avg: mean(areaAvg) };
}
function cleanList(v, max, maxLen = 80) {
  if (!Array.isArray(v)) return [];
  const seen = new Set(), out = [];
  for (const x of v) { const t = String(x).trim().replace(/\s+/g, " ").slice(0, maxLen); if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); } }
  return out.slice(0, max);
}

async function getConfig(db) {
  let c = await db.get("config", { type: "json" }), changed = false;
  if (!c) { c = {}; changed = true; }
  if (!Array.isArray(c.accounts)) {
    const names = Array.isArray(c.juri) && c.juri.length ? c.juri.map((x) => (typeof x === "string" ? x : x.name)) : DEF.juri;
    c.accounts = names.map((name, i) => ({ id: "juri" + (i + 1), password: randPw(), name }));
    changed = true;
  }
  if (!c.login) { c.login = { id: "juri", password: randPw() }; changed = true; }
  c.accounts = c.accounts.map((a) => ({ id: a.id, name: a.name }));
  if (c.schema !== 2) {
    const nm = (c.stores || DEF.stores).map((s) => (typeof s === "string" ? s : s.name));
    c.areas = DEF.areas; c.stores = assignBlocks(nm, c.accounts); c.schema = 2; changed = true;
  }
  c.stores = c.stores.map((s) => ({ name: s.name, juri: Array.isArray(s.juri) ? s.juri : s.juri ? [s.juri] : [] }));
  c = { schema: 2, title: c.title || DEF.title, areas: c.areas, stores: c.stores, accounts: c.accounts, login: c.login };
  if (changed) await db.setJSON("config", c);
  return c;
}
const pub = (c, role) => ({
  title: c.title, areas: c.areas, stores: c.stores, accounts: c.accounts, juri: c.accounts.map((a) => a.name),
  ...(role === "admin" ? { login: c.login } : {}),
});

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Gunakan POST" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "Permintaan tidak valid" }, 400); }
  const ADMIN = String(Netlify.env.get("ADMIN_PIN") || process.env.ADMIN_PIN || "").trim();
  if (!ADMIN) return json({ error: "ADMIN_PIN belum diatur di Netlify (Environment variables), lalu deploy ulang." }, 500);

  const db = getStore({ name: "lomba", consistency: "strong" });
  const cfg = await getConfig(db);
  const id = String(b.id ?? "").trim().toLowerCase(), pw = String(b.pw ?? "").trim();
  let role = null, me = null;
  if (id === "admin") { if (pw === ADMIN) role = "admin"; }
  else if (id === cfg.login.id.toLowerCase() && pw === cfg.login.password) { role = "juri"; me = cfg.accounts.find((a) => a.name === b.juri) || null; }
  if (!role) { await sleep(600); return json({ error: "ID atau kata sandi salah." }, 401); }

  switch (b.action) {
    case "load": {
      const out = { role, config: pub(cfg, role) };
      if (me) out.mine = (await db.get(key(me.name), { type: "json" })) || {};
      return json(out);
    }
    case "submit": {
      if (role !== "juri") return json({ error: "Hanya juri yang bisa menilai" }, 403);
      if (!me) return json({ error: "Pilih nama juri dulu" }, 400);
      if (!cfg.stores.some((s) => s.name === b.store)) return json({ error: "Toko tidak dikenali" }, 400);
      const n = b.nilai;
      if (!Array.isArray(n) || n.length !== qCount(cfg.areas) || !n.every((x) => Number.isInteger(x) && x >= 1 && x <= 10))
        return json({ error: "Isi semua pertanyaan dengan nilai 1–10" }, 400);
      const k = key(me.name), mine = (await db.get(k, { type: "json" })) || {};
      mine[b.store] = { nilai: n, ts: Date.now() };
      await db.setJSON(k, mine);
      return json({ ok: true, saved: mine[b.store] });
    }
    case "ranking": {
      if (role !== "admin") return json({ error: "Khusus admin" }, 403);
      const all = {};
      await Promise.all(cfg.accounts.map(async (a) => { all[a.name] = (await db.get(key(a.name), { type: "json" })) || {}; }));
      const rows = cfg.stores.map((s) => {
        const per = [];
        for (const a of cfg.accounts) {
          const e = all[a.name][s.name], sc = e && score(e.nilai, cfg.areas);
          if (sc) per.push({ juri: a.name, nilai: e.nilai, areaAvg: sc.areaAvg.map(r2), avg: r2(sc.avg), raw: sc.avg });
        }
        return {
          store: s.name, juriName: cfg.accounts.filter((a) => s.juri.includes(a.id)).map((a) => a.name).join(", "), expected: s.juri.length, count: per.length,
          avg: per.length ? r2(mean(per.map((p) => p.raw))) : null,
          areaAvg: per.length ? cfg.areas.map((_, k) => r2(mean(per.map((p) => p.areaAvg[k])))) : null,
          juri: per.map(({ raw, ...p }) => p),
        };
      });
      rows.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.count - a.count || a.store.localeCompare(b.store, "id", { numeric: true }));
      let rank = 0, prev = null;
      rows.forEach((r, i) => { if (r.avg === null) { r.rank = null; return; } if (r.avg !== prev) { rank = i + 1; prev = r.avg; } r.rank = rank; });
      const progress = cfg.accounts.map((a) => {
        const mine = cfg.stores.filter((s) => s.juri.includes(a.id));
        return { name: a.name, total: mine.length, done: mine.filter((s) => score(all[a.name][s.name]?.nilai, cfg.areas)).length };
      });
      const qlabels = cfg.areas.flatMap((a) => a.qs.map((q) => `${a.name} – ${q.g ? q.g + ": " : ""}${q.t}`));
      return json({ rows, progress, total: cfg.stores.length, assigned: cfg.stores.reduce((n, x) => n + x.juri.length, 0), areas: cfg.areas.map((a) => a.name), qlabels, updated: Date.now() });
    }
    case "saveConfig": {
      if (role !== "admin") return json({ error: "Khusus admin" }, 403);
      const c = b.config || {}, accounts = [], ids = new Set(), nm = new Set();
      for (const a of Array.isArray(c.accounts) ? c.accounts.slice(0, 30) : []) {
        const aid = String(a.id ?? "").trim().toLowerCase(), name = String(a.name ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
        if (!aid && !name) continue;
        if (!/^[a-z0-9._-]{1,30}$/.test(aid)) return json({ error: `Kode juri "${aid}" tidak valid (huruf kecil/angka, tanpa spasi)` }, 400);
        if (!name) return json({ error: `Nama untuk kode "${aid}" belum diisi` }, 400);
        if (ids.has(aid) || nm.has(name.toLowerCase())) return json({ error: `Kode atau nama juri ganda: "${aid}" / "${name}"` }, 400);
        ids.add(aid); nm.add(name.toLowerCase()); accounts.push({ id: aid, name });
      }
      if (!accounts.length) return json({ error: "Minimal 1 juri" }, 400);
      const lid = String(c.login?.id ?? "").trim().toLowerCase(), lpw = String(c.login?.password ?? "").trim();
      if (!/^[a-z0-9._-]{2,30}$/.test(lid) || lid === "admin") return json({ error: 'ID login juri tidak valid (huruf kecil/angka, bukan "admin")' }, 400);
      if (lpw.length < 3 || lpw.length > 40) return json({ error: "Kata sandi juri harus 3-40 karakter" }, 400);
      const areas = [];
      for (const a of Array.isArray(c.areas) ? c.areas.slice(0, 10) : []) {
        const name = String(a.name ?? "").trim().slice(0, 60);
        const qs = (Array.isArray(a.qs) ? a.qs : []).map((q) => ({ g: String(q.g ?? "").trim().slice(0, 60), t: String(q.t ?? "").trim().slice(0, 160) })).filter((q) => q.t);
        if (!name) return json({ error: "Ada area tanpa nama (baris yang diawali #)" }, 400);
        if (!qs.length) return json({ error: `Area "${name}" belum punya pertanyaan` }, 400);
        areas.push({ name, qs });
      }
      if (!areas.length) return json({ error: "Minimal 1 area dengan pertanyaan" }, 400);
      if (qCount(areas) > 120) return json({ error: "Maksimal 120 pertanyaan" }, 400);
      const stores = [], seen = new Set();
      for (const s of Array.isArray(c.stores) ? c.stores.slice(0, 300) : []) {
        const name = String(s.name ?? "").trim().replace(/\s+/g, " ").slice(0, 80), js = [...new Set((Array.isArray(s.juri) ? s.juri : [s.juri]).map((x) => String(x ?? "").trim().toLowerCase()).filter(Boolean))];
        if (!name) continue;
        if (seen.has(name.toLowerCase())) return json({ error: `Nama toko ganda: "${name}"` }, 400);
        for (const j of js) if (!ids.has(j)) return json({ error: `Toko "${name}" memakai ID juri "${j}" yang tidak ada` }, 400);
        seen.add(name.toLowerCase()); stores.push({ name, juri: js });
      }
      if (!stores.length) return json({ error: "Minimal 1 toko" }, 400);
      const next = { schema: 2, title: String(c.title || DEF.title).trim().slice(0, 100), areas, stores, accounts, login: { id: lid, password: lpw } };
      await db.setJSON("config", next);
      return json({ ok: true, config: pub(next, "admin") });
    }
    default: return json({ error: "Aksi tidak dikenal" }, 400);
  }
};
export const config = { path: "/api" };
