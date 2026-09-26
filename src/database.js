const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data');
const XP_FILE = path.join(DB_PATH, 'xp.json');
const VOICE_FILE = path.join(DB_PATH, 'voice.json');
const SESSIONS_FILE = path.join(DB_PATH, 'sessions.json');
const TEAM_FILE = path.join(DB_PATH, 'teams.json');
const WRAPPED_FILE = path.join(DB_PATH, 'wrapped_snapshot.json');

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
  const user = getXP(guildId, userId);
  user.xp += amount;
  let leveledUp = false;
  while (user.xp >= xpForLevel(user.level)) {
    user.xp -= xpForLevel(user.level);
    user.level += 1;
    leveledUp = true;
  }
  setXP(guildId, userId, user);
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

module.exports = {
  getXP, setXP, addXP, xpForLevel, totalXPEarned, getLeaderboard,
  startVoiceSession, endVoiceSession, getActiveSession,
  getActiveSessionsForChannel, getSessionsSince, tickVoiceXP,
  getTeams, setTeams,
  getWrappedSnapshot, setWrappedSnapshot,
};
