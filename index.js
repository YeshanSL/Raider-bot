require('dotenv').config();
const http = require('http');
const { Client, GatewayIntentBits, Collection, ActivityType, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');

const port = Number(process.env.PORT) || 3000;
http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Raider Bot | Online</title>
    <style>
      :root { color-scheme: dark; font-family: "Segoe UI", sans-serif; background: #101714; color: #f3f6f2; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: radial-gradient(ellipse at 50% 0%, #24382b 0, #101714 60%); }
      main { width: min(100% - 40px, 520px); padding: 48px 24px; text-align: center; border: 1px solid #34483a; border-radius: 12px; background: #151e19; box-shadow: 0 24px 80px #0006; }
      .mark { display: grid; place-items: center; width: 64px; aspect-ratio: 1; margin: 0 auto 24px; border: 1px solid #587b53; border-radius: 18px; color: #b4dc78; font-size: 30px; }
      h1 { margin: 0; font-size: 32px; }
      p { margin: 12px 0 0; color: #a9b8ac; }
      .status { display: inline-flex; align-items: center; gap: 9px; margin-top: 30px; padding: 10px 14px; border: 1px solid #345b3d; border-radius: 999px; color: #c2e9bf; background: #1b3021; font-size: 14px; }
      .dot { width: 8px; aspect-ratio: 1; border-radius: 50%; background: #75d77d; box-shadow: 0 0 12px #75d77d99; }
    </style>
  </head>
  <body>
    <main>
      <div class="mark" aria-hidden="true">R</div>
      <h1>Raider is online</h1>
      <p>Your community bot is ready for action.</p>
      <div class="status"><span class="dot"></span>Service operational</div>
    </main>
  </body>
</html>`);
}).listen(port, '0.0.0.0', () => {
  console.log(`🌐 Raider status page listening on port ${port}`);
});

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

client.once(Events.ClientReady, () => {
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
