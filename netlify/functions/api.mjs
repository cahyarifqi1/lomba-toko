import { getStore } from "@netlify/blobs";

// Isi awal. Semuanya bisa diubah admin lewat tab "Pengaturan" di aplikasi.
const DEFAULT_CONFIG = {
  title: "Lomba Kebersihan & Kerapihan Toko",
  areas: [
    "Area depan & parkir",
    "Area penjualan & display",
    "Kasir",
    "Gudang",
    "Toilet & area belakang",
  ],
  juri: Array.from({ length: 8 }, (_, i) => `Juri ${i + 1}`),
  stores: Array.from({ length: 95 }, (_, i) => `Toko ${i + 1}`),
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const r2 = (n) => Math.round(n * 100) / 100;
const key = (juri) => "juri:" + encodeURIComponent(juri);

function cleanList(v, max, maxLen = 80) {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  const out = [];
  for (const x of v) {
    const t = String(x).trim().replace(/\s+/g, " ").slice(0, maxLen);
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out.slice(0, max);
}

async function getConfig(db) {
  const c = await db.get("config", { type: "json" });
  return c ? { ...DEFAULT_CONFIG, ...c } : DEFAULT_CONFIG;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Gunakan POST" }, 405);

  let b;
  try {
    b = await req.json();
  } catch {
    return json({ error: "Permintaan tidak valid" }, 400);
  }

  const ADMIN = (Netlify.env.get("ADMIN_PIN") || "").trim();
  const JURI = (Netlify.env.get("JURI_CODE") || "").trim();
  if (!ADMIN || !JURI) {
    return json(
      {
        error:
          "ADMIN_PIN dan JURI_CODE belum diatur di Netlify (Site configuration → Environment variables), lalu deploy ulang.",
      },
      500
    );
  }

  const code = String(b.code ?? "").trim();
  const role = code === ADMIN ? "admin" : code === JURI ? "juri" : null;
  if (!role) return json({ error: "Kode salah. Cek lagi kode dari admin." }, 401);

  const db = getStore({ name: "lomba", consistency: "strong" });
  const cfg = await getConfig(db);

  switch (b.action) {
    case "load": {
      const out = { role, config: cfg };
      if (b.juri && cfg.juri.includes(b.juri)) {
        out.mine = (await db.get(key(b.juri), { type: "json" })) || {};
      }
      return json(out);
    }

    case "submit": {
      if (!cfg.juri.includes(b.juri)) return json({ error: "Nama juri tidak dikenali" }, 400);
      if (!cfg.stores.includes(b.store)) return json({ error: "Toko tidak dikenali" }, 400);
      const n = b.nilai;
      if (
        !Array.isArray(n) ||
        n.length !== cfg.areas.length ||
        !n.every((x) => Number.isInteger(x) && x >= 1 && x <= 10)
      ) {
        return json({ error: "Isi nilai 1–10 untuk semua area" }, 400);
      }
      const k = key(b.juri);
      const mine = (await db.get(k, { type: "json" })) || {};
      mine[b.store] = { nilai: n, ts: Date.now() };
      await db.setJSON(k, mine);
      return json({ ok: true, saved: mine[b.store] });
    }

    case "ranking": {
      if (role !== "admin") return json({ error: "Khusus admin" }, 403);
      const all = {};
      await Promise.all(
        cfg.juri.map(async (j) => {
          all[j] = (await db.get(key(j), { type: "json" })) || {};
        })
      );

      const rows = cfg.stores.map((s) => {
        const per = [];
        for (const j of cfg.juri) {
          const e = all[j][s];
          if (e && Array.isArray(e.nilai) && e.nilai.length) {
            per.push({ juri: j, nilai: e.nilai, avg: r2(mean(e.nilai)), raw: mean(e.nilai) });
          }
        }
        return {
          store: s,
          count: per.length,
          avg: per.length ? r2(mean(per.map((p) => p.raw))) : null,
          juri: per.map(({ raw, ...p }) => p),
        };
      });

      rows.sort(
        (a, b) =>
          (b.avg ?? -1) - (a.avg ?? -1) ||
          b.count - a.count ||
          a.store.localeCompare(b.store, "id", { numeric: true })
      );

      let rank = 0;
      let prev = null;
      rows.forEach((r, i) => {
        if (r.avg === null) {
          r.rank = null;
          return;
        }
        if (r.avg !== prev) {
          rank = i + 1;
          prev = r.avg;
        }
        r.rank = rank;
      });

      const progress = cfg.juri.map((j) => ({
        name: j,
        done: cfg.stores.filter((s) => all[j][s]).length,
      }));

      return json({ rows, progress, total: cfg.stores.length, areas: cfg.areas, updated: Date.now() });
    }

    case "saveConfig": {
      if (role !== "admin") return json({ error: "Khusus admin" }, 403);
      const c = b.config || {};
      const next = {
        title: String(c.title || DEFAULT_CONFIG.title).trim().slice(0, 100),
        areas: cleanList(c.areas, 12),
        juri: cleanList(c.juri, 30, 40),
        stores: cleanList(c.stores, 300),
      };
      if (!next.areas.length) return json({ error: "Minimal 1 area penilaian" }, 400);
      if (!next.juri.length) return json({ error: "Minimal 1 juri" }, 400);
      if (!next.stores.length) return json({ error: "Minimal 1 toko" }, 400);
      await db.setJSON("config", next);
      return json({ ok: true, config: next });
    }

    default:
      return json({ error: "Aksi tidak dikenal" }, 400);
  }
};

export const config = { path: "/api" };
