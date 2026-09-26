const { Events, EmbedBuilder } = require('discord.js');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member, client) {
    const config = client.config;
    const channelId = config.WELCOME_CHANNEL_ID;
    if (!channelId) return;

    const channel = member.guild.channels.cache.get(channelId);
    if (!channel) return;

    const memberCount = member.guild.memberCount;

    const embed = new EmbedBuilder()
      .setColor(config.COLORS.welcome)
      .setTitle('🎉 A New Raider Has Dropped In!')
      .setDescription(
        `Welcome to **${member.guild.name}**, ${member}!\n\n` +
        `You are member **#${memberCount}** — gear up, the squad's waiting for you! 🔥`
      )
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields(
        { name: '📌 Get Started', value: 'Check the channels, introduce yourself, and start leveling up!', inline: false },
        { name: '🎮 Game On', value: 'Join a voice channel and play with the squad.', inline: false },
      )
      .setFooter({ text: `Raider Bot • ${member.guild.name}` })
      .setTimestamp();

    await channel.send({ content: `${member}`, embeds: [embed] });
  },
};
