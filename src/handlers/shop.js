const { EmbedBuilder, PermissionsBitField } = require('discord.js');

const VALID_TYPES = ['boost', 'nickname', 'shoutout', 'mysterybox', 'xp'];

const TYPE_LABELS = {
  boost: '⚡ XP Boost',
  nickname: '🏷️ Nickname Flair',
  shoutout: '📢 Shoutout',
  mysterybox: '🎁 Mystery Box',
  xp: '✨ XP Pack',
};

// Weighted reward table for Mystery Box. Each `apply` runs after the price
// has already been charged, and returns the text shown to the buyer.
const MYSTERY_REWARDS = [
  { weight: 40, apply: (db, guildId, userId) => { db.addXP(guildId, userId, 50); return '**+50 XP**'; } },
  { weight: 25, apply: (db, guildId, userId, price) => { const refund = Math.round(price * 0.5); db.addPoints(guildId, userId, refund); return `a **${refund} point** refund`; } },
  { weight: 20, apply: (db, guildId, userId) => { db.addXP(guildId, userId, 150); return '**+150 XP**'; } },
  { weight: 10, apply: (db, guildId, userId) => { db.addXP(guildId, userId, 300); db.addPoints(guildId, userId, 100); return '🎉 the jackpot: **+300 XP and +100 bonus points**'; } },
  { weight: 5, apply: () => 'unfortunately... nothing this time 😬' },
];

function rollMysteryReward() {
  const total = MYSTERY_REWARDS.reduce((sum, r) => sum + r.weight, 0);
  let roll = Math.random() * total;
  for (const reward of MYSTERY_REWARDS) {
    if (roll < reward.weight) return reward;
    roll -= reward.weight;
  }
  return MYSTERY_REWARDS[0];
}

module.exports = async (message, args, client) => {
  const config = client.config;
  const db = client.db;
  const guildId = message.guild.id;
  const sub = args[0]?.toLowerCase();

  const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    (config.ADMIN_ROLE_ID && message.member.roles.cache.has(config.ADMIN_ROLE_ID));

  // ─── /shop additem (Admin only) ───
  // args: [ 'additem', name, price, type, multiplier, durationMinutes, xpAmount ]
  if (sub === 'additem') {
    if (!isAdmin) return message.reply('❌ Only admins can add shop items.');

    const name = args[1];
    const price = parseInt(args[2], 10);
    const type = args[3]?.toLowerCase();
    const multiplier = args[4] ? parseFloat(args[4]) : null;
    const durationMinutes = args[5] ? parseInt(args[5], 10) : null;
    const xpAmount = args[6] ? parseInt(args[6], 10) : null;

    if (!name || !Number.isFinite(price) || price <= 0 || !VALID_TYPES.includes(type)) {
      return message.reply(`Usage: \`/shop additem <name> <price> <type>\` — type must be one of: ${VALID_TYPES.join(', ')}`);
    }

    const meta = {};
    if (type === 'boost') {
      if (!multiplier || multiplier <= 1 || !durationMinutes || durationMinutes <= 0) {
        return message.reply('A **boost** item needs a multiplier > 1 and a duration in minutes, e.g. `/shop additem "2x XP Hour" 300 boost multiplier:2 duration_minutes:60`.');
      }
      meta.multiplier = multiplier;
      meta.durationMinutes = durationMinutes;
    } else if (type === 'nickname') {
      if (!durationMinutes || durationMinutes <= 0) {
        return message.reply('A **nickname** flair item needs a duration in minutes, e.g. `/shop additem "Flair (24h)" 150 nickname duration_minutes:1440`.');
      }
      meta.durationMinutes = durationMinutes;
    } else if (type === 'xp') {
      if (!xpAmount || xpAmount <= 0) {
        return message.reply('An **xp** item needs an xp_amount, e.g. `/shop additem "XP Pack" 400 xp xp_amount:200`.');
      }
      meta.xpAmount = xpAmount;
    }
    // shoutout / mysterybox need no extra meta

    const items = db.getShopItems(guildId);
    if (items.some(i => i.name.toLowerCase() === name.toLowerCase())) {
      return message.reply(`❌ An item named **${name}** already exists. Remove it first if you want to replace it.`);
    }

    items.push({ id: Date.now().toString(36), name, price, type, meta });
    db.setShopItems(guildId, items);

    return message.reply(`✅ Added **${name}** (${TYPE_LABELS[type]}) to the shop for **${price}** points.`);
  }

  // ─── /shop removeitem <name> (Admin only) ───
  if (sub === 'removeitem') {
    if (!isAdmin) return message.reply('❌ Only admins can remove shop items.');

    const name = args[1];
    if (!name) return message.reply('Usage: `/shop removeitem <name>`');

    const items = db.getShopItems(guildId);
    const filtered = items.filter(i => i.name.toLowerCase() !== name.toLowerCase());
    if (filtered.length === items.length) {
      return message.reply(`❌ No shop item named **${name}** found.`);
    }
    db.setShopItems(guildId, filtered);
    return message.reply(`✅ Removed **${name}** from the shop.`);
  }

  // ─── /shop buy <name> [text] ───
  if (sub === 'buy') {
    const name = args[1];
    const text = args[2] || null; // used by nickname flair + shoutout
    if (!name) return message.reply('Usage: `/shop buy <name>` — see `/shop view` for what\'s available.');

    const items = db.getShopItems(guildId);
    const item = items.find(i => i.name.toLowerCase() === name.toLowerCase());
    if (!item) return message.reply(`❌ No shop item named **${name}**. Check \`/shop view\` for the exact name.`);

    if (item.type === 'nickname' && !text) {
      return message.reply('That item needs flair text — e.g. `/shop buy item:"Flair (24h)" text:"🔥 Pro"`.');
    }
    if (item.type === 'shoutout' && !text) {
      return message.reply('That item needs a message — e.g. `/shop buy item:Shoutout text:"GG tonight everyone!"`.');
    }

    const result = db.spendPoints(guildId, message.author.id, item.price);
    if (!result.success) {
      return message.reply(`❌ Not enough points — **${item.name}** costs **${item.price}**, you have **${result.balance}**.`);
    }

    // ─── Apply the effect per type ───
    if (item.type === 'boost') {
      db.setBoost(guildId, message.author.id, item.meta.multiplier, item.meta.durationMinutes);
      return message.reply(`⚡ **${item.name}** active! **${item.meta.multiplier}x** XP for the next **${item.meta.durationMinutes} minutes**. Balance: **${result.balance}**.`);
    }

    if (item.type === 'nickname') {
      const flairText = text.slice(0, 20); // keep nicknames sane
      const member = message.member;
      // Strip any currently-active flair first so re-buying doesn't stack prefixes.
      const existingFlair = db.getFlair(guildId, message.author.id);
      let base = member.nickname || member.user.username;
      if (existingFlair && base.startsWith(`${existingFlair.flair} `)) {
        base = base.slice(existingFlair.flair.length + 1);
      }
      const newNickname = `${flairText} ${base}`.slice(0, 32);
      const applied = await member.setNickname(newNickname).catch(() => null);
      if (!applied) {
        db.addPoints(guildId, message.author.id, item.price); // refund
        return message.reply(
          `❌ Couldn't set your nickname — refunded your points. Make sure my role has **Manage Nicknames** and sits above your roles in Server Settings → Roles.`
        );
      }
      db.setFlair(guildId, message.author.id, flairText, item.meta.durationMinutes);
      return message.reply(`🏷️ Flair **${flairText}** applied for **${item.meta.durationMinutes} minutes**. Balance: **${result.balance}**.`);
    }

    if (item.type === 'shoutout') {
      const channelId = config.WRAPPED_CHANNEL_ID || config.DASHBOARD_CHANNEL_ID;
      const channel = channelId ? message.guild.channels.cache.get(channelId) : message.channel;
      const embed = new EmbedBuilder()
        .setColor(config.COLORS.shop)
        .setTitle('📢 Shoutout')
        .setDescription(text.slice(0, 500))
        .setFooter({ text: `— ${message.author.username}` })
        .setTimestamp();
      await (channel || message.channel).send({ embeds: [embed] }).catch(() => {});
      return message.reply(`📢 Shoutout posted! Balance: **${result.balance}**.`);
    }

    if (item.type === 'xp') {
      const xpResult = db.addXP(guildId, message.author.id, item.meta.xpAmount);
      const levelNote = xpResult.leveledUp ? ` 🎉 You leveled up to **${xpResult.level}**!` : '';
      return message.reply(`✨ **+${item.meta.xpAmount} XP** added.${levelNote} Balance: **${result.balance}**.`);
    }

    if (item.type === 'mysterybox') {
      const reward = rollMysteryReward();
      const outcome = reward.apply(db, guildId, message.author.id, item.price);
      return message.reply(`🎁 You opened **${item.name}** and got: ${outcome}! Balance: **${result.balance}**.`);
    }

    // Should never happen given VALID_TYPES, but refund just in case.
    db.addPoints(guildId, message.author.id, item.price);
    return message.reply('❌ Unknown item type — refunded your points.');
  }

  // ─── /shop view (default) ───
  const items = db.getShopItems(guildId);
  const balance = db.getPoints(guildId, message.author.id);

  const embed = new EmbedBuilder()
    .setColor(config.COLORS.shop)
    .setTitle('🛒 Points Shop')
    .setDescription(`You have **${balance}** points. Earn more by leveling up (+${config.POINTS_PER_LEVEL_UP} per level).`)
    .setFooter({ text: 'Buy with /shop buy <name>' });

  if (items.length === 0) {
    embed.addFields({ name: 'No items yet', value: 'An admin can add one with `/shop additem`.' });
  } else {
    for (const item of items) {
      let detail;
      if (item.type === 'boost') detail = `${item.meta.multiplier}x XP for ${item.meta.durationMinutes}m`;
      else if (item.type === 'nickname') detail = `Custom flair for ${item.meta.durationMinutes}m — needs \`text\``;
      else if (item.type === 'shoutout') detail = 'Posts your message — needs `text`';
      else if (item.type === 'xp') detail = `+${item.meta.xpAmount} XP instantly`;
      else if (item.type === 'mysterybox') detail = 'Random reward — could be XP, points, or nothing!';

      embed.addFields({
        name: `${TYPE_LABELS[item.type]} — ${item.name} (${item.price} pts)`,
        value: detail,
        inline: false,
      });
    }
  }

  return message.reply({ embeds: [embed] });
};
