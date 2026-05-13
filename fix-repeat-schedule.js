/**
 * fix-repeat-schedule.js
 * Script untuk:
 * 1. Cek stream yang ada (status scheduled/offline)
 * 2. Set repeat_mode = 'daily' pada stream tertentu
 * 3. Reschedule stream yang schedule_time-nya sudah lewat ke besok
 *
 * Jalankan: node fix-repeat-schedule.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, 'db', 'lastream.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

db.serialize(() => {
  // Tambah kolom repeat_mode jika belum ada
  db.run(`ALTER TABLE streams ADD COLUMN repeat_mode TEXT DEFAULT 'none'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding column:', err.message);
    } else {
      console.log('✅ Kolom repeat_mode siap');
    }
  });

  // Tampilkan semua stream
  console.log('\n=== DAFTAR STREAM SAAT INI ===');
  db.all(`SELECT id, title, status, schedule_time, end_time, repeat_mode FROM streams ORDER BY created_at DESC LIMIT 20`, (err, rows) => {
    if (err) {
      console.error(err);
      db.close();
      return;
    }

    rows.forEach((row, i) => {
      console.log(`\n[${i + 1}] ID: ${row.id}`);
      console.log(`    Title: ${row.title}`);
      console.log(`    Status: ${row.status}`);
      console.log(`    Schedule: ${row.schedule_time || 'tidak ada'}`);
      console.log(`    End Time: ${row.end_time || 'tidak ada'}`);
      console.log(`    Repeat Mode: ${row.repeat_mode || 'none'}`);
    });

    // ============================================================
    // EDIT BAGIAN INI: Set ID stream yang ingin diulang harian
    // Contoh: const streamIdToFix = 'abc-123-def-456';
    // Atau biarkan kosong ('') jika hanya ingin melihat data
    // ============================================================
    const streamIdToFix = ''; // <-- ISI DENGAN ID STREAM ANDA

    if (streamIdToFix) {
      db.get(`SELECT * FROM streams WHERE id = ?`, [streamIdToFix], (err, stream) => {
        if (err || !stream) {
          console.error('\n❌ Stream tidak ditemukan:', streamIdToFix);
          db.close();
          return;
        }

        console.log('\n=== MEMPERBAIKI STREAM ===');
        console.log(`Mengatur repeat_mode = daily untuk: ${stream.title}`);

        // Hitung schedule_time besok jika sudah lewat
        const now = new Date();
        let newSchedule = stream.schedule_time ? new Date(stream.schedule_time) : null;
        let newEndTime = stream.end_time ? new Date(stream.end_time) : null;

        if (newSchedule && newSchedule <= now) {
          const shiftMs = 24 * 60 * 60 * 1000;
          while (newSchedule <= now) {
            newSchedule = new Date(newSchedule.getTime() + shiftMs);
          }
          if (newEndTime) {
            const origSchedule = stream.schedule_time ? new Date(stream.schedule_time) : null;
            const origEnd = stream.end_time ? new Date(stream.end_time) : null;
            if (origSchedule && origEnd) {
              const duration = origEnd.getTime() - origSchedule.getTime();
              newEndTime = new Date(newSchedule.getTime() + duration);
            }
          }
        }

        const scheduleIso = newSchedule ? newSchedule.toISOString() : stream.schedule_time;
        const endIso = newEndTime ? newEndTime.toISOString() : stream.end_time;

        db.run(
          `UPDATE streams SET repeat_mode = 'daily', status = 'scheduled', schedule_time = ?, end_time = ?, start_time = NULL, youtube_broadcast_id = NULL, youtube_stream_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [scheduleIso, endIso, streamIdToFix],
          function(err) {
            if (err) {
              console.error('❌ Error:', err.message);
            } else {
              console.log(`✅ Berhasil! Stream "${stream.title}" sekarang dijadwalkan ulang ke:`);
              console.log(`   Schedule: ${scheduleIso}`);
              console.log(`   End Time: ${endIso}`);
              console.log(`   Status: scheduled`);
              console.log(`   Repeat: daily`);
            }
            db.close();
          }
        );
      });
    } else {
      console.log('\n💡 TIP: Edit variabel streamIdToFix di script ini dengan ID stream yang ingin diulang harian');
      console.log('   Lalu jalankan ulang: node fix-repeat-schedule.js');
      db.close();
    }
  });
});
