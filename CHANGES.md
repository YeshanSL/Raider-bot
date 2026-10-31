# What changed in the bot
- index.js            → old keep-alive server replaced by src/status-server.js (same port, same "Raider bot is running." reply on "/")
- src/status-server.js → /status now returns: online, ping, servers, total members, online members, uptime, + owner/admins of STATUS_GUILD_ID
- .env.example        → two new optional lines: STATUS_GUILD_ID, STATUS_ORIGIN
Copy these three files over your project, add the two variables on Render (Environment tab), redeploy.
