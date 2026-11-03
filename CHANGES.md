# What changed in the bot
- index.js            → old keep-alive server replaced by src/status-server.js (same port, same "Raider bot is running." reply on "/")
- src/status-server.js → /status now returns: online, ping, servers, total members, online members, uptime, + owner/admins of STATUS_GUILD_ID
- .env.example        → two new optional lines: STATUS_GUILD_ID, STATUS_ORIGIN
Copy these three files over your project, add the two variables on Render (Environment tab), redeploy.


## Website control panel + startup fix
- **Fixed:** `index.js` had lost its MongoDB startup (connect, restore saved `/setchannel` choices, safe shutdown). Restored. Without it the bot ran with no database.
- **New:** `src/web-panel.js` adds the `/panel/*` API the website's Control page uses (login, servers, channels, team mode, soundboard). Hooked into `src/status-server.js`.
- **New:** CORS preflight (OPTIONS) is answered, so the website can send POST requests.
- **New env var:** `PANEL_PASSKEY` (same passkey as the website). Added to `.env.example`, with `MONGODB_URI` / `MONGODB_DB`.
- **Fixed:** README merge-conflict markers; `.gitignore` now ignores `node_modules/`.
