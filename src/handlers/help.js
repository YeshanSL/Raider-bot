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
        name: '💰 Points & Shop',
        value: [
          '`/points balance [user]` — Check a points balance',
          '`/points gift <user> <amount>` — Send points to someone',
          '`/shop view` — See items and your balance',
          '`/shop buy <item> [text]` — Buy an item',
          '`/shop additem` · `/shop removeitem` — Manage items (Admin)',
        ].join('\n'),
      },
      {
        name: '📦 Weekly Wrapped',
        value: '`/wrapped` — Run the weekly recap now (Admin; auto-posts Sundays 12PM IST)',
      },
      {
        name: '⚔️ FPS Team Mode (Admin)',
        value: [
          '`/team setup <channel>` — Set the voice channel',
          '`/team assign <user> <team>` — Assign to team',
          '`/team on` — Activate team isolation',
          '`/team off` — Deactivate, merge back',
          '`/team panel <on|off>` — Self-select team button panel',
          '`/team status` — View current teams',
        ].join('\n'),
      },
      {
        name: '🔇 Soundboard Control (Admin)',
        value: [
          '`/soundboard-block <member> [channels]` — Block soundboard + external sounds (all voice channels if none picked)',
          '`/soundboard-unblock <member> [channels]` — Restore access',
          '`/soundboard-status <member>` — Check the restriction',
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
