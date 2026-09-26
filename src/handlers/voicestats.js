const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

module.exports = async (message, args, client) => {
  const target = message.mentions.users.first() || message.author;
  const guildId = message.guild.id;

  const SESSIONS_FILE = path.join(__dirname, '../../data/sessions.json');
  let sessions = {};
  if (fs.existsSync(SESSIONS_FILE)) {
    try { sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); } catch {}
  }

  const userSessions = (sessions[guildId] || []).filter(s => s.userId === target.id);
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
    )
    .setFooter({ text: 'Raider Bot • Voice Tracker' })
    .setTimestamp();

  await message.reply({ embeds: [embed] });
};
