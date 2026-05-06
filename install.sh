#!/bin/bash
set -e

echo "=================================="
echo "   LaStream Quick Installer       "
echo "   by Vaimoz                      "
echo "=================================="
echo

read -p "Mulai instalasi LaStream? (y/n): " -n 1 -r
echo
[[ ! $REPLY =~ ^[Yy]$ ]] && echo "Instalasi dibatalkan." && exit 1

# ─────────────────────────────────────────
# 1. Update sistem
# ─────────────────────────────────────────
echo "🔄 Updating sistem..."
sudo apt update && sudo apt upgrade -y

# ─────────────────────────────────────────
# 2. Install NVM + Node.js LTS
# ─────────────────────────────────────────
echo "📦 Installing nvm (Node Version Manager)..."
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/refs/heads/master/install.sh | bash

export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

grep -q 'NVM_DIR' ~/.bashrc || cat >> ~/.bashrc << 'EOF'
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
EOF

echo "📦 Installing Node.js LTS..."
nvm install --lts
nvm use --lts
nvm alias default 'lts/*'
echo "✅ Node.js $(node -v) berhasil diinstall"

# ─────────────────────────────────────────
# 3. Install build tools
# ─────────────────────────────────────────
echo "🔨 Installing build tools..."
sudo apt install -y python3 make g++ build-essential

# ─────────────────────────────────────────
# 4. Install FFmpeg
# ─────────────────────────────────────────
if command -v ffmpeg &> /dev/null; then
    echo "✅ FFmpeg sudah terinstall, skip..."
else
    echo "🎬 Installing FFmpeg..."
    sudo apt install ffmpeg -y
fi

# ─────────────────────────────────────────
# 5. Install Git
# ─────────────────────────────────────────
if command -v git &> /dev/null; then
    echo "✅ Git sudah terinstall, skip..."
else
    echo "🔧 Installing Git..."
    sudo apt install git -y
fi

# ─────────────────────────────────────────
# 6. Clone repository LaStream
# ─────────────────────────────────────────
echo "📥 Clone repository LaStream..."
if [ -d "$HOME/lastream" ]; then
    echo "⚠️  Folder lastream sudah ada, melakukan pull terbaru..."
    cd "$HOME/lastream"
    git pull
else
    git clone https://github.com/creatorvaimoz-ux/LaStream "$HOME/lastream"
    cd "$HOME/lastream"
fi

# ─────────────────────────────────────────
# 7. Install dependencies
# ─────────────────────────────────────────
echo "⚙️  Installing dependencies..."
npm install --production

# ─────────────────────────────────────────
# 8. Generate .env
# ─────────────────────────────────────────
echo "🔐 Membuat file .env..."
if [ ! -f "$HOME/lastream/.env" ]; then
    cp "$HOME/lastream/.env.example" "$HOME/lastream/.env"

    # Generate SESSION_SECRET (64 karakter hex)
    SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    # Generate ENCRYPTION_KEY (32 karakter hex)
    ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")

    sed -i "s/isi_random_string_minimal_32_karakter/$SESSION_SECRET/" "$HOME/lastream/.env"
    sed -i "s/isi_32_karakter_hex/$ENCRYPTION_KEY/" "$HOME/lastream/.env"

    echo "✅ .env berhasil dibuat dengan SESSION_SECRET & ENCRYPTION_KEY otomatis"
else
    echo "✅ .env sudah ada, skip generate..."
fi

# ─────────────────────────────────────────
# 9. Setup timezone
# ─────────────────────────────────────────
echo "🕐 Setup timezone ke Asia/Jakarta..."
sudo timedatectl set-timezone Asia/Jakarta

# ─────────────────────────────────────────
# 10. Setup firewall
# ─────────────────────────────────────────
echo "🔧 Setup firewall (port 7575)..."
sudo ufw allow ssh
sudo ufw allow 7575
sudo ufw --force enable

# ─────────────────────────────────────────
# 11. Install PM2
# ─────────────────────────────────────────
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"

if command -v pm2 &> /dev/null; then
    echo "✅ PM2 sudah terinstall, skip..."
else
    echo "🚀 Installing PM2..."
    npm install -g pm2
fi

if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 gagal ditemukan setelah instalasi."
    exit 1
fi

echo "✅ PM2 $(pm2 --version) berhasil disiapkan"

# ─────────────────────────────────────────
# 12. Start LaStream via PM2
# ─────────────────────────────────────────
echo "▶️  Starting LaStream..."
cd "$HOME/lastream"

# Hapus proses lama jika ada
pm2 describe lastream &> /dev/null && pm2 delete lastream || true

pm2 start app.js --name lastream
pm2 save

# ─────────────────────────────────────────
# 13. Setup PM2 startup (auto-start on reboot)
# ─────────────────────────────────────────
echo "🔁 Setup PM2 startup on boot..."
PM2_STARTUP_CMD=$(pm2 startup systemd -u "$USER" --hp "$HOME" 2>&1 | grep "sudo env" | head -1)
if [ -n "$PM2_STARTUP_CMD" ]; then
    eval "sudo $PM2_STARTUP_CMD" || true
else
    pm2 startup 2>&1 | tail -1 | sudo bash || true
fi
pm2 save

# ─────────────────────────────────────────
# 14. Selesai
# ─────────────────────────────────────────
echo
echo "=================================="
echo "✅ INSTALASI LASTREAM SELESAI!"
echo "=================================="

SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}' || echo "IP_SERVER")

echo
echo "🌐 URL Akses : http://$SERVER_IP:7575"
echo "📦 Node.js  : $(node -v)"
echo "📦 PM2      : $(pm2 --version)"
echo
echo "📋 Langkah selanjutnya:"
echo "  1. Buka http://$SERVER_IP:7575 di browser"
echo "  2. Daftar akun pertama (otomatis jadi Admin)"
echo "  3. Masuk ke Settings → Integration → hubungkan YouTube"
echo
echo "📌 Perintah berguna:"
echo "  pm2 status            — cek status app"
echo "  pm2 logs lastream     — lihat log real-time"
echo "  pm2 restart lastream  — restart app"
echo "=================================="
