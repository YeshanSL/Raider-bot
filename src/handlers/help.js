const { EmbedBuilder } = require('discord.js');

module.exports = async (message, args, client) => {
  const embed = new EmbedBuilder()
    .setColor(client.config.COLORS.info)
    .setTitle('⚔️ Raider Bot — Command List')
    .setDescription('Type `/` in any channel to see these commands pop up, or use the classic `!raider` prefix.')
    .addFields(
      {
        name: '📊 Levels & XP',
        value: [
          '`/rank [user]` — View your or someone\'s rank',
          '`/leaderboard` — Top 10 members',
          '`/voicestats [user]` — Voice activity stats',
        ].join('\n'),
      },
      {
        name: '🎮 Dashboard',
        value: '`/dashboard` — Your personal stats dashboard',
      },
      {
        name: '⚔️ FPS Team Mode (Admin)',
        value: [
          '`/team setup <channel>` — Set the voice channel',
          '`/team assign <user> <team>` — Assign to team',
          '`/team on` — Activate team isolation',
          '`/team off` — Deactivate, merge back',
          '`/team status` — View current teams',
        ].join('\n'),
      },
      {
        name: '⚙️ Config (Admin)',
        value: '`/setchannel <type> <channel>` — Set welcome, boost, levelup, voice or dashboard channel',
      },
    )
    .setFooter({ text: 'Raider Bot • Ready to Battle 🔥' })
    .setTimestamp();

  await message.reply({ embeds: [embed] });
};
