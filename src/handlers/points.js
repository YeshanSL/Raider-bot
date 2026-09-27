const { EmbedBuilder } = require('discord.js');

module.exports = async (message, args, client) => {
  const db = client.db;
  const guildId = message.guild.id;
  const sub = args[0]?.toLowerCase();

  // ─── /points gift <user> <amount> ───
  if (sub === 'gift') {
    const target = message.mentions.users.first();
    const amount = parseInt(args[2], 10);

    if (!target) return message.reply('Usage: `/points gift <user> <amount>`');
    if (target.id === message.author.id) return message.reply("❌ You can't gift points to yourself.");
    if (target.bot) return message.reply("❌ Can't gift points to a bot.");
    if (!Number.isFinite(amount) || amount <= 0) return message.reply('❌ Enter a positive amount to gift.');

    const result = db.spendPoints(guildId, message.author.id, amount);
    if (!result.success) {
      return message.reply(`❌ You only have **${result.balance}** points — can't gift **${amount}**.`);
    }

    db.addPoints(guildId, target.id, amount);
    return message.reply(`🎁 Gifted **${amount}** points to <@${target.id}>. Your balance: **${result.balance}**.`);
  }

  // ─── /points balance (default) ───
  const target = message.mentions.users.first() || message.author;
  const balance = db.getPoints(guildId, target.id);

  const embed = new EmbedBuilder()
    .setColor(client.config.COLORS.shop)
    .setTitle(`💰 ${target.username}'s Points`)
    .setThumbnail(target.displayAvatarURL({ dynamic: true }))
    .setDescription(`**${balance}** points — spend them with \`/shop buy <name>\`, see what's available with \`/shop view\`, or send some with \`/points gift\`.`)
    .setFooter({ text: 'Raider Bot • Points Shop' })
    .setTimestamp();

  await message.reply({ embeds: [embed] });
};
