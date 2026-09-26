const { EmbedBuilder } = require('discord.js');

module.exports = async (message, args, client) => {
  const db = client.db;
  const lb = db.getLeaderboard(message.guild.id, 10);

  const medals = ['🥇', '🥈', '🥉'];
  const lines = await Promise.all(lb.map(async (entry, i) => {
    const member = await message.guild.members.fetch(entry.userId).catch(() => null);
    const name = member?.displayName || `Unknown (${entry.userId})`;
    const medal = medals[i] || `**${i + 1}.**`;
    return `${medal} **${name}** — Level ${entry.level} (${entry.xp} XP)`;
  }));

  const embed = new EmbedBuilder()
    .setColor(client.config.COLORS.levelup)
    .setTitle('🏆 Raider Leaderboard')
    .setDescription(lines.join('\n') || 'No data yet.')
    .setFooter({ text: 'Raider Bot • Top Raiders' })
    .setTimestamp();

  await message.reply({ embeds: [embed] });
};
