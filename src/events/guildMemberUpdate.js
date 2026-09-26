const { Events, EmbedBuilder } = require('discord.js');

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember, client) {
    const config = client.config;
    // Detect new boost
    const wasBooster = oldMember.premiumSince;
    const isBooster = newMember.premiumSince;
    if (!wasBooster && isBooster) {
      const channelId = config.BOOST_CHANNEL_ID || config.WELCOME_CHANNEL_ID;
      if (!channelId) return;
      const channel = newMember.guild.channels.cache.get(channelId);
      if (!channel) return;

      const embed = new EmbedBuilder()
        .setColor(config.COLORS.boost)
        .setTitle('💎 Server Boosted!')
        .setDescription(
          `${newMember} just boosted **${newMember.guild.name}**! 🚀\n\n` +
          `Thanks to your support, the squad gets stronger! You're an absolute legend 💜`
        )
        .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
          { name: '🎁 Boost Perks', value: 'Your special role and perks have been granted!', inline: false },
          { name: '🏅 Total Boosts', value: `${newMember.guild.premiumSubscriptionCount}`, inline: true },
          { name: '⭐ Boost Level', value: `Level ${newMember.guild.premiumTier}`, inline: true },
        )
        .setFooter({ text: 'Raider Bot • Thank you Booster! 💜' })
        .setTimestamp();

      await channel.send({ content: `${newMember}`, embeds: [embed] });

      // Give boost role if set
      if (config.BOOST_ROLE_ID) {
        const role = newMember.guild.roles.cache.get(config.BOOST_ROLE_ID);
        if (role) await newMember.roles.add(role).catch(() => {});
      }
    }
  },
};
