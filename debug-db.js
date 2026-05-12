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
  console.log('--- STREAMS TABLE ---');
  db.all('SELECT id, title, status, schedule_time, user_id, created_at FROM streams ORDER BY created_at DESC LIMIT 5', (err, rows) => {
    if (err) console.error(err);
    else console.log(rows);
    
    console.log('\n--- ROTATIONS TABLE ---');
    db.all('SELECT id, name, status, user_id, created_at FROM rotations ORDER BY created_at DESC LIMIT 5', (err, rows) => {
      if (err) console.error(err);
      else console.log(rows);
      
      console.log('\n--- SYSTEM USERS ---');
      db.all('SELECT id, username FROM users', (err, rows) => {
        if (err) console.error(err);
        else console.log(rows);
        
        db.close();
      });
    });
  });
});
