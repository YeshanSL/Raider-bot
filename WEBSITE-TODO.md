# Website connection: things to check later

The website is hosted separately. **No code was changed for these items.** They're here so they can be dealt with when the website is set up.

> Found during the full project review on 3 Nov 2026.

---

## 1. The control panel is turned off on Render

**What's happening:** `src/web-panel.js` only works if `PANEL_PASSKEY` is set. Render's Environment tab doesn't have it, so every `/panel/*` request returns:

```
503  { "error": "The control panel is off. Set PANEL_PASSKEY on the bot, then redeploy." }
```

**To turn it on:**
1. On the website, create the passkey with `set-passkey.html`.
2. On Render → **Environment**, add `PANEL_PASSKEY` with the **same passkey text** (12+ characters).
3. Redeploy.

## 2. `/status` doesn't return the server owner and admins

**What's happening:** `/status` returns `"home": null`, because `STATUS_GUILD_ID` isn't set on Render. Without it, the website can't show the owner and admin list.

**To fix:** on Render, add `STATUS_GUILD_ID=980089449687965726` (the main server's ID, the same as `GUILD_ID`), then redeploy.

## 3. Any website can call the bot's API

**What's happening:** `STATUS_ORIGIN` isn't set, so it defaults to `*`, and any site can read `/status` and call `/panel/*`. The panel still needs the passkey, so this isn't an open door, but it's looser than it needs to be.

**To fix:** once the website has its final address, set `STATUS_ORIGIN` on Render to it, with no trailing slash (for example `https://raiderbot-web.vercel.app`).

## 4. The panel's login rate limit can be bypassed (security)

**Where:** `src/web-panel.js`, in the `module.exports` function:

```js
const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
```

**What's wrong:** the panel allows 6 wrong passkeys per IP every 10 minutes. It takes the IP from the **first** entry of the `X-Forwarded-For` header, and whoever sends the request controls that entry. Render adds the real address at the **end** of the header. An attacker can put a different fake IP at the start of every request and get unlimited passkey guesses.

**How much it matters:** with a long, random passkey (20+ characters), guessing it is still impractical. With a short or common one, it's a real risk, because a correct guess gives control of team mode, channel settings and soundboard blocks.

**Suggested fix (not applied):** use the **last** entry, which Render adds itself:

```js
const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop().trim();
```

Also consider a global limit on wrong attempts, regardless of IP. Until it's fixed, use a long, random passkey.

---

## Checklist

- [ ] `PANEL_PASSKEY` set on Render (same as the website's)
- [ ] `STATUS_GUILD_ID` set on Render
- [ ] `STATUS_ORIGIN` set to the website's final address
- [ ] Rate-limit fix applied in `src/web-panel.js`
- [ ] Redeployed, and `https://raider-bot-q15e.onrender.com/status` shows `"home": { ... }`
