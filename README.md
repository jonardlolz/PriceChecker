# Price Checker

Barcode price checker (React + Vite) with an admin panel, an Express API and a SQLite database.
Public address: **https://prices.kregjonard.fun** (served through Cloudflare Tunnel).

The same steps work on **Windows, macOS and Linux**.

---

## 1. One-time setup on a computer

### Install Node.js (version 22.13 or newer; 24 LTS recommended)
- **Windows:** `winget install OpenJS.NodeJS.LTS` (or the installer from https://nodejs.org)
- **macOS:** `brew install node` (or the installer from https://nodejs.org)
- **Linux:** use your distro's NodeSource packages or `nvm` — see https://nodejs.org/en/download

Check with `node -v`.

### Install cloudflared (only needed for the public HTTPS address)
- **Windows:** `winget install --id Cloudflare.cloudflared`
- **macOS:** `brew install cloudflared`
- **Linux (Debian/Ubuntu, 64-bit):**
  ```bash
  curl -L -o cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  sudo dpkg -i cloudflared.deb
  ```
  Other distros/architectures: https://github.com/cloudflare/cloudflared/releases

Check with `cloudflared --version`. You do **not** need to log in to Cloudflare — the tunnel token in `.env` is enough.

### Copy the project
Copy the project folder to the computer, **including**:
- `.env` — admin password, secrets and the tunnel token (**keep private**; it is not in git)
- `data/` — the database with all your products (skip it to start with an empty database)

Do **not** copy `node_modules/` or `dist/`; they are recreated.

**Starting fresh (e.g. after `git clone`)?** There is no `.env` in the repo. Create one from the template
and fill in the values — see the comments inside it:
```bash
cp .env.example .env        # Windows: copy .env.example .env
```

Then, in a terminal opened in the project folder:
```bash
npm install
```

---

## 2. Start it

```bash
npm run live
```
This builds the app, starts it, and connects the tunnel. When you see
`Registered tunnel connection` four times, open **https://prices.kregjonard.fun**.

**Stop:** press `Ctrl + C` in that terminal.

The site is only online while this command is running and the computer is awake and connected.

> ⚠️ Run it on **one computer at a time**. Each computer has its own `data/` database, and Cloudflare
> would split visitors between them.

### Moving to another computer
Stop it on the old one, copy `data/` (and `.env` if needed) to the new one, then `npm run live` there.

---

## Other commands
| Command | What it does |
|---|---|
| `npm run live` | Build + start app + start tunnel (normal use) |
| `npm start` | Start the app only, at http://localhost:3000 (no public address) |
| `npm run tunnel` | Start the tunnel only (app must already be running) |
| `npm run build` | Rebuild the frontend |
| `npm run dev` | Development mode with live reload at http://localhost:5173 |
| `npm run dev:mobile` | Development mode reachable from phones on the same Wi-Fi (self-signed HTTPS) |

## Settings (`.env`)
| Setting | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Admin login password. Change it here, then restart. |
| `TOKEN_SECRET` | Keeps admins signed in across restarts. |
| `HOST` | `127.0.0.1` = only reachable through the tunnel (recommended). `0.0.0.0` = also from your local network at `http://<computer-ip>:3000`. |
| `PORT` | App port (default 3000). |
| `CURRENCY` | Price currency (default `PHP`), e.g. `PHP`, `USD`, `EUR`. |
| `TUNNEL_TOKEN` | Connects this computer to `prices.kregjonard.fun`. Secret. |
| `DB_PATH` | Optional: database file location (default `data/pricechecker.db`). |

**If the tunnel token leaks:** in the Cloudflare dashboard go to *Zero Trust → Networks → Tunnels →
price-checker* and rotate/refresh the token, then put the new one in `.env`.

## Backups
The whole database is `data/pricechecker.db` (plus `-wal`/`-shm` files while running).
Stop the app and copy the `data/` folder to back it up.

## Troubleshooting
- **`https://prices.kregjonard.fun` shows a Vercel "deployment not found" page:** your network still
  has an old DNS answer cached. Wait a few hours, or on Android set *Settings → Network → Private DNS*
  to `1dot1dot1dot1.cloudflare-dns.com`.
- **Cloudflare "Error 1033" / "502 Bad Gateway":** `npm run live` isn't running, or the app crashed —
  check the terminal.
- **`cloudflared is not installed`:** install it (step 1) and open a new terminal.
- **Port 3000 already in use:** another copy is running; stop it or change `PORT` in `.env`.

## Data model
| Column | Notes |
|---|---|
| `id` | Internal database ID (auto-increment, never edited) |
| `product_id` | Your Product ID — unique, editable |
| `barcode` | Unique |
| `product_name` | |
| `price_cents` | Stored as integer cents to avoid rounding errors |
