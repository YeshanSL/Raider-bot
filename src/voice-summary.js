const {
  ActivityType,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ThumbnailBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  escapeMarkdown,
} = require('discord.js');

// ─── Voice Session Summary ───
// A "session" is one voice channel's lifetime: it starts when the first
// person joins an empty channel and ends when the last person leaves. One
// summary message is posted when it ends, showing everyone who took part,
// how long each person stayed, and which games were played.
//
// Everything here is in-memory (like the per-user timers in database.js), so
// a session that is still running when the bot restarts is simply not
// summarised.

// ─── Look & feel — tweak these freely ───
const TITLE = 'Voice Session Summary';
const TAGLINE = 'Another great session with the crew!';
const FOOTER = 'Thanks for being part of this voice session!';
const MAX_MEMBERS_SHOWN = 8;
const MAX_GAMES_SHOWN = 6;
const MIN_GAME_SECONDS = 30; // ignore games seen for less than this

// Swap any of these for a custom server emoji, e.g. '<:mic:123456789012345678>'
const EMOJI = {
  mic: '🎙️',
  clock: '🕐',
  people: '👥',
  calendar: '🗓️',
  hourglass: '⏳',
  members: '👥',
  games: '🎮',
  star: '⭐',
  heart: '💜',
};
// Coloured "bars" shown at the start of each row (cycled in order)
const MEMBER_BARS = ['🟦', '⬜', '🟪', '🟩', '🟨', '🟧', '🟥', '🟫'];
const GAME_BARS = ['🟩', '🟥', '🟧', '🟪', '🟦', '🟨'];

// ─── State ───
// key `${guildId}:${channelId}` → {
//   startedAt, peak, active: Set<userId>,
//   members: Map<userId, { name, seconds, joinedAt, lastSample, lastGame }>,
//   games: Map<gameName, seconds>
// }
const sessions = new Map();

// Best-effort read of "what game are they currently playing". Returns null if
// nothing/not visible (needs the Presence intent — see index.js).
function currentGame(member) {
  const activity = member?.presence?.activities?.find(a => a.type === ActivityType.Playing);
  return activity?.name || null;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = n => String(n).padStart(2, '0');
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

// Adds the time since the last check to whatever game was being played then.
function sampleEntry(session, entry, now, gameNow) {
  if (entry.lastGame) {
    const secs = (now - entry.lastSample) / 1000;
    session.games.set(entry.lastGame, (session.games.get(entry.lastGame) || 0) + secs);
  }
  entry.lastSample = now;
  entry.lastGame = gameNow;
}

// ─── Tracking ───
function join(guildId, channelId, member) {
  if (!member) return;
  const key = `${guildId}:${channelId}`;
  const now = Date.now();

  let session = sessions.get(key);
  if (!session) {
    session = { startedAt: now, peak: 0, active: new Set(), members: new Map(), games: new Map() };
    sessions.set(key, session);
  }

  let entry = session.members.get(member.id);
  if (!entry) {
    entry = { name: member.displayName || member.user?.username || 'Unknown', seconds: 0 };
    session.members.set(member.id, entry);
  }
  entry.name = member.displayName || entry.name;
  entry.joinedAt = now;
  entry.lastSample = now;
  entry.lastGame = currentGame(member);

  session.active.add(member.id);
  session.peak = Math.max(session.peak, session.active.size);
}

// Returns the finished session (with endedAt) when this was the last person
// to leave the channel, otherwise null.
function leave(guildId, channelId, member) {
  if (!member) return null;
  const key = `${guildId}:${channelId}`;
  const session = sessions.get(key);
  const entry = session?.members.get(member.id);
  if (!session || !entry || !session.active.has(member.id)) return null;

  const now = Date.now();
  sampleEntry(session, entry, now, null);
  entry.seconds += (now - entry.joinedAt) / 1000;
  entry.name = member.displayName || entry.name;
  session.active.delete(member.id);

  if (session.active.size > 0) return null;

  sessions.delete(key);
  session.endedAt = now;
  return session;
}

// Called every minute so the games being played are recorded as they happen,
// not just whatever someone happens to be playing when they leave.
function sampleGames(client) {
  const now = Date.now();
  for (const [key, session] of sessions) {
    const guild = client.guilds.cache.get(key.split(':')[0]);
    if (!guild) continue;
    for (const userId of session.active) {
      const entry = session.members.get(userId);
      sampleEntry(session, entry, now, currentGame(guild.members.cache.get(userId)));
    }
  }
}

// ─── Message ───
function buildMessage(session, config, thumbnailUrl) {
  const members = [...session.members.values()]
    .filter(m => m.seconds >= 1)
    .sort((a, b) => b.seconds - a.seconds);
  const games = [...session.games.entries()]
    .filter(([, secs]) => secs >= MIN_GAME_SECONDS)
    .sort((a, b) => b[1] - a[1]);

  const totalSeconds = members.reduce((sum, m) => sum + m.seconds, 0);
  const startTs = Math.floor(session.startedAt / 1000);
  const endTs = Math.floor(session.endedAt / 1000);

  // Header — title + tagline with the image on the right
  const header = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${EMOJI.mic} ${TITLE}\n*${TAGLINE}*`),
    )
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl));

  // Stats
  const stats = [
    `${EMOJI.clock} **Total VC Time**`,
    `# ${formatTime(Math.round(totalSeconds))}`,
    `*(${Math.floor(totalSeconds / 60)} min)*`,
    '',
    `${EMOJI.people} **Total Member Count:** ${session.members.size}  *(Peak: ${session.peak})*`,
    `${EMOJI.calendar} **Time:** <t:${startTs}:t> → <t:${endTs}:t>  *(<t:${startTs}:D>)*`,
  ].join('\n');

  // Members & Their Time
  const memberRows = members.slice(0, MAX_MEMBERS_SHOWN).map((m, i) =>
    `${MEMBER_BARS[i % MEMBER_BARS.length]} **${escapeMarkdown(m.name).slice(0, 28)}** — ${EMOJI.hourglass} ${formatTime(Math.round(m.seconds))}`);
  if (members.length > MAX_MEMBERS_SHOWN) memberRows.push(`*…and ${members.length - MAX_MEMBERS_SHOWN} more*`);
  const membersText = `### ${EMOJI.members} Members & Their Time\n${memberRows.join('\n')}`;

  // Games Played
  const gameRows = games.slice(0, MAX_GAMES_SHOWN).map(([name, secs], i) =>
    `${GAME_BARS[i % GAME_BARS.length]} **${escapeMarkdown(name).slice(0, 40)}** — ${EMOJI.hourglass} ${formatTime(Math.round(secs))}`);
  if (games.length > MAX_GAMES_SHOWN) gameRows.push(`*…and ${games.length - MAX_GAMES_SHOWN} more*`);
  const gamesText = `### ${EMOJI.games} Games Played\n${gameRows.join('\n')}`;

  const separator = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

  const container = new ContainerBuilder()
    .setAccentColor(config.COLORS.voiceSummary)
    .addSectionComponents(header)
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(stats))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(membersText));

  if (games.length > 0) {
    container
      .addSeparatorComponents(separator())
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(gamesText));
  }

  container
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# ${EMOJI.star} *${FOOTER}* ${EMOJI.heart}`),
    );

  return { flags: MessageFlags.IsComponentsV2, components: [container], allowedMentions: { parse: [] } };
}

// Posts the summary for a finished session to the voice log channel.
async function send(client, guildId, session) {
  const config = client.config;
  const totalSeconds = [...session.members.values()].reduce((sum, m) => sum + m.seconds, 0);
  if (totalSeconds < config.VOICE_SUMMARY_MIN_SECONDS) return;

  const guild = client.guilds.cache.get(guildId);
  const logChannel = config.VOICE_LOG_CHANNEL_ID && guild?.channels.cache.get(config.VOICE_LOG_CHANNEL_ID);
  if (!logChannel) return;

  const thumbnailUrl = config.VOICE_SUMMARY_IMAGE_URL
    || guild.iconURL({ size: 256, extension: 'png' })
    || client.user.displayAvatarURL({ size: 256, extension: 'png' });

  await logChannel.send(buildMessage(session, config, thumbnailUrl)).catch(err => {
    console.error('⚠️ Could not send voice session summary:', err.message);
  });
}

module.exports = { currentGame, join, leave, sampleGames, buildMessage, send, formatTime };
