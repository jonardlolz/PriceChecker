# Price Checker

Barcode price checker for sari-sari stores (React + Vite, Express API, SQLite).

- **Products are shared** by every store (ID, name, barcode).
- **Prices are per store:** each tindahan signs in with its own account and sets its own prices.
- **No barcode? No problem:** barcodes are optional (for loose/tingi items like eggs or candy per piece).
  Type a product name in the scanner box to search. When adding a product, similar existing names are
  shown first to avoid duplicates.
- **Quick picks:** each store can pin (☆) the items it sells all day; they appear as big buttons on the Scanner.
- Anyone can create a store account from the sign-in page. Any store can add a new product
  (e.g. when it scans an unknown barcode); only the **admin** can edit or delete shared products.
Public address: **https://prices.kregjonard.fun** (served through Cloudflare Tunnel).

The same steps work on **Windows, macOS and Linux**.

---

## 1. One-time setup on a computer

### Install Node.js 24 (LTS)
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

## Deployment (CI/CD)

Production runs on **this laptop** and always runs what is on the **`main` branch on GitHub**.

```
git push (main) ──► GitHub Actions: CI (build + smoke test, on GitHub's servers)
                         │ passes
                         ▼
                   self-hosted runner on this laptop ──► deploy/deploy.sh
                         back up DB → build new release → restart → health check
                         (fails? automatic rollback to the previous release + DB backup)
```

- **Pull requests / other branches:** only CI runs (on GitHub's servers). Nothing touches the laptop.
- **Push or merge to `main`:** CI, then automatic deploy. Watch it in the repo's **Actions** tab.
- **Redeploy by hand:** Actions → *Deploy* → *Run workflow*.
- Run the smoke test locally: `npm run build && npm test`.

### Where production lives (`~/price-checker`)
| Path | What |
|---|---|
| `current/` | The running release (symlink into `releases/`) |
| `releases/` | Last 5 deploys |
| `shared/.env` | **Production settings** (edit here, then `systemctl --user restart pricechecker`). Production uses `PORT=3100`. |
| `shared/data/pricechecker.db` | **Production database** |
| `backups/` | Database copy from before each deploy (last 30) |

Your dev folder (`~/Documents/PriceChecker`, its `.env` and `data/`) is **not** used by production.

### Services (run in the background, restart on crash and at boot)
| Service | Does |
|---|---|
| `pricechecker` | The app |
| `pricechecker-tunnel` | Cloudflare Tunnel → `prices.kregjonard.fun` |
| `github-runner` | Receives deploy jobs from GitHub |

```bash
systemctl --user status pricechecker            # is it running?
journalctl --user -u pricechecker -f            # live logs (also: -u pricechecker-tunnel, -u github-runner)
systemctl --user restart pricechecker           # e.g. after editing shared/.env
```

> ⚠️ With production set up, **don't run `npm run live`** on any computer: a second tunnel would split
> visitors between two different databases. For development use `npm run dev` (http://localhost:5173).

### One-time setup (already done on this laptop)
```bash
bash deploy/setup.sh                # production folder, services, GitHub runner
sudo loginctl enable-linger $USER   # keep services running when logged out / after reboot
bash deploy/setup.sh --import-data  # copy the dev database into production (once)
```

### Restore a database backup
```bash
systemctl --user stop pricechecker
cp ~/price-checker/backups/<file>.db ~/price-checker/shared/data/pricechecker.db
rm -f ~/price-checker/shared/data/pricechecker.db-wal ~/price-checker/shared/data/pricechecker.db-shm
systemctl --user start pricechecker
```

## Other commands
| Command | What it does |
|---|---|
| `npm run live` | Build + start app + start tunnel (manual mode — don't use alongside the production services) |
| `npm start` | Start the app only, at http://localhost:3000 (no public address) |
| `npm run tunnel` | Start the tunnel only (app must already be running) |
| `npm run build` | Rebuild the frontend |
| `npm run dev` | Development mode with live reload at http://localhost:5173 |
| `npm test` | Smoke test: starts the app on a temporary database and checks the API |
| `npm run dev:mobile` | Development mode reachable from phones on the same Wi-Fi (self-signed HTTPS) |

## Settings (`.env`)
| Setting | Purpose |
|---|---|
| `ADMIN_USERNAME` | Username of the admin account (default `admin`). |
| `ADMIN_PASSWORD` | Password for the admin account, used only when that account is first created on startup. Changing it later does **not** change an existing admin's password. |
| `TOKEN_SECRET` | Keeps stores signed in across restarts (sessions last 30 days). |
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
| Table | Holds |
|---|---|
| `users` | One row per store account: `username` (unique, case-insensitive), `store_name`, scrypt `password_hash`, `is_admin` |
| `products` | The shared catalog: `id` (auto-generated product ID), `barcode` (unique, optional), `product_name`, `created_by` |
| `store_favorites` | Each store's quick picks: (`user_id`, `product_id`) → `position` |
| `store_prices` | Each store's price: (`user_id`, `product_id`) → `price_cents` (integer cents to avoid rounding errors) |

Deleting a product also deletes every store's price for it. Older databases are migrated automatically on start: the old `product_id` column is removed (`id` is the
product ID), and prices from the single-price version become the admin account's prices.
