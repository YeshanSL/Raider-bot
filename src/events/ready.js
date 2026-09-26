const { Events } = require('discord.js');
const db = require('../database');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`✅ Logged in as ${client.user.tag}`);
    // Tick voice XP every minute
    setInterval(() => db.tickVoiceXP(client), 60000);
  },
};
