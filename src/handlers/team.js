const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');

async function teamCommandHandler(message, args, client) {
  const config = client.config;
  const db = client.db;

  const sub = args[0]?.toLowerCase();

  // ─── Permission check ───
  const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    (config.ADMIN_ROLE_ID && message.member.roles.cache.has(config.ADMIN_ROLE_ID));

  if (!isAdmin) {
    return message.reply('❌ Only admins can control team mode.');
  }

  const teamData = db.getTeams(message.guild.id);

  // !raider team setup <vc_channel_id> — initialise teams
  if (sub === 'setup') {
    const channelId = args[1];
    if (!channelId) return message.reply('Usage: `!raider team setup <voice-channel-id>`');
    const vc = message.guild.channels.cache.get(channelId);
    if (!vc || vc.type !== 2) return message.reply('❌ That is not a valid voice channel.');

    teamData.channelId = channelId;
    teamData.active = false;
    teamData.teams = { team1: [], team2: [] };
    db.setTeams(message.guild.id, teamData);

    return message.reply(`✅ Team mode configured for **${vc.name}**. Use \`!raider team assign @user 1|2\` then \`!raider team on\`.`);
  }

  // !raider team assign @user 1|2
  if (sub === 'assign') {
    const target = message.mentions.members.first();
    const teamNum = args[2];
    if (!target || !['1', '2'].includes(teamNum)) {
      return message.reply('Usage: `!raider team assign @user 1|2`');
    }
    const key = `team${teamNum}`;
    const other = teamNum === '1' ? 'team2' : 'team1';
    // Remove from other team
    teamData.teams[other] = (teamData.teams[other] || []).filter(id => id !== target.id);
    // Add to this team
    if (!teamData.teams[key]) teamData.teams[key] = [];
    if (!teamData.teams[key].includes(target.id)) teamData.teams[key].push(target.id);
    db.setTeams(message.guild.id, teamData);
    return message.reply(`✅ ${target.displayName} assigned to **Team ${teamNum}**.`);
  }

  // !raider team on — activate team isolation
  if (sub === 'on') {
    if (!teamData.channelId) return message.reply('❌ Run `!raider team setup` first.');
    teamData.active = true;
    db.setTeams(message.guild.id, teamData);

    const vc = message.guild.channels.cache.get(teamData.channelId);
    // Apply permission overwrites: Team 1 can't hear Team 2 and vice versa
    // We use Discord's permission deafen approach:
    // Each team gets their own "can speak" / "deafen others" overwrite on the channel
    // Since Discord doesn't natively let you isolate within one VC,
    // we move each team to a temp category with 2 sub-channels instead.
    await applyTeamSeparation(message.guild, teamData, client, true);

    const embed = new EmbedBuilder()
      .setColor(config.COLORS.team)
      .setTitle('⚔️ Team Mode ACTIVATED')
      .setDescription('Teams are now separated! Each team can only hear themselves.')
      .addFields(
        { name: '🔴 Team 1', value: teamData.teams.team1.length ? teamData.teams.team1.map(id => `<@${id}>`).join(', ') : 'No members', inline: true },
        { name: '🔵 Team 2', value: teamData.teams.team2.length ? teamData.teams.team2.map(id => `<@${id}>`).join(', ') : 'No members', inline: true },
      )
      .setFooter({ text: 'Raider Bot • FPS Team Mode' })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // !raider team off — deactivate
  if (sub === 'off') {
    teamData.active = false;
    db.setTeams(message.guild.id, teamData);
    await applyTeamSeparation(message.guild, teamData, client, false);

    return message.reply('✅ Team mode **deactivated**. Everyone can hear each other again.');
  }

  // !raider team panel on|off — self-select button panel
  if (sub === 'panel') {
    const action = args[1]?.toLowerCase();

    if (action === 'on') {
      if (!teamData.channelId) {
        return message.reply('❌ Run `/team setup <voice-channel>` first so I know where to return players when the panel is off.');
      }
      const panelChannelId = config.DASHBOARD_CHANNEL_ID || message.channel.id;

      // Fresh start: clear old assignments, (re)create the two team VCs.
      teamData.teams = { team1: [], team2: [] };
      teamData.active = true;
      teamData.panelOn = true;
      teamData.panelChannelId = panelChannelId;
      db.setTeams(message.guild.id, teamData);

      try {
        await applyTeamSeparation(message.guild, teamData, client, true);
        await repostPanel(message.guild, db.getTeams(message.guild.id), client);
      } catch (err) {
        console.error('Failed to set up team panel:', err);
        // Roll back so it isn't stuck "half on".
        teamData.active = false;
        teamData.panelOn = false;
        teamData.panelChannelId = null;
        db.setTeams(message.guild.id, teamData);
        return message.reply(
          `❌ Couldn't set up the team panel: **${err.message}**\n` +
          "Check: my **role** (Server Settings → Roles, not a single channel) needs **Manage Channels**, **Manage Roles/Permissions**, and **Move Members** all turned ON, " +
          "and my role needs to be dragged **above** every player's role in that same Roles list."
        );
      }

      return message.reply(`✅ Team panel is live in <#${panelChannelId}>. Players can now pick their own team with the buttons.`);
    }

    if (action === 'off') {
      if (!teamData.panelOn) return message.reply('❌ The team panel is not currently on.');

      const panelChannel = message.guild.channels.cache.get(teamData.panelChannelId);
      if (panelChannel && teamData.panelMessageId) {
        const oldMsg = await panelChannel.messages.fetch(teamData.panelMessageId).catch(() => null);
        if (oldMsg) await oldMsg.delete().catch(() => {});
      }

      teamData.panelOn = false;
      teamData.panelMessageId = null;
      teamData.panelChannelId = null;
      teamData.active = false;
      db.setTeams(message.guild.id, teamData);

      await applyTeamSeparation(message.guild, teamData, client, false);

      return message.reply('✅ Team panel turned **off** — everyone moved back and the team channels were cleaned up.');
    }

    return message.reply('Usage: `/team panel on` or `/team panel off`');
  }

  // !raider team status
  if (sub === 'status') {
    const embed = new EmbedBuilder()
      .setColor(config.COLORS.team)
      .setTitle('⚔️ Team Mode Status')
      .addFields(
        { name: 'Status', value: teamData.active ? '🟢 ACTIVE' : '🔴 INACTIVE', inline: true },
        { name: '🔴 Team 1', value: teamData.teams.team1?.length ? teamData.teams.team1.map(id => `<@${id}>`).join(', ') : 'Empty', inline: false },
        { name: '🔵 Team 2', value: teamData.teams.team2?.length ? teamData.teams.team2.map(id => `<@${id}>`).join(', ') : 'Empty', inline: false },
      )
      .setFooter({ text: 'Raider Bot • FPS Team Mode' });
    return message.reply({ embeds: [embed] });
  }

  // Default help
  const helpEmbed = new EmbedBuilder()
    .setColor(config.COLORS.team)
    .setTitle('⚔️ Team Mode Commands')
    .setDescription('Separate FPS teams in the same voice channel!')
    .addFields(
      { name: '`/team setup <channel>`', value: 'Link a voice channel for team mode', inline: false },
      { name: '`/team assign <user> <team>`', value: 'Manually assign a player to Team 1 or Team 2', inline: false },
      { name: '`/team on`', value: 'Activate team isolation using manual assignments', inline: false },
      { name: '`/team off`', value: 'Deactivate — everyone hears each other again', inline: false },
      { name: '`/team panel on`', value: 'Post a Team 1 / Team 2 / All button panel so players pick their own team', inline: false },
      { name: '`/team panel off`', value: 'Take the panel down and reset everyone', inline: false },
      { name: '`/team status`', value: 'View current team assignments', inline: false },
    )
    .setFooter({ text: 'Admin only • Raider Bot' });

  await message.reply({ embeds: [helpEmbed] });
}

// ─── Self-select panel: embed + buttons ───
function buildPanelPayload(config, teamData) {
  const embed = new EmbedBuilder()
    .setColor(config.COLORS.team)
    .setTitle('⚔️ Pick Your Team')
    .setDescription('Tap **Team 1** or **Team 2** to join a squad — you\'ll only hear your teammates in voice.\nTap **All** to reset — this brings **everyone** back together, not just you.')
    .addFields(
      { name: '🔴 Team 1', value: teamData.teams.team1?.length ? teamData.teams.team1.map(id => `<@${id}>`).join(', ') : 'No one yet', inline: true },
      { name: '🔵 Team 2', value: teamData.teams.team2?.length ? teamData.teams.team2.map(id => `<@${id}>`).join(', ') : 'No one yet', inline: true },
    )
    .setFooter({ text: 'Raider Bot • Self-Select Team Mode' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('team_panel_1').setLabel('Team 1').setStyle(ButtonStyle.Danger).setEmoji('🔴'),
    new ButtonBuilder().setCustomId('team_panel_2').setLabel('Team 2').setStyle(ButtonStyle.Primary).setEmoji('🔵'),
    new ButtonBuilder().setCustomId('team_panel_all').setLabel('Reset All').setStyle(ButtonStyle.Secondary).setEmoji('🔓'),
  );

  return { embed, row };
}

// Deletes the old panel message (if any) and posts a fresh one, storing its id.
// Used both for the initial `/team panel on` and for keeping the panel pinned
// as the newest message in its channel.
async function repostPanel(guild, teamData, client) {
  const channel = teamData.panelChannelId ? guild.channels.cache.get(teamData.panelChannelId) : null;
  if (!channel) return;

  if (teamData.panelMessageId) {
    const old = await channel.messages.fetch(teamData.panelMessageId).catch(() => null);
    if (old) await old.delete().catch(() => {});
  }

  const { embed, row } = buildPanelPayload(client.config, teamData);
  const sent = await channel.send({ embeds: [embed], components: [row] }).catch(() => null);
  if (sent) {
    teamData.panelMessageId = sent.id;
    client.db.setTeams(guild.id, teamData);
  }
}

// Edits the panel message in place (no move to bottom) — used after a button
// click just to refresh the Team 1 / Team 2 member lists shown in the embed.
async function refreshPanelEmbed(guild, teamData, client) {
  if (!teamData.panelOn || !teamData.panelChannelId || !teamData.panelMessageId) return;
  const channel = guild.channels.cache.get(teamData.panelChannelId);
  if (!channel) return;
  const msg = await channel.messages.fetch(teamData.panelMessageId).catch(() => null);
  if (!msg) return;
  const { embed, row } = buildPanelPayload(client.config, teamData);
  await msg.edit({ embeds: [embed], components: [row] }).catch(() => {});
}

// Called from messageCreate for every non-bot-authored message. If the team
// panel is on and someone posts in its channel, the panel gets bumped back
// to the bottom so it's always the latest message.
async function bumpPanel(message, client) {
  const db = client.db;
  const teamData = db.getTeams(message.guild.id);
  if (!teamData.panelOn) return;
  if (message.channel.id !== teamData.panelChannelId) return;
  if (message.id === teamData.panelMessageId) return;
  await repostPanel(message.guild, teamData, client);
}

// Grants a member Connect/View/Speak on their new team's VC and strips any
// overwrite they had on the other team's VC.
async function assignMemberTeamPermissions(guild, teamData, userId, key) {
  const t1vc = teamData.t1vcId ? guild.channels.cache.get(teamData.t1vcId) : null;
  const t2vc = teamData.t2vcId ? guild.channels.cache.get(teamData.t2vcId) : null;

  if (key === 'team1') {
    if (t1vc) await t1vc.permissionOverwrites.edit(userId, {
      Connect: true, ViewChannel: true, Speak: true,
    }).catch(() => {});
    if (t2vc) await t2vc.permissionOverwrites.delete(userId).catch(() => {});
  } else {
    if (t2vc) await t2vc.permissionOverwrites.edit(userId, {
      Connect: true, ViewChannel: true, Speak: true,
    }).catch(() => {});
    if (t1vc) await t1vc.permissionOverwrites.delete(userId).catch(() => {});
  }
}

// Strips a member's overwrite from both team VCs (used by the "All" button).
async function clearMemberTeamPermissions(guild, teamData, userId) {
  const t1vc = teamData.t1vcId ? guild.channels.cache.get(teamData.t1vcId) : null;
  const t2vc = teamData.t2vcId ? guild.channels.cache.get(teamData.t2vcId) : null;
  if (t1vc) await t1vc.permissionOverwrites.delete(userId).catch(() => {});
  if (t2vc) await t2vc.permissionOverwrites.delete(userId).catch(() => {});
}

// Handles clicks on the panel's Team 1 / Team 2 / All buttons. Anyone can
// click — no admin check here, this is the self-service path.
async function handlePanelButton(interaction, client) {
  const guild = interaction.guild;
  if (!guild) return interaction.reply({ content: '❌ This only works in a server.', ephemeral: true });

  const db = client.db;
  const teamData = db.getTeams(guild.id);

  if (!teamData.panelOn) {
    return interaction.reply({ content: '❌ The team panel is currently off.', ephemeral: true });
  }

  const member = interaction.member;
  const userId = member.id;
  const choice = interaction.customId; // team_panel_1 | team_panel_2 | team_panel_all

  await interaction.deferReply({ ephemeral: true });

  if (choice === 'team_panel_all') {
    // Global reset: EVERYONE currently on a team gets pulled back together,
    // not just the person who clicked.
    const everyoneOnATeam = [
      ...new Set([...(teamData.teams.team1 || []), ...(teamData.teams.team2 || [])]),
    ];

    if (everyoneOnATeam.length === 0) {
      return interaction.editReply("Nobody's on a team right now — everyone's already together.");
    }

    const originalVc = teamData.channelId ? guild.channels.cache.get(teamData.channelId) : null;

    for (const id of everyoneOnATeam) {
      await clearMemberTeamPermissions(guild, teamData, id);

      const m = guild.members.cache.get(id) || await guild.members.fetch(id).catch(() => null);
      if (m?.voice?.channelId && [teamData.t1vcId, teamData.t2vcId].includes(m.voice.channelId) && originalVc) {
        await m.voice.setChannel(originalVc).catch(() => {});
      }
    }

    teamData.teams.team1 = [];
    teamData.teams.team2 = [];
    db.setTeams(guild.id, teamData);

    await refreshPanelEmbed(guild, teamData, client);
    return interaction.editReply('🔓 Reset — everyone is back together and can hear/speak with each other again.');
  }

  const teamNum = choice === 'team_panel_1' ? '1' : '2';
  const key = `team${teamNum}`;
  const other = teamNum === '1' ? 'team2' : 'team1';

  teamData.teams[other] = (teamData.teams[other] || []).filter(id => id !== userId);
  if (!teamData.teams[key]) teamData.teams[key] = [];
  if (!teamData.teams[key].includes(userId)) teamData.teams[key].push(userId);
  db.setTeams(guild.id, teamData);

  await assignMemberTeamPermissions(guild, teamData, userId, key);

  if (member.voice?.channelId) {
    const targetVcId = key === 'team1' ? teamData.t1vcId : teamData.t2vcId;
    const targetVc = targetVcId ? guild.channels.cache.get(targetVcId) : null;
    if (targetVc) await member.voice.setChannel(targetVc).catch(() => {});
  }

  await refreshPanelEmbed(guild, teamData, client);
  return interaction.editReply(`⚔️ You joined **Team ${teamNum}** — you'll only hear your teammates now.`);
}

// ─── Team separation logic ───
// Creates two sub-VCs under a "RAIDER TEAMS" category, moves players, isolates audio
async function applyTeamSeparation(guild, teamData, client, activate) {
  if (activate) {
    // Create or find RAIDER TEAMS category
    let category = guild.channels.cache.find(c => c.name === 'RAIDER TEAMS' && c.type === 4);
    if (!category) {
      try {
        category = await guild.channels.create({
          name: 'RAIDER TEAMS',
          type: 4, // GUILD_CATEGORY
          permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] }],
        });
      } catch (err) {
        err.message = `${err.message} (while creating the "RAIDER TEAMS" category)`;
        throw err;
      }
    }

    // Create Team 1 VC
    let t1vc;
    try {
      t1vc = await guild.channels.create({
        name: '🔴 Team 1',
        type: 2, // GUILD_VOICE
        parent: category.id,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.ViewChannel] },
          ...teamData.teams.team1.map(id => ({ id, allow: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Speak] })),
        ],
      });
    } catch (err) {
      err.message = `${err.message} (while creating the "Team 1" voice channel)`;
      throw err;
    }

    // Create Team 2 VC
    let t2vc;
    try {
      t2vc = await guild.channels.create({
        name: '🔵 Team 2',
        type: 2,
        parent: category.id,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.ViewChannel] },
          ...teamData.teams.team2.map(id => ({ id, allow: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Speak] })),
        ],
      });
    } catch (err) {
      err.message = `${err.message} (while creating the "Team 2" voice channel)`;
      throw err;
    }

    // Move players
    for (const userId of teamData.teams.team1) {
      const member = guild.members.cache.get(userId);
      if (member?.voice?.channel) await member.voice.setChannel(t1vc).catch(() => {});
    }
    for (const userId of teamData.teams.team2) {
      const member = guild.members.cache.get(userId);
      if (member?.voice?.channel) await member.voice.setChannel(t2vc).catch(() => {});
    }

    // Store channel IDs for cleanup
    teamData.t1vcId = t1vc.id;
    teamData.t2vcId = t2vc.id;
    teamData.categoryId = category.id;
    const db = client.db;
    db.setTeams(guild.id, teamData);

  } else {
    // Move everyone back to original channel and delete temp channels
    const originalVc = teamData.channelId ? guild.channels.cache.get(teamData.channelId) : null;
    for (const userId of [...(teamData.teams.team1 || []), ...(teamData.teams.team2 || [])]) {
      const member = guild.members.cache.get(userId);
      if (member?.voice?.channel && originalVc) {
        await member.voice.setChannel(originalVc).catch(() => {});
      }
    }
    // Delete temp channels
    if (teamData.t1vcId) await guild.channels.cache.get(teamData.t1vcId)?.delete().catch(() => {});
    if (teamData.t2vcId) await guild.channels.cache.get(teamData.t2vcId)?.delete().catch(() => {});
    if (teamData.categoryId) {
      const cat = guild.channels.cache.get(teamData.categoryId);
      const children = guild.channels.cache.filter(c => c.parentId === teamData.categoryId);
      for (const [, ch] of children) await ch.delete().catch(() => {});
      await cat?.delete().catch(() => {});
    }
    teamData.t1vcId = null;
    teamData.t2vcId = null;
    teamData.categoryId = null;
    client.db.setTeams(guild.id, teamData);
  }
}

module.exports = teamCommandHandler;
module.exports.handlePanelButton = handlePanelButton;
module.exports.bumpPanel = bumpPanel;
