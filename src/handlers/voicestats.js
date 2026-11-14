const { EmbedBuilder } = require('discord.js');

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Live view of the member's current voice sitting: how long, the current rate,
// and when the rate doubles next.
function currentSitting(client, guildId, userId) {
  const session = client.db.getActiveSession(guildId, userId);
  if (!session) return 'Not in voice right now';
  const config = client.config;
  const seconds = Math.floor((Date.now() - session.sittingStart) / 1000);
  const minutes = seconds / 60;
  const multiplier = client.db.getSittingMultiplier(minutes);
  // Rate doubles at FIRST_DOUBLE_MIN, then at 2×, 4×, 8× … that
  const nextAt = config.VOICE_SITTING_FIRST_DOUBLE_MIN * multiplier;
  const secondsToNext = Math.max(0, Math.ceil(nextAt * 60 - seconds));
  return `${formatTime(seconds)} straight · **${config.XP_PER_VOICE_MIN * multiplier} XP/min** (${multiplier}x) · ` +
    `doubles to ${config.XP_PER_VOICE_MIN * multiplier * 2} XP/min in ${formatTime(secondsToNext)}`;
}

module.exports = async (message, args, client) => {
  const target = message.mentions.users.first() || message.author;
  const guildId = message.guild.id;

  const userSessions = client.db.getSessions(guildId).filter(s => s.userId === target.id);
  const totalSeconds = userSessions.reduce((sum, s) => sum + s.duration, 0);
  const sessionCount = userSessions.length;
  const avgSeconds = sessionCount > 0 ? Math.floor(totalSeconds / sessionCount) : 0;
  const lastSession = userSessions[userSessions.length - 1];

  const embed = new EmbedBuilder()
    .setColor(client.config.COLORS.voice)
    .setTitle(`🎙️ Voice Stats — ${target.username}`)
    .setThumbnail(target.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: '⏱️ Total Time', value: formatTime(totalSeconds), inline: true },
      { name: '📋 Sessions', value: `${sessionCount}`, inline: true },
      { name: '📊 Avg Session', value: formatTime(avgSeconds), inline: true },
      { name: '🕐 Last Session', value: lastSession ? `${formatTime(lastSession.duration)} on <t:${Math.floor(lastSession.timestamp / 1000)}:D>` : 'No sessions yet', inline: false },
      { name: '🔥 Current Sitting', value: currentSitting(client, guildId, target.id), inline: false },
    )
    .setFooter({ text: 'Raider Bot • Voice Tracker' })
    .setTimestamp();

  await message.reply({ embeds: [embed] });
};
