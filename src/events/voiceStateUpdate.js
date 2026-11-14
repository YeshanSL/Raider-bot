const { Events, EmbedBuilder } = require('discord.js');
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
    const config = client.config;
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
    if (leftChannel) {
      const result = db.endVoiceSession(guildId, userId, currentGame(oldState.member));
      if (result && result.duration > 10) {
        const voiceXPGained = Math.floor((result.duration / 60) * config.XP_PER_VOICE_MIN);
        if (voiceXPGained > 0) {
          const xpResult = db.addXP(guildId, userId, voiceXPGained);
          if (xpResult.leveledUp) {
            await sendVoiceLevelUp(client, guildId, userId, xpResult.level, oldState.member);
          }
        }
      }
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

async function sendVoiceLevelUp(client, guildId, userId, newLevel, member) {
  const config = client.config;
  const db = require('../database');
  const channelId = config.LEVEL_UP_CHANNEL_ID || config.VOICE_LOG_CHANNEL_ID;
  if (!channelId) return;
  const channel = client.guilds.cache.get(guildId)?.channels.cache.get(channelId);
  if (!channel) return;

  const xpData = db.getXP(guildId, userId);

  const embed = new EmbedBuilder()
    .setColor(config.COLORS.levelup)
    .setTitle('🎙️ Voice Level Up!')
    .setDescription(`${member} leveled up from voice activity! 🎉`)
    .addFields(
      { name: '🏆 New Level', value: `**Level ${newLevel}**`, inline: true },
      { name: '⚡ XP', value: `${xpData.xp} / ${db.xpForLevel(newLevel)} XP`, inline: true },
    )
    .setThumbnail(member?.user?.displayAvatarURL({ dynamic: true }) || null)
    .setFooter({ text: 'Stay in voice to keep leveling!' })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});
}
