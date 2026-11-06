module.exports = {
  // ─── Channel IDs (fill these in after creating channels) ───
  WELCOME_CHANNEL_ID: process.env.WELCOME_CHANNEL_ID || '',
  BOOST_CHANNEL_ID: process.env.BOOST_CHANNEL_ID || '',
  LEVEL_UP_CHANNEL_ID: process.env.LEVEL_UP_CHANNEL_ID || '',
  VOICE_LOG_CHANNEL_ID: process.env.VOICE_LOG_CHANNEL_ID || '',
  DASHBOARD_CHANNEL_ID: process.env.DASHBOARD_CHANNEL_ID || '',
  // Where the weekly Wrapped recap gets posted. Falls back to the
  // dashboard channel if you don't set this one separately.
  WRAPPED_CHANNEL_ID: process.env.WRAPPED_CHANNEL_ID || '',

  // ─── XP Settings ───
  XP_PER_MSG: 15,          // XP per message
  XP_PER_VOICE_MIN: 8,     // Starting XP per minute in voice (see sitting bonus below)
  XP_COOLDOWN_MS: 60000,   // 1 min cooldown between msg XP

  // ─── Voice sitting bonus ───
  // Voice XP per minute doubles every time ONE continuous sitting doubles in
  // length, with no upper limit. With the defaults:
  //   0–9 min = 8 XP/min, 10–19 = 16, 20–39 = 32, 40–79 = 64,
  //   80–159 = 128, 160–319 = 256, 320–639 = 512, ... and so on.
  // The first doubling happens at this many minutes into the sitting:
  VOICE_SITTING_FIRST_DOUBLE_MIN: 10,
  // Switching channels never breaks a sitting. Leaving and rejoining within
  // this window (e.g. a dropped connection) doesn't break it either.
  VOICE_SITTING_GRACE_MS: 2 * 60 * 1000,

  // ─── Boost reward role ───
  BOOST_ROLE_ID: process.env.BOOST_ROLE_ID || '',

  // ─── Admin role that can control team mode ───
  ADMIN_ROLE_ID: process.env.ADMIN_ROLE_ID || '',

  // ─── Points shop ───
  // How many points a member earns per level gained (from chat OR voice XP).
  // Spending points on shop items never touches their actual level/XP —
  // points are a separate balance, so the leaderboard stays untouched.
  POINTS_PER_LEVEL_UP: 10,

  // ─── AFK nickname prefix ───
  // Prepended to a member's nickname while they're sitting in the server's
  // configured AFK voice channel (Server Settings → Overview → Afk Channel).
  AFK_PREFIX: '💤 ',

  // ─── Colors ───
  COLORS: {
    welcome: 0x5865F2,
    boost: 0xFF73FA,
    levelup: 0xFFD700,
    voice: 0x57F287,
    team: 0xED4245,
    info: 0x5865F2,
    wrapped: 0x1DB954,
    shop: 0xF1C40F,
  },
};
