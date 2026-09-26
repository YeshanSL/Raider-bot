// Handler registry — returns handler or null
const handlers = ['rank', 'leaderboard', 'team', 'dashboard', 'setchannel', 'voicestats', 'help'];

module.exports = function getHandler(command) {
  if (!handlers.includes(command)) return null;
  try { return require(`./${command}`); } catch { return null; }
};
