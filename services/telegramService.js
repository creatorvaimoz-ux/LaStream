const axios = require('axios');
const AppSettings = require('../models/AppSettings');

class TelegramService {
  static async sendMessage(message, isError = false) {
    try {
      const settings = await AppSettings.getTelegramSettings();
      if (!settings.enabled || !settings.token || !settings.chatId) {
        return { success: false, error: 'Telegram is not configured or disabled' };
      }

      if (isError && !settings.notifyError) {
        return { success: false, error: 'Error notifications are disabled' };
      }

      const url = `https://api.telegram.org/bot${settings.token}/sendMessage`;
      const response = await axios.post(url, {
        chat_id: settings.chatId,
        text: message,
        parse_mode: 'HTML'
      });

      return { success: true, data: response.data };
    } catch (error) {
      console.error('Telegram notification error:', error.message);
      return { success: false, error: error.message };
    }
  }

  static async sendWatchdogAlert(streamTitle, errorDetail, retryCount, isMaxRetry) {
    let emoji = isMaxRetry ? '🚨' : '⚠️';
    let statusMsg = isMaxRetry 
      ? `<b>STREAM FAILED (MAX RETRIES REACHED)</b>` 
      : `<b>STREAM RESTARTING (Attempt ${retryCount})</b>`;

    const message = `${emoji} <b>LaStream Watchdog</b> ${emoji}\n\n` +
      `${statusMsg}\n` +
      `<b>Stream:</b> ${streamTitle || 'Unknown'}\n` +
      `<b>Error:</b> ${errorDetail}\n\n` +
      `<i>System is trying to recover...</i>`;

    return await this.sendMessage(message, true);
  }

  static async sendStreamStart(streamTitle, platform) {
    try {
      const settings = await AppSettings.getTelegramSettings();
      if (!settings.enabled || !settings.notifyStart) return { success: false };
      const message = `▶️ <b>STREAM DIMULAI</b>\n\n<b>Judul:</b> ${streamTitle || 'Untitled'}\n<b>Platform:</b> ${platform || 'Custom'}`;
      return await this.sendMessage(message, false);
    } catch (e) { return { success: false }; }
  }

  static async sendStreamStop(streamTitle, platform) {
    try {
      const settings = await AppSettings.getTelegramSettings();
      if (!settings.enabled || !settings.notifyStop) return { success: false };
      const message = `⏹️ <b>STREAM BERHENTI</b>\n\n<b>Judul:</b> ${streamTitle || 'Untitled'}\n<b>Platform:</b> ${platform || 'Custom'}`;
      return await this.sendMessage(message, false);
    } catch (e) { return { success: false }; }
  }

  static async sendStreamError(streamTitle, platform, errorMsg) {
    try {
      const message = `❌ <b>STREAM ERROR</b>\n\n<b>Judul:</b> ${streamTitle || 'Untitled'}\n<b>Platform:</b> ${platform || 'Custom'}\n<b>Detail:</b> ${errorMsg}`;
      return await this.sendMessage(message, true);
    } catch (e) { return { success: false }; }
  }
}

module.exports = TelegramService;
