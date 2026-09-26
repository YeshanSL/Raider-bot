const cron = require('node-cron');
const { generateWrapped } = require('./handlers/wrapped');

// Every Sunday at 12:00 (noon) India Standard Time (UTC+5:30).
// node-cron's `timezone` option uses the IANA database, so this stays
// correct at noon IST regardless of what timezone the server itself runs in
// (e.g. Render's servers run UTC).
const WRAPPED_CRON = '0 12 * * 0';

function startScheduler(client) {
  cron.schedule(WRAPPED_CRON, async () => {
    for (const guild of client.guilds.cache.values()) {
      try {
        await generateWrapped(client, guild);
      } catch (err) {
        console.error(`Weekly Wrapped failed for guild ${guild.id}:`, err);
      }
    }
  }, { timezone: 'Asia/Kolkata' });

  console.log('🗓️  Weekly Wrapped scheduled for Sundays, 12:00 PM IST.');
}

module.exports = { startScheduler };
