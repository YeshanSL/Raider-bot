# ⚔️ Raider Bot — Technical Documentation

How the bot works, how it is configured and deployed, where its data lives, and what to watch out for when changing it.

> **Last updated:** 26 Oct 2026 (after the move to MongoDB, commit `f69dfb9`)

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
- **Soundboard control.** Admins can stop specific members from using the Discord soundboard.
- **Weekly Wrapped.** A Sunday recap of who was most active, who leveled the most, the best duo and the most-played game.
- **Server events.** Welcome messages, thank-you messages for boosts, AFK nickname tagging and a rotating status message.

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
| Hosting | Render (Web Service), with a small HTTP server for health checks |

---

## 3. Project structure

```
Raider-bot/
├── index.js                 # Entry point: HTTP server, client, events, DB connect, login, status rotation
├── deploy-commands.js       # Registers slash commands with Discord (run manually)
├── .env                     # Secrets — never commit (git-ignored)
├── .env.example             # Template for .env
├── data/                    # OLD JSON storage — git-ignored, only used for one-time import
└── src/
    ├── config.js            # Channel/role IDs, XP rates, colors, points settings
    ├── commands.js          # Slash command definitions
    ├── database.js          # All data access (MongoDB + in-memory cache)
    ├── scheduler.js         # Cron jobs: Weekly Wrapped, flair expiry
    ├── events/              # One file per Discord event
    │   ├── ready.js               # Starts the 1-minute voice XP tick
    │   ├── messageCreate.js       # Chat XP, level-up message, !raider commands, team panel bump
    │   ├── interactionCreate.js   # Slash commands + team panel buttons
    │   ├── voiceStateUpdate.js    # Voice sessions, voice XP, summaries, AFK nickname
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
        ├── points.js        # Points balance / gift   (currently not wired up — see §12)
        ├── shop.js          # Points shop             (currently not wired up — see §12)
        └── wrapped.js       # Weekly Wrapped generator
```

---

## 4. How the bot runs

### Startup sequence (`index.js`)

1. Load `.env`.
2. Start a tiny HTTP server on `PORT` (default 3000) that answers `Raider bot is running.`. Render's Web Service plan treats a deploy as failed unless something listens on a port. An uptime pinger can also use this URL to keep a free instance awake.
3. Create the Discord client with these intents: Guilds, GuildMembers, GuildMessages, MessageContent, GuildVoiceStates, GuildMessageReactions and GuildPresences.
4. Attach `client.config` (`src/config.js`) and `client.db` (`src/database.js`).
5. Load every file in `src/events/` as an event listener.
6. **Connect to MongoDB** and load all data into memory. If this fails, the process exits with an error.
7. Re-apply saved `/setchannel` overrides onto `client.config`.
8. Log in to Discord.
9. On `ready`:
   - start the scheduler (Weekly Wrapped and flair expiry);
   - start the 40-second status rotation;
   - start the 1-minute voice XP tick (`ready.js`).

### Shutdown

On `SIGTERM` or `SIGINT`, which Render sends on every redeploy or restart, the bot waits for pending database writes, closes the MongoDB connection, logs out of Discord and exits.

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
| `MONGODB_DB` | recommended | Database name. Production uses `Raider_Bot`; the default is `raider` |
| `WELCOME_CHANNEL_ID` | optional | Where welcome messages go |
| `BOOST_CHANNEL_ID` | optional | Where boost thank-yous go (falls back to the welcome channel) |
| `LEVEL_UP_CHANNEL_ID` | optional | Where level-up messages go |
| `VOICE_LOG_CHANNEL_ID` | optional | Where voice session summaries go |
| `DASHBOARD_CHANNEL_ID` | optional | Where the team panel is posted; fallback for Wrapped and shoutouts |
| `WRAPPED_CHANNEL_ID` | optional | Where Weekly Wrapped and shoutouts go |
| `BOOST_ROLE_ID` | optional | Role given automatically to new boosters |
| `ADMIN_ROLE_ID` | optional | Role treated as admin (in addition to the Administrator permission) |
| `PORT` | optional | HTTP keep-alive port (Render sets this automatically) |

To get an ID in Discord, turn on **Settings → Advanced → Developer Mode**, then right-click a channel, role or server and choose **Copy ID**.

### Tunable values (`src/config.js`)

| Setting | Default | Meaning |
|---|---|---|
| `XP_PER_MSG` | 15 | XP per chat message |
| `XP_COOLDOWN_MS` | 60000 | Minimum gap between two XP-earning messages (1 min) |
| `XP_PER_VOICE_MIN` | 5 | XP per minute in voice |
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
4. Set `MONGODB_URI` and `MONGODB_DB=Raider_Bot`.

You don't need to create collections; they're created on first write. See [§9](#9-data-storage-mongodb).

### 6.3 Run locally

```bash
npm install
cp .env.example .env      # then fill it in
npm run deploy            # register slash commands (only when commands change)
npm start
```

Expected log output:
```
🌐 Keep-alive server listening on port 3000
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
| Environment | All variables from §5 (at minimum `DISCORD_TOKEN`, `MONGODB_URI`, `MONGODB_DB`) |

A push to `main` redeploys automatically. On the free plan the instance sleeps when idle. Point an uptime pinger (e.g. UptimeRobot) at the service URL to keep it awake.

**Current deployment**

| | |
|---|---|
| Repo | https://github.com/YeshanSL/Raider-bot (`main`) |
| Service URL | https://raider-bot-q15e.onrender.com |
| Bot account | `Raider#0900` |
| Runtime | Node.js 24 (Render default), port 10000 |
| Status (26 Oct 2026) | ✅ Builds and goes live. The last confirmed deploy ran commit `a039583`, before the MongoDB change. Confirm that the deploy of `f69dfb9` or later logs `🍃 Connected to MongoDB and loaded data` |

**A healthy startup log looks like this:**
```
🌐 Keep-alive server listening on port 10000
🍃 Connected to MongoDB and loaded data      ← missing = old code or MongoDB not reached
✅ Raider is online as Raider#0900
🗓️  Weekly Wrapped scheduled for Sundays, 12:00 PM IST.
🏷️  Nickname flair expiry check running every 5 minutes.
✅ Logged in as Raider#0900
```
- `injected env (0) from .env` is normal on Render. There's no `.env` file there; the variables come from Render's Environment settings.
- `❌ Startup failed: MONGODB_URI is not set` means the variable is missing on Render.
- Timeout or authentication errors usually mean the Atlas **Network Access** list doesn't include `0.0.0.0/0`, or the password in the URI is wrong.
- The `ready event has been renamed to clientReady` warning doesn't affect anything yet (see §12).

### 6.5 When to run `deploy-commands.js`

Run `npm run deploy` only after you add, rename or change options on a slash command in `src/commands.js`. Changes to handler logic don't need it.

---

## 7. Features

### 7.1 Leveling and XP

**Earning XP**

| Source | Amount | Rules |
|---|---|---|
| Chat message | 15 XP | At most once per 60 s per member (`lastMsg` timestamp). Bots are ignored |
| Voice — per-minute tick | 5 XP | Every 60 s, for every member in an active voice session |
| Voice — on leaving | 5 XP × minutes in session | Only if the session lasted more than 10 s (see the double-XP note in §12) |
| Shop items | varies | XP packs, mystery boxes |

An active **XP boost** multiplies every XP gain, whatever the source.

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
- **Voice:** sent to `LEVEL_UP_CHANNEL_ID`, falling back to `VOICE_LOG_CHANNEL_ID`.

**Ranking.** The leaderboard sorts by level, then by XP within the level. `/rank` looks for the member in the top 100 and shows "Unranked" if they're below that.

### 7.2 Voice tracking

- Joining a voice channel starts a session. The session is held **in memory only** until it ends.
- Leaving ends the session and saves it to history with `userId`, `channelId`, `duration`, `timestamp`, and `game` (from the member's "Playing" status, if the Presence intent can see it).
- Switching channels ends the old session and starts a new one.
- A **Voice Session Summary** is posted to `VOICE_LOG_CHANNEL_ID` for sessions longer than 1 minute. It shows the time spent, the number of members in the channel, the XP earned and the start and end times.
- History keeps the **last 2,000 sessions per server**.
- `/voicestats` shows a member's total time, session count, average session length and last session, based on that history.

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
- The bot adds a member-specific permission overwrite that denies **Use Soundboard** on each channel. Nothing else about the member changes.
- An **all voice channels** block is also applied automatically to voice channels created later, including team-mode channels (`channelCreate.js`).
- Unblocking removes only the soundboard deny and leaves any other overwrites in place, such as team-mode access.
- The bot refuses to block itself, the server owner, Administrators (they bypass overwrites anyway), and anyone whose highest role is equal to or above the invoker's (unless the invoker is the owner).

### 7.8 Points shop ⚠️ *(the code exists but the commands aren't registered; see §12)*

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

Commands: `/points [user]`, `/points gift user amount`, `/shop view`, `/shop buy item [text]`, `/shop additem ...` (admin) and `/shop removeitem name` (admin). If setting the nickname fails, the purchase is refunded automatically.

### 7.9 Weekly Wrapped

Runs every **Sunday at 12:00 PM IST** for every server and posts to `WRAPPED_CHANNEL_ID`, falling back to `DASHBOARD_CHANNEL_ID`. It covers the last 7 days of voice sessions:

- **Most Active:** most voice time.
- **Winner of the Week:** most XP gained since the last Wrapped, measured against a saved snapshot.
- **Best Duo:** the pair who spent the most time together in the same channel.
- **Most Played Game:** across the whole squad.
- **Squad Recap:** up to 20 members, each with hours, levels gained, top partner and top game.

Each run saves a new snapshot, so "XP gained" is always measured since the previous run. If there was no voice activity that week, nothing is posted. A manual `/wrapped` command exists in code but isn't registered (§12).

### 7.10 Rotating status

The bot's status cycles through seven messages every 40 seconds, such as "⚔️ Raider | Ready to Battle" and "🏆 Raider | Rank Up Now". They're defined in `index.js`.

---

## 8. Command reference

| Slash command | Prefix form | Who | Description |
|---|---|---|---|
| `/rank [user]` | `!raider rank [@user]` | Everyone | Level, XP and server rank |
| `/leaderboard` | `!raider leaderboard` | Everyone | Top 10 |
| `/voicestats [user]` | `!raider voicestats [@user]` | Everyone | Voice history stats |
| `/dashboard` | `!raider dashboard` | Everyone | Interactive stats panel |
| `/help` | `!raider help` | Everyone | Command list |
| `/team setup\|assign\|on\|off\|panel\|status` | `!raider team ...` | Admin | FPS Team Mode |
| `/setchannel type channel` | `!raider setchannel <type> #ch` | Administrator permission | Set the `welcome`, `boost`, `levelup`, `voice` or `dashboard` channel |
| `/soundboard-block` | — | Admin | Block soundboard |
| `/soundboard-unblock` | — | Admin | Unblock soundboard |
| `/soundboard-status` | — | Admin | Check soundboard restriction |
| `/points`, `/shop`, `/wrapped` | — | — | ⚠️ Currently unavailable (§12) |

`/setchannel` choices are saved in MongoDB and re-applied on startup. They take priority over the `.env` channel IDs.

---

## 9. Data storage (MongoDB)

### 9.1 Design

- **Database:** `Raider_Bot` (from `MONGODB_DB`).
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
| `teams` | `{ active, channelId, teams: { team1: [ids], team2: [ids] }, t1vcId, t2vcId, categoryId, panelOn, panelChannelId, panelMessageId }` | `/team` |
| `soundboard_blocks` | `{ [userId]: { allVoice, channelIds: [ids], by, at } }` | `/soundboard-*` |
| `points` | `{ [userId]: number }` | Level-ups, shop, gifts |
| `shop` | `[ { id, name, price, type, meta: { multiplier?, durationMinutes?, xpAmount? } } ]` | `/shop additem/removeitem` |
| `boosts` | `{ [userId]: { multiplier, expiresAt } }` | Buying a boost |
| `flair` | `{ [userId]: { flair, expiresAt } }` | Buying flair; cleared by the expiry job |
| `wrapped_snapshot` | `{ [userId]: { level, xp } }` | Weekly Wrapped |
| `channel_overrides` | `{ WELCOME_CHANNEL_ID?: id, BOOST_CHANNEL_ID?: id, ... }` | `/setchannel` |

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
mongodump --uri="<MONGODB_URI>" --db=Raider_Bot --out=backup-YYYY-MM-DD
```

---

## 10. Scheduled jobs

| Job | Schedule | Where | What it does |
|---|---|---|---|
| Voice XP tick | every 60 s | `events/ready.js` | +5 XP (boosted if active) to everyone in voice; fires `voiceLevelUp` |
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
| 1 | **`/points`, `/shop` and `/wrapped` aren't registered.** Commit `a039583` ("soundboard cmd") removed them from `commands.js`, `handlers/index.js`, the arg-building in `interactionCreate.js` and `help.js`. The handler files still exist. | Members can earn points but can't see or spend them. Wrapped still runs on its Sunday schedule | Restore those parts from commit `17e5aa3` alongside the soundboard changes, then run `npm run deploy` |
| 2 | **Voice XP is counted twice.** The 1-minute tick gives 5 XP/min, and leaving gives another 5 XP × minutes. | Voice earns ~10 XP/min instead of 5. The summary shows only half of what was actually earned | Remove one of the two (most likely the payout on leaving) |
| 3 | **Active voice sessions live only in memory.** | A restart or redeploy drops current sessions: no history entry or summary, and no voice XP until the member rejoins | Persist active sessions, or rebuild them from current voice states on `ready` |
| 4 | **Channel settings are global, not per server.** `client.config` is shared, so `/setchannel` in one server changes it for every server. | Only matters if the bot is in more than one server | Read overrides per server when sending messages |
| 5 | **MongoDB is read only at startup** (in-memory cache). | Manual edits in Atlas need a restart. Never run two bot instances on the same database | — (by design) |
| 6 | `/rank` only ranks the top 100. | Members below that show "Unranked" | Compute the rank from the full list |
| 7 | **`README.md` contains unresolved merge conflict markers** (`<<<<<<< HEAD` … `>>>>>>>`). | Shows up as broken on GitHub | Delete the markers and the `# Raider-bot` stub |
| 8 | **Stray `Raider-bot` git entry.** An empty submodule pointer was committed in `a039583`. | Confusing; clones get an empty folder | `git rm --cached Raider-bot` |
| 9 | **`node_modules/` is committed to git.** | Bloated repo and noisy diffs | Add it to `.gitignore` and `git rm -r --cached node_modules` |
| 10 | Dashboard buttons stop working after 60 s. | By design (collector timeout) | — |
| 11 | **Deprecation warning:** `ready event has been renamed to clientReady`. `index.js` uses `client.once('ready', ...)`. | Harmless now. In discord.js v15 the status rotation and scheduler would never start | Change it to `client.once(Events.ClientReady, ...)` |
| 12 | `npm install` on Render reports **1 high-severity vulnerability**. | Unknown until checked | Run `npm audit` and `npm audit fix` |
| 13 | **`ready.js` and `index.js` both handle "ready".** That's why "online" and "Logged in" each appear in the log. | Harmless duplication | Merge them into one handler |

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

Create `src/events/<name>.js` exporting `{ name: Events.X, once?: boolean, async execute(...args, client) }`. `index.js` picks it up automatically.

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
| `a039583` | Soundboard commands. **Accidentally reverted most of `17e5aa3`** (see §12 #1) |
| `f69dfb9` | Moved all storage from JSON files to MongoDB; restored the lost database functions |
