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
git commit -m "feat: Add Auto-Generated Subtitles, Multi-Language AI, and AI Generator for Rotations

- Add youtube_closed_captions column to streams and rotation_items tables
- Update Stream.js and Rotation.js models to support closed captions CRUD
- Update youtubeService.js to pass enableClosedCaptions to YouTube API
- Update rotationService.js to pass enableClosedCaptions and save field
- Add ytClosedCaptions parameter to POST/PUT /api/streams/youtube endpoint
- Add youtube_closed_captions support to POST/PUT /api/rotations endpoints
- Add Auto-Generated Subtitles toggle UI to Create Stream form (dashboard)
- Add Auto-Generated Subtitles toggle UI to Edit Stream form (dashboard)
- Wire ytClosedCaptions into ytFormData for create and edit payloads
- Restore editYtEnableClosedCaptions state when opening edit modal
- Port AI Content Generator (with Language + Style selector) to rotations.ejs
- Add generateRotationItemAI() function for per-item AI metadata generation
- Add youtube_closed_captions checkbox per rotation item"

Write-Host "`n=== Push ke GitHub ===" -ForegroundColor Green
git push

Write-Host "`n=== SELESAI ===" -ForegroundColor Green
Write-Host "Cek repository GitHub Anda untuk memastikan push berhasil." -ForegroundColor White
