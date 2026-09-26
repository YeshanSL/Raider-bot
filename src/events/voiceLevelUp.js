const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'voiceLevelUp',
  async execute(guildId, userId, level, client) {
    const config = client.config;
    const db = client.db;
    const channelId = config.LEVEL_UP_CHANNEL_ID || config.VOICE_LOG_CHANNEL_ID;
    if (!channelId) return;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const channel = guild.channels.cache.get(channelId);
    if (!channel) return;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    const xpData = db.getXP(guildId, userId);

    const embed = new EmbedBuilder()
      .setColor(config.COLORS.levelup)
      .setTitle('🎙️ Voice Level Up!')
      .setDescription(`${member} leveled up from voice activity! 🔥`)
      .addFields(
        { name: '🏆 New Level', value: `**Level ${level}**`, inline: true },
        { name: '⚡ XP Progress', value: `${xpData.xp} / ${db.xpForLevel(level)} XP`, inline: true },
      )
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: 'Keep grinding in voice!' })
      .setTimestamp();

    await channel.send({ embeds: [embed] }).catch(() => {});
  },
};
