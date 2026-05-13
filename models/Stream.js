const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');
class Stream {
  static create(streamData) {
    const id = uuidv4();
    const {
      title,
      video_id,
      rtmp_url,
      stream_key,
      platform,
      platform_icon,
      bitrate = 2500,
      resolution,
      fps = 30,
      orientation = 'horizontal',
      loop_video = true,
      schedule_time = null,
      end_time = null,
      duration = null,
      use_advanced_settings = false,
      status,
      user_id,
      youtube_broadcast_id = null,
      youtube_stream_id = null,
      youtube_description = null,
      youtube_privacy = null,
      youtube_category = null,
      youtube_tags = null,
      youtube_thumbnail = null,
      youtube_channel_id = null,
      is_youtube_api = false,
      youtube_monetization = false,
      youtube_closed_captions = false,
      watermark_path = null,
      watermark_position = 'top-right',
      overlay_text = null,
      overlay_text_type = 'static',
      smart_stop = false,
      viewer_threshold = 5,
      smart_stop_max = 30,
      repeat_mode = 'none'
    } = streamData;
    const loop_video_int = loop_video ? 1 : 0;
    const use_advanced_settings_int = use_advanced_settings ? 1 : 0;
    const is_youtube_api_int = is_youtube_api ? 1 : 0;
    const youtube_monetization_int = youtube_monetization ? 1 : 0;
    const youtube_closed_captions_int = youtube_closed_captions ? 1 : 0;
    const smart_stop_int = smart_stop ? 1 : 0;
    const final_status = status || (schedule_time ? 'scheduled' : 'offline');
    const status_updated_at = new Date().toISOString();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO streams (
          id, title, video_id, rtmp_url, stream_key, platform, platform_icon,
          bitrate, resolution, fps, orientation, loop_video,
          schedule_time, end_time, duration, status, status_updated_at, use_advanced_settings, user_id,
          youtube_broadcast_id, youtube_stream_id, youtube_description, youtube_privacy, youtube_category, youtube_tags, youtube_thumbnail, youtube_channel_id, is_youtube_api, youtube_monetization, youtube_closed_captions, watermark_path, watermark_position, overlay_text, overlay_text_type,
          smart_stop, viewer_threshold, smart_stop_max, repeat_mode
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, title, video_id, rtmp_url, stream_key, platform, platform_icon,
          bitrate, resolution, fps, orientation, loop_video_int,
          schedule_time, end_time, duration, final_status, status_updated_at, use_advanced_settings_int, user_id,
          youtube_broadcast_id, youtube_stream_id, youtube_description, youtube_privacy, youtube_category, youtube_tags, youtube_thumbnail, youtube_channel_id, is_youtube_api_int, youtube_monetization_int, youtube_closed_captions_int, watermark_path, watermark_position, overlay_text, overlay_text_type,
          smart_stop_int, viewer_threshold, smart_stop_max, repeat_mode
        ],
        function (err) {
          if (err) {
            console.error('Error creating stream:', err.message);
            return reject(err);
          }
          resolve({ id, ...streamData, status: final_status, status_updated_at });
        }
      );
    });
  }
  static findById(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM streams WHERE id = ?', [id], (err, row) => {
        if (err) {
          console.error('Error finding stream:', err.message);
          return reject(err);
        }
        if (row) {
          row.loop_video = row.loop_video === 1;
          row.use_advanced_settings = row.use_advanced_settings === 1;
          row.is_youtube_api = row.is_youtube_api === 1;
          row.youtube_monetization = row.youtube_monetization === 1;
          row.youtube_closed_captions = row.youtube_closed_captions === 1;
          row.smart_stop = row.smart_stop === 1;
        }
        resolve(row);
      });
    });
  }
  static findAll(userId = null, filter = null) {
    return new Promise((resolve, reject) => {
      let query = `
        SELECT s.*, 
               v.title AS video_title, 
               v.filepath AS video_filepath,
               v.thumbnail_path AS video_thumbnail, 
               v.duration AS video_duration,
               v.resolution AS video_resolution,  
               v.bitrate AS video_bitrate,        
               v.fps AS video_fps,
               p.name AS playlist_name,
               CASE 
                 WHEN p.id IS NOT NULL THEN 'playlist'
                 WHEN v.id IS NOT NULL THEN 'video'
                 ELSE NULL
               END AS video_type,
               yc.channel_name AS youtube_channel_name,
               yc.channel_thumbnail AS youtube_channel_thumbnail,
               yc.channel_id AS youtube_channel_external_id
        FROM streams s
        LEFT JOIN videos v ON s.video_id = v.id
        LEFT JOIN playlists p ON s.video_id = p.id
        LEFT JOIN youtube_channels yc ON s.youtube_channel_id = yc.id
      `;
      const params = [];
      const conditions = [];
      
      if (userId) {
        conditions.push('s.user_id = ?');
        params.push(userId);
      }
      
      if (filter) {
        if (filter === 'live') {
          conditions.push("s.status = 'live'");
        } else if (filter === 'scheduled') {
          conditions.push("s.status = 'scheduled'");
        } else if (filter === 'offline') {
          conditions.push("s.status = 'offline'");
        }
      }
      
      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      
      query += ` ORDER BY 
        CASE s.status 
          WHEN 'live' THEN 1 
          WHEN 'scheduled' THEN 2 
          WHEN 'offline' THEN 3 
          ELSE 4 
        END,
        s.created_at DESC`;
      db.all(query, params, (err, rows) => {
        if (err) {
          console.error('Error finding streams:', err.message);
          return reject(err);
        }
        if (rows) {
          rows.forEach(row => {
            row.loop_video = row.loop_video === 1;
            row.use_advanced_settings = row.use_advanced_settings === 1;
            row.is_youtube_api = row.is_youtube_api === 1;
            row.youtube_monetization = row.youtube_monetization === 1;
            row.youtube_closed_captions = row.youtube_closed_captions === 1;
            row.smart_stop = row.smart_stop === 1;
          });
        }
        resolve(rows || []);
      });
    });
  }
  static findAllPaginated(userId = null, options = {}) {
    const { page = 1, limit = 10, filter = null, search = '' } = options;
    const offset = (page - 1) * limit;
    return new Promise((resolve, reject) => {
      let baseQuery = `
        FROM streams s
        LEFT JOIN videos v ON s.video_id = v.id
        LEFT JOIN playlists p ON s.video_id = p.id
        LEFT JOIN youtube_channels yc ON s.youtube_channel_id = yc.id
      `;
      const params = [];
      const conditions = [];
      if (userId) {
        conditions.push('s.user_id = ?');
        params.push(userId);
      }
      if (filter) {
        if (filter === 'live') {
          conditions.push("s.status = 'live'");
        } else if (filter === 'scheduled') {
          conditions.push("s.status = 'scheduled'");
        } else if (filter === 'offline') {
          conditions.push("s.status = 'offline'");
        }
      }
      if (search) {
        conditions.push('s.title LIKE ?');
        params.push(`%${search}%`);
      }
      if (conditions.length > 0) {
        baseQuery += ' WHERE ' + conditions.join(' AND ');
      }
      const countQuery = `SELECT COUNT(*) as count ${baseQuery}`;
      db.get(countQuery, params, (err, countRow) => {
        if (err) {
          console.error('Error counting streams:', err.message);
          return reject(err);
        }
        const totalCount = countRow.count;
        const totalPages = Math.ceil(totalCount / limit);
        const selectQuery = `
          SELECT s.*, 
                 v.title AS video_title, 
                 v.filepath AS video_filepath,
                 v.thumbnail_path AS video_thumbnail, 
                 v.duration AS video_duration,
                 v.resolution AS video_resolution,  
                 v.bitrate AS video_bitrate,        
                 v.fps AS video_fps,
                 p.name AS playlist_name,
                 CASE 
                   WHEN p.id IS NOT NULL THEN 'playlist'
                   WHEN v.id IS NOT NULL THEN 'video'
                   ELSE NULL
                 END AS video_type,
                 yc.channel_name AS youtube_channel_name,
                 yc.channel_thumbnail AS youtube_channel_thumbnail,
                 yc.channel_id AS youtube_channel_external_id
          ${baseQuery}
          ORDER BY 
            CASE s.status 
              WHEN 'live' THEN 1 
              WHEN 'scheduled' THEN 2 
              WHEN 'offline' THEN 3 
              ELSE 4 
            END,
            s.created_at DESC
          LIMIT ? OFFSET ?
        `;
        db.all(selectQuery, [...params, limit, offset], (err, rows) => {
          if (err) {
            console.error('Error finding streams:', err.message);
            return reject(err);
          }
          if (rows) {
            rows.forEach(row => {
              row.loop_video = row.loop_video === 1;
              row.use_advanced_settings = row.use_advanced_settings === 1;
              row.is_youtube_api = row.is_youtube_api === 1;
              row.youtube_monetization = row.youtube_monetization === 1;
              row.youtube_closed_captions = row.youtube_closed_captions === 1;
              row.smart_stop = row.smart_stop === 1;
            });
          }
          resolve({
            streams: rows || [],
            pagination: {
              page,
              limit,
              totalCount,
              totalPages
            }
          });
        });
      });
    });
  }
  static update(id, streamData) {
    const fields = [];
    const values = [];
    Object.entries(streamData).forEach(([key, value]) => {
      if (key === 'loop_video' && typeof value === 'boolean') {
        fields.push(`${key} = ?`);
        values.push(value ? 1 : 0);
      } else if (key === 'youtube_monetization' && typeof value === 'boolean') {
        fields.push(`${key} = ?`);
        values.push(value ? 1 : 0);
      } else if (key === 'youtube_closed_captions' && typeof value === 'boolean') {
        fields.push(`${key} = ?`);
        values.push(value ? 1 : 0);
      } else if (key === 'smart_stop' && typeof value === 'boolean') {
        fields.push(`${key} = ?`);
        values.push(value ? 1 : 0);
      } else {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    });
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    const query = `UPDATE streams SET ${fields.join(', ')} WHERE id = ?`;
    return new Promise((resolve, reject) => {
      db.run(query, values, function (err) {
        if (err) {
          console.error('Error updating stream:', err.message);
          return reject(err);
        }
        resolve({ id, ...streamData });
      });
    });
  }
  static delete(id, userId) {
    return new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM streams WHERE id = ? AND user_id = ?',
        [id, userId],
        function (err) {
          if (err) {
            console.error('Error deleting stream:', err.message);
            return reject(err);
          }
          resolve({ success: true, deleted: this.changes > 0 });
        }
      );
    });
  }
  static updateStatus(id, status, userId = null, options = {}) {
    const status_updated_at = new Date().toISOString();
    const { startTimeOverride = null, preserveEndTime = false } = options;
    
    return new Promise((resolve, reject) => {
      let query;
      let params;
      
      if (status === 'live') {
        const start_time = startTimeOverride || new Date().toISOString();
        query = `UPDATE streams SET 
            status = ?, 
            status_updated_at = ?, 
            start_time = ?,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`;
        params = [status, status_updated_at, start_time, id];
      } else if (status === 'offline') {
        if (preserveEndTime) {
          query = `UPDATE streams SET 
              status = ?, 
              status_updated_at = ?,
              schedule_time = NULL,
              updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`;
          params = [status, status_updated_at, id];
        } else {
          // Check if stream has repeat_mode before clearing schedule
          // This is handled async via rescheduleIfRepeating()
          query = `UPDATE streams SET 
              status = ?, 
              status_updated_at = ?,
              schedule_time = NULL,
              end_time = NULL,
              start_time = NULL,
              updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`;
          params = [status, status_updated_at, id];
        }
      } else {
        query = `UPDATE streams SET 
            status = ?, 
            status_updated_at = ?,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`;
        params = [status, status_updated_at, id];
      }
      
      if (userId) {
        query = query.replace(' WHERE id = ?', ' WHERE id = ? AND user_id = ?');
        params.push(userId);
      }
      
      db.run(query, params, function (err) {
          if (err) {
            console.error('Error updating stream status:', err.message);
            return reject(err);
          }
          resolve({
            id,
            status,
            status_updated_at,
            updated: this.changes > 0
          });
        }
      );
    });
  }
  
  static updateStartTime(id, startTime) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE streams SET start_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [startTime, id],
        function (err) {
          if (err) {
            console.error('Error updating start time:', err.message);
            return reject(err);
          }
          resolve({ id, start_time: startTime, updated: this.changes > 0 });
        }
      );
    });
  }
  
  static clearScheduleFields(id) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE streams SET 
          schedule_time = NULL, 
          end_time = NULL, 
          start_time = NULL,
          updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [id],
        function (err) {
          if (err) {
            console.error('Error clearing schedule fields:', err.message);
            return reject(err);
          }
          resolve({ id, updated: this.changes > 0 });
        }
      );
    });
  }

  /**
   * Reschedule a stream to next occurrence based on repeat_mode.
   * Called after stream goes offline. If repeat_mode is 'daily' or 'weekly',
   * shifts schedule_time (and end_time) forward and sets status back to 'scheduled'.
   * @returns {Promise<boolean>} true if rescheduled, false if no repeat
   */
  static async rescheduleIfRepeating(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM streams WHERE id = ?', [id], (err, stream) => {
        if (err) return reject(err);
        if (!stream) return resolve(false);

        const repeatMode = stream.repeat_mode || 'none';
        if (repeatMode === 'none' || !stream.schedule_time) {
          return resolve(false);
        }

        let shiftMs = 0;
        if (repeatMode === 'daily') {
          shiftMs = 24 * 60 * 60 * 1000; // +1 hari
        } else if (repeatMode === 'weekly') {
          shiftMs = 7 * 24 * 60 * 60 * 1000; // +7 hari
        } else {
          return resolve(false);
        }

        // Geser schedule_time dan end_time ke jadwal berikutnya
        const originalSchedule = new Date(stream.schedule_time);
        let newSchedule = new Date(originalSchedule.getTime() + shiftMs);

        // Pastikan jadwal baru di masa depan
        const now = new Date();
        while (newSchedule <= now) {
          newSchedule = new Date(newSchedule.getTime() + shiftMs);
        }

        let newEndTime = null;
        if (stream.end_time) {
          const originalEnd = new Date(stream.end_time);
          const duration = originalEnd.getTime() - originalSchedule.getTime();
          newEndTime = new Date(newSchedule.getTime() + duration).toISOString();
        }

        const newScheduleIso = newSchedule.toISOString();
        const status_updated_at = new Date().toISOString();

        const query = newEndTime
          ? `UPDATE streams SET status = 'scheduled', status_updated_at = ?, schedule_time = ?, end_time = ?, start_time = NULL, youtube_broadcast_id = NULL, youtube_stream_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
          : `UPDATE streams SET status = 'scheduled', status_updated_at = ?, schedule_time = ?, start_time = NULL, youtube_broadcast_id = NULL, youtube_stream_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;

        const params = newEndTime
          ? [status_updated_at, newScheduleIso, newEndTime, id]
          : [status_updated_at, newScheduleIso, id];

        db.run(query, params, function(err2) {
          if (err2) {
            console.error('[Stream] Error rescheduling stream:', err2.message);
            return reject(err2);
          }
          console.log(`[Stream] Rescheduled stream ${id} (${repeatMode}) to ${newScheduleIso}`);
          resolve(true);
        });
      });
    });
  }
  static async getStreamWithVideo(id) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT s.*, 
                v.title AS video_title, 
                v.filepath AS video_filepath, 
                v.thumbnail_path AS video_thumbnail, 
                v.duration AS video_duration,
                p.name AS playlist_name,
                CASE 
                  WHEN p.id IS NOT NULL THEN 'playlist'
                  WHEN v.id IS NOT NULL THEN 'video'
                  ELSE NULL
                END AS video_type,
                yc.channel_name AS youtube_channel_name,
                yc.channel_thumbnail AS youtube_channel_thumbnail,
                yc.channel_id AS youtube_channel_external_id,
                yc.subscriber_count AS youtube_subscriber_count
         FROM streams s
         LEFT JOIN videos v ON s.video_id = v.id
         LEFT JOIN playlists p ON s.video_id = p.id
         LEFT JOIN youtube_channels yc ON s.youtube_channel_id = yc.id
         WHERE s.id = ?`,
        [id],
        (err, row) => {
          if (err) {
            console.error('Error fetching stream with video:', err.message);
            return reject(err);
          }
          if (row) {
            row.loop_video = row.loop_video === 1;
            row.use_advanced_settings = row.use_advanced_settings === 1;
            row.is_youtube_api = row.is_youtube_api === 1;
            row.youtube_monetization = row.youtube_monetization === 1;
            row.youtube_closed_captions = row.youtube_closed_captions === 1;
            row.smart_stop = row.smart_stop === 1;
          }
          resolve(row);
        }
      );
    });
  }
  static findScheduledInRange(startTime, endTime) {
    return new Promise((resolve, reject) => {
      const endTimeStr = endTime.toISOString();
      const query = `
        SELECT s.*, 
               v.title AS video_title, 
               v.filepath AS video_filepath,
               v.thumbnail_path AS video_thumbnail, 
               v.duration AS video_duration,
               v.resolution AS video_resolution,
               v.bitrate AS video_bitrate,
               v.fps AS video_fps  
        FROM streams s
        LEFT JOIN videos v ON s.video_id = v.id
        WHERE s.status = 'scheduled'
        AND s.schedule_time IS NOT NULL
        AND s.schedule_time <= ?
      `;
      db.all(query, [endTimeStr], (err, rows) => {
        if (err) {
          console.error('Error finding scheduled streams:', err.message);
          return reject(err);
        }
        if (rows) {
          rows.forEach(row => {
            row.loop_video = row.loop_video === 1;
            row.use_advanced_settings = row.use_advanced_settings === 1;
            row.is_youtube_api = row.is_youtube_api === 1;
            row.youtube_monetization = row.youtube_monetization === 1;
            row.youtube_closed_captions = row.youtube_closed_captions === 1;
            row.smart_stop = row.smart_stop === 1;
          });
        }
        resolve(rows || []);
      });
    });
  }
  static isStreamKeyInUse(streamKey, userId, excludeId = null) {
    return new Promise((resolve, reject) => {
      let query = 'SELECT COUNT(*) as count FROM streams WHERE stream_key = ? AND user_id = ? AND stream_key != ""';
      const params = [streamKey, userId];
      
      if (excludeId) {
        query += ' AND id != ?';
        params.push(excludeId);
      }
      
      db.get(query, params, (err, row) => {
        if (err) {
          console.error('Error checking stream key:', err.message);
          return reject(err);
        }
        resolve(row.count > 0);
      });
    });
  }

  static duplicate(id, userId) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM streams WHERE id = ? AND user_id = ?', [id, userId], (err, row) => {
        if (err) return reject(err);
        if (!row) return reject(new Error('Stream not found'));
        const { v4: uuidv4 } = require('uuid');
        const newId = uuidv4();
        const now = new Date().toISOString();
        db.run(
          `INSERT INTO streams (id, title, video_id, rtmp_url, stream_key, platform, platform_icon, bitrate, resolution, fps,
            orientation, loop_video, schedule_time, end_time, duration, status, status_updated_at, use_advanced_settings,
            user_id, youtube_description, youtube_privacy, youtube_category, youtube_tags, youtube_channel_id,
            is_youtube_api, youtube_monetization, youtube_closed_captions, smart_stop, viewer_threshold, smart_stop_max, notes, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            newId,
            `${row.title} (Copy)`,
            row.video_id, row.rtmp_url, row.stream_key, row.platform, row.platform_icon,
            row.bitrate, row.resolution, row.fps, row.orientation, row.loop_video,
            row.duration, 'offline', now, row.use_advanced_settings, row.user_id,
            row.youtube_description, row.youtube_privacy, row.youtube_category, row.youtube_tags,
            row.youtube_channel_id, row.is_youtube_api, row.youtube_monetization,
            row.youtube_closed_captions, row.smart_stop, row.viewer_threshold, row.smart_stop_max, row.notes, now, now
          ],
          function(err) {
            if (err) {
              console.error('Error duplicating stream:', err.message);
              return reject(err);
            }
            resolve({ id: newId, title: `${row.title} (Copy)` });
          }
        );
      });
    });
  }

  static bulkDelete(ids, userId) {
    return new Promise((resolve, reject) => {
      if (!ids || ids.length === 0) return resolve({ deleted: 0 });
      const placeholders = ids.map(() => '?').join(',');
      db.run(
        `DELETE FROM streams WHERE id IN (${placeholders}) AND user_id = ?`,
        [...ids, userId],
        function(err) {
          if (err) {
            console.error('Error bulk deleting streams:', err.message);
            return reject(err);
          }
          resolve({ deleted: this.changes });
        }
      );
    });
  }

  static findScheduledUpcoming(userId, hours = 24) {
    return new Promise((resolve, reject) => {
      const now = new Date().toISOString();
      const future = new Date(Date.now() + hours * 3600 * 1000).toISOString();
      db.all(
        `SELECT s.*, v.title AS video_title, p.name AS playlist_name,
                yc.channel_name AS youtube_channel_name
         FROM streams s
         LEFT JOIN videos v ON s.video_id = v.id
         LEFT JOIN playlists p ON s.video_id = p.id
         LEFT JOIN youtube_channels yc ON s.youtube_channel_id = yc.id
         WHERE s.user_id = ?
           AND s.status = 'scheduled'
           AND s.schedule_time IS NOT NULL
           AND s.schedule_time >= ?
           AND s.schedule_time <= ?
         ORDER BY s.schedule_time ASC
         LIMIT 20`,
        [userId, now, future],
        (err, rows) => {
          if (err) {
            console.error('Error finding upcoming streams:', err.message);
            return reject(err);
          }
          resolve(rows || []);
        }
      );
    });
  }

  static getStreamHistory(userId, days = 30) {
    return new Promise((resolve, reject) => {
      const since = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 10);
      db.all(
        `SELECT DATE(start_time) as date, COUNT(*) as count, platform
         FROM stream_history
         WHERE user_id = ?
           AND start_time >= ?
         GROUP BY DATE(start_time), platform
         ORDER BY date ASC`,
        [userId, since],
        (err, rows) => {
          if (err) {
            console.error('Error getting stream history stats:', err.message);
            return reject(err);
          }
          resolve(rows || []);
        }
      );
    });
  }
}
module.exports = Stream;