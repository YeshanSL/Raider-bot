# ⚔️ Raider Bot — Technical Documentation

How the bot works, how it is configured and deployed, where its data lives, and what to watch out for when changing it.

> **Last updated:** 6 Nov 2026 (voice sitting bonus: voice XP doubles as a sitting doubles in length)

---

## Read this first

A short summary for anyone (person or AI assistant) about to change this project. Each point links to the full explanation.

- **What it is:** a Node.js Discord bot (`discord.js` v14) for one gaming server, hosted on Render, storing data in MongoDB Atlas. Entry point: `index.js`.
- **Live data is in the `raider` database** on Atlas `Cluster11`. `MONGODB_DB` is not set on Render, so the default `raider` is used. Never point it at another name (section 9.6).
- **Startup order is critical:** `client.db.connect()` → re-apply `/setchannel` overrides → `client.login()`. Removing or reordering this makes the bot run with no database while looking healthy (sections 4 and 9.6).
- **All data access goes through `src/database.js`.** Getters are synchronous and read an in-memory cache. Every change must call `persist()`, or it's lost on restart (sections 9 and 13).
- **Commands run through one handler per feature,** shared by `/slash` and `!raider` prefix forms. Slash options are converted into an `args` array by `buildArgs()` (section 4, and *How slash options become `args`* in section 13).
- **Edit files, don't replace them.** Copying an older file over the project is what broke the database connection on 31 Oct 2026. Check `git diff` before committing.
- **After changing slash command definitions** in `src/commands.js`, run `npm run deploy` (section 6.5).
- **The website is a separate project.** It uses the bot's HTTP API (section 7.11). Open items are in `WEBSITE-TODO.md`.
- **Verifying a deploy:** the Render log must show `🍃 Connected to MongoDB and loaded data` (section 6.4).

---

## Contents

1. [Overview](#1-overview)
2. [Tech stack](#2-tech-stack)
3. [Project structure](#3-project-structure)
4. [How the bot runs](#4-how-the-bot-runs)
5. [Configuration](#5-configuration)
6. [Setup and deployment](#6-setup-and-deployment)
7. [Features](#7-features)
8. [Command reference](#8-command-reference)
9. [Data storage (MongoDB)](#9-data-storage-mongodb)
10. [Scheduled jobs](#10-scheduled-jobs)
11. [Permissions the bot needs](#11-permissions-the-bot-needs)
12. [Known issues and limitations](#12-known-issues-and-limitations)
13. [Developer guide](#13-developer-guide)

---

## 1. Overview

Raider is a Discord bot for gaming communities. It provides:

- **Leveling.** Members earn XP from chatting and from time in voice channels, then level up.
- **Voice tracking.** Every voice session is logged, with summaries and per-member stats.
- **Points shop.** Members earn points when they level up and spend them on XP boosts, nickname flair, shoutouts, XP packs and mystery boxes.
- **FPS Team Mode.** Splits a voice channel into two private team channels so teams can't hear each other.
- **Soundboard control.** Admins can stop specific members from using the Discord soundboard and external sounds.
- **Weekly Wrapped.** A Sunday recap of who was most active, who leveled the most, the best duo and the most-played game.
- **Server events.** Welcome messages, thank-you messages for boosts, AFK nickname tagging and a rotating status message.
- **Website API.** `/status` (live stats) and `/panel/*` (control panel) for the separately hosted website.

Commands work as slash commands (`/rank`) and, for most features, with the classic prefix (`!raider rank`). Both forms run the same handler code.

---

## 2. Tech stack

| Part | Technology |
|---|---|
| Runtime | Node.js |
| Discord library | `discord.js` v14 (+ `@discordjs/voice`) |
| Database | MongoDB Atlas (`mongodb` driver v7) |
| Scheduling | `node-cron` |
| Config | `dotenv` (`.env` file / host environment variables) |
| Hosting | Render (Web Service), with a small HTTP server for health checks and the website API |

---

## 3. Project structure

```
Raider-bot/
├── index.js                 # Entry point: web server, client, events, DB connect, login, status rotation, shutdown
├── deploy-commands.js       # Registers slash commands with Discord (run manually)
├── .env                     # Secrets — never commit (git-ignored)
├── .env.example             # Template for .env
├── CHANGES.md               # Short change log
├── WEBSITE-TODO.md          # Open items for the website connection
├── data/                    # OLD JSON storage — git-ignored, only used for one-time import
└── src/
    ├── config.js            # Channel/role IDs, XP rates, colors, points settings
    ├── commands.js          # Slash command definitions
    ├── database.js          # All data access (MongoDB + in-memory cache)
    ├── scheduler.js         # Cron jobs: Weekly Wrapped, flair expiry
    ├── status-server.js     # HTTP server: health check (/), live stats (/status), routes /panel/*
    ├── web-panel.js         # Website control panel API (/panel/*)
    ├── events/              # One file per Discord event
    │   ├── ready.js               # Starts the 1-minute voice XP tick
    │   ├── messageCreate.js       # Chat XP, level-up message, !raider commands, team panel bump
    │   ├── interactionCreate.js   # Slash commands + team panel buttons
    │   ├── voiceStateUpdate.js    # Voice sessions, summaries, AFK nickname
    │   ├── voiceLevelUp.js        # Custom event: announces voice level-ups
    │   ├── guildMemberAdd.js      # Welcome message
    │   ├── guildMemberUpdate.js   # Boost thank-you + boost role
    │   └── channelCreate.js       # Re-applies soundboard blocks to new voice channels
    └── handlers/            # Command logic (shared by / and !raider)
        ├── index.js         # Command name → handler file registry
        ├── rank.js, leaderboard.js, voicestats.js, dashboard.js, help.js
        ├── setchannel.js    # Change announcement channels
        ├── team.js          # FPS Team Mode + self-select panel
        ├── soundboard.js    # Soundboard block/unblock/status
        ├── points.js        # Points balance / gift
        ├── shop.js          # Points shop
        └── wrapped.js       # Weekly Wrapped generator + manual /wrapped
```

---

## 4. How the bot runs

### Startup sequence (`index.js`)

1. Load `.env`.
2. Create the Discord client with these intents: Guilds, GuildMembers, GuildMessages, MessageContent, GuildVoiceStates, GuildMessageReactions and GuildPresences.
3. Start the web server (`src/status-server.js`) on `PORT` (default 3000). `/` answers `Raider bot is running.`, which Render needs to treat the deploy as healthy. `/status` and `/panel/*` serve the website.
4. Attach `client.config` (`src/config.js`) and `client.db` (`src/database.js`).
5. Load every file in `src/events/` as an event listener. Each handler is wrapped so that an error is **logged** (`❌ Error in <event> handler`) instead of crashing the process.
6. **Connect to MongoDB** and load all data into memory. If this fails, the process exits with `❌ Startup failed: ...`.
7. Re-apply saved `/setchannel` overrides onto `client.config`.
8. Log in to Discord. This only happens after step 6 succeeds, so a bot that is online in Discord is always connected to the database.
9. On `ready`:
   - start the scheduler (Weekly Wrapped and flair expiry);
   - start the 40-second status rotation;
   - start the 1-minute voice XP tick (`ready.js`).

> ⚠️ **Steps 6–8 must stay in `index.js`.** On 31 Oct 2026 (`d286cc7`) `index.js` was overwritten with an older copy that called `client.login()` directly. The bot stayed online but never connected to MongoDB, so nothing was saved until it was restored. See section 9.6.

### Shutdown

On `SIGTERM` or `SIGINT`, which Render sends on every redeploy or restart, the bot waits for pending database writes, closes the MongoDB connection, logs out of Discord and exits.

### Error handling

- Errors inside event handlers are caught and logged by the loader in `index.js`.
- `process.on('unhandledRejection')` logs any other promise that fails without a `.catch`.
- Without these, a single failed message send (for example, missing permission in the welcome channel) would exit Node, Render would restart the bot, and every active voice session would be lost.

### Two ways to run a command

```
!raider rank @user ──► messageCreate.js ──┐
                                           ├──► handlers/index.js ──► handlers/rank.js
/rank user:@user ───► interactionCreate.js ┘
```

Handlers were originally written for prefix messages. For slash commands, `interactionCreate.js` builds a **compat message** object (`author`, `member`, `guild`, `mentions`, `reply`) and an `args` array from the slash options. The same handler runs either way. Soundboard commands are slash-only, because they need the raw interaction to read the channel options.

---

## 5. Configuration

### Environment variables (`.env` locally, **Environment** tab on Render)

| Variable | Required | Purpose |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Bot token from the Discord Developer Portal |
| `CLIENT_ID` | ✅ (deploy-commands) | Application ID, used to register slash commands |
| `GUILD_ID` | optional | When set, slash commands are registered to this one server and appear instantly. When blank, they're registered globally, which can take up to an hour |
| `MONGODB_URI` | ✅ | Atlas connection string, e.g. `mongodb+srv://user:pass@cluster11.xxxxx.mongodb.net/` |
| `MONGODB_DB` | optional | Database name. Production data is in **`raider`**, which is also the default. Leave it unset or set it to `raider` (see section 9.6) |
| `WELCOME_CHANNEL_ID` | optional | Where welcome messages go |
| `BOOST_CHANNEL_ID` | optional | Where boost thank-yous go (falls back to the welcome channel) |
| `LEVEL_UP_CHANNEL_ID` | optional | Where level-up messages go |
| `VOICE_LOG_CHANNEL_ID` | optional | Where voice session summaries go |
| `DASHBOARD_CHANNEL_ID` | optional | Where the team panel is posted; fallback for Wrapped and shoutouts |
| `WRAPPED_CHANNEL_ID` | optional | Where Weekly Wrapped and shoutouts go |
| `BOOST_ROLE_ID` | optional | Role given automatically to new boosters |
| `ADMIN_ROLE_ID` | optional | Role treated as admin (in addition to the Administrator permission) |
| `STATUS_GUILD_ID` | optional | Server whose owner and admins `/status` returns to the website |
| `STATUS_ORIGIN` | optional | Website address allowed to call `/status` and `/panel/*` (no trailing slash). Empty = any site |
| `PANEL_PASSKEY` | optional | Passkey for the website control panel. Empty = panel turned off |
| `PORT` | optional | Web server port (Render sets this automatically) |

To get an ID in Discord, turn on **Settings → Advanced → Developer Mode**, then right-click a channel, role or server and choose **Copy ID**.

### Tunable values (`src/config.js`)

| Setting | Default | Meaning |
|---|---|---|
| `XP_PER_MSG` | 15 | XP per chat message |
| `XP_COOLDOWN_MS` | 60000 | Minimum gap between two XP-earning messages (1 min) |
| `XP_PER_VOICE_MIN` | 8 | Starting XP per minute in voice |
| `VOICE_SITTING_FIRST_DOUBLE_MIN` | 10 | Minutes into a sitting when the voice rate first doubles; it doubles again at 2×, 4×, 8× … that |
| `VOICE_SITTING_GRACE_MS` | 120000 | Leave-and-rejoin window that keeps a sitting going (2 min) |
| `POINTS_PER_LEVEL_UP` | 10 | Shop points awarded per level gained |
| `AFK_PREFIX` | `💤 ` | Nickname prefix while in the server's AFK channel |
| `COLORS` | — | Embed colors per feature |

Changing any of these needs a redeploy.

---

## 6. Setup and deployment

### 6.1 Discord application

1. Open https://discord.com/developers/applications, click **New Application**, and name it **Raider**.
2. On the **Bot** tab, copy the token into `DISCORD_TOKEN`.
3. Under **Privileged Gateway Intents**, enable **Server Members**, **Message Content** and **Presence**.
4. Invite the bot with Administrator permission (needed for team mode, soundboard overwrites and nickname changes):
   ```
   https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=8&scope=bot%20applications.commands
   ```
5. In **Server Settings → Roles**, drag the bot's role **above** every member role. The bot can't move, rename or change permissions for members whose role sits higher than its own.

### 6.2 MongoDB Atlas

1. Create a cluster (production: `Cluster11`) and a database user.
2. Under **Network Access**, allow `0.0.0.0/0`. Render has no fixed outbound IP.
3. Go to **Connect → Drivers → Node.js**, copy the connection string, and put the real password in it. If the password has special characters (`@ : / ? # %`), URL-encode them.
4. Set `MONGODB_URI`. Leave `MONGODB_DB` unset, or set it to `raider`.

You don't need to create collections; they're created on first write. Read section 9.6 before changing anything database-related.

### 6.3 Run locally

```bash
npm install
cp .env.example .env      # then fill it in
npm run deploy            # register slash commands (only when commands change)
npm start
```

Expected log output:
```
🌐 Web server on port 3000 (health check + /status)
🍃 Connected to MongoDB and loaded data
✅ Raider is online as Raider#1234
🗓️  Weekly Wrapped scheduled for Sundays, 12:00 PM IST.
```

> ⚠️ Don't run the bot locally while the Render instance is also running with the same token and database. Both copies would respond to every command and award XP twice. Their in-memory caches would also overwrite each other's writes.

### 6.4 Render

| Setting | Value |
|---|---|
| Service type | Web Service |
| Build command | `npm install` |
| Start command | `npm start` |
| Environment | Variables from section 5 (at minimum `DISCORD_TOKEN` and `MONGODB_URI`) |

A push to `main` redeploys automatically. On the free plan the instance sleeps when idle. Point an uptime pinger (e.g. UptimeRobot) at the service URL to keep it awake.

**Current deployment**

| | |
|---|---|
| Repo | https://github.com/YeshanSL/Raider-bot (`main`) |
| Service URL | https://raider-bot-q15e.onrender.com |
| Bot account | `Raider#0900` |
| Runtime | Node.js 24 (Render default), port 10000 |
| Database | Atlas `Cluster11`, database `raider` (`MONGODB_DB` not set on Render, so the default is used) |

**A healthy startup log looks like this:**
```
🌐 Web server on port 10000 (health check + /status)
🍃 Connected to MongoDB and loaded data      ← missing = MongoDB not connected
✅ Raider is online as Raider#0900
🗓️  Weekly Wrapped scheduled for Sundays, 12:00 PM IST.
🏷️  Nickname flair expiry check running every 5 minutes.
✅ Logged in as Raider#0900
```
- `injected env (0) from .env` is normal on Render. There's no `.env` file there; the variables come from Render's Environment settings.
- `❌ Startup failed: MONGODB_URI is not set` means the variable is missing on Render.
- Timeout or authentication errors usually mean the Atlas **Network Access** list doesn't include `0.0.0.0/0`, or the password in the URI is wrong.
- `❌ MongoDB write failed (...)` means a save didn't reach Atlas. A one-off is usually a network blip; repeated ones need checking.

### 6.5 When to run `deploy-commands.js`

Run `npm run deploy` only after you add, rename or change options on a slash command in `src/commands.js`. Changes to handler logic don't need it.

> ⚠️ **After this update, run `npm run deploy` once** so Discord shows `/points`, `/shop` and `/wrapped`.

---

## 7. Features

### 7.1 Leveling and XP

**Earning XP**

| Source | Amount | Rules |
|---|---|---|
| Chat message | 15 XP | At most once per 60 s per member (`lastMsg` timestamp). Bots are ignored |
| Voice | 8 XP per minute, doubling with sitting length | Awarded by the 1-minute tick to every member in an active voice session. The rate depends on the current **sitting** (see below). Nothing extra is paid when they leave |
| Shop items | varies | XP packs, mystery boxes |

**Voice sitting bonus.** A sitting is continuous time in voice. Switching channels doesn't end it, and neither does leaving and rejoining within `VOICE_SITTING_GRACE_MS` (2 min). The voice rate doubles every time the current sitting doubles in length, with no upper limit:

| Minutes into sitting | Multiplier | XP per minute |
|---|---|---|
| 0–9 | 1x | 8 |
| 10–19 | 2x | 16 |
| 20–39 | 4x | 32 |
| 40–79 | 8x | 64 |
| 80–159 | 16x | 128 |
| 160–319 | 32x | 256 |
| 320–639 | 64x | 512 |
| … | doubles again | … |

Totals for one sitting: 60 min ≈ 2,160 XP (six separate 10-minute visits earn 480), 2 h ≈ 8,560, 8 h ≈ 136,560, 24 h ≈ 1.2 million (level 0 → 32). Sittings live in memory, so a bot restart starts everyone's sitting over.

An active **XP boost** multiplies every XP gain, whatever the source (for voice, on top of the sitting bonus).

**Level curve.** XP resets at each level. Reaching the next level costs `100 × (level + 1)²`:

| From → To | XP needed | Total XP from 0 |
|---|---|---|
| 0 → 1 | 100 | 100 |
| 1 → 2 | 400 | 500 |
| 2 → 3 | 900 | 1,400 |
| 3 → 4 | 1,600 | 3,000 |
| 4 → 5 | 2,500 | 5,500 |
| 9 → 10 | 10,000 | 38,500 |

Leftover XP carries over, and one large gain can raise several levels at once. Each level gained also awards `POINTS_PER_LEVEL_UP` points.

**Level-up announcements**

- **Chat:** sent to `LEVEL_UP_CHANNEL_ID`, or to the channel where the message was typed.
- **Voice:** sent to `LEVEL_UP_CHANNEL_ID`, falling back to `VOICE_LOG_CHANNEL_ID` (`voiceLevelUp.js`).

**Ranking.** The leaderboard sorts by level, then by XP within the level. `/rank` looks for the member in the top 100 and shows "Unranked" if they're below that.

### 7.2 Voice tracking

- Joining a voice channel starts a session. The session is held **in memory only** until it ends.
- Leaving ends the session and saves it to history with `userId`, `channelId`, `duration`, `timestamp`, and `game` (from the member's "Playing" status, if the Presence intent can see it).
- Switching channels ends the old session and starts a new one.
- A **Voice Session Summary** is posted to `VOICE_LOG_CHANNEL_ID` for sessions longer than 1 minute. It shows the time spent, the number of members in the channel, the voice XP actually earned in that channel (before boosts), the sitting bonus reached, and the start and end times.
- History keeps the **last 2,000 sessions per server**.
- `/voicestats` shows a member's total time, session count, average session length and last session, based on that history. If they're in voice now, it also shows their **current sitting**: how long, the current XP/min, and when it next doubles.

### 7.3 AFK nickname

If the server has an AFK channel (**Server Settings → Overview**), members who move into it get `💤 ` added to the front of their nickname. The prefix is removed when they leave. Nicknames are capped at 32 characters.

### 7.4 Welcome and boost messages

- **Welcome** (`guildMemberAdd`): an embed in `WELCOME_CHANNEL_ID` that pings the new member and shows their member number.
- **Boost** (`guildMemberUpdate`): when a member starts boosting, a thank-you embed is posted showing the boost count and server boost level. `BOOST_ROLE_ID` is granted if it's set.

### 7.5 Dashboard

`/dashboard` shows your level, an XP progress bar, your rank, team mode status, the member count, boosts, and quick commands. It has three buttons (**My Rank**, **Leaderboard**, **Team Status**) that work for 60 seconds and only for the person who opened it.

### 7.6 FPS Team Mode (admin)

Discord can't isolate audio inside a single voice channel. Team mode instead creates a hidden **RAIDER TEAMS** category containing **🔴 Team 1** and **🔵 Team 2** voice channels, which only assigned members can see and join, and moves players into them.

**Manual mode**
```
/team setup channel:#game-vc         link the "home" voice channel
/team assign user:@A team:Team 1     repeat for each player
/team on                             create team VCs and move players
/team off                            move everyone home and delete the team VCs
/team status                         show assignments
```

**Self-select panel**
```
/team panel action:on    clear teams, create the team VCs, post a panel with Team 1 / Team 2 / All buttons
/team panel action:off   delete the panel, move everyone home, clean up
```
- The panel is posted in `DASHBOARD_CHANNEL_ID`, or the current channel if that isn't set.
- Anyone can click **Team 1** or **Team 2**. They get access to that team's VC and are moved there if they're in voice.
- **All** resets *everyone*: every team member is moved back to the home VC and the teams are cleared.
- The panel re-posts itself whenever someone else sends a message in its channel, so it stays at the bottom.

Admin means having the Administrator permission or `ADMIN_ROLE_ID`.

### 7.7 Soundboard control (admin, slash only)

```
/soundboard-block   member:@X [channel1..channel5]   no channels picked = every voice channel
/soundboard-unblock member:@X [channel1..channel5]
/soundboard-status  member:@X                        reply only visible to you
```
- The bot adds a member-specific permission overwrite that denies **Use Soundboard** and **Use External Sounds** on each channel. Nothing else about the member changes.
- An **all voice channels** block is also applied automatically to voice channels created later, including team-mode channels (`channelCreate.js`).
- Unblocking removes only those two denies and leaves any other overwrites in place, such as team-mode access.
- The bot refuses to block itself, the server owner, Administrators (they bypass overwrites anyway), and anyone whose highest role is equal to or above the invoker's (unless the invoker is the owner).

### 7.8 Points shop

Points are a spendable balance, separate from XP. Spending them never lowers a member's level.

**Earning points:** level-ups (10 per level), mystery box rewards and gifts.

| Item type | Effect | Admin setup needs |
|---|---|---|
| `boost` | XP multiplier for N minutes | `multiplier` (> 1), `duration_minutes` |
| `nickname` | Adds the buyer's flair text in front of their nickname for N minutes; removed automatically | `duration_minutes`; the buyer supplies `text` (max 20 characters) |
| `shoutout` | Posts the buyer's message (max 500 characters) as an embed | — ; the buyer supplies `text` |
| `xp` | Adds XP instantly | `xp_amount` |
| `mysterybox` | Random reward | — |

**Mystery box odds:** 40% +50 XP · 25% refund of half the price · 20% +150 XP · 10% jackpot (+300 XP and +100 points) · 5% nothing.

Commands: `/points balance [user]`, `/points gift user amount`, `/shop view`, `/shop buy item [text]`, `/shop additem ...` (admin) and `/shop removeitem name` (admin). If setting the nickname fails, the purchase is refunded automatically. The shop starts empty; an admin has to add items.

### 7.9 Weekly Wrapped

Runs every **Sunday at 12:00 PM IST** for every server and posts to `WRAPPED_CHANNEL_ID`, falling back to `DASHBOARD_CHANNEL_ID`. It covers the last 7 days of voice sessions:

- **Most Active:** most voice time.
- **Winner of the Week:** most XP gained since the last Wrapped, measured against a saved snapshot.
- **Best Duo:** the pair who spent the most time together in the same channel.
- **Most Played Game:** across the whole squad.
- **Squad Recap:** up to 20 members, each with hours, levels gained, top partner and top game.

Each run saves a new snapshot, so "XP gained" is always measured since the previous run. If there was no voice activity that week, nothing is posted.

`/wrapped` runs it immediately. It's **admin only**, because a manual run also saves a new snapshot: the next Sunday recap then only counts XP gained since the manual run.

### 7.10 Rotating status

The bot's status cycles through seven messages every 40 seconds, such as "⚔️ Raider | Ready to Battle" and "🏆 Raider | Rank Up Now". They're defined in `index.js`.

### 7.11 Website API

The website is hosted separately and talks to the bot over HTTP, on the same port as the health check (`src/status-server.js`, `src/web-panel.js`). Base URL in production: `https://raider-bot-q15e.onrender.com`. Every response includes `Access-Control-Allow-Origin: <STATUS_ORIGIN or *>`.

Open setup items and a known security issue are listed in [`WEBSITE-TODO.md`](WEBSITE-TODO.md).

#### `GET /` (health check)

Plain text `Raider bot is running.` Render uses it to decide the deploy is healthy.

#### `GET /status` (public, no login)

```json
{
  "online": true,            // client.isReady()
  "ping": 84,                // websocket ping, ms
  "servers": 1,              // guilds the bot is in
  "users": 24,               // total members across all guilds
  "onlineMembers": 12,       // members whose presence isn't "offline"
  "uptime": 15497,           // seconds since the Discord login
  "home": null               // or the object below, if STATUS_GUILD_ID is set
}
```

`home` (for the `STATUS_GUILD_ID` server): `{ name, icon, members, online, owner: { name, role: "Owner", avatar }, admins: [ { name, role: "Admin", avatar } ] }` (max 20 admins). It's refreshed in the background at most once a minute, so the first call after a start returns `null`.

#### `/panel/*` (control panel, login required)

- **Off unless `PANEL_PASSKEY` is set.** Otherwise every route returns `503`.
- **Login:** `POST /panel/login` with body `{ "passkey": "..." }` returns `{ "token": "<expiry>.<signature>" }`. The token is valid for **12 hours** and still works after a restart, because it's an HMAC signed with `PANEL_PASSKEY` + `DISCORD_TOKEN`. Changing either one signs everyone out.
- **Rate limit:** 6 wrong passkeys per IP per 10 minutes, then `429`. This can be bypassed (see `WEBSITE-TODO.md` item 4).
- **Every other route** needs the header `Authorization: Bearer <token>`. It returns `503` until the bot has logged in to Discord.
- **Server selection:** GET routes take `?guild=<guildId>`. POST routes take `"guildId"` in the JSON body. Bodies are limited to 20 KB.
- **Errors:** `{ "error": "..." }` with `401` (bad or expired token, wrong passkey), `404` (unknown route or bot not in that server), `429`, `503` or `500`.
- **POST results:** `200` with `{ "ok": true|false, "message": "..." }`. `ok: false` means the action was refused, for example a member wasn't found.

| Route | Input | Returns / does |
|---|---|---|
| `GET /panel/guilds` | — | `{ guilds: [ { id, name } ] }` |
| `GET /panel/data` | `?guild` | `{ textChannels, voiceChannels, channels: { welcome, boost, levelup, voice, dashboard }, team: { channelId, active, panelOn, team1: [ {id,name} ], team2 }, blocks: [ { id, name, allVoice, channels: [names] } ] }` |
| `GET /panel/members` | `?guild&q=<search>` | `{ members: [ { id, name, avatar } ] }` (max 8, no bots) |
| `POST /panel/channel` | `{ guildId, type: welcome\|boost\|levelup\|voice\|dashboard, channelId }` | Same as `/setchannel`: saved to `channel_overrides` |
| `POST /panel/team` | `{ guildId, action: setup\|on\|off\|panel-on\|panel-off\|assign, channelId?, userId?, team?: "1"\|"2" }` | Runs the same code as `/team`, acting as an admin |
| `POST /panel/soundboard` | `{ guildId, action: block\|unblock, userId, channelIds?: [ids] }` | Same as `/soundboard-block` / `-unblock`; no `channelIds` = all voice channels |

Differences from the slash commands:

- Panel soundboard blocks **skip the role-hierarchy check**, because the panel acts with full admin rights. They still refuse the bot itself, the owner and Administrators.
- Panel team actions don't post the command's reply in Discord. The reply is captured and returned as `message`, with mentions turned into names and markdown removed. `panel-on` still posts the self-select panel in Discord, as `/team panel on` does.

---

## 8. Command reference

| Slash command | Prefix form | Who | Description |
|---|---|---|---|
| `/rank [user]` | `!raider rank [@user]` | Everyone | Level, XP and server rank |
| `/leaderboard` | `!raider leaderboard` | Everyone | Top 10 |
| `/voicestats [user]` | `!raider voicestats [@user]` | Everyone | Voice history stats |
| `/dashboard` | `!raider dashboard` | Everyone | Interactive stats panel |
| `/help` | `!raider help` | Everyone | Command list |
| `/points balance [user]` | `!raider points [@user]` | Everyone | Points balance |
| `/points gift user amount` | `!raider points gift @user <amount>` | Everyone | Send points to someone |
| `/shop view` · `/shop buy item [text]` | `!raider shop` · `!raider shop buy <item> [text]` | Everyone | Browse and buy |
| `/shop additem` · `/shop removeitem` | — | Admin | Manage shop items |
| `/wrapped` | `!raider wrapped` | Admin | Run the weekly recap now |
| `/team setup\|assign\|on\|off\|panel\|status` | `!raider team ...` | Admin | FPS Team Mode |
| `/setchannel type channel` | `!raider setchannel <type> #ch` | Administrator permission | Set the `welcome`, `boost`, `levelup`, `voice` or `dashboard` channel |
| `/soundboard-block` | — | Admin | Block soundboard |
| `/soundboard-unblock` | — | Admin | Unblock soundboard |
| `/soundboard-status` | — | Admin | Check soundboard restriction |

`/setchannel` choices are saved in MongoDB and re-applied on startup. They take priority over the `.env` channel IDs.

---

## 9. Data storage (MongoDB)

### 9.1 Design

- **Database:** `raider` (from `MONGODB_DB`, which defaults to `raider`).
- **Layout:** one collection per feature, holding **one document per Discord server**:
  ```json
  { "_id": "<guildId>", "data": { ... } }
  ```
- **In-memory cache:** on startup, every collection is loaded into memory. Every `db.get*()` reads memory, so it's instant and synchronous. Every `db.set*()` / `add*()` updates memory first, then saves that server's document to MongoDB in the background.
- **Write ordering:** writes to the same document are queued so they happen in order. If several changes happen while a write is in flight, they're combined into one follow-up write.
- **Failed writes** are logged as `❌ MongoDB write failed (...)`. The in-memory value stays correct, and the next change to the same document saves it again.
- **One-time import:** if a collection is **empty** at startup and `data/<collection>.json` exists, that file is imported. This is how the original JSON data was moved into MongoDB. Delete everything in a collection and the import runs again on the next start.

### 9.2 Collections

| Collection | `data` shape (per server) | Written by |
|---|---|---|
| `xp` | `{ [userId]: { xp, level, lastMsg } }` | Chat, voice, shop |
| `sessions` | `[ { userId, channelId, duration, timestamp, game } ]` (last 2,000) | Leaving or switching voice |
| `teams` | `{ active, channelId, teams: { team1: [ids], team2: [ids] }, t1vcId, t2vcId, categoryId, panelOn, panelChannelId, panelMessageId }` | `/team`, website panel |
| `soundboard_blocks` | `{ [userId]: { allVoice, channelIds: [ids], by, at } }` | `/soundboard-*`, website panel |
| `points` | `{ [userId]: number }` | Level-ups, shop, gifts |
| `shop` | `[ { id, name, price, type, meta: { multiplier?, durationMinutes?, xpAmount? } } ]` | `/shop additem/removeitem` |
| `boosts` | `{ [userId]: { multiplier, expiresAt } }` | Buying a boost |
| `flair` | `{ [userId]: { flair, expiresAt } }` | Buying flair; cleared by the expiry job |
| `wrapped_snapshot` | `{ [userId]: { level, xp } }` | Weekly Wrapped |
| `channel_overrides` | `{ WELCOME_CHANNEL_ID?: id, BOOST_CHANNEL_ID?: id, ... }` | `/setchannel`, website panel |

A collection only appears in Atlas after its first write, so `shop`, `boosts`, `flair` and `channel_overrides` may not exist yet. That's normal.

Times are in milliseconds since the Unix epoch. `duration` is in seconds.

### 9.3 Editing data by hand

You can edit documents in Atlas (**Browse Collections**), for example to fix someone's level. **The bot only reads MongoDB at startup**, though. To make a manual edit take effect:

1. Stop the bot (or suspend the Render service).
2. Edit the document.
3. Start the bot again.

If you edit while the bot is running, it doesn't see the change. Its next save to that server's document overwrites your edit.

### 9.4 Backups

Atlas's free tier has no automatic backups. To take one manually:
```bash
mongodump --uri="<MONGODB_URI>" --db=raider --out=backup-YYYY-MM-DD
```

### 9.5 `database.js` functions

Everything else in the bot reaches the data through these exports (`client.db` or `require('./database')`). Getters return cached values instantly; setters update the cache and save in the background.

| Area | Functions |
|---|---|
| Connection | `connect()` loads every collection into memory; it must run before login. `close()` waits for pending writes and disconnects |
| XP | `getXP(g,u)` → `{ xp, level, lastMsg }` · `setXP(g,u,data)` · `addXP(g,u,amount)` → `{ xp, level, lastMsg, leveledUp }` (applies active boosts, handles multi-level gains, awards points) · `xpForLevel(level)` = `100 × (level+1)²` · `totalXPEarned(level,xp)` · `getLeaderboard(g, limit=10)` |
| Voice sessions | `startVoiceSession(g,u,channelId)` · `endVoiceSession(g,u,game)` → `{ duration, channelId, game, xpEarned, sittingMinutes, multiplier }` or `null` (saves history) · `getActiveSession(g,u)` · `getActiveSessionsForChannel(g,channelId)` · `getSessions(g)` · `getSessionsSince(g,ms)` · `tickVoiceXP(client)` (the 1-minute voice XP award) · `getSittingMultiplier(minutes)` (1x, 2x, 4x … by sitting length) |
| Team mode | `getTeams(g)` · `setTeams(g,data)` |
| Soundboard | `getSoundboardBlocks(g)` · `setSoundboardBlocks(g,data)` (an empty object deletes the document) |
| Wrapped | `getWrappedSnapshot(g)` · `setWrappedSnapshot(g,data)` |
| Points | `getPoints(g,u)` · `addPoints(g,u,n)` → new balance · `spendPoints(g,u,n)` → `{ success, balance }` (only spends if the balance covers it) |
| Shop | `getShopItems(g)` · `setShopItems(g,items)` |
| Boosts | `getActiveBoost(g,u)` → `{ multiplier, expiresAt }` or `null` · `setBoost(g,u,multiplier,minutes)` |
| Flair | `getFlair(g,u)` · `setFlair(g,u,text,minutes)` · `clearFlair(g,u)` · `getExpiredFlairs()` |
| Channel overrides | `getAllChannelOverrides()` → `{ [guildId]: { CONFIG_KEY: channelId } }` · `setChannelOverride(g,key,channelId)` |

`g` = guild ID, `u` = user ID. Getters can return the cached object itself, so a caller that changes it must then call the matching setter (which calls `persist()`). The existing handlers all do this.

Active voice sessions (`startVoiceSession`/`endVoiceSession`) are kept **only in memory** until they end.

### 9.6 Database: do's and don'ts

The live data (levels, XP, points, sessions, teams, soundboard blocks) is in the **`raider`** database on `Cluster11`.

**✅ Do**

- Leave `MONGODB_DB` **unset** on Render, or set it to exactly `raider` (lowercase).
- Keep the startup code in `index.js` exactly as described in section 4: `client.db.connect()` → re-apply overrides → `client.login()`, plus the `SIGTERM`/`SIGINT` handler.
- When changing `index.js` (or any file), **edit only what you need** and check `git diff` before committing. Look for deleted lines you didn't mean to remove.
- After every deploy, check the Render log for `🍃 Connected to MongoDB and loaded data`.
- Take a `mongodump` backup (section 9.4) before any risky change to data or storage code.
- Stop the bot before editing documents in Atlas (section 9.3).
- Give other projects that read this data their **own** Atlas user, read-only if they only need to read.

**❌ Don't**

- **Don't set `MONGODB_DB` to anything other than `raider`** (for example `Raider_Bot`). MongoDB silently creates a new, empty database for any new name: everyone shows level 0, and new progress is saved there instead of in `raider`.
- **Don't copy whole files over the project** (as `CHANGES.md` once suggested). An older copy of `index.js` removed the MongoDB connection on 31 Oct 2026 (`d286cc7`), and nothing was saved until it was restored.
- **Don't call `client.login()` before `client.db.connect()` has finished.** The bot would run on empty in-memory data and every save would fail.
- **Don't run two copies of the bot** (for example local and Render) on the same database at the same time. Their caches overwrite each other.
- **Don't edit documents in Atlas while the bot is running.** The bot's next save overwrites your change.
- **Don't delete a collection** to "reset" it unless you mean it. If an old `data/<collection>.json` exists, it gets re-imported on the next start.
- **Don't commit `.env`** or paste `MONGODB_URI` into code, docs or chat. It contains the database password.

**How to tell it's working**

| Sign | Meaning |
|---|---|
| `🍃 Connected to MongoDB and loaded data` in the log | ✅ Connected, data loaded |
| `❌ Startup failed: ...` | Not connected; the bot won't log in to Discord |
| Repeated `❌ MongoDB write failed (...)` | Saves are failing; check Atlas status and network access |
| Everyone suddenly at level 0 | Wrong database name, or the connection code is missing |

---

## 10. Scheduled jobs

| Job | Schedule | Where | What it does |
|---|---|---|---|
| Voice XP tick | every 60 s | `events/ready.js` → `database.tickVoiceXP` | +8 XP, doubling with sitting length (boosted if active) to everyone in voice; fires `voiceLevelUp` |
| Status rotation | every 40 s | `index.js` | Cycles the bot's activity text |
| Weekly Wrapped | Sun 12:00 Asia/Kolkata | `scheduler.js` | Posts the recap for every server |
| Flair expiry | every 5 min | `scheduler.js` | Removes expired flair from nicknames and clears the record |

XP boosts don't need a cleanup job. They stop applying once `expiresAt` has passed.

---

## 11. Permissions the bot needs

The invite link grants Administrator, which covers everything. If you ever narrow it down, these are the permissions each feature uses:

| Feature | Permissions |
|---|---|
| All messages | View Channels, Send Messages, Embed Links, Read Message History |
| Team mode | Manage Channels, Manage Roles (permission overwrites), Move Members |
| Soundboard control | Manage Roles / Manage Permissions on voice channels |
| AFK prefix, nickname flair | Manage Nicknames |
| Boost role | Manage Roles |
| Team panel bump | Manage Messages (to delete its old panel) |

The bot's role must also be **above** the roles of the members it acts on.

---

## 12. Known issues and limitations

| # | Issue | Impact | Fix |
|---|---|---|---|
| 1 | **Active voice sessions live only in memory.** | A restart or redeploy drops current sessions: no history entry or summary, no voice XP until the member rejoins, and everyone's sitting bonus starts over at 1x | Persist active sessions, or rebuild them from current voice states on `ready` |
| 2 | **Channel settings are global, not per server.** `client.config` is shared, so `/setchannel` in one server changes it for every server. | Only matters if the bot is in more than one server | Read overrides per server when sending messages |
| 3 | **MongoDB is read only at startup** (in-memory cache). | Manual edits in Atlas need a restart. Never run two bot instances on the same database | — (by design) |
| 4 | `/rank` only ranks the top 100. | Members below that show "Unranked" | Compute the rank from the full list |
| 5 | Dashboard buttons stop working after 60 s. | By design (collector timeout) | — |
| 6 | `npm install` on Render reports **1 high-severity vulnerability**. | Unknown until checked | Run `npm audit` and `npm audit fix` |
| 7 | **`ready.js` and `index.js` both handle "ready".** That's why "online" and "Logged in" each appear in the log. | Harmless duplication | Merge them into one handler |
| 8 | **Website connection items** (panel off, missing `STATUS_*` variables, login rate-limit bypass). | Website panel and owner/admin list don't work yet | See [`WEBSITE-TODO.md`](WEBSITE-TODO.md) |

**Fixed on 3 Nov 2026:** MongoDB startup restored in `index.js`; event-handler errors no longer crash the bot; voice XP is no longer counted twice; `/points`, `/shop` and `/wrapped` registered again; `node_modules/` and the stray `Raider-bot` submodule entry removed from git; README updated; `.env.example` uses `MONGODB_DB=raider`.

---

## 13. Developer guide

### Adding a new command

1. **Handler:** create `src/handlers/<name>.js` exporting `async (message, args, client) => { ... }`. Use `message.reply`, `message.author`, `message.mentions.users.first()` and so on, so it works for both `/` and `!raider`.
2. **Registry:** add `<name>` to the `handlers` array in `src/handlers/index.js`. If the slash command name differs from the file name, add it to `aliases`.
3. **Slash definition:** add a `SlashCommandBuilder` to `src/commands.js`.
4. **Arguments:** if the command has options or subcommands, add a branch to `buildArgs()` in `src/events/interactionCreate.js` that turns them into the `args` array your handler expects.
5. **Help:** add it to `src/handlers/help.js` (and the dashboard's quick commands if relevant).
6. Run `npm run deploy`, then restart the bot.

### Adding new stored data

1. Add the collection name to `STORES` in `src/database.js`.
2. Write getters and setters that read and modify `cache.<store>[guildId]` and then call `persist('<store>', guildId)`.
3. Export them. The collection is created in Atlas the first time the bot saves to it.

Keep getters synchronous and **always call `persist()` after changing cached data**. A change made without `persist()` is lost on the next restart.

### Adding a Discord event

Create `src/events/<name>.js` exporting `{ name: Events.X, once?: boolean, async execute(...args, client) }`. `index.js` picks it up automatically and logs any error it throws.

### How slash options become `args`

Handlers take `(message, args, client)`. For slash commands, `buildArgs()` in `src/events/interactionCreate.js` produces `args`, and `buildCompatMessage()` makes `message.mentions.users/members.first()` return the `user` option (`member` for soundboard commands) and `message.mentions.channels.first()` return the `channel` option.

| Slash command | `args` |
|---|---|
| `/team setup channel` | `['setup', channelId]` |
| `/team assign user team` | `['assign', 'user', '1'\|'2']` (the user comes from `mentions`) |
| `/team panel action` | `['panel', 'on'\|'off']` |
| `/team on\|off\|status` | `['on']` / `['off']` / `['status']` |
| `/soundboard-block\|unblock\|status` | `['block']` / `['unblock']` / `['status']` (channels are read from `message.interaction`) |
| `/setchannel type channel` | `[type]` (the channel comes from `mentions`) |
| `/shop view` | `['view']` |
| `/shop buy item text` | `['buy', item, text or '']` |
| `/shop additem ...` | `['additem', name, price, type, multiplier or '', duration_minutes or '', xp_amount or '']` (all strings) |
| `/shop removeitem name` | `['removeitem', name]` |
| `/points balance [user]` | `['balance']` |
| `/points gift user amount` | `['gift', 'user', amount]` |
| Everything else | `[]` |

Prefix commands split the message on spaces after `!raider <command>`, so `!raider shop buy <item> <text>` only supports single-word item names and text.

### Button IDs

| `customId` | Where it's handled | What it does |
|---|---|---|
| `team_panel_1`, `team_panel_2` | `team.js` → `handlePanelButton` (routed in `interactionCreate.js`) | Join Team 1 / Team 2. Anyone can click |
| `team_panel_all` | same | Reset: everyone back to the home VC, teams cleared |
| `dashboard_rank`, `dashboard_lb`, `dashboard_team` | Collector inside `dashboard.js` | Only for the member who opened `/dashboard`, for 60 s |

### Useful commands

```bash
npm start              # run the bot
npm run deploy         # register slash commands
node --check file.js   # quick syntax check
```

### Git history notes

| Commit | Change |
|---|---|
| `74f8218` | Initial bot |
| `c6a16a1` | Keep-alive HTTP server for Render |
| `17e5aa3` | Points shop, Weekly Wrapped, boosts, flair |
| `a039583` | Soundboard commands. **Accidentally removed the points/shop/wrapped commands** from `17e5aa3` |
| `f69dfb9` | Moved all storage from JSON files to MongoDB; restored the lost database functions |
| `d501cdb` | `ready` → `Events.ClientReady` in `index.js` |
| `d286cc7` | Website status server. **Overwrote `index.js` with an older copy, removing the MongoDB connection** (see section 9.6) |
| `cee59ee` | Status server fix |
| `75af8df` / `8ddceae` | Website control panel (`web-panel.js`); MongoDB startup restored in `index.js` |
