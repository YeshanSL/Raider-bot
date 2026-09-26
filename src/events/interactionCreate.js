const { Events } = require('discord.js');
const getHandler = require('../handlers/index');

// Wraps a slash-command interaction so it looks like the old `message`
// object our handlers already know how to use (message.author,
// message.mentions, message.reply, ...). This lets `!raider rank` and
// `/rank` both run through the exact same handler code.
function buildCompatMessage(interaction, args) {
  const optUser = interaction.options.getUser?.('user') || null;
  let optMember = null;
  if (optUser) {
    optMember = interaction.options.getMember?.('user') || interaction.guild?.members?.cache?.get(optUser.id) || null;
  }
  const optChannel = interaction.options.getChannel?.('channel') || null;

  return {
    author: interaction.user,
    member: interaction.member,
    guild: interaction.guild,
    channel: interaction.channel,
    mentions: {
      users: { first: () => optUser },
      members: { first: () => optMember },
      channels: { first: () => optChannel },
    },
    // Mirrors Message#reply: first call answers the interaction, any
    // handler call after that (e.g. dashboard's buttons re-using this
    // same object) posts a new follow-up message instead of overwriting it.
    reply: async payload => {
      if (interaction.replied || interaction.deferred) {
        return interaction.followUp(payload);
      }
      await interaction.reply(payload);
      return interaction.fetchReply();
    },
  };
}

// Rebuilds the classic `args` array each handler expects from its
// !raider-prefix days, using the slash command's options/subcommand.
function buildArgs(interaction) {
  const command = interaction.commandName;

  if (command === 'team') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel');
      return ['setup', channel ? channel.id : ''];
    }
    if (sub === 'assign') {
      const team = interaction.options.getString('team');
      return ['assign', 'user', team];
    }
    if (sub === 'panel') {
      const action = interaction.options.getString('action');
      return ['panel', action];
    }
    return [sub];
  }

  if (command === 'setchannel') {
    return [interaction.options.getString('type')];
  }

  return [];
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    // ─── Team self-select panel buttons (Team 1 / Team 2 / All) ───
    if (interaction.isButton() && interaction.customId.startsWith('team_panel_')) {
      const teamHandler = require('../handlers/team');
      try {
        await teamHandler.handlePanelButton(interaction, client);
      } catch (err) {
        console.error('Team panel button error:', err);
        const payload = { content: '⚠️ Something went wrong with that button.', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ This command only works in a server.', ephemeral: true });
    }

    const handler = getHandler(interaction.commandName);
    if (!handler) return;

    const args = buildArgs(interaction);
    const compatMessage = buildCompatMessage(interaction, args);

    try {
      await handler(compatMessage, args, client);
    } catch (err) {
      console.error(`Slash command error [/${interaction.commandName}]:`, err);
      const payload = { content: '⚠️ Something went wrong with that command.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  },
};
