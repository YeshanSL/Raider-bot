const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = async (message, args, client) => {
  const config = client.config;
  const db = client.db;
  const guildId = message.guild.id;
  const userId = message.author.id;

  const xp = db.getXP(guildId, userId);
  const lb = db.getLeaderboard(guildId, 100);
  const rank = lb.findIndex(u => u.userId === userId) + 1;
  const teamData = db.getTeams(guildId);

  const progress = Math.min(Math.floor((xp.xp / db.xpForLevel(xp.level)) * 10), 10);
  const bar = '█'.repeat(progress) + '░'.repeat(10 - progress);

  const embed = new EmbedBuilder()
    .setColor(config.COLORS.info)
    .setTitle(`🎮 Raider Dashboard — ${message.guild.name}`)
    .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
    .addFields(
      {
        name: '📊 Your Stats',
        value: [
          `**Level:** ${xp.level}`,
          `**XP:** ${xp.xp} / ${db.xpForLevel(xp.level)}`,
          `**Progress:** \`[${bar}]\``,
          `**Rank:** ${rank ? `#${rank}` : 'Unranked'}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '⚔️ Team Mode',
        value: teamData.active ? '🟢 ACTIVE' : '🔴 INACTIVE',
        inline: true,
      },
      {
        name: '👥 Members',
        value: `${message.guild.memberCount}`,
        inline: true,
      },
      {
        name: '💎 Boosts',
        value: `${message.guild.premiumSubscriptionCount} (Level ${message.guild.premiumTier})`,
        inline: true,
      },
      {
        name: '📋 Quick Commands',
        value: [
          '`/rank [user]` — View rank',
          '`/leaderboard` — Top 10',
          '`/team status` — FPS team mode',
          '`/setchannel <type> <channel>` — Config channels (Admin)',
          '`/voicestats` — Your voice activity',
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'Raider Bot • Dashboard' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('dashboard_rank').setLabel('My Rank').setStyle(ButtonStyle.Primary).setEmoji('🏆'),
    new ButtonBuilder().setCustomId('dashboard_lb').setLabel('Leaderboard').setStyle(ButtonStyle.Secondary).setEmoji('📊'),
    new ButtonBuilder().setCustomId('dashboard_team').setLabel('Team Status').setStyle(ButtonStyle.Danger).setEmoji('⚔️'),
  );

  const reply = await message.reply({ embeds: [embed], components: [row] });

  // Collector for button interactions (60 second window)
  const collector = reply.createMessageComponentCollector({ time: 60000 });
  collector.on('collect', async i => {
    if (i.user.id !== userId) return i.reply({ content: 'This dashboard is not yours!', ephemeral: true });

    if (i.customId === 'dashboard_rank') {
      await i.deferUpdate();
      const rankHandler = require('./rank');
      await rankHandler(message, [], client);
    } else if (i.customId === 'dashboard_lb') {
      await i.deferUpdate();
      const lbHandler = require('./leaderboard');
      await lbHandler(message, [], client);
    } else if (i.customId === 'dashboard_team') {
      await i.deferUpdate();
      const teamHandler = require('./team');
      await teamHandler(message, ['status'], client);
    }
  });

  collector.on('end', () => {
    reply.edit({ components: [] }).catch(() => {});
  });
};
