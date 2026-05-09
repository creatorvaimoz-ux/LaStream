<div align="center">
  <img src="public/images/logo.svg" alt="LaStream Logo" width="80">
  <h1>LaStream</h1>
  <p>Platform manajemen live streaming YouTube berbasis Node.js dengan YouTube API v3</p>

  ![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=nodedotjs&logoColor=white)
  ![YouTube API](https://img.shields.io/badge/YouTube-API%20v3-FF0000?logo=youtube&logoColor=white)
  ![License](https://img.shields.io/badge/License-MIT-blue)
  ![Made by](https://img.shields.io/badge/Made%20by-Vaimoz-purple)
</div>

---

## ✨ Fitur Utama

- 🔴 **Live Streaming YouTube** — via YouTube API v3 (otomatis buat broadcast & stream)
- 🖼️ **Dynamic Overlays** — tambahkan logo watermark & running text otomatis (FFmpeg)
- 📅 **Penjadwal Otomatis** — atur jadwal mulai & selesai dengan repeat mode
- 🎬 **Manajemen Media** — upload video, audio, thumbnail dengan folder manager
- 📋 **Playlist Manager** — buat playlist untuk rotasi konten
- 🤖 **Content AI & Subtitle** — generate SEO metadata & subtitle otomatis (Closed Captions)
- 💰 **Monetisasi** — kelola iklan, Super Chat, Membership per stream
- 📺 **VOD After Live** — atur visibilitas & delay publish rekaman setelah live
- 📊 **Analytics** — tayangan, jam tonton, geografi, sumber traffic & pendapatan
- 🤖 **YouTube Chatbot** — pesan otomatis di live chat
- 📱 **Telegram Notifikasi** — notifikasi start/stop/error via bot Telegram
- 🔒 **Multi User** — sistem role admin & user dengan manajemen akun
- 🗃️ **Database Bawaan (SQLite)** — ringan, cepat, tanpa perlu setup database terpisah
- 📱 **Responsive** — tampilan mobile-friendly

---

## ⚡ Quick Install (Cara Termudah)

> **Untuk VPS Ubuntu 20.04 / 22.04** — satu perintah, semua otomatis.

**1. Install dependensi dasar:**
```bash
sudo apt update && sudo apt install -y git ffmpeg curl tmux
```

**2. Jalankan di dalam tmux agar tidak putus:**
```bash
tmux new -s lastream
bash <(curl -fsSL https://raw.githubusercontent.com/creatorvaimoz-ux/LaStream/main/install.sh)
```

> 💡 Jika koneksi SSH terputus, reconnect lalu ketik `tmux attach -t lastream` untuk melanjutkan.

**3. Setelah selesai, akses:**
```
http://IP_VPS:7575
```

Akun pertama yang didaftarkan otomatis menjadi **Admin**.

---

## 🚀 Instalasi Manual (Step-by-Step)

### Prasyarat

| Kebutuhan | Versi |
|---|---|
| OS | Ubuntu 20.04 / 22.04 |
| Node.js | 20+ (LTS) |
| FFmpeg | Terbaru |
| RAM | Minimal 1 GB |
| Storage | Minimal 10 GB |

---

### Langkah 1 — Update Sistem & Install Dependensi

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git ffmpeg curl tmux
```

### Langkah 2 — Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verifikasi
node -v
npm -v
ffmpeg -version
```

### Langkah 3 — Clone Repository

```bash
git clone https://github.com/creatorvaimoz-ux/LaStream.git ~/lastream
cd ~/lastream
```

### Langkah 4 — Install Dependencies

```bash
npm install --production
```

### Langkah 5 — Konfigurasi Environment

```bash
cp .env.example .env
nano .env
```

Isi file `.env` — **hanya 3 variabel wajib:**

```env
PORT=7575
NODE_ENV=production
SESSION_SECRET=GANTI_DENGAN_STRING_RANDOM_64_KARAKTER
ENCRYPTION_KEY=GANTI_DENGAN_HEX_32_KARAKTER
```

**Generate otomatis:**
```bash
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(16).toString('hex'))"
```

> **Catatan:** YouTube API, Telegram Bot, Gemini AI, OpenAI **tidak perlu di `.env`**.
> Konfigurasi di dalam aplikasi: **Settings → Integration** dan **Settings → AI Keys**.

### Langkah 6 — Jalankan dengan PM2

```bash
# Install PM2
npm install -g pm2

# Jalankan aplikasi
pm2 start app.js --name lastream

# Auto-start saat reboot
pm2 save
pm2 startup
# Jalankan perintah sudo yang muncul dari output di atas
```

**Verifikasi:**
```bash
pm2 status
pm2 logs lastream --lines 50
```

---

### Langkah 7 — Setup Nginx (Opsional, untuk domain)

```bash
sudo apt install -y nginx
sudo nano /etc/nginx/sites-available/lastream
```

Paste konfigurasi berikut (ganti `domain.com`):

```nginx
server {
    listen 80;
    server_name domain.com www.domain.com;

    client_max_body_size 50G;

    location / {
        proxy_pass http://localhost:7575;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/lastream /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx && sudo systemctl enable nginx
```

### Langkah 8 — Install SSL/HTTPS (Opsional)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d domain.com -d www.domain.com
```

---

## ⚙️ Konfigurasi YouTube API

1. Buka [Google Cloud Console](https://console.cloud.google.com)
2. Buat project → aktifkan **YouTube Data API v3** & **YouTube Analytics API**
3. Buat **OAuth 2.0 Client ID** (Web Application):
   - Authorized redirect URIs: `https://domain.com/auth/youtube/callback`
4. Paste **Client ID** & **Client Secret** ke **Settings → Integration**

---

## 🔄 Update Aplikasi

```bash
cd ~/lastream
git pull origin main
npm install --production
pm2 restart lastream
```

---

## 📋 Perintah PM2 Berguna

```bash
pm2 status                 # Cek status
pm2 logs lastream          # Log real-time
pm2 restart lastream       # Restart app
pm2 stop lastream          # Stop app
pm2 delete lastream        # Hapus dari PM2
pm2 save                   # Simpan konfigurasi
```

---

## 🔐 Reset Password Admin

```bash
cd ~/lastream
node reset-password.js
```

---

## 🗄️ Reset Database

```bash
cd ~/lastream
node scripts/reset-db.js
# Ketik "HAPUS" untuk konfirmasi
```

---

## 🛠️ Troubleshooting

### ❌ `client_loop: send disconnect` — SSH Putus Saat Install

Gunakan **tmux** agar proses tetap berjalan meski SSH terputus:
```bash
tmux new -s lastream
# jalankan install script di sini
# jika putus, reconnect lalu:
tmux attach -t lastream
```

---

### ❌ `fatal: Unable to create '.git/shallow.lock': File exists`

Hapus file lock sisa dari proses yang terhenti:
```bash
rm -f ~/.nvm/.git/shallow.lock
# Lalu jalankan install ulang
```

---

### ❌ `pm2: command not found`

nvm belum di-load ke shell saat ini:
```bash
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
# Coba lagi
pm2 status
```

---

### ❌ Port 7575 sudah digunakan

```bash
sudo lsof -i :7575
sudo kill -9 <PID>
```

---

### ❌ FFmpeg tidak ditemukan

```bash
sudo apt install -y ffmpeg
which ffmpeg
```

---

### ❌ Permission error upload file

```bash
chmod -R 755 ~/lastream/public/uploads
```

---

### ❌ Cek log error aplikasi

```bash
pm2 logs lastream --err --lines 100
```

---

## 📄 Lisensi

MIT License — © 2026 Vaimoz

---

<div align="center">
  Made with ❤️ by <a href="https://github.com/creatorvaimoz-ux">Vaimoz</a>
</div>
