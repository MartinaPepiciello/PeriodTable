# Period Table

A small, private period tracker that installs on your phone as a web app (PWA). It is hosted on Cloudflare Workers, with an encrypted sync store in Workers KV.

- Log period start dates, predict the next ones, and see your current cycle day
- Calendar starting on Monday, with the cycle day shown in every cell
- Predictions use either a fixed cycle length or the average of your last X cycles
- History of cycle lengths as exact numbers plus a horizontal bar chart (newest at the top)
- Works offline. Data is saved on the phone first and synced when you're online
- End-to-end encrypted sync: Cloudflare only ever stores ciphertext
- CSV import/export as a backup that doesn't depend on any server

## How the privacy works

Each deployment holds a single vault (yours), so there's nothing to name or configure. To turn on sync, go to the **Settings** tab and enter a *passphrase*. The first time, it asks you to type it twice. The browser turns the passphrase into:

| derived in your browser | what it's for | does it leave the phone? |
|---|---|---|
| AES-256-GCM key (PBKDF2-SHA256, 600k iterations) | encrypts all your data | **never** |
| auth token (from the same derivation) | proves you may read/write the vault | only its SHA-256 hash is stored on the server |

The worker ([src/worker.js](src/worker.js)) only stores `{iv, ciphertext, hash(token)}`. It can't read your dates, even if someone else gets hold of the KV contents. Whoever creates the vault first owns it. After that, nobody can read or overwrite it without the passphrase.

The passphrase can't be dropped entirely: the encryption key has to come from something only you know. Otherwise anyone who found the URL could read your data.

**There's no password reset.** If you forget the passphrase, the cloud copy can't be decrypted. Your phone's copy and any CSV exports are unaffected.

On a second device, enter the same passphrase. The two devices merge their data (deleting a date on one device carries over to the other).

## Run it locally

```bash
npm install
npm run dev
```

Then open http://127.0.0.1:8787. `wrangler dev` simulates KV locally, so sync works with no Cloudflare account.

## Deploy to Cloudflare (free plan is plenty)

1. Log in (this opens a browser window):
   ```bash
   npx wrangler login
   ```
2. Create the KV namespace:
   ```bash
   npx wrangler kv namespace create VAULT
   ```
   Copy the `id` it prints into `wrangler.jsonc` in place of `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.
3. Deploy:
   ```bash
   npm run deploy
   ```
   You'll get a URL like `https://period-table.<your-subdomain>.workers.dev`.
4. Open the URL and turn on sync in **Settings** right away, so the vault is yours.

## Install on your phone

- **iPhone (Safari):** open the URL, tap Share, then **Add to Home Screen**.
- **Android (Chrome):** open the URL, tap ⋮, then **Install app** (or **Add to Home screen**).

Once installed, the app opens full-screen and works with no connection.

## Updating the app

After changing anything in `public/`, bump `VERSION` in [public/sw.js](public/sw.js) (for example `pt-v2`) so phones pick up the new files, then run `npm run deploy`. The installed app updates itself in the background: open it once to download the update, and you'll see it the next time you open it.

## CSV format

```csv
start_date,cycle_length_days
2026-09-15,29
2026-10-14,
```

Import reads only the first column. It accepts `YYYY-MM-DD`, `DD/MM/YYYY`, `DD.MM.YYYY` and `DD-MM-YYYY`. Imported dates are added to the ones you already have. Nothing gets overwritten.

## Project layout

```
public/            the PWA (plain HTML/CSS/JS modules, no build step)
  js/app.js        UI
  js/cycles.js     cycle maths and predictions
  js/store.js      local storage and conflict-free merge
  js/sync.js       key derivation, AES-GCM, sync with the worker
  js/csv.js        CSV import/export
  sw.js            offline cache
src/worker.js      sync API (Cloudflare Worker and KV)
scripts/make-icons.mjs   renders the Fe-male icon (`npm run icons`)
```

Fonts: Archivo Black and Space Mono (both under the SIL Open Font License), in the app and the icon.
