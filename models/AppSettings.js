const { db } = require('../db/database');

class AppSettings {
  static get(key) {
    return new Promise((resolve, reject) => {
      db.get('SELECT setting_value FROM app_settings WHERE setting_key = ?', [key], (err, row) => {
        if (err) {
          console.error('Database error in AppSettings.get:', err);
          return reject(err);
        }
        resolve(row ? row.setting_value : null);
      });
    });
  }

  static set(key, value) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO app_settings (setting_key, setting_value, updated_at) 
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = ?, updated_at = CURRENT_TIMESTAMP`,
        [key, value, value],
        function(err) {
          if (err) {
            console.error('Database error in AppSettings.set:', err);
            return reject(err);
          }
          resolve({ key, value });
        }
      );
    });
  }

  static delete(key) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM app_settings WHERE setting_key = ?', [key], function(err) {
        if (err) {
          console.error('Database error in AppSettings.delete:', err);
          return reject(err);
        }
        resolve({ deleted: this.changes > 0 });
      });
    });
  }

  static async getRecaptchaSettings() {
    const siteKey = await this.get('recaptcha_site_key');
    const secretKey = await this.get('recaptcha_secret_key');
    const enabled = await this.get('recaptcha_enabled');
    
    return {
      siteKey: siteKey || '',
      secretKey: secretKey || '',
      enabled: enabled === '1',
      hasKeys: !!(siteKey && secretKey)
    };
  }

  static async setRecaptchaSettings(siteKey, secretKey, enabled) {
    await this.set('recaptcha_site_key', siteKey);
    await this.set('recaptcha_secret_key', secretKey);
    await this.set('recaptcha_enabled', enabled ? '1' : '0');
  }

  static async deleteRecaptchaSettings() {
    await this.delete('recaptcha_site_key');
    await this.delete('recaptcha_secret_key');
    await this.delete('recaptcha_enabled');
  }
  static async getTelegramSettings() {
    const token = await this.get('telegram_bot_token');
    const chatId = await this.get('telegram_chat_id');
    const enabled = await this.get('telegram_enabled');
    const notifyStart = await this.get('telegram_notify_start');
    const notifyStop = await this.get('telegram_notify_stop');
    const notifyError = await this.get('telegram_notify_error');
    
    return {
      token: token || '',
      chatId: chatId || '',
      enabled: enabled === '1',
      notifyStart: notifyStart !== '0', // Default true if not set
      notifyStop: notifyStop !== '0',
      notifyError: notifyError !== '0'
    };
  }

  static async setTelegramSettings(token, chatId, enabled, notifyStart, notifyStop, notifyError) {
    await this.set('telegram_bot_token', token);
    await this.set('telegram_chat_id', chatId);
    await this.set('telegram_enabled', enabled ? '1' : '0');
    await this.set('telegram_notify_start', notifyStart ? '1' : '0');
    await this.set('telegram_notify_stop', notifyStop ? '1' : '0');
    await this.set('telegram_notify_error', notifyError ? '1' : '0');
  }

  static async getAISettings() {
    const geminiKey = await this.get('ai_gemini_key');
    const openaiKey = await this.get('ai_openai_key');
    const groqKey   = await this.get('ai_groq_key');
    const defaultProvider = await this.get('ai_default_provider');
    return {
      geminiKey: geminiKey || '',
      openaiKey: openaiKey || '',
      groqKey:   groqKey   || '',
      defaultProvider: defaultProvider || 'gemini',
      hasGemini: !!geminiKey,
      hasOpenAI: !!openaiKey,
      hasGroq:   !!groqKey
    };
  }

  static async setAISettings(geminiKey, openaiKey, defaultProvider, groqKey) {
    await this.set('ai_gemini_key',      geminiKey || '');
    await this.set('ai_openai_key',      openaiKey || '');
    await this.set('ai_groq_key',        groqKey   || '');
    await this.set('ai_default_provider', defaultProvider || 'gemini');
  }
}

module.exports = AppSettings;
