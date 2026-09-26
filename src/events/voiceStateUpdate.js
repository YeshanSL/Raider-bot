const { Events, EmbedBuilder, ActivityType } = require('discord.js');
const db = require('../database');

// Best-effort read of "what game are they currently playing", used to tag
// voice sessions for the weekly Wrapped recap. Returns null if nothing/not
// visible (requires the Presence intent to be enabled — see index.js).
function currentGame(member) {
  const activity = member?.presence?.activities?.find(a => a.type === ActivityType.Playing);
  return activity?.name || null;
}

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

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
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
      const result = db.endVoiceSession(guildId, userId, currentGame(newState.member));
      db.startVoiceSession(guildId, userId, newState.channelId);
      // Show summary for old channel if significant
      if (result && result.duration > 60) {
        await sendVoiceSummary(client, guildId, userId, oldState.channel, result, newState.member);
      }
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
        if (result.duration > 60) {
          await sendVoiceSummary(client, guildId, userId, oldState.channel, result, oldState.member);
        }
      }
    }
  },
};

async function sendVoiceSummary(client, guildId, userId, channel, result, member) {
  const config = client.config;
  const channelId = config.VOICE_LOG_CHANNEL_ID;
  if (!channelId) return;
  const logChannel = client.guilds.cache.get(guildId)?.channels.cache.get(channelId);
  if (!logChannel) return;

  const membersInChannel = channel?.members?.size || 0;
  const xpEarned = Math.floor((result.duration / 60) * config.XP_PER_VOICE_MIN);

  const embed = new EmbedBuilder()
    .setColor(config.COLORS.voice)
    .setTitle('🎙️ Voice Session Summary')
    .setDescription(`${member} just left **${channel?.name || 'a voice channel'}**`)
    .addFields(
      { name: '⏱️ Time Spent', value: formatTime(result.duration), inline: true },
      { name: '👥 Members in Channel', value: `${membersInChannel + 1}`, inline: true },
      { name: '⚡ XP Earned', value: `+${xpEarned} XP`, inline: true },
      { name: '📅 Session', value: `<t:${Math.floor((Date.now() - result.duration * 1000) / 1000)}:t> → <t:${Math.floor(Date.now() / 1000)}:t>`, inline: false },
    )
    .setThumbnail(member?.user?.displayAvatarURL({ dynamic: true }) || null)
    .setFooter({ text: 'Raider Bot • Voice Tracker' })
    .setTimestamp();

  await logChannel.send({ embeds: [embed] }).catch(() => {});
}

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
