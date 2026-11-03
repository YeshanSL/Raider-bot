// Website control panel API. Called from status-server.js for every /panel/* request.
//
// Needs one env var:  PANEL_PASSKEY  → the same passkey you set on the website (set-passkey.html).
// Optional:           STATUS_ORIGIN  → your website address, so only your site can call this.
//
// It reuses the bot's own team + soundboard code, so the website does exactly what the slash commands do.
const crypto = require('crypto');
const { ChannelType, PermissionsBitField } = require('discord.js');
const teamHandler = require('./handlers/team');
const { applyToChannel } = require('./handlers/soundboard');

const ORIGIN = process.env.STATUS_ORIGIN || '*';
const TOKEN_HOURS = 12;
const CHANNEL_KEYS = { welcome: 'WELCOME_CHANNEL_ID', boost: 'BOOST_CHANNEL_ID', levelup: 'LEVEL_UP_CHANNEL_ID', voice: 'VOICE_LOG_CHANNEL_ID', dashboard: 'DASHBOARD_CHANNEL_ID' };
const MASK = PermissionsBitField.Flags.UseSoundboard | PermissionsBitField.Flags.UseExternalSounds;

// ─── tiny auth: signed token that survives restarts ───
const secret = () => crypto.createHash('sha256').update('raider-panel:' + process.env.PANEL_PASSKEY + ':' + process.env.DISCORD_TOKEN).digest();
const sign = exp => crypto.createHmac('sha256', secret()).update(String(exp)).digest('base64url');
const makeToken = () => { const exp = Date.now() + TOKEN_HOURS * 3600e3; return `${exp}.${sign(exp)}`; };
function validToken(t) {
  const [exp, sig] = String(t || '').split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function samePasskey(typed) {
  const h = s => crypto.createHash('sha256').update(String(s).trim()).digest();
  return crypto.timingSafeEqual(h(typed), h(process.env.PANEL_PASSKEY));
}
const fails = new Map(); // ip → [timestamps]
function tooMany(ip) { const now = Date.now(), l = (fails.get(ip) || []).filter(t => now - t < 10 * 60e3); fails.set(ip, l); return l.length >= 6; }

// ─── http helpers ───
function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders() });
  res.end(JSON.stringify(body));
}
function corsHeaders() {
  return { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin' };
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 20000) { reject(new Error('Request too large.')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Bad request.')); } });
  });
}

// ─── helpers ───
const textChannels = g => [...g.channels.cache.filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement).sort((a, b) => a.rawPosition - b.rawPosition).values()];
const voiceChannels = g => [...g.channels.cache.filter(c => c.type === ChannelType.GuildVoice).sort((a, b) => a.rawPosition - b.rawPosition).values()];
const nameOf = (g, id) => g.members.cache.get(id)?.displayName || 'Unknown member';
const plain = (g, t) => String(t || '').replace(/<@!?(\d+)>/g, (m, id) => nameOf(g, id)).replace(/<#(\d+)>/g, (m, id) => '#' + (g.channels.cache.get(id)?.name || 'channel')).replace(/[*`_]/g, '').trim();

// Runs the existing !raider-style team handler as if an admin typed the command.
async function runTeam(guild, client, args, target) {
  const out = [];
  const channel = guild.channels.cache.get(client.config.DASHBOARD_CHANNEL_ID) || guild.systemChannel || textChannels(guild)[0];
  const message = {
    guild, channel, author: { id: guild.ownerId, tag: 'Website control panel' },
    member: { id: 'web-panel', displayName: 'Control panel', permissions: { has: () => true }, roles: { cache: { has: () => true } } },
    mentions: { members: { first: () => target || null }, users: { first: () => target?.user || null }, channels: { first: () => null } },
    reply: async p => { out.push(p); },
  };
  await teamHandler(message, args, client);
  const p = out[0];
  const text = typeof p === 'string' ? p : p?.content || p?.embeds?.[0]?.data?.title || p?.embeds?.[0]?.title || 'Done.';
  const msg = plain(guild, text);
  return { ok: !msg.startsWith('❌'), message: msg };
}

// ─── routes ───
const routes = {
  async 'GET /panel/guilds'(client) {
    return { guilds: [...client.guilds.cache.values()].map(g => ({ id: g.id, name: g.name })) };
  },

  async 'GET /panel/data'(client, { guild }) {
    const teams = client.db.getTeams(guild.id), t = teams.teams || {};
    const over = client.db.getAllChannelOverrides()[guild.id] || {};
    const channels = {};
    for (const [k, key] of Object.entries(CHANNEL_KEYS)) channels[k] = over[key] || client.config[key] || '';
    const blocks = Object.entries(client.db.getSoundboardBlocks(guild.id)).map(([id, r]) => ({
      id, name: nameOf(guild, id), allVoice: !!r.allVoice, channels: (r.channelIds || []).map(c => guild.channels.cache.get(c)?.name || 'deleted channel'),
    }));
    const people = ids => (ids || []).map(id => ({ id, name: nameOf(guild, id) }));
    return {
      textChannels: textChannels(guild).map(c => ({ id: c.id, name: c.name })),
      voiceChannels: voiceChannels(guild).map(c => ({ id: c.id, name: c.name })),
      channels,
      team: { channelId: teams.channelId || '', active: !!teams.active, panelOn: !!teams.panelOn, team1: people(t.team1), team2: people(t.team2) },
      blocks,
    };
  },

  async 'GET /panel/members'(client, { guild, query }) {
    const q = (query.get('q') || '').trim();
    if (!q) return { members: [] };
    const found = await guild.members.search({ query: q, limit: 8 });
    return { members: [...found.values()].filter(m => !m.user.bot).map(m => ({ id: m.id, name: m.displayName, avatar: m.displayAvatarURL({ extension: 'png', size: 64 }) })) };
  },

  async 'POST /panel/channel'(client, { guild, body }) {
    const key = CHANNEL_KEYS[body.type], ch = guild.channels.cache.get(body.channelId);
    if (!key) return { ok: false, message: '❌ Unknown channel type.' };
    if (!ch || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(ch.type)) return { ok: false, message: '❌ Pick a text channel from this server.' };
    client.db.setChannelOverride(guild.id, key, ch.id);
    client.config[key] = ch.id;
    return { ok: true, message: `✅ ${body.type} messages will now go to #${ch.name}.` };
  },

  async 'POST /panel/team'(client, { guild, body }) {
    const a = body.action;
    if (a === 'setup') return runTeam(guild, client, ['setup', String(body.channelId || '')]);
    if (a === 'on' || a === 'off') return runTeam(guild, client, [a]);
    if (a === 'panel-on') return runTeam(guild, client, ['panel', 'on']);
    if (a === 'panel-off') return runTeam(guild, client, ['panel', 'off']);
    if (a === 'assign') {
      const member = await guild.members.fetch(String(body.userId || '')).catch(() => null);
      if (!member) return { ok: false, message: '❌ I couldn’t find that member.' };
      return runTeam(guild, client, ['assign', 'user', String(body.team)], member);
    }
    return { ok: false, message: '❌ Unknown team action.' };
  },

  async 'POST /panel/soundboard'(client, { guild, body }) {
    const db = client.db, action = body.action, userId = String(body.userId || '');
    const allVoice = voiceChannels(guild);
    const selected = (body.channelIds || []).map(id => guild.channels.cache.get(id)).filter(c => c && c.type === ChannelType.GuildVoice);
    const targets = selected.length ? selected : allVoice;
    const target = await guild.members.fetch(userId).catch(() => null);
    const name = target?.displayName || nameOf(guild, userId);
    if (!userId || (!target && action === 'block')) return { ok: false, message: '❌ I couldn’t find that member in this server.' };
    if (!targets.length) return { ok: false, message: '❌ This server has no voice channels.' };

    const run = async block => {
      const res = { changed: [], unchanged: [], failed: [] };
      for (const ch of targets) {
        try { res[await applyToChannel(ch, userId, block, `Soundboard ${block ? 'blocked' : 'restored'} from the website panel`)].push(ch); }
        catch (e) { res.failed.push({ channel: ch, error: e }); }
      }
      return res;
    };
    const fail = r => r.failed.length ? ` ⚠️ Couldn’t update ${r.failed.length} channel(s). My role needs Manage Permissions there.` : '';

    if (action === 'block') {
      if (userId === client.user.id) return { ok: false, message: '❌ I can’t restrict myself.' };
      if (userId === guild.ownerId || target.permissions.has(PermissionsBitField.Flags.Administrator))
        return { ok: false, message: '❌ The server owner and Administrators bypass channel permissions, so this would have no effect.' };
      const r = await run(true), done = [...r.changed, ...r.unchanged];
      if (done.length) {
        const store = db.getSoundboardBlocks(guild.id), rec = store[userId] || { allVoice: false, channelIds: [] };
        if (selected.length) { for (const c of done) if (!rec.channelIds.includes(c.id)) rec.channelIds.push(c.id); } else rec.allVoice = true;
        rec.at = Date.now(); store[userId] = rec; db.setSoundboardBlocks(guild.id, store);
      }
      return { ok: done.length > 0, message: (done.length ? `🔇 ${name} can no longer use the Soundboard in ${selected.length ? done.length + ' selected channel(s)' : 'all voice channels'}.` : `❌ I couldn’t restrict ${name}.`) + fail(r) };
    }

    if (action === 'unblock') {
      const r = await run(false), okIds = new Set([...r.changed, ...r.unchanged].map(c => c.id));
      const store = db.getSoundboardBlocks(guild.id), rec = store[userId];
      if (rec) {
        if (selected.length) { rec.channelIds = (rec.allVoice ? allVoice.map(c => c.id) : rec.channelIds).filter(id => !okIds.has(id)); rec.allVoice = false; }
        else { rec.channelIds = r.failed.map(f => f.channel.id); rec.allVoice = false; }
        if (!rec.channelIds.length) delete store[userId];
        db.setSoundboardBlocks(guild.id, store);
      }
      return { ok: !r.failed.length, message: (r.changed.length ? `🔊 ${name}’s Soundboard access was restored.` : `ℹ️ ${name} had no soundboard restriction there.`) + fail(r) };
    }
    return { ok: false, message: '❌ Unknown soundboard action.' };
  },
};

// Entry point. Always handles the request (called only for /panel/* paths).
module.exports = async (client, req, res) => {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders()); return res.end(); }
    if (!process.env.PANEL_PASSKEY) return send(res, 503, { error: 'The control panel is off. Set PANEL_PASSKEY on the bot, then redeploy.' });

    const url = new URL(req.url, 'http://x'), key = `${req.method} ${url.pathname}`;
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

    if (key === 'POST /panel/login') {
      if (tooMany(ip)) return send(res, 429, { error: 'Too many wrong attempts. Wait 10 minutes and try again.' });
      const body = await readBody(req);
      if (typeof body.passkey !== 'string' || !samePasskey(body.passkey)) { fails.get(ip).push(Date.now()); return send(res, 401, { error: 'Wrong passkey.' }); }
      return send(res, 200, { token: makeToken() });
    }

    const route = routes[key];
    if (!route) return send(res, 404, { error: 'Unknown panel route.' });
    if (!validToken((req.headers.authorization || '').replace(/^Bearer /, ''))) return send(res, 401, { error: 'Please sign in again.' });
    if (!client.isReady()) return send(res, 503, { error: 'The bot is still starting. Try again in a moment.' });

    const body = req.method === 'POST' ? await readBody(req) : {};
    const gid = req.method === 'POST' ? body.guildId : url.searchParams.get('guild');
    const guild = gid ? client.guilds.cache.get(String(gid)) : null;
    if (key !== 'GET /panel/guilds' && !guild) return send(res, 404, { error: 'The bot is not in that server.' });

    send(res, 200, await route(client, { guild, body, query: url.searchParams }));
  } catch (e) {
    console.error('Panel error:', e);
    send(res, 500, { error: e.message || 'Something went wrong.' });
  }
};
