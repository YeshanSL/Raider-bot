const cron = require('node-cron');
const { generateWrapped } = require('./handlers/wrapped');

// Every Sunday at 12:00 (noon) India Standard Time (UTC+5:30).
// node-cron's `timezone` option uses the IANA database, so this stays
// correct at noon IST regardless of what timezone the server itself runs in
// (e.g. Render's servers run UTC).
const WRAPPED_CRON = '0 12 * * 0';

// Checks for expired shop-bought nickname flairs every 5 minutes and strips
// them back off. (XP boosts don't need this — they just stop applying once
// their timestamp passes, checked directly inside addXP.)
const FLAIR_CHECK_CRON = '*/5 * * * *';

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

  cron.schedule(FLAIR_CHECK_CRON, async () => {
    const db = client.db;
    for (const { guildId, userId, flair } of db.getExpiredFlairs()) {
      try {
        const guild = client.guilds.cache.get(guildId);
        const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
        if (member?.nickname?.startsWith(`${flair} `)) {
          const restored = member.nickname.slice(flair.length + 1);
          await member.setNickname(restored || null).catch(() => {});
        }
        db.clearFlair(guildId, userId);
      } catch (err) {
        console.error(`Failed to revert expired flair for ${userId} in ${guildId}:`, err);
      }
    }
  });

  console.log('🗓️  Weekly Wrapped scheduled for Sundays, 12:00 PM IST.');
  console.log('🏷️  Nickname flair expiry check running every 5 minutes.');
}

module.exports = { startScheduler };
