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
  XP_PER_VOICE_MIN: 5,     // XP per minute in voice
  XP_COOLDOWN_MS: 60000,   // 1 min cooldown between msg XP

  // ─── Boost reward role ───
  BOOST_ROLE_ID: process.env.BOOST_ROLE_ID || '',

  // ─── Admin role that can control team mode ───
  ADMIN_ROLE_ID: process.env.ADMIN_ROLE_ID || '',

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
  },
};
