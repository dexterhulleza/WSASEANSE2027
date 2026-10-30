# WorldSkills ASEAN Special Edition 2027 — Skills Registry

A web registry for the Central, Host and Country Secretariats:

- **Skills catalogue**: skills offered by each host country, with dates, capacity, documents and demand.
- **Entries**: Country Secretariats register competitors or teams in any skill, only while a registration stage (Interest, Provisional, Definitive) is open. The stage is set by the schedule, never chosen by hand.
- **Delegations**: each country registers its Official Delegate, Technical Delegate, Technical Delegate Assistants, Team Leaders and any extra roles, within the places the Central Secretariat allows.
- **Host desk**: host countries manage their skills, host information and documents, and record a decision on every entry they receive.
- **Central**: registration periods, host countries, roles and places, accounts, demand vs capacity, entry decisions, CSV exports and an activity log.

The rules are enforced by the server, not just the page: a country can only read and change its own entries, delegation and files; hosts only their own skills; registration windows and delegation places are checked on every save.

## How it is built

| Part | Choice |
|---|---|
| Server | Node.js 22, standard library only (no npm packages to install or patch) |
| Database | SQLite (built into Node 22) in the `/data` volume |
| Files | Stored in `/data/uploads`, served only to people allowed to see them |
| Sign-in | Email and password (scrypt hashes), session cookies, rate-limited sign-in |
| Live updates | Server-sent events refresh every open browser after each change |
| HTTPS | Caddy, with automatic Let's Encrypt certificates |
| Image | Built by GitHub Actions and published to `ghcr.io/dexterhulleza/wsaseanse2027` |

## Recommended Hostinger setup

| Item | Recommendation |
|---|---|
| Plan | Hostinger **KVM 1** (1 vCPU, 4 GB RAM) is enough for 11 countries; KVM 2 if you expect heavy document uploads |
| OS template | **Ubuntu 24.04 with Docker** |
| Domain | A subdomain, e.g. `registry.yourdomain.org`, with an **A record** pointing to the VPS IP |
| Firewall | Allow ports **22, 80, 443** only (hPanel → VPS → Security → Firewall) |
| Backups | Turn on Hostinger weekly VPS backups **and** the daily database backup below |

### Option A — SSH (recommended)

```bash
# on the VPS
git clone https://github.com/dexterhulleza/WSASEANSE2027.git registry
cd registry
cp .env.example .env
nano .env            # set DOMAIN, ADMIN_EMAIL, ADMIN_PASSWORD
docker compose up -d --build
docker compose logs -f app    # shows "Central Secretariat account ready"
```

Open `https://<your DOMAIN>` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. The first start creates that Central Secretariat account and seeds the 17 proposed skills; after that the `ADMIN_*` values are ignored, so you can remove `ADMIN_PASSWORD` from `.env`.

Update to a new version:

```bash
cd registry && git pull && docker compose up -d --build
```

### Option B — Hostinger Docker Manager (hPanel)

1. After the first push, GitHub Actions publishes the image. In GitHub go to **Packages → wsaseanse2027 → Package settings** and set visibility to **Public** (the image holds no data or secrets), or log the VPS in to `ghcr.io`.
2. In hPanel open **VPS → Docker Manager → Compose → URL** and paste
   `https://github.com/dexterhulleza/WSASEANSE2027/blob/main/docker-compose.yml`.
3. Add the environment variables `DOMAIN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, then **Deploy**.
4. To update later, redeploy the project (it pulls the newest `latest` image).

### Already running another site on ports 80/443?

Use `docker-compose.no-proxy.yml`, which publishes the app on `127.0.0.1:3000` only, and point your existing proxy (Traefik, Nginx Proxy Manager) at it with HTTPS:

```bash
docker compose -f docker-compose.no-proxy.yml up -d --build
```

## Backups

Daily consistent snapshot of the database and a copy of new uploads into the data volume (keeps 14):

```bash
# crontab -e on the VPS, runs at 02:30
30 2 * * * cd /root/registry && docker compose exec -T app npm run backup >> /var/log/registry-backup.log 2>&1
```

Copy backups off the server regularly, for example:

```bash
docker compose cp app:/data/backups ./backups-$(date +%F)
```

Restore: stop the app, copy a `registry-*.db` snapshot over `/data/registry.db` in the volume, start again.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `DOMAIN` | — | Public domain; Caddy requests its HTTPS certificate |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | — | First Central Secretariat account (first start only; password 10+ characters) |
| `ALLOW_SIGNUP` | `true` | Show "Request an account" on the sign-in page. Set `false` to create every account yourself |
| `APP_TIMEZONE` | `Asia/Manila` | Time zone for registration open/close dates |
| `SESSION_DAYS` | `7` | How long a sign-in lasts |

## Accounts and roles

- **Central Secretariat**: sees the Central tab, can act for any country ("Acting for"), sets registration periods, roles and places, skill status (Official, Demo Skill), approves accounts and resets passwords.
- **Country Secretariat**: one or more accounts per country. Manages its country's entries and delegation. If the country is a host, it also gets the Host desk.
- New accounts created by the Central Secretariat get a one-time password and must set their own at first sign-in. Self-registered accounts wait for approval.
- There is no email sending: password resets are done by the Central Secretariat from the Accounts panel.

## Data protection

The registry holds names and contact details of competitors (some may be under 18) and delegates. Before going live, agree a short privacy notice with the OCM, keep `ALLOW_SIGNUP` under review, limit Central accounts to the people who need them, and follow the Philippine Data Privacy Act of 2012 and each member state's rules.

## Development

```bash
npm start      # http://localhost:3000 (set COOKIE_SECURE=false, ADMIN_EMAIL, ADMIN_PASSWORD)
npm test       # end-to-end checks of the permission and registration rules
```

Requires Node.js 22.13 or later. No `npm install` needed.
