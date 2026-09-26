<<<<<<< HEAD
# ⚔️ Raider Bot

A full-featured Discord bot for gaming communities — leveling, voice tracking, FPS team mode, welcome messages, and more.

---

## 🚀 Setup Guide

### 1. Create Your Bot on Discord

1. Go to https://discord.com/developers/applications
2. Click **New Application** → name it **Raider**
3. Go to **Bot** tab → click **Add Bot**
4. Under **Privileged Gateway Intents**, enable:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
   - ✅ Presence Intent
5. Copy your **Bot Token** (keep it secret!)

### 2. Invite the Bot to Your Server

Use this URL (replace `CLIENT_ID` with your Application ID):
```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=8&scope=bot%20applications.commands
```
Permission 8 = Administrator (needed for team mode to move members and manage channels).

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `DISCORD_TOKEN` — your bot token
- Channel IDs for each feature
- Role IDs for boost reward and admin control

**To get IDs:** Enable Developer Mode in Discord (Settings → Advanced → Developer Mode), then right-click any channel/role → Copy ID.

### 4. Install & Run

```bash
npm install
npm start
```

---

## 🎮 Features

### ✅ Rotating Status Tag
The bot's status rotates every **40 seconds** automatically showing different tags like:
- ⚔️ Raider | Ready to Battle
- 🏆 Raider | Rank Up Now
- 🔥 Raider | Drop Zone Active

### ✅ Welcome Message
Sent to `WELCOME_CHANNEL_ID` when a new member joins.  
Change it anytime: `!raider setchannel welcome #your-channel`

### ✅ Boost Thank You
Sent when someone boosts the server. Optionally grants a boost role.  
Change it: `!raider setchannel boost #your-channel`

### ✅ Chat Level Up
Members earn XP for every message (1 min cooldown).  
Level up → announce in level-up channel.  
Change it: `!raider setchannel levelup #your-channel`

### ✅ Voice Level Up
Members earn XP every minute in a voice channel.  
Leaving voice → session summary posted.  
Change it: `!raider setchannel voice #your-channel`

### ✅ Voice Session Summary
After leaving VC, shows:
- ⏱️ Time spent
- 👥 Members in channel
- ⚡ XP earned

### ✅ Dashboard (`!raider dashboard`)
Interactive dashboard with buttons for rank, leaderboard, and team status.

### ✅ FPS Team Mode (Admin Only)
Split one VC into two isolated teams — like FreeFire squad audio grouping.

```
!raider team setup <vc-channel-id>   — Set the voice channel
!raider team assign @Player1 1       — Put Player1 in Team 1
!raider team assign @Player2 2       — Put Player2 in Team 2
!raider team on                      — ACTIVATE isolation
!raider team off                     — Merge back together
!raider team status                  — See current teams
```

**How it works:**  
When activated, the bot creates two private sub-channels under a "RAIDER TEAMS" category, moves each team to their channel, and restricts audio so only teammates can hear each other. When deactivated, everyone gets moved back and temp channels are deleted.

---

## 📋 All Commands

| Command | Description |
|---|---|
| `!raider rank [@user]` | View rank & XP |
| `!raider leaderboard` | Top 10 members |
| `!raider voicestats [@user]` | Voice session history |
| `!raider dashboard` | Interactive stats panel |
| `!raider team ...` | FPS team mode (admin) |
| `!raider setchannel <type> #ch` | Configure channels (admin) |
| `!raider help` | Full command list |

---

## 📁 File Structure

```
raider-bot/
├── index.js              # Entry point, status rotation
├── .env                  # Your secrets (never share this)
├── src/
│   ├── config.js         # Colors, XP rates, channel IDs
│   ├── database.js       # JSON-based data storage
│   ├── events/
│   │   ├── ready.js
│   │   ├── guildMemberAdd.js    # Welcome
│   │   ├── guildMemberUpdate.js # Boost
│   │   ├── messageCreate.js     # Chat XP + commands
│   │   ├── voiceStateUpdate.js  # Voice XP + session log
│   │   └── voiceLevelUp.js
│   └── handlers/
│       ├── rank.js
│       ├── leaderboard.js
│       ├── team.js        # FPS team isolation
│       ├── dashboard.js
│       ├── setchannel.js
│       ├── voicestats.js
│       └── help.js
└── data/                  # Auto-created JSON storage
    ├── xp.json
    ├── sessions.json
    └── teams.json
```

---

## 🔧 Hosting

For 24/7 uptime, host on:
- **Railway** (free tier available) — https://railway.app
- **Render** — https://render.com
- **VPS** (DigitalOcean, Hetzner) with `pm2 start index.js`

---

Built with ❤️ for the Raider squad.
=======
# Raider-bot
>>>>>>> bfd67cfdee34f634321cf1b6971d1d79b966ba01
