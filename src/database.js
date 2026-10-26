const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

// ─── Storage ───
// Every store is a MongoDB collection with one document per guild:
//   { _id: guildId, data: <that guild's data> }
// All data is loaded into memory on startup so every getter below stays
// synchronous. Each change updates memory immediately and is written to
// MongoDB in the background.
const STORES = [
  'xp', 'sessions', 'teams', 'soundboard_blocks', 'wrapped_snapshot',
  'points', 'shop', 'boosts', 'flair', 'channel_overrides',
];

// Old JSON files, imported into MongoDB once if their collection is empty
const LEGACY_DIR = path.join(__dirname, '../data');

const cache = Object.fromEntries(STORES.map(s => [s, {}]));
let mongo = null;
let database = null;

async function connect() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set — add it to your .env / Render environment.');
  mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  database = mongo.db(process.env.MONGODB_DB || 'raider');

  for (const store of STORES) {
    const docs = await database.collection(store).find().toArray();
    for (const doc of docs) cache[store][doc._id] = doc.data;
    if (docs.length === 0) await importLegacyFile(store);
  }
  console.log('🍃 Connected to MongoDB and loaded data');
}

async function importLegacyFile(store) {
  const file = path.join(LEGACY_DIR, `${store}.json`);
  if (!fs.existsSync(file)) return;
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return console.warn(`⚠️ Could not parse ${file}, skipping import`); }
  const docs = Object.entries(data).map(([guildId, value]) => ({ _id: guildId, data: value }));
  if (docs.length === 0) return;
  await database.collection(store).insertMany(docs);
  for (const doc of docs) cache[store][doc._id] = doc.data;
  console.log(`📥 Imported ${file} into MongoDB (${docs.length} guilds)`);
}

// Writes are chained per guild document so they land in order. If a write is
// already queued, it will pick up the latest in-memory state, so repeat calls
// are skipped.
const writeChains = new Map();
const queued = new Set();

function persist(store, guildId) {
  const key = `${store}:${guildId}`;
  if (queued.has(key)) return;
  queued.add(key);
  const prev = writeChains.get(key) || Promise.resolve();
  const next = prev.then(async () => {
    queued.delete(key);
    const data = cache[store][guildId];
    const collection = database.collection(store);
    if (data === undefined) await collection.deleteOne({ _id: guildId });
    else await collection.replaceOne({ _id: guildId }, { data }, { upsert: true });
  }).catch(err => console.error(`❌ MongoDB write failed (${key}):`, err.message));
  writeChains.set(key, next);
}

// Waits for queued writes, then closes the connection (call before exiting)
async function close() {
  await Promise.all(writeChains.values());
  if (mongo) await mongo.close();
}

// ─── XP / Levels ───
function getXP(guildId, userId) {
  return cache.xp[guildId]?.[userId] || { xp: 0, level: 0, lastMsg: 0 };
}

function setXP(guildId, userId, data) {
  if (!cache.xp[guildId]) cache.xp[guildId] = {};
  cache.xp[guildId][userId] = data;
  persist('xp', guildId);
}

function xpForLevel(level) {
  return 100 * (level + 1) * (level + 1);
}

// Total XP ever earned to reach { level, xp }, used to measure XP gained
// between two points in time (e.g. for the weekly Wrapped recap).
function totalXPEarned(level, xp) {
  let total = xp;
  for (let l = 0; l < level; l++) total += xpForLevel(l);
  return total;
}

function addXP(guildId, userId, amount) {
  const boost = getActiveBoost(guildId, userId);
  if (boost) amount = Math.round(amount * boost.multiplier);

  const user = { ...getXP(guildId, userId) };
  const startingLevel = user.level;
  user.xp += amount;
  let leveledUp = false;
  while (user.xp >= xpForLevel(user.level)) {
    user.xp -= xpForLevel(user.level);
    user.level += 1;
    leveledUp = true;
  }
  setXP(guildId, userId, user);

  const levelsGained = user.level - startingLevel;
  if (levelsGained > 0) {
    // Points are a separate spendable balance — awarding them here never
    // touches XP/level itself, so the leaderboard is unaffected.
    const config = require('./config');
    addPoints(guildId, userId, levelsGained * config.POINTS_PER_LEVEL_UP);
  }

  return { ...user, leveledUp };
}

function getLeaderboard(guildId, limit = 10) {
  const guild = cache.xp[guildId] || {};
  return Object.entries(guild)
    .map(([userId, data]) => ({ userId, ...data }))
    .sort((a, b) => b.level - a.level || b.xp - a.xp)
    .slice(0, limit);
}

// ─── Voice Sessions ───
const activeSessions = {}; // in-memory: { guildId: { userId: { joinTime, channelId } } }

function startVoiceSession(guildId, userId, channelId) {
  if (!activeSessions[guildId]) activeSessions[guildId] = {};
  activeSessions[guildId][userId] = { joinTime: Date.now(), channelId };
}

function endVoiceSession(guildId, userId, game = null) {
  const session = activeSessions[guildId]?.[userId];
  if (!session) return null;
  const duration = Math.floor((Date.now() - session.joinTime) / 1000); // seconds
  delete activeSessions[guildId][userId];
  // Save to history
  if (!cache.sessions[guildId]) cache.sessions[guildId] = [];
  cache.sessions[guildId].push({ userId, channelId: session.channelId, duration, timestamp: Date.now(), game });
  // Keep last 2000 sessions per guild (enough for a weekly recap on an active server)
  if (cache.sessions[guildId].length > 2000) cache.sessions[guildId] = cache.sessions[guildId].slice(-2000);
  persist('sessions', guildId);
  return { duration, channelId: session.channelId, game };
}

// All saved sessions for a guild (oldest first)
function getSessions(guildId) {
  return cache.sessions[guildId] || [];
}

// All sessions for a guild that ended at or after `sinceTimestamp` (ms epoch).
function getSessionsSince(guildId, sinceTimestamp) {
  return getSessions(guildId).filter(s => s.timestamp >= sinceTimestamp);
}

function getActiveSession(guildId, userId) {
  return activeSessions[guildId]?.[userId] || null;
}

function getActiveSessionsForChannel(guildId, channelId) {
  const sessions = activeSessions[guildId] || {};
  return Object.entries(sessions)
    .filter(([, s]) => s.channelId === channelId)
    .map(([userId, s]) => ({ userId, joinTime: s.joinTime }));
}

// ─── Voice XP ─── tick every minute for all active sessions
function tickVoiceXP(client) {
  const config = require('./config');
  for (const [guildId, users] of Object.entries(activeSessions)) {
    for (const [userId] of Object.entries(users)) {
      const result = addXP(guildId, userId, config.XP_PER_VOICE_MIN);
      if (result.leveledUp) {
        // Fire level-up event for voice
        client.emit('voiceLevelUp', guildId, userId, result.level);
      }
    }
  }
}

// ─── Team Mode ───
function getTeams(guildId) {
  return cache.teams[guildId] || { active: false, teams: {}, channelId: null };
}

function setTeams(guildId, data) {
  cache.teams[guildId] = data;
  persist('teams', guildId);
}

// ─── Soundboard restrictions ───
// Shape: { [userId]: { allVoice: bool, channelIds: string[], by: userId, at: ms } }
function getSoundboardBlocks(guildId) {
  return cache.soundboard_blocks[guildId] || {};
}

function setSoundboardBlocks(guildId, data) {
  if (Object.keys(data).length === 0) delete cache.soundboard_blocks[guildId];
  else cache.soundboard_blocks[guildId] = data;
  persist('soundboard_blocks', guildId);
}

// ─── Weekly Wrapped snapshot ───
// Stores each user's level/xp as of the last Wrapped run, so the next run
// can measure how much they gained since then.
function getWrappedSnapshot(guildId) {
  return cache.wrapped_snapshot[guildId] || {};
}

function setWrappedSnapshot(guildId, data) {
  cache.wrapped_snapshot[guildId] = data;
  persist('wrapped_snapshot', guildId);
}

// ─── Points (spendable shop currency, separate from XP/level) ───
function getPoints(guildId, userId) {
  return cache.points[guildId]?.[userId] ?? 0;
}

function addPoints(guildId, userId, amount) {
  if (!cache.points[guildId]) cache.points[guildId] = {};
  cache.points[guildId][userId] = (cache.points[guildId][userId] || 0) + amount;
  persist('points', guildId);
  return cache.points[guildId][userId];
}

// Deducts points only if the balance covers it. Returns { success, balance }.
function spendPoints(guildId, userId, amount) {
  const current = getPoints(guildId, userId);
  if (current < amount) return { success: false, balance: current };
  if (!cache.points[guildId]) cache.points[guildId] = {};
  cache.points[guildId][userId] = current - amount;
  persist('points', guildId);
  return { success: true, balance: cache.points[guildId][userId] };
}

// ─── Shop items (per guild) ───
function getShopItems(guildId) {
  return cache.shop[guildId] || [];
}

function setShopItems(guildId, items) {
  cache.shop[guildId] = items;
  persist('shop', guildId);
}

// ─── XP Boosts (temporary multiplier on all XP gain) ───
function getActiveBoost(guildId, userId) {
  const entry = cache.boosts[guildId]?.[userId];
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) return null;
  return entry;
}

function setBoost(guildId, userId, multiplier, durationMin) {
  if (!cache.boosts[guildId]) cache.boosts[guildId] = {};
  cache.boosts[guildId][userId] = { multiplier, expiresAt: Date.now() + durationMin * 60 * 1000 };
  persist('boosts', guildId);
}

// ─── Nickname Flair (temporary prefix on nickname) ───
function getFlair(guildId, userId) {
  return cache.flair[guildId]?.[userId] || null;
}

function setFlair(guildId, userId, flair, durationMin) {
  if (!cache.flair[guildId]) cache.flair[guildId] = {};
  cache.flair[guildId][userId] = { flair, expiresAt: Date.now() + durationMin * 60 * 1000 };
  persist('flair', guildId);
}

function clearFlair(guildId, userId) {
  if (cache.flair[guildId]) delete cache.flair[guildId][userId];
  persist('flair', guildId);
}

// All guild/user flair entries that have expired, for the periodic cleanup
// loop to revert. Does NOT clear them — caller clears each one after it
// successfully reverts the nickname.
function getExpiredFlairs() {
  const expired = [];
  for (const [guildId, users] of Object.entries(cache.flair)) {
    for (const [userId, entry] of Object.entries(users)) {
      if (Date.now() >= entry.expiresAt) expired.push({ guildId, userId, flair: entry.flair });
    }
  }
  return expired;
}

// ─── Channel overrides (set via /setchannel) ───
// Shape: { [configKey]: channelId }, e.g. { WELCOME_CHANNEL_ID: '123' }
function getAllChannelOverrides() {
  return cache.channel_overrides;
}

function setChannelOverride(guildId, configKey, channelId) {
  if (!cache.channel_overrides[guildId]) cache.channel_overrides[guildId] = {};
  cache.channel_overrides[guildId][configKey] = channelId;
  persist('channel_overrides', guildId);
}

module.exports = {
  connect, close,
  getXP, setXP, addXP, xpForLevel, totalXPEarned, getLeaderboard,
  startVoiceSession, endVoiceSession, getActiveSession,
  getActiveSessionsForChannel, getSessions, getSessionsSince, tickVoiceXP,
  getTeams, setTeams,
  getSoundboardBlocks, setSoundboardBlocks,
  getWrappedSnapshot, setWrappedSnapshot,
  getPoints, addPoints, spendPoints,
  getShopItems, setShopItems,
  getActiveBoost, setBoost,
  getFlair, setFlair, clearFlair, getExpiredFlairs,
  getAllChannelOverrides, setChannelOverride,
};
