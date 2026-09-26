// Registers the slash ("/") commands with Discord.
// Run this once whenever you add/change a command:
//   node deploy-commands.js
//
// Needs DISCORD_TOKEN and CLIENT_ID in your .env (CLIENT_ID = your bot's
// Application ID, found on the "General Information" page of your app at
// https://discord.com/developers/applications).
//
// If GUILD_ID is also set in .env, commands are registered to just that
// server and show up instantly (best while developing/testing).
// If GUILD_ID is left blank, commands are registered globally, which is
// what you want for a bot that lives in multiple servers — but it can take
// up to an hour to show up everywhere.
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const commands = require('./src/commands');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token) {
  console.error('❌ Missing DISCORD_TOKEN in .env');
  process.exit(1);
}
if (!clientId) {
  console.error('❌ Missing CLIENT_ID in .env — grab this from the "General Information" tab of your app at https://discord.com/developers/applications');
  process.exit(1);
}

const rest = new REST().setToken(token);

(async () => {
  try {
    console.log(`🔄 Registering ${commands.length} slash command(s)...`);

    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log(`✅ Registered commands to guild ${guildId} (they'll show up immediately).`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log('✅ Registered commands globally (can take up to an hour to appear everywhere).');
    }
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
    process.exit(1);
  }
})();
