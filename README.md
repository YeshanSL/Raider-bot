# ⚔️ Raider Bot

A full-featured Discord bot for gaming communities — leveling, voice tracking, a points shop, FPS team mode, soundboard control, a weekly recap, and more. Data is stored in MongoDB Atlas.

For the full technical details (architecture, data storage, deployment, known issues) see **[DOCUMENTATION.md](DOCUMENTATION.md)**.

---

## 🚀 Setup Guide

### 1. Create Your Bot on Discord

1. Go to https://discord.com/developers/applications
2. Click **New Application** → name it **Raider**
3. Go to the **Bot** tab and copy your **Bot Token** (keep it secret!)
4. Under **Privileged Gateway Intents**, enable:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
   - ✅ Presence Intent

### 2. Invite the Bot to Your Server

Use this URL (replace `CLIENT_ID` with your Application ID):
```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=8&scope=bot%20applications.commands
```
Permission 8 = Administrator (needed for team mode, soundboard control and nickname changes). Then drag the bot's role **above** every member role in **Server Settings → Roles**.

### 3. Set Up MongoDB Atlas

1. Create a cluster and a database user.
2. Under **Network Access**, allow `0.0.0.0/0` (Render has no fixed IP).
3. Copy the Node.js connection string from **Connect → Drivers** and put your password in it.

The bot's data lives in the **`raider`** database. Don't change the database name. See *Database: do's and don'ts* in [DOCUMENTATION.md](DOCUMENTATION.md#96-database-dos-and-donts).

### 4. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `DISCORD_TOKEN` — your bot token
- `CLIENT_ID` — your Application ID
- `MONGODB_URI` — your Atlas connection string (`MONGODB_DB` stays `raider`)
- Channel IDs for each feature, and role IDs for the boost reward and admin control

**To get IDs:** enable Developer Mode in Discord (Settings → Advanced → Developer Mode), then right-click any channel/role/server → Copy ID.

### 5. Install & Run

```bash
npm install
npm run deploy   # register slash commands (first time, and whenever commands change)
npm start
```

You should see `🍃 Connected to MongoDB and loaded data` in the log. If it's missing, the bot isn't saving anything.

---

## 🎮 Features

### ✅ Leveling
Members earn **15 XP** per chat message (1 min cooldown) and **8 XP per minute** in voice. The voice rate doubles every time one continuous sitting doubles in length: 16 XP/min at 10 min, 32 at 20, 64 at 40, 128 at 80, and so on with no limit. Switching channels or a reconnect within 2 minutes doesn't break a sitting. Level-ups are announced in the level-up channel, and every level gained also awards **10 points**.

### ✅ Voice Tracking
Every voice session is logged. Leaving a session longer than a minute posts a **Voice Session Summary** (time spent, members in channel, XP earned). `/voicestats` shows totals, averages and, while you're in voice, your current sitting and XP rate.

### ✅ Points Shop
Spend points on XP boosts, temporary nickname flair, shoutouts, instant XP packs and mystery boxes. Admins add the items. Points are separate from XP, so spending them never lowers your level.

### ✅ Weekly Wrapped
Every **Sunday at 12:00 PM IST** the bot posts a recap: most active member, biggest XP gain, best duo, most played game, and a squad summary.

### ✅ FPS Team Mode (Admin Only)
Splits players into two private team voice channels so each team only hears itself. Admins can assign teams, or post a **self-select panel** with Team 1 / Team 2 / Reset buttons.

```
/team setup channel:#game-vc      — Set the "home" voice channel
/team assign user:@Player team:1  — Put a player in Team 1 or 2
/team on  /  /team off            — Activate / merge back
/team panel action:on|off         — Self-select button panel
/team status                      — See current teams
```

### ✅ Soundboard Control (Admin Only)
Stop a specific member from using the **Soundboard** and **external sounds** in voice channels.

```
/soundboard-block @member [channel1..channel5]    — Block (every voice channel if none picked)
/soundboard-unblock @member [channel1..channel5]  — Restore access
/soundboard-status @member                        — Check where they're restricted
```

Blocks on "all voice channels" also apply to voice channels created later. The server owner and Administrators bypass channel permissions, so they can't be restricted.

### ✅ Server Events
- **Welcome message** when a member joins
- **Boost thank-you** (and optional boost role) when someone boosts
- **💤 AFK prefix** on nicknames while in the server's AFK channel
- **Rotating status** that changes every 40 seconds

### ✅ Dashboard
`/dashboard` shows your level, XP progress, rank, team mode status and server stats, with quick buttons.

---

## 📋 All Commands

| Command | Who | Description |
|---|---|---|
| `/rank [user]` | Everyone | View rank & XP |
| `/leaderboard` | Everyone | Top 10 members |
| `/voicestats [user]` | Everyone | Voice session history |
| `/dashboard` | Everyone | Interactive stats panel |
| `/points balance [user]` | Everyone | Points balance |
| `/points gift <user> <amount>` | Everyone | Send points to someone |
| `/shop view` · `/shop buy <item> [text]` | Everyone | Browse and buy shop items |
| `/shop additem` · `/shop removeitem` | Admin | Manage shop items |
| `/wrapped` | Admin | Run the weekly recap now |
| `/team ...` | Admin | FPS team mode |
| `/soundboard-block` · `/soundboard-unblock` · `/soundboard-status` | Admin | Soundboard restrictions |
| `/setchannel <type> <channel>` | Admin | Set welcome, boost, levelup, voice or dashboard channel |
| `/help` | Everyone | Full command list |

Most commands also work with the classic prefix, e.g. `!raider rank @user`. Soundboard commands are slash-only.

---

## 📁 File Structure

```
Raider-bot/
├── index.js               # Entry point: web server, MongoDB connect, login, status rotation
├── deploy-commands.js     # Registers slash commands
├── .env.example           # Template for .env (never commit the real .env)
├── DOCUMENTATION.md       # Full technical documentation
├── WEBSITE-TODO.md        # Open items for the website connection
└── src/
    ├── config.js          # Colors, XP rates, channel IDs
    ├── commands.js        # Slash command definitions
    ├── database.js        # MongoDB storage (with in-memory cache)
    ├── scheduler.js       # Weekly Wrapped + flair expiry jobs
    ├── status-server.js   # Health check + /status for the website
    ├── web-panel.js       # Website control panel API (/panel/*)
    ├── events/            # Discord event handlers (messages, voice, joins, boosts, ...)
    └── handlers/          # Command logic (rank, team, shop, points, soundboard, wrapped, ...)
```

---

## 🔧 Hosting

The bot runs on **Render** as a Web Service (`npm install` / `npm start`), with environment variables set in Render's **Environment** tab. A push to `main` redeploys automatically. See [DOCUMENTATION.md](DOCUMENTATION.md#64-render) for the details.

---

## 🌐 Website

The website is hosted separately and connects to the bot through `/status` (live stats) and `/panel/*` (control panel). Setup steps and open items are in **[WEBSITE-TODO.md](WEBSITE-TODO.md)**.

---

Built with ❤️ for the Raider squad.
