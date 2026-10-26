const {
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
  OverwriteType,
  MessageFlags,
} = require('discord.js');

// Handles all three soundboard commands:
//   /soundboard-block   @member [channel1..channel5]
//   /soundboard-unblock @member [channel1..channel5]
//   /soundboard-status  @member
//
// How it works: Discord has a per-channel "Use Soundboard" permission. We add a
// member-specific permission overwrite on each voice channel that DENIES it.
// A member overwrite beats any role-based allow, so the member simply can't use
// the soundboard in that channel (everything else about them is untouched).
//
// Exception: the server owner and anyone with the Administrator permission
// bypass every channel overwrite, so they can't be restricted this way.

const FLAG = PermissionsBitField.Flags.UseSoundboard;
const MAX_CHANNEL_OPTIONS = 5; // must match the number of channelN options in commands.js

function isAdmin(member, config) {
  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    (config.ADMIN_ROLE_ID && member.roles.cache.has(config.ADMIN_ROLE_ID))
  );
}

function getVoiceChannels(guild) {
  return [...guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).values()];
}

// Adds (block = true) or removes (block = false) the soundboard deny for one
// member on one channel. Returns 'changed' or 'unchanged'. Throws on API errors.
async function applyToChannel(channel, userId, block, reason) {
  const existing = channel.permissionOverwrites.cache.get(userId);
  const alreadyDenied = !!existing && (existing.deny.bitfield & FLAG) === FLAG;

  if (block) {
    if (alreadyDenied) return 'unchanged';
    await channel.permissionOverwrites.edit(userId, { UseSoundboard: false }, { type: OverwriteType.Member, reason });
    return 'changed';
  }

  if (!alreadyDenied) return 'unchanged';
  // If removing our deny leaves the overwrite empty, delete it entirely so we
  // don't leave clutter behind. Otherwise just clear our one flag (keeps any
  // other overwrites on that member, e.g. team-mode Connect/Speak, intact).
  const remainingDeny = existing.deny.bitfield & ~FLAG;
  if (remainingDeny === 0n && existing.allow.bitfield === 0n) {
    await existing.delete(reason);
  } else {
    await channel.permissionOverwrites.edit(userId, { UseSoundboard: null }, { type: OverwriteType.Member, reason });
  }
  return 'changed';
}

// Runs applyToChannel over many channels, collecting results instead of
// stopping at the first failure.
async function applyToMany(channels, userId, block, reason) {
  const out = { changed: [], unchanged: [], failed: [] };
  for (const ch of channels) {
    try {
      const r = await applyToChannel(ch, userId, block, reason);
      out[r].push(ch);
    } catch (err) {
      out.failed.push({ channel: ch, error: err });
    }
  }
  return out;
}

function describeFailures(failed) {
  const shown = failed.slice(0, 5).map(({ channel, error }) => {
    const why = error?.code === 50013 ? 'missing permissions' : (error?.message || 'unknown error');
    return `• <#${channel.id}> — ${why}`;
  });
  const more = failed.length > 5 ? `\n…and ${failed.length - 5} more` : '';
  return `\n\n⚠️ Couldn't update ${failed.length} channel(s):\n${shown.join('\n')}${more}\n` +
    'My role needs **Manage Permissions** (and **Use Soundboard**) in those channels.';
}

function truncateList(items, max = 15) {
  if (!items.length) return 'None';
  const shown = items.slice(0, max).join(', ');
  return items.length > max ? `${shown} …and ${items.length - max} more` : shown;
}

const NO_PINGS = { parse: [] };

module.exports = async (message, args, client) => {
  const action = args[0]; // 'block' | 'unblock' | 'status'
  const interaction = message.interaction;
  const guild = message.guild;
  const db = client.db;

  if (!interaction) {
    return message.reply('❌ The soundboard commands are slash-commands only — type `/soundboard-block`.');
  }

  if (!isAdmin(message.member, client.config)) {
    return message.reply({ content: '❌ Only admins can manage soundboard restrictions.', flags: MessageFlags.Ephemeral });
  }

  const target = message.mentions.members.first();
  if (!target) {
    return message.reply({ content: "❌ I couldn't find that member in this server.", flags: MessageFlags.Ephemeral });
  }

  // ─── Safety checks (block / unblock only) ───
  if (action !== 'status') {
    if (target.id === client.user.id) {
      return message.reply({ content: "❌ I can't restrict myself.", flags: MessageFlags.Ephemeral });
    }
    if (action === 'block') {
      if (target.id === guild.ownerId || target.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return message.reply({
          content: '❌ The server owner and members with **Administrator** bypass channel permissions, so this restriction would have no effect on them.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const invokerIsOwner = message.author.id === guild.ownerId;
      if (!invokerIsOwner && target.roles.highest.position >= message.member.roles.highest.position) {
        return message.reply({
          content: "❌ You can't restrict someone whose highest role is equal to or above yours.",
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }

  // Updating many channels can take longer than Discord's 3 second window.
  await interaction.deferReply(action === 'status' ? { flags: MessageFlags.Ephemeral } : {});

  // Channels picked via the optional channel1..channel5 options (voice only).
  const selected = [];
  for (let i = 1; i <= MAX_CHANNEL_OPTIONS; i++) {
    const picked = interaction.options.getChannel(`channel${i}`);
    const ch = picked && guild.channels.cache.get(picked.id);
    if (ch && ch.type === ChannelType.GuildVoice && !selected.some(s => s.id === ch.id)) selected.push(ch);
  }

  const allVoice = getVoiceChannels(guild);

  // ─────────────── /soundboard-block ───────────────
  if (action === 'block') {
    const targets = selected.length ? selected : allVoice;
    if (!targets.length) return message.reply('❌ This server has no voice channels.');

    const reason = `Soundboard blocked by ${message.author.tag}`;
    const res = await applyToMany(targets, target.id, true, reason);
    const succeeded = [...res.changed, ...res.unchanged];

    if (succeeded.length) {
      const store = db.getSoundboardBlocks(guild.id);
      const rec = store[target.id] || { allVoice: false, channelIds: [] };
      if (selected.length) {
        for (const ch of succeeded) if (!rec.channelIds.includes(ch.id)) rec.channelIds.push(ch.id);
      } else {
        rec.allVoice = true; // also covers voice channels created later
      }
      rec.by = message.author.id;
      rec.at = Date.now();
      store[target.id] = rec;
      db.setSoundboardBlocks(guild.id, store);
    }

    const scope = selected.length ? `${succeeded.length} selected voice channel(s)` : 'all voice channels';
    let text = succeeded.length
      ? `🔇 **${target.displayName}** can no longer use the Soundboard in ${scope}.`
      : `❌ I couldn't restrict **${target.displayName}** in any channel.`;
    if (res.unchanged.length && succeeded.length) text += ` (${res.unchanged.length} already restricted)`;
    if (res.failed.length) text += describeFailures(res.failed);
    return message.reply({ content: text, allowedMentions: NO_PINGS });
  }

  // ─────────────── /soundboard-unblock ───────────────
  if (action === 'unblock') {
    // With no channels picked we sweep every voice channel; channels with no
    // restriction are skipped without touching the API.
    const targets = selected.length ? selected : allVoice;
    const reason = `Soundboard restored by ${message.author.tag}`;
    const res = await applyToMany(targets, target.id, false, reason);
    const okIds = new Set([...res.changed, ...res.unchanged].map(c => c.id));

    const store = db.getSoundboardBlocks(guild.id);
    const rec = store[target.id];
    if (rec) {
      if (selected.length) {
        // If the block covered "all voice channels", turn it into an explicit
        // list first so we can carve the unblocked channels out of it.
        const base = rec.allVoice ? allVoice.map(c => c.id) : rec.channelIds;
        rec.channelIds = base.filter(id => !okIds.has(id));
        rec.allVoice = false;
      } else {
        // Full unblock: keep a record only for channels we failed to clear.
        rec.channelIds = res.failed.map(f => f.channel.id);
        rec.allVoice = false;
      }
      if (rec.channelIds.length === 0) delete store[target.id];
      db.setSoundboardBlocks(guild.id, store);
    }

    let text;
    if (res.changed.length) {
      text = `🔊 **${target.displayName}**'s Soundboard access was restored in ${res.changed.length} voice channel(s).`;
    } else if (!res.failed.length) {
      text = `ℹ️ **${target.displayName}** had no soundboard restriction${selected.length ? ' in those channels' : ''}.`;
    } else {
      text = `❌ I couldn't restore **${target.displayName}**'s access.`;
    }
    if (res.failed.length) text += describeFailures(res.failed);
    return message.reply({ content: text, allowedMentions: NO_PINGS });
  }

  // ─────────────── /soundboard-status ───────────────
  if (action === 'status') {
    const rec = db.getSoundboardBlocks(guild.id)[target.id];
    const blocked = allVoice.filter(ch => {
      const ow = ch.permissionOverwrites.cache.get(target.id);
      return ow && (ow.deny.bitfield & FLAG) === FLAG;
    });
    const cannotUse = allVoice.filter(ch => !ch.permissionsFor(target).has(FLAG));
    const bypasses = target.id === guild.ownerId || target.permissions.has(PermissionsBitField.Flags.Administrator);

    const embed = new EmbedBuilder()
      .setColor(blocked.length ? client.config.COLORS.team : client.config.COLORS.voice)
      .setTitle('🔊 Soundboard Status')
      .setDescription(`${target}`)
      .addFields({
        name: 'Restriction',
        value: blocked.length ? '🔴 **Restricted**' : '🟢 **Not restricted**',
        inline: true,
      });

    if (blocked.length) {
      const scope = rec?.allVoice ? 'All voice channels' : 'Selected channels';
      embed.addFields(
        { name: 'Scope', value: `${scope} (${blocked.length}/${allVoice.length} voice channels)`, inline: true },
        { name: 'Blocked in', value: truncateList(blocked.map(c => `<#${c.id}>`)) },
      );
    }
    if (rec?.by) {
      embed.addFields({
        name: 'Set by',
        value: `<@${rec.by}>${rec.at ? ` • <t:${Math.floor(rec.at / 1000)}:R>` : ''}`,
        inline: true,
      });
    }
    if (blocked.length && !rec) {
      embed.addFields({
        name: 'Note',
        value: 'This restriction was set manually in channel settings (not through the bot).',
      });
    }
    // Soundboard might be unavailable for reasons other than our overwrite (role denies, etc.)
    const otherReason = cannotUse.filter(c => !blocked.some(b => b.id === c.id));
    if (otherReason.length) {
      embed.addFields({
        name: 'Also unable to use soundboard in',
        value: truncateList(otherReason.map(c => `<#${c.id}>`)) + '\n_(via role or channel permissions, not this bot)_',
      });
    }
    if (bypasses) {
      embed.addFields({
        name: 'Heads up',
        value: 'This member is the owner or has **Administrator**, which bypasses channel restrictions.',
      });
    }
    embed.setFooter({ text: 'Raider Bot • Soundboard Control' }).setTimestamp();

    return message.reply({ embeds: [embed], allowedMentions: NO_PINGS });
  }
};

module.exports.applyToChannel = applyToChannel;
