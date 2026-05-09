const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');

class RotationLog {
  static create(logData) {
    const id = uuidv4();
    const {
      rotation_id,
      rotation_item_id = null,
      rotation_name = '',
      item_title = '',
      action,
      status = 'success',
      error_message = null,
      stream_id = null,
      started_at = null,
      stopped_at = null,
      duration_seconds = null
    } = logData;

    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO rotation_logs (id, rotation_id, rotation_item_id, rotation_name, item_title, action, status, error_message, stream_id, started_at, stopped_at, duration_seconds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, rotation_id, rotation_item_id, rotation_name, item_title, action, status, error_message, stream_id, started_at, stopped_at, duration_seconds],
        function(err) {
          if (err) {
            console.error('Error creating rotation log:', err.message);
            return reject(err);
          }
          resolve({ id, ...logData });
        }
      );
    });
  }

  static findByRotationId(rotationId, limit = 50) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM rotation_logs WHERE rotation_id = ? ORDER BY created_at DESC LIMIT ?`,
        [rotationId, limit],
        (err, rows) => {
          if (err) {
            console.error('Error finding rotation logs:', err.message);
            return reject(err);
          }
          resolve(rows || []);
        }
      );
    });
  }

  static getStats(rotationId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT
          COUNT(*) as total_runs,
          SUM(CASE WHEN status = 'success' AND action = 'start' THEN 1 ELSE 0 END) as successful_starts,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
          SUM(duration_seconds) as total_duration_seconds,
          MAX(created_at) as last_run_at
         FROM rotation_logs WHERE rotation_id = ?`,
        [rotationId],
        (err, row) => {
          if (err) {
            console.error('Error getting rotation log stats:', err.message);
            return reject(err);
          }
          resolve(row || { total_runs: 0, successful_starts: 0, errors: 0, total_duration_seconds: 0, last_run_at: null });
        }
      );
    });
  }

  static deleteOld(rotationId, keepCount = 100) {
    return new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM rotation_logs WHERE rotation_id = ? AND id NOT IN (
           SELECT id FROM rotation_logs WHERE rotation_id = ? ORDER BY created_at DESC LIMIT ?
         )`,
        [rotationId, rotationId, keepCount],
        function(err) {
          if (err) {
            console.error('Error deleting old rotation logs:', err.message);
            return reject(err);
          }
          resolve({ deleted: this.changes });
        }
      );
    });
  }
}

module.exports = RotationLog;
