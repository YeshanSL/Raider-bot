const { Events } = require('discord.js');
const db = require('../database');
const voiceSummary = require('../voice-summary');

// Best-effort "what game are they currently playing" (needs the Presence
// intent — see index.js). Also used to tag sessions for the weekly Wrapped.
const { currentGame } = voiceSummary;

// Prepends/removes the AFK prefix on a member's nickname when they enter or
// leave the server's configured AFK voice channel (Server Settings →
// Overview → Afk Channel). No-op if the server hasn't set one.
async function syncAfkNickname(oldState, newState, client) {
  const guild = newState.guild || oldState.guild;
  const afkChannelId = guild?.afkChannelId;
  if (!afkChannelId) return;

  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const prefix = client.config.AFK_PREFIX;
  const enteredAfk = newState.channelId === afkChannelId && oldState.channelId !== afkChannelId;
  const leftAfk = oldState.channelId === afkChannelId && newState.channelId !== afkChannelId;

  if (enteredAfk) {
    const current = member.nickname || member.user.username;
    if (!current.startsWith(prefix)) {
      await member.setNickname(`${prefix}${current}`.slice(0, 32)).catch(() => {});
    }
  } else if (leftAfk) {
    if (member.nickname?.startsWith(prefix)) {
      const restored = member.nickname.slice(prefix.length);
      await member.setNickname(restored || null).catch(() => {});
    }
  }
}

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState, client) {
    const userId = newState.member?.id || oldState.member?.id;
    const guildId = newState.guild?.id || oldState.guild?.id;
    if (!userId || !guildId) return;
    if (newState.member?.user?.bot) return;

    await syncAfkNickname(oldState, newState, client);

    const joinedChannel = !oldState.channelId && newState.channelId;
    const leftChannel = oldState.channelId && !newState.channelId;
    const switchedChannel = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;

    // ─── Join VC ───
    if (joinedChannel) {
      db.startVoiceSession(guildId, userId, newState.channelId);
    }

    // ─── Switch VC ───
    if (switchedChannel) {
      // End old, start new (keeps time tracking)
      db.endVoiceSession(guildId, userId, currentGame(newState.member));
      db.startVoiceSession(guildId, userId, newState.channelId);
    }

    // ─── Leave VC ───
    // Voice XP is awarded only by the 1-minute tick (database.tickVoiceXP),
    // so nothing extra is paid out here.
    if (leftChannel) {
      db.endVoiceSession(guildId, userId, currentGame(oldState.member));
    }

    // ─── Session summary ───
    // One summary per channel session, posted when the last person leaves.
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      const finished = voiceSummary.leave(guildId, oldState.channelId, oldState.member);
      if (finished) await voiceSummary.send(client, guildId, finished);
    }
    if (newState.channelId && newState.channelId !== oldState.channelId
        && newState.channelId !== newState.guild.afkChannelId) {
      voiceSummary.join(guildId, newState.channelId, newState.member);
    }
  },
};

