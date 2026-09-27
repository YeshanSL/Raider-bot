const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data');
const XP_FILE = path.join(DB_PATH, 'xp.json');
const VOICE_FILE = path.join(DB_PATH, 'voice.json');
const SESSIONS_FILE = path.join(DB_PATH, 'sessions.json');
const TEAM_FILE = path.join(DB_PATH, 'teams.json');
const WRAPPED_FILE = path.join(DB_PATH, 'wrapped_snapshot.json');
const POINTS_FILE = path.join(DB_PATH, 'points.json');
const SHOP_FILE = path.join(DB_PATH, 'shop.json');
const EFFECTS_FILE = path.join(DB_PATH, 'active_effects.json');
const BOOST_FILE = path.join(DB_PATH, 'boosts.json');
const FLAIR_FILE = path.join(DB_PATH, 'flair.json');

// Ensure data directory exists
if (!fs.existsSync(DB_PATH)) fs.mkdirSync(DB_PATH, { recursive: true });

function readJSON(file) {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return {}; }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ─── XP / Levels ───
function getXP(guildId, userId) {
  const db = readJSON(XP_FILE);
  return db[guildId]?.[userId] || { xp: 0, level: 0, lastMsg: 0 };
}

function setXP(guildId, userId, data) {
  const db = readJSON(XP_FILE);
  if (!db[guildId]) db[guildId] = {};
  db[guildId][userId] = data;
  writeJSON(XP_FILE, db);
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

  const user = getXP(guildId, userId);
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
  const db = readJSON(XP_FILE);
  const guild = db[guildId] || {};
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
  const db = readJSON(SESSIONS_FILE);
  if (!db[guildId]) db[guildId] = [];
  db[guildId].push({ userId, channelId: session.channelId, duration, timestamp: Date.now(), game });
  // Keep last 2000 sessions per guild (enough for a weekly recap on an active server)
  if (db[guildId].length > 2000) db[guildId] = db[guildId].slice(-2000);
  writeJSON(SESSIONS_FILE, db);
  return { duration, channelId: session.channelId, game };
}

// All sessions for a guild that ended at or after `sinceTimestamp` (ms epoch).
function getSessionsSince(guildId, sinceTimestamp) {
  const db = readJSON(SESSIONS_FILE);
  return (db[guildId] || []).filter(s => s.timestamp >= sinceTimestamp);
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
  const db = readJSON(TEAM_FILE);
  return db[guildId] || { active: false, teams: {}, channelId: null };
}

function setTeams(guildId, data) {
  const db = readJSON(TEAM_FILE);
  db[guildId] = data;
  writeJSON(TEAM_FILE, db);
}

// ─── Weekly Wrapped snapshot ───
// Stores each user's level/xp as of the last Wrapped run, so the next run
// can measure how much they gained since then.
function getWrappedSnapshot(guildId) {
  const db = readJSON(WRAPPED_FILE);
  return db[guildId] || {};
}

function setWrappedSnapshot(guildId, data) {
  const db = readJSON(WRAPPED_FILE);
  db[guildId] = data;
  writeJSON(WRAPPED_FILE, db);
}

// ─── Points (spendable shop currency, separate from XP/level) ───
function getPoints(guildId, userId) {
  const db = readJSON(POINTS_FILE);
  return db[guildId]?.[userId] ?? 0;
}

function addPoints(guildId, userId, amount) {
  const db = readJSON(POINTS_FILE);
  if (!db[guildId]) db[guildId] = {};
  db[guildId][userId] = (db[guildId][userId] || 0) + amount;
  writeJSON(POINTS_FILE, db);
  return db[guildId][userId];
}

// Deducts points only if the balance covers it. Returns { success, balance }.
function spendPoints(guildId, userId, amount) {
  const db = readJSON(POINTS_FILE);
  const current = db[guildId]?.[userId] || 0;
  if (current < amount) return { success: false, balance: current };
  if (!db[guildId]) db[guildId] = {};
  db[guildId][userId] = current - amount;
  writeJSON(POINTS_FILE, db);
  return { success: true, balance: db[guildId][userId] };
}

// ─── Shop items (per guild) ───
function getShopItems(guildId) {
  const db = readJSON(SHOP_FILE);
  return db[guildId] || [];
}

function setShopItems(guildId, items) {
  const db = readJSON(SHOP_FILE);
  db[guildId] = items;
  writeJSON(SHOP_FILE, db);
}

// ─── XP Boosts (temporary multiplier on all XP gain) ───
function getActiveBoost(guildId, userId) {
  const db = readJSON(BOOST_FILE);
  const entry = db[guildId]?.[userId];
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) return null;
  return entry;
}

function setBoost(guildId, userId, multiplier, durationMin) {
  const db = readJSON(BOOST_FILE);
  if (!db[guildId]) db[guildId] = {};
  db[guildId][userId] = { multiplier, expiresAt: Date.now() + durationMin * 60 * 1000 };
  writeJSON(BOOST_FILE, db);
}

// ─── Nickname Flair (temporary prefix on nickname) ───
function getFlair(guildId, userId) {
  const db = readJSON(FLAIR_FILE);
  return db[guildId]?.[userId] || null;
}

function setFlair(guildId, userId, flair, durationMin) {
  const db = readJSON(FLAIR_FILE);
  if (!db[guildId]) db[guildId] = {};
  db[guildId][userId] = { flair, expiresAt: Date.now() + durationMin * 60 * 1000 };
  writeJSON(FLAIR_FILE, db);
}

function clearFlair(guildId, userId) {
  const db = readJSON(FLAIR_FILE);
  if (db[guildId]) delete db[guildId][userId];
  writeJSON(FLAIR_FILE, db);
}

// All guild/user flair entries that have expired, for the periodic cleanup
// loop to revert. Does NOT clear them — caller clears each one after it
// successfully reverts the nickname.
function getExpiredFlairs() {
  const db = readJSON(FLAIR_FILE);
  const expired = [];
  for (const [guildId, users] of Object.entries(db)) {
    for (const [userId, entry] of Object.entries(users)) {
      if (Date.now() >= entry.expiresAt) expired.push({ guildId, userId, flair: entry.flair });
    }
  }
  return expired;
}

module.exports = {
  getXP, setXP, addXP, xpForLevel, totalXPEarned, getLeaderboard,
  startVoiceSession, endVoiceSession, getActiveSession,
  getActiveSessionsForChannel, getSessionsSince, tickVoiceXP,
  getTeams, setTeams,
  getWrappedSnapshot, setWrappedSnapshot,
  getPoints, addPoints, spendPoints,
  getShopItems, setShopItems,
  getActiveBoost, setBoost,
  getFlair, setFlair, clearFlair, getExpiredFlairs,
};
