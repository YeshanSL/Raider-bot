const { EmbedBuilder } = require('discord.js');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function formatHours(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Sums how much time each pair of users spent together in the *same* voice
// channel this week, by intersecting their session time ranges. Returns a
// map of "userA|userB" (sorted) -> overlap seconds.
function computeOverlaps(sessions) {
  const intervals = sessions.map(s => ({
    userId: s.userId,
    channelId: s.channelId,
    start: s.timestamp - s.duration * 1000,
    end: s.timestamp,
  }));

  const overlapMap = {};
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      const a = intervals[i], b = intervals[j];
      if (a.userId === b.userId || a.channelId !== b.channelId) continue;
      const overlapStart = Math.max(a.start, b.start);
      const overlapEnd = Math.min(a.end, b.end);
      const overlapSec = (overlapEnd - overlapStart) / 1000;
      if (overlapSec <= 0) continue;
      const key = [a.userId, b.userId].sort().join('|');
      overlapMap[key] = (overlapMap[key] || 0) + overlapSec;
    }
  }
  return overlapMap;
}

function topPartnerFor(userId, overlapMap) {
  let best = null, bestSec = 0;
  for (const [key, sec] of Object.entries(overlapMap)) {
    const [a, b] = key.split('|');
    if (a !== userId && b !== userId) continue;
    if (sec > bestSec) { bestSec = sec; best = a === userId ? b : a; }
  }
  return best ? { partnerId: best, seconds: bestSec } : null;
}

// Builds and posts the Wrapped embed for one guild. Returns the embed (or
// null if there was nothing to report) so callers can also show it inline
// (e.g. the manual /wrapped command replying to whoever ran it).
async function generateWrapped(client, guild) {
  const db = client.db;
  const config = client.config;
  const guildId = guild.id;
  const since = Date.now() - WEEK_MS;

  const sessions = db.getSessionsSince(guildId, since);

  if (sessions.length === 0) {
    return null;
  }

  // ─── Per-user hours + most-played game (weighted by time) ───
  const hoursByUser = {};
  const gameTimeByUser = {}; // userId -> { gameName: seconds }
  const gameTimeServer = {}; // gameName -> seconds

  for (const s of sessions) {
    hoursByUser[s.userId] = (hoursByUser[s.userId] || 0) + s.duration;
    if (s.game) {
      gameTimeByUser[s.userId] = gameTimeByUser[s.userId] || {};
      gameTimeByUser[s.userId][s.game] = (gameTimeByUser[s.userId][s.game] || 0) + s.duration;
      gameTimeServer[s.game] = (gameTimeServer[s.game] || 0) + s.duration;
    }
  }

  function topGameFor(userId) {
    const games = gameTimeByUser[userId];
    if (!games) return null;
    return Object.entries(games).sort((a, b) => b[1] - a[1])[0][0];
  }

  // ─── Levels/XP gained since last snapshot ───
  const snapshot = db.getWrappedSnapshot(guildId);
  const newSnapshot = {};
  const gains = {}; // userId -> { levelGained, xpGained }

  const activeUserIds = new Set(Object.keys(hoursByUser));
  for (const userId of activeUserIds) {
    const current = db.getXP(guildId, userId);
    const prev = snapshot[userId] || null;
    const currentTotal = db.totalXPEarned(current.level, current.xp);
    const prevTotal = prev ? db.totalXPEarned(prev.level, prev.xp) : currentTotal;
    gains[userId] = {
      levelGained: prev ? current.level - prev.level : 0,
      xpGained: Math.max(0, currentTotal - prevTotal),
    };
    newSnapshot[userId] = { level: current.level, xp: current.xp };
  }
  db.setWrappedSnapshot(guildId, newSnapshot);

  // ─── Teammate overlaps ───
  const overlapMap = computeOverlaps(sessions);

  // ─── Highlights ───
  const mostActive = Object.entries(hoursByUser).sort((a, b) => b[1] - a[1])[0];
  const winner = Object.entries(gains).sort((a, b) => b[1].xpGained - a[1].xpGained)[0];
  const bestDuoEntry = Object.entries(overlapMap).sort((a, b) => b[1] - a[1])[0];
  const topGameServer = Object.entries(gameTimeServer).sort((a, b) => b[1] - a[1])[0];

  const mention = id => `<@${id}>`;

  const embed = new EmbedBuilder()
    .setColor(config.COLORS.wrapped)
    .setTitle('📦 Raider Weekly Wrapped')
    .setDescription(`Recap for <t:${Math.floor(since / 1000)}:D> → <t:${Math.floor(Date.now() / 1000)}:D>`)
    .setTimestamp();

  if (mostActive) {
    embed.addFields({ name: '🎙️ Most Active', value: `${mention(mostActive[0])} — ${formatHours(mostActive[1])}`, inline: true });
  }
  if (winner && winner[1].xpGained > 0) {
    embed.addFields({ name: '🏆 Winner of the Week', value: `${mention(winner[0])} — +${winner[1].levelGained} levels, +${winner[1].xpGained} XP`, inline: true });
  }
  if (bestDuoEntry) {
    const [a, b] = bestDuoEntry[0].split('|');
    embed.addFields({ name: '👯 Best Duo', value: `${mention(a)} & ${mention(b)} — ${formatHours(bestDuoEntry[1])} together`, inline: true });
  }
  if (topGameServer) {
    embed.addFields({ name: '🎮 Most Played Game', value: `${topGameServer[0]} — ${formatHours(topGameServer[1])} across the squad`, inline: true });
  }

  // ─── Per-member recap lines ───
  const lines = [...activeUserIds]
    .sort((a, b) => hoursByUser[b] - hoursByUser[a])
    .slice(0, 20) // stay well under Discord's field character limit
    .map(userId => {
      const g = gains[userId];
      const partner = topPartnerFor(userId, overlapMap);
      const game = topGameFor(userId);
      const parts = [
        `${mention(userId)} — **${formatHours(hoursByUser[userId])}**`,
        `+${g.levelGained} levels`,
      ];
      if (partner) parts.push(`with ${mention(partner.partnerId)}`);
      if (game) parts.push(`playing **${game}**`);
      return `${parts.join(' • ')}`;
    });

  if (lines.length > 0) {
    embed.addFields({ name: '📋 Squad Recap', value: lines.join('\n').slice(0, 1024), inline: false });
  }

  embed.setFooter({ text: 'Raider Bot • Weekly Wrapped' });

  const channelId = config.WRAPPED_CHANNEL_ID || config.DASHBOARD_CHANNEL_ID;
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  if (channel) {
    await channel.send({ embeds: [embed] }).catch(() => {});
  }

  return embed;
}

// !raider wrapped / `/wrapped` — manually trigger the recap right now
// (handy for testing without waiting for Sunday).
module.exports = async (message, args, client) => {
  const embed = await generateWrapped(client, message.guild);
  if (!embed) {
    return message.reply("📦 No voice activity in the last 7 days — nothing to wrap yet.");
  }
  await message.reply({ embeds: [embed] });
};

module.exports.generateWrapped = generateWrapped;
