require('dotenv').config();
const { Client, GatewayIntentBits, Collection, ActivityType } = require('discord.js');
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

client.commands = new Collection();
client.config = require('./src/config');
client.db = require('./src/database');

// Load event handlers
const eventsPath = path.join(__dirname, 'src/events');
const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));
for (const file of eventFiles) {
  const event = require(path.join(eventsPath, file));
  if (event.once) client.once(event.name, (...args) => event.execute(...args, client));
  else client.on(event.name, (...args) => event.execute(...args, client));
}

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

client.once('ready', () => {
  console.log(`✅ Raider is online as ${client.user.tag}`);
  // Set initial tag
  client.user.setActivity(tags[0].name, { type: tags[0].type });
  // Rotate every 40 seconds
  setInterval(() => {
    tagIndex = (tagIndex + 1) % tags.length;
    const tag = tags[tagIndex];
    client.user.setActivity(tag.name, { type: tag.type });
  }, 40000);
});

client.login(process.env.DISCORD_TOKEN);
