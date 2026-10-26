// Handler registry — returns handler or null
const handlers = ['rank', 'leaderboard', 'team', 'dashboard', 'setchannel', 'voicestats', 'help', 'soundboard'];

// Commands whose name differs from their handler file (all three soundboard
// commands share handlers/soundboard.js).
const aliases = {
  'soundboard-block': 'soundboard',
  'soundboard-unblock': 'soundboard',
  'soundboard-status': 'soundboard',
};

module.exports = function getHandler(command) {
  const file = aliases[command] || command;
  if (!handlers.includes(file)) return null;
  try { return require(`./${file}`); } catch { return null; }
};
