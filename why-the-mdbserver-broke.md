# Why the bot disconnected from MongoDB

> **Investigated:** 3 Nov 2026, at `HEAD` = `cee59ee`

## Summary

Commit **`d286cc7`** ("Fix environment configuration", Yeshan Perera, 31 Oct 2026) replaced `index.js` with a copy based on an **older, pre-MongoDB version** of the file. That copy has no call to `client.db.connect()`. The bot still logs in to Discord and looks normal, but it never connects to MongoDB:

- Every start begins with **empty data**: no levels, XP, points, teams, soundboard blocks or shop items.
- **Nothing is saved.** Every write fails in the background.
- Saved `/setchannel` choices are no longer applied.

The data already in Atlas (`Raider_Bot`) **was not deleted or overwritten**, because no write has reached it since the broken version was deployed. It's still in the state it was in before `d286cc7` went live. Anything members earned after that point was only ever held in memory and is gone.

---

## Timeline

| Commit | Date | Author | What it did | Effect on MongoDB |
|---|---|---|---|---|
| `a039583` | 26 Oct | KTG11 | "soundboard cmd" | Bot still used local JSON files |
| `f69dfb9` | 26 Oct | KTG11 | Moved storage to MongoDB. Added `db.connect()`, `/setchannel` re-apply and the shutdown handler to `index.js` | ✅ Connected |
| `c9e66f6` | 26 Oct | KTG11 | "MongoDB Connection" (added the `mongodb` package) | ✅ Connected |
| `3244b0b` | 26 Oct | KTG11 | Added `DOCUMENTATION.md` | ✅ Connected |
| `d501cdb` | 26 Oct | KTG11 | Changed `'ready'` to `Events.ClientReady` in `index.js` | ✅ Connected (last working version) |
| **`d286cc7`** | **31 Oct** | **Yeshan Perera** | **Replaced `index.js` with an old copy, added `src/status-server.js`, rewrote `.env.example`** | ❌ **Never connects** |
| `cee59ee` | 1 Nov | Yeshan Perera | "error fix": only changed `src/status-server.js` | ❌ Still broken (doesn't touch `index.js`) |

---

## The cause: `index.js` was overwritten with an old copy

`d286cc7` added a status web server for the website. `CHANGES.md`, added in the same commit, says to:

> Copy these three files over your project, add the two variables on Render (Environment tab), redeploy.

The `index.js` that was copied in was built on top of the **pre-MongoDB** version from `a039583`, not on the current one. Comparing the two confirms this. The only difference between `index.js` at `a039583` and at `d286cc7` is that the old keep-alive server was swapped for the new status server:

```bash
git diff a039583 d286cc7 -- index.js
```

```diff
-const http = require('http');
-// ─── Keep-alive web server ───
-const PORT = process.env.PORT || 3000;
-http.createServer((req, res) => { ... }).listen(PORT, ...);
+// Web server: Render health check + live stats for the website (/status)
+require('./src/status-server')(client);
```

So copying the file over undid every change made to `index.js` between 26 and 31 Oct: the MongoDB startup code from `f69dfb9` and the `ready` fix from `d501cdb`.

### What `d286cc7` removed from `index.js`

```bash
git show d286cc7 -- index.js
```

**1. The MongoDB connection (this is what broke it)**

```diff
-// Load data from MongoDB before logging in, so every handler sees it
-client.db.connect()
-  .then(() => {
-    // Re-apply channels saved via /setchannel
-    for (const overrides of Object.values(client.db.getAllChannelOverrides())) {
-      Object.assign(client.config, overrides);
-    }
-    return client.login(process.env.DISCORD_TOKEN);
-  })
-  .catch(err => {
-    console.error('❌ Startup failed:', err.message);
-    process.exit(1);
-  });
+client.login(process.env.DISCORD_TOKEN);
```

`client.db.connect()` in `src/database.js` is the **only** place that:

- opens the MongoDB connection (`new MongoClient(process.env.MONGODB_URI)`),
- sets the `database` variable that every write uses,
- loads all existing data from Atlas into the in-memory cache.

Without it, the bot goes straight to `client.login()`.

**2. Re-applying `/setchannel` overrides.** This was inside the `.then()` above, so it was removed too. Channel choices saved with `/setchannel` are ignored, and only the `.env` / Render values apply.

**3. The shutdown handler**

```diff
-// Render sends SIGTERM on redeploy/restart — finish pending DB writes first
-for (const signal of ['SIGTERM', 'SIGINT']) {
-  process.on(signal, async () => {
-    console.log(`🛑 ${signal} received, saving data...`);
-    await client.db.close().catch(() => {});
-    client.destroy();
-    process.exit(0);
-  });
-}
```

This waited for pending writes and closed the connection before Render restarted the bot. Once it's back, it stops writes from being lost during a redeploy.

**4. The `ready` event fix (not related to MongoDB)**

```diff
-const { Client, GatewayIntentBits, Collection, ActivityType, Events } = require('discord.js');
+const { Client, GatewayIntentBits, Collection, ActivityType } = require('discord.js');
 ...
-client.once(Events.ClientReady, () => {
+client.once('ready', () => {
```

This brings back the `ready event has been renamed to clientReady` deprecation warning that `d501cdb` had fixed.

---

## Why it failed silently

Nothing crashes and Render shows the service as live, for three reasons:

1. **Reads don't fail.** Every getter in `src/database.js` reads the in-memory cache, which starts as `{}`. For example, `getXP()` returns `{ xp: 0, level: 0, lastMsg: 0 }` for everyone, so `/rank` and `/leaderboard` work, but they show everyone at level 0.
2. **Write errors are caught.** `persist()` calls `database.collection(store)`. Because `database` is still `null`, that throws `TypeError: Cannot read properties of null (reading 'collection')`. The error is caught and only logged:
   ```
   ❌ MongoDB write failed (xp:<guildId>): Cannot read properties of null (reading 'collection')
   ```
   The 1-minute voice XP tick writes XP, so this line repeats every minute while anyone is in voice.
3. **The `MONGODB_URI` check never runs.** The `❌ Startup failed: MONGODB_URI is not set` error is thrown inside `connect()`, which is never called. Even a wrong or missing URI produces no error.

### How to confirm in the Render logs

| Line | Working bot | Current bot |
|---|---|---|
| `🍃 Connected to MongoDB and loaded data` | ✅ present | ❌ **missing** |
| `🌐 Web server on port … (health check + /status)` | — | present |
| `❌ MongoDB write failed (...): Cannot read properties of null` | absent | ❌ **repeats** |

---

## A related change in the same commit: `.env.example`

`d286cc7` also rewrote `.env.example` and dropped the MongoDB lines:

```diff
-# MongoDB connection string (e.g. from MongoDB Atlas → Connect → Drivers)
-MONGODB_URI=mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/
-# Optional: database name (defaults to "raider")
-MONGODB_DB=
```

This **did not** cause the disconnect on Render, where the variables are still set in the Environment tab. It does mean that anyone setting up from `.env.example` won't know the bot needs them.

---

## The fix

Add the removed blocks back to the end of `index.js`, keeping the new status server:

```js
// Load data from MongoDB before logging in, so every handler sees it
client.db.connect()
  .then(() => {
    // Re-apply channels saved via /setchannel
    for (const overrides of Object.values(client.db.getAllChannelOverrides())) {
      Object.assign(client.config, overrides);
    }
    return client.login(process.env.DISCORD_TOKEN);
  })
  .catch(err => {
    console.error('❌ Startup failed:', err.message);
    process.exit(1);
  });

// Render sends SIGTERM on redeploy/restart — finish pending DB writes first
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    console.log(`🛑 ${signal} received, saving data...`);
    await client.db.close().catch(() => {});
    client.destroy();
    process.exit(0);
  });
}
```

This replaces the single `client.login(process.env.DISCORD_TOKEN);` line. Optionally, also bring back `Events` / `Events.ClientReady` from `d501cdb`, and add the `MONGODB_URI` / `MONGODB_DB` lines back to `.env.example`.

After redeploying, check that the log shows `🍃 Connected to MongoDB and loaded data`. The bot will then load the data that's still in Atlas. Progress made between the `d286cc7` deploy and the fix can't be recovered, because it was never saved.

## How to avoid this next time

- **Don't copy whole files over the project.** Apply the change itself, either as a small edit or by merging a branch, so other people's recent changes aren't undone.
- **Review the diff before pushing.** `git diff` on `index.js` would have shown the `client.db.connect()` block being deleted.
- **Check the startup log after each deploy.** If `🍃 Connected to MongoDB and loaded data` is missing, the bot isn't saving anything.
