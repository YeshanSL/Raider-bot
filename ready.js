const { Events } = require('discord.js');
const db = require('../database');
const voiceSummary = require('../voice-summary');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`✅ Logged in as ${client.user.tag}`);
    // Tick voice XP + record which games are being played, every minute
    setInterval(() => {
      db.tickVoiceXP(client);
      voiceSummary.sampleGames(client);
    }, 60000);
  },
};
