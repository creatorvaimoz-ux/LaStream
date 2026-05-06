/**
 * Script: Reset Database LaStream
 * Hapus semua data user, stream, video, channel YouTube
 * Jalankan: node scripts/reset-db.js
 */

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const readline = require('readline');

const dbPath = path.join(__dirname, '../db/lastream.db');
const db = new sqlite3.Database(dbPath);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log('\n⚠️  PERINGATAN: Script ini akan MENGHAPUS SEMUA DATA dari database!');
console.log('   Termasuk: semua user, video, stream, playlist, channel YouTube, dll.\n');

rl.question('Ketik "HAPUS" untuk konfirmasi: ', (answer) => {
  rl.close();
  if (answer !== 'HAPUS') {
    console.log('❌ Dibatalkan.');
    process.exit(0);
  }

  console.log('\n🗑️  Menghapus semua data...\n');

  db.serialize(() => {
    const tables = [
      'stream_history',
      'streams',
      'stream_rotations',
      'rotation_items',
      'playlists',
      'playlist_items',
      'videos',
      'media_folders',
      'youtube_channels',
      'app_settings',
      'users',
      'sessions',
    ];

    tables.forEach(table => {
      db.run(`DELETE FROM ${table}`, [], function(err) {
        if (err) {
          if (err.message.includes('no such table')) {
            console.log(`   ⏭️  Tabel "${table}" tidak ditemukan (skip)`);
          } else {
            console.error(`   ❌ Error hapus "${table}":`, err.message);
          }
        } else {
          console.log(`   ✅ Tabel "${table}" dikosongkan (${this.changes} baris dihapus)`);
        }
      });
    });

    // Reset auto-increment
    db.run(`DELETE FROM sqlite_sequence`, [], (err) => {
      if (!err) console.log('   ✅ Auto-increment counter direset');
    });

    setTimeout(() => {
      db.close();
      console.log('\n✅ Database berhasil dikosongkan!');
      console.log('📋 Langkah selanjutnya:');
      console.log('   1. Restart server: npm start / node app.js');
      console.log('   2. Buka http://localhost:7575 → akan muncul halaman Setup Account');
      console.log('   3. Buat akun admin baru\n');
    }, 1000);
  });
});
