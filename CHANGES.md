# What changed in the bot
- index.js            → old keep-alive server replaced by src/status-server.js (same port, same "Raider bot is running." reply on "/")
- src/status-server.js → /status now returns: online, ping, servers, total members, online members, uptime, + owner/admins of STATUS_GUILD_ID
- .env.example        → two new optional lines: STATUS_GUILD_ID, STATUS_ORIGIN
Copy these three files over your project, add the two variables on Render (Environment tab), redeploy.
> ⚠️ Don't do this again: copying `index.js` over the project removed the MongoDB connection. Apply changes as edits and check `git diff` first (see DOCUMENTATION.md, section 9.6).


## Website control panel + startup fix
- **Fixed:** `index.js` had lost its MongoDB startup (connect, restore saved `/setchannel` choices, safe shutdown). Restored. Without it the bot ran with no database.
- **New:** `src/web-panel.js` adds the `/panel/*` API the website's Control page uses (login, servers, channels, team mode, soundboard). Hooked into `src/status-server.js`.
- **New:** CORS preflight (OPTIONS) is answered, so the website can send POST requests.
- **New env var:** `PANEL_PASSKEY` (same passkey as the website). Added to `.env.example`, with `MONGODB_URI` / `MONGODB_DB`.
- **Fixed:** README merge-conflict markers; `.gitignore` now ignores `node_modules/`.


## Stability fixes + points/shop/wrapped (3 Nov 2026)
- **Fixed:** an error in any event handler (e.g. a failed welcome or level-up send) no longer crashes the bot. Errors are logged instead (`index.js`).
- **Fixed:** voice XP was counted twice (per-minute tick + payout on leaving). Now only the 1-minute tick awards it: 5 XP/min (`voiceStateUpdate.js`).
- **Back:** `/points`, `/shop` and `/wrapped` slash commands. `/wrapped` is now admin only. **Run `npm run deploy` once** so Discord shows them.
- **Fixed:** `.env.example` now says `MONGODB_DB=raider`, the database that holds the live data.
- **Cleanup:** `node_modules/` and the empty `Raider-bot` submodule entry are no longer tracked in git. `npm install` on Render recreates `node_modules`.
- **Docs:** README and DOCUMENTATION.md updated, with a new "Database: do's and don'ts" section. Website items moved to `WEBSITE-TODO.md`.


## Voice sitting bonus (6 Nov 2026)
- **New:** voice XP per minute now doubles every time one continuous sitting doubles in length: 8 XP/min for the first 10 min, then 16 at 10 min, 32 at 20, 64 at 40, 128 at 80, 256 at 160, 512 at 320, with no upper limit. 60 min in one go earns about 2,160 XP vs 480 for 6 × 10 min visits.
- Switching channels, or leaving and rejoining within 2 minutes, keeps the sitting going.
- Tunable in `src/config.js`: `XP_PER_VOICE_MIN` (now 8), `VOICE_SITTING_FIRST_DOUBLE_MIN`, `VOICE_SITTING_GRACE_MS`.
- `/help` explains how chat and voice XP are earned. `/voicestats` shows the member's current sitting, XP/min and time until the next doubling.
- **Fixed:** the Voice Session Summary now shows the XP actually earned (it used to estimate 5 XP/min) and adds a Sitting Bonus field.
