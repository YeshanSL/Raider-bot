module.exports = {
  // ─── Channel IDs (fill these in after creating channels) ───
  WELCOME_CHANNEL_ID: process.env.WELCOME_CHANNEL_ID || '',
  BOOST_CHANNEL_ID: process.env.BOOST_CHANNEL_ID || '',
  LEVEL_UP_CHANNEL_ID: process.env.LEVEL_UP_CHANNEL_ID || '',
  VOICE_LOG_CHANNEL_ID: process.env.VOICE_LOG_CHANNEL_ID || '',
  DASHBOARD_CHANNEL_ID: process.env.DASHBOARD_CHANNEL_ID || '',

  // ─── XP Settings ───
  XP_PER_MSG: 15,          // XP per message
  XP_PER_VOICE_MIN: 5,     // XP per minute in voice
  XP_COOLDOWN_MS: 60000,   // 1 min cooldown between msg XP

  // ─── Boost reward role ───
  BOOST_ROLE_ID: process.env.BOOST_ROLE_ID || '',

  // ─── Admin role that can control team mode ───
  ADMIN_ROLE_ID: process.env.ADMIN_ROLE_ID || '',

  // ─── Colors ───
  COLORS: {
    welcome: 0x5865F2,
    boost: 0xFF73FA,
    levelup: 0xFFD700,
    voice: 0x57F287,
    team: 0xED4245,
    info: 0x5865F2,
  },
};
