# Aplikasi Penilaian Lomba Toko

Halaman juri (HP) + halaman admin (ranking langsung). Data tersimpan di Netlify Blobs, jadi tidak perlu database lain.

## Cara pasang (Netlify)
1. Upload folder ini ke GitHub (repo baru), lalu di Netlify: Add new site → Import from Git → pilih repo. (Atau pakai Netlify CLI: `npm i -g netlify-cli`, `netlify login`, `netlify deploy --prod`.)
2. Site configuration → Environment variables, tambahkan:
   - `ADMIN_PIN` = kode rahasia untuk admin (Ayah)
   - `JURI_CODE` = kode yang dibagikan ke 8 juri
3. Deploy ulang (Deploys → Trigger deploy).
4. Buka alamat situsnya, masuk dengan ADMIN_PIN → tab Pengaturan: isi nama juri, area penilaian, dan 95 nama toko (tempel dari Excel, 1 baris 1 toko).
5. Bagikan alamat situs + JURI_CODE ke juri.

Catatan: jangan ubah nama toko/juri/jumlah area setelah penilaian dimulai.
