const { EmbedBuilder } = require('discord.js');

module.exports = async (message, args, client) => {
  const db = client.db;
  const target = message.mentions.users.first() || message.author;
  const guildId = message.guild.id;
  const data = db.getXP(guildId, target.id);
  const lb = db.getLeaderboard(guildId, 100);
  const rank = lb.findIndex(u => u.userId === target.id) + 1;

  const embed = new EmbedBuilder()
    .setColor(client.config.COLORS.levelup)
    .setTitle(`⚔️ ${target.username}'s Rank`)
    .setThumbnail(target.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: '🏆 Level', value: `${data.level}`, inline: true },
      { name: '⚡ XP', value: `${data.xp} / ${db.xpForLevel(data.level)}`, inline: true },
      { name: '📊 Server Rank', value: rank ? `#${rank}` : 'Unranked', inline: true },
    )
    .setFooter({ text: 'Raider Bot • Level System' })
    .setTimestamp();

  await message.reply({ embeds: [embed] });
};
