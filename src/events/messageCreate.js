const { Events, EmbedBuilder } = require('discord.js');
const db = require('../database');
const team = require('../handlers/team');

module.exports = {
  name: Events.MessageCreate,
  async execute(message, client) {
    if (!message.guild) return;

    // ─── Keep the team panel pinned as the newest message in its channel ───
    // Runs before the bot-author check below so it still reacts to other
    // people's/bots' messages, but skips its own repost (avoids a loop).
    if (message.author.id !== client.user.id) {
      await team.bumpPanel(message, client).catch(err => console.error('Team panel bump error:', err));
    }

    if (message.author.bot) return;

    const config = client.config;
    const guildId = message.guild.id;
    const userId = message.author.id;

    // ─── Chat XP ───
    const userData = db.getXP(guildId, userId);
    const now = Date.now();
    if (now - (userData.lastMsg || 0) >= config.XP_COOLDOWN_MS) {
      userData.lastMsg = now;
      db.setXP(guildId, userId, userData);
      const result = db.addXP(guildId, userId, config.XP_PER_MSG);

      if (result.leveledUp) {
        const channelId = config.LEVEL_UP_CHANNEL_ID || message.channel.id;
        const ch = message.guild.channels.cache.get(channelId) || message.channel;

        const embed = new EmbedBuilder()
          .setColor(config.COLORS.levelup)
          .setTitle('📈 Chat Level Up!')
          .setDescription(`${message.author} leveled up in chat! 🎉`)
          .addFields(
            { name: '🏆 New Level', value: `**Level ${result.level}**`, inline: true },
            { name: '⚡ XP', value: `${result.xp} / ${db.xpForLevel(result.level)} XP`, inline: true },
          )
          .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: 'Keep chatting to rank up!' })
          .setTimestamp();

        await ch.send({ embeds: [embed] });
      }
    }

    // ─── Command handling (!raider prefix) ───
    const prefix = '!raider';
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Import command handlers
    const getHandler = require('../handlers/index');
    const handler = getHandler(command);
    if (handler) {
      await handler(message, args, client).catch(err => {
        console.error(`Command error [${command}]:`, err);
        message.reply('⚠️ Something went wrong with that command.').catch(() => {});
      });
    }
  },
};
