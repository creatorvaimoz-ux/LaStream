const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./db/lastream.db');

db.all("SELECT id, username, youtube_client_id, youtube_client_secret FROM users", [], (err, rows) => {
  if (err) console.error(err);
  console.log(rows);
  db.close();
});
