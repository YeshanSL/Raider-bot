const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');

const OVERRIDE_FILE = path.join(__dirname, '../../data/channel_overrides.json');

function readOverrides() {
  if (!fs.existsSync(OVERRIDE_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8')); } catch { return {}; }
}

function writeOverrides(data) {
  fs.writeFileSync(OVERRIDE_FILE, JSON.stringify(data, null, 2));
}

const VALID_TYPES = {
  welcome: 'WELCOME_CHANNEL_ID',
  boost: 'BOOST_CHANNEL_ID',
  levelup: 'LEVEL_UP_CHANNEL_ID',
  voice: 'VOICE_LOG_CHANNEL_ID',
  dashboard: 'DASHBOARD_CHANNEL_ID',
};

module.exports = async (message, args, client) => {
  if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return message.reply('❌ You need Administrator permission.');
  }

  const type = args[0]?.toLowerCase();
  const channel = message.mentions.channels.first();

  if (!type || !VALID_TYPES[type]) {
    const embed = new EmbedBuilder()
      .setColor(client.config.COLORS.info)
      .setTitle('📋 Channel Configuration')
      .setDescription('Usage: `!raider setchannel <type> #channel`')
      .addFields({
        name: 'Available Types',
        value: Object.keys(VALID_TYPES).map(t => `\`${t}\``).join(', '),
      });
    return message.reply({ embeds: [embed] });
  }

  if (!channel) return message.reply('❌ Please mention a channel: `!raider setchannel welcome #welcome`');

  const overrides = readOverrides();
  if (!overrides[message.guild.id]) overrides[message.guild.id] = {};
  overrides[message.guild.id][VALID_TYPES[type]] = channel.id;
  writeOverrides(overrides);

  // Apply to config dynamically
  client.config[VALID_TYPES[type]] = channel.id;

  await message.reply(`✅ **${type}** messages will now be sent to ${channel}.`);
};
