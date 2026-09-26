// ─── Slash command definitions ───
// These are what Discord shows when a user types "/" in your server.
const { SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('rank')
    .setDescription("View your or someone else's rank")
    .addUserOption(opt =>
      opt.setName('user').setDescription('The member to check (defaults to you)').setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the top 10 members on the server'),

  new SlashCommandBuilder()
    .setName('wrapped')
    .setDescription('Manually run the weekly recap right now (normally auto-posts Sundays 12PM IST)'),

  new SlashCommandBuilder()
    .setName('voicestats')
    .setDescription("View your or someone else's voice activity stats")
    .addUserOption(opt =>
      opt.setName('user').setDescription('The member to check (defaults to you)').setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Open your personal stats dashboard'),

  new SlashCommandBuilder()
    .setName('team')
    .setDescription('FPS Team Mode controls (Admin only)')
    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('Link a voice channel for team mode')
        .addChannelOption(opt =>
          opt.setName('channel').setDescription('The voice channel to use').setRequired(true),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('assign')
        .setDescription('Assign a player to Team 1 or Team 2')
        .addUserOption(opt => opt.setName('user').setDescription('The member to assign').setRequired(true))
        .addStringOption(opt =>
          opt
            .setName('team')
            .setDescription('Which team')
            .setRequired(true)
            .addChoices({ name: 'Team 1', value: '1' }, { name: 'Team 2', value: '2' }),
        ),
    )
    .addSubcommand(sub => sub.setName('on').setDescription('Activate team isolation'))
    .addSubcommand(sub => sub.setName('off').setDescription('Deactivate — everyone hears each other again'))
    .addSubcommand(sub =>
      sub
        .setName('panel')
        .setDescription('Post a button panel so players pick their own team')
        .addStringOption(opt =>
          opt
            .setName('action')
            .setDescription('Turn the panel on or off')
            .setRequired(true)
            .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }),
        ),
    )
    .addSubcommand(sub => sub.setName('status').setDescription('View current team assignments')),

  new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('Configure which channel a message type is sent to (Admin only)')
    .addStringOption(opt =>
      opt
        .setName('type')
        .setDescription('Which message type to configure')
        .setRequired(true)
        .addChoices(
          { name: 'welcome', value: 'welcome' },
          { name: 'boost', value: 'boost' },
          { name: 'levelup', value: 'levelup' },
          { name: 'voice', value: 'voice' },
          { name: 'dashboard', value: 'dashboard' },
        ),
    )
    .addChannelOption(opt =>
      opt.setName('channel').setDescription('The channel to send these messages to').setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show the full Raider Bot command list'),
].map(cmd => cmd.toJSON());

module.exports = commands;
