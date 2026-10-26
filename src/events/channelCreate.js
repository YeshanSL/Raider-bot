const { Events, ChannelType } = require('discord.js');
const { applyToChannel } = require('../handlers/soundboard');

// When a voice channel is created later (including Raider's temporary team
// channels), re-apply "all voice channels" soundboard blocks to it so a
// restricted member can't dodge the block by hopping into a new channel.
module.exports = {
  name: Events.ChannelCreate,
  async execute(channel, client) {
    if (!channel.guild || channel.type !== ChannelType.GuildVoice) return;

    const blocks = client.db.getSoundboardBlocks(channel.guild.id);
    for (const [userId, rec] of Object.entries(blocks)) {
      if (!rec.allVoice) continue;
      await applyToChannel(channel, userId, true, 'Soundboard block (new voice channel)').catch(err =>
        console.error(`Soundboard block on new channel ${channel.id} failed:`, err.message),
      );
    }
  },
};
