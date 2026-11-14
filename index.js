require('dotenv').config();
const { Client, GatewayIntentBits, Collection, ActivityType, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildPresences,
  ],
});

// Web server: Render health check + live stats for the website (/status)
require('./src/status-server')(client);

client.commands = new Collection();
client.config = require('./src/config');
client.db = require('./src/database');

// Load event handlers
const eventsPath = path.join(__dirname, 'src/events');
const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));
for (const file of eventFiles) {
  const event = require(path.join(eventsPath, file));
  // Log handler errors instead of letting them crash the process (an unhandled
  // rejection exits Node, which restarts the bot and drops active voice sessions)
  const run = (...args) => Promise.resolve()
    .then(() => event.execute(...args, client))
    .catch(err => console.error(`❌ Error in ${event.name} handler:`, err));
  if (event.once) client.once(event.name, run);
  else client.on(event.name, run);
}

// Safety net for any other promise that fails without a .catch
process.on('unhandledRejection', err => console.error('❌ Unhandled promise rejection:', err));

// Rotating status tags every 40 seconds
const tags = [
  { name: '⚔️ Raider | Ready to Battle', type: ActivityType.Playing },
  { name: '🏆 Raider | Rank Up Now', type: ActivityType.Competing },
  { name: '🔥 Raider | Drop Zone Active', type: ActivityType.Watching },
  { name: '💬 Raider | Chat & Level Up', type: ActivityType.Listening },
  { name: '🎮 Raider | Game On', type: ActivityType.Playing },
  { name: '🛡️ Raider | Protecting the Squad', type: ActivityType.Watching },
  { name: '⚡ Raider | FPS Team Mode', type: ActivityType.Playing },
];
let tagIndex = 0;

client.once(Events.ClientReady, () => {
  console.log(`✅ Raider is online as ${client.user.tag}`);
  // Set initial tag
  client.user.setActivity(tags[0].name, { type: tags[0].type });

  // Weekly Wrapped recap — Sundays, 12:00 PM IST
  require('./src/scheduler').startScheduler(client);
  // Rotate every 40 seconds
  setInterval(() => {
    tagIndex = (tagIndex + 1) % tags.length;
    const tag = tags[tagIndex];
    client.user.setActivity(tag.name, { type: tag.type });
  }, 40000);
});

// Load data from MongoDB before logging in, so every handler sees it
client.db.connect()
  .then(() => {
    // Re-apply channels saved via /setchannel (or the website's control panel)
    for (const overrides of Object.values(client.db.getAllChannelOverrides())) {
      Object.assign(client.config, overrides);
    }
    return client.login(process.env.DISCORD_TOKEN);
  })
  .catch(err => {
    console.error('❌ Startup failed:', err.message);
    process.exit(1);
  });

// Render sends SIGTERM on redeploy/restart — finish pending DB writes first
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    console.log(`🛑 ${signal} received, saving data...`);
    await client.db.close().catch(() => {});
    client.destroy();
    process.exit(0);
  });
}
