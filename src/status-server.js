// One small web server for Render's health check (/) AND the website's live stats (/status).
// Started from index.js:  require('./src/status-server')(client);
//
// Optional env vars:
//   STATUS_GUILD_ID = your main/community server ID → also returns that server's owner + admins
//   STATUS_ORIGIN   = your website address (e.g. https://raiderbot-web.vercel.app). Default: any site.
const http = require('http');

const HOME_ID = process.env.STATUS_GUILD_ID || '';
const ORIGIN = process.env.STATUS_ORIGIN || '*';
let homeCache = { at: 0, data: null };

const isOnline = p => p && p.status !== 'offline'; // online / idle / dnd all count as online
const isAdmin = (m, cfg) =>
  !m.user.bot && (m.permissions.has('Administrator') || (cfg.ADMIN_ROLE_ID && m.roles.cache.has(cfg.ADMIN_ROLE_ID)));
const person = (m, role) => ({ name: m.displayName, role, avatar: m.displayAvatarURL({ extension: 'png', size: 128 }) });

// Owner + admins of ONE server (the one you choose), refreshed at most once a minute.
async function homeInfo(client) {
  if (!HOME_ID) return null;
  if (Date.now() - homeCache.at < 60_000) return homeCache.data;
  const g = client.guilds.cache.get(HOME_ID);
  if (!g) return null;
  let data = homeCache.data;
  try {
    const owner = await g.fetchOwner();
    await g.members.fetch();
    data = {
      name: g.name,
      icon: g.iconURL({ extension: 'png', size: 128 }),
      members: g.memberCount,
      online: g.presences.cache.filter(isOnline).size,
      owner: person(owner, 'Owner'),
      admins: g.members.cache.filter(m => m.id !== owner.id && isAdmin(m, client.config)).map(m => person(m, 'Admin')).slice(0, 20),
    };
  } catch (e) { console.error('Status: could not load home server info:', e.message); }
  homeCache = { at: Date.now(), data };
  return data;
}

module.exports = (client, port = process.env.PORT || 3000) => {
  http.createServer(async (req, res) => {
    try {
      if (req.url.split('?')[0] === '/status') {
        const guilds = [...client.guilds.cache.values()];
        const body = {
          online: client.isReady(),
          ping: Math.round(client.ws.ping),
          servers: guilds.length,
          users: guilds.reduce((n, g) => n + g.memberCount, 0),                                  // total members in all servers
          onlineMembers: guilds.reduce((n, g) => n + g.presences.cache.filter(isOnline).size, 0), // members online right now
          uptime: Math.floor((client.uptime || 0) / 1000),
          home: client.isReady() ? await homeInfo(client) : null,
        };
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ORIGIN, 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(body));
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Raider bot is running.');
    } catch (e) { res.writeHead(500); res.end(); }
  }).listen(port, () => console.log(`🌐 Web server on port ${port} (health check + /status)`));
};
