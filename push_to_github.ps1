#!/usr/bin/env powershell
# LaStream - Push to GitHub Script
# Jalankan script ini di PowerShell dari folder LaStream-main

Set-Location "c:\Users\ASUS FX506ICB\Documents\LaStream-main\LaStream-main"

Write-Host "`n=== Mengecek Git Remote ===" -ForegroundColor Cyan
git remote -v

Write-Host "`n=== Status File yang Berubah ===" -ForegroundColor Cyan
git status --short

Write-Host "`n=== Menambahkan semua file (git add) ===" -ForegroundColor Yellow
git add .

Write-Host "`n=== Git Status setelah add ===" -ForegroundColor Cyan
git status --short

Write-Host "`n=== Membuat commit ===" -ForegroundColor Yellow
git commit -m "feat: enhance streaming status table in dashboard

- Add start_time and end_time to schedule column in dashboard
- Show YouTube channel name under the platform icon for active YouTube streams
- Translate schedule status to Indonesian (Mulai, Jadwal, Berhenti)"

Write-Host "`n=== Push ke GitHub ===" -ForegroundColor Green
git push

Write-Host "`n=== SELESAI ===" -ForegroundColor Green
Write-Host "Cek repository GitHub Anda untuk memastikan push berhasil." -ForegroundColor White
