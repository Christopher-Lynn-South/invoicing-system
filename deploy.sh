#!/usr/bin/env bash
# OrderFlow — deploy script for Debian
# Run once on your server: bash deploy.sh
set -euo pipefail

DOMAIN="orders.001.com.mx"
APP_DIR="/opt/orderflow"

echo "=== OrderFlow deploy ==="

# ── 1. Install Docker if missing ──────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "Installing Docker..."
  apt-get update -qq
  apt-get install -y ca-certificates curl gnupg lsb-release
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/debian $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
  echo "Docker installed."
fi

# ── 2. Install certbot if missing ─────────────────────────────────────────────
if ! command -v certbot &>/dev/null; then
  echo "Installing certbot..."
  apt-get install -y certbot
fi

# ── 3. Clone / update repo ────────────────────────────────────────────────────
if [ ! -d "$APP_DIR/.git" ]; then
  echo "Cloning repository..."
  git clone https://github.com/Christopher-Lynn-South/invoicing-system.git "$APP_DIR"
else
  echo "Pulling latest code..."
  git -C "$APP_DIR" pull origin claude/orderflow-platform-cazBt
fi
cd "$APP_DIR"
git checkout claude/orderflow-platform-cazBt

# ── 4. Create .env if missing ─────────────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "⚠️  .env created from .env.example — EDIT IT NOW before continuing:"
  echo "    nano $APP_DIR/.env"
  echo ""
  echo "Required: POSTGRES_PASSWORD, SESSION_SECRET, STRIPE_*, FEDEX_*, MAIL_*"
  echo "Then re-run this script."
  exit 0
fi

# ── 5. Obtain SSL cert (standalone — ports 80/443 must be free) ───────────────
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  echo "Obtaining SSL certificate for $DOMAIN..."
  certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos \
    --email "$(grep ADMIN_EMAIL .env | cut -d= -f2)" || true
fi

# ── 6. Build and start containers ─────────────────────────────────────────────
echo "Building Docker images..."
docker compose build --pull

echo "Starting services..."
docker compose up -d

# ── 7. Run DB migrations and seed ─────────────────────────────────────────────
echo "Running database migrations..."
docker compose exec app node server/db/migrate.js

# Seed only if admin_users table is empty
ADMIN_COUNT=$(docker compose exec -T postgres \
  psql -U orderflow -d orderflow -tAc "SELECT COUNT(*) FROM admin_users;" 2>/dev/null || echo "0")
if [ "$ADMIN_COUNT" = "0" ]; then
  echo "Seeding admin user..."
  docker compose exec app node server/db/seed.js
fi

# ── 8. Set up certbot auto-renewal ────────────────────────────────────────────
if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
  (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && docker compose -f $APP_DIR/docker-compose.yml exec nginx nginx -s reload") \
    | crontab -
  echo "Certbot auto-renewal cron added."
fi

echo ""
echo "✓ OrderFlow is running at https://$DOMAIN"
echo ""
echo "Useful commands:"
echo "  docker compose logs -f app     # live app logs"
echo "  docker compose logs -f nginx   # nginx logs"
echo "  docker compose restart app     # restart server"
echo "  docker compose down            # stop everything"
