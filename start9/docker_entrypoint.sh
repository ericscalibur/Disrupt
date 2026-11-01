#!/bin/bash

set -ea

# Running as root — fix volume permissions then drop to app user
mkdir -p /app/data
chown -R disrupt:nodejs /app/data

# Persist the SQLite database on the data volume.
# Verified: db.js honors DISRUPT_DB_PATH, so no symlink needed.
export DISRUPT_DB_PATH="/app/data/disrupt.db"

# Generate JWT secrets once, persisted on the data volume
if [ ! -f /app/data/.secrets ]; then
    echo "Generating JWT secrets..."
    cat > /app/data/.secrets << EOF
ACCESS_TOKEN_SECRET=$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')
REFRESH_TOKEN_SECRET=$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')
EOF
    chmod 600 /app/data/.secrets
    chown disrupt:nodejs /app/data/.secrets
fi

# Load secrets, then user config (written by configurator.sh)
set -a
source /app/data/.secrets
[ -f /app/data/.env ] && source /app/data/.env
set +a

# StartOS handles SSL/Tor proxying — serve plain HTTP on 3000
export NODE_ENV="production"
export PORT="3000"

# Bootstrap the admin account if the DB has no users yet.
# (Disrupt normally requires interactive `npm run setup`; on StartOS the
# admin credentials come from the Config tab instead.)
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
    echo "Ensuring admin account exists..."
    su-exec disrupt node /app/start9/create-admin.js || {
        echo "WARNING: admin bootstrap failed — check Config values"; }
fi

echo "Starting Disrupt Portal..."
cd /app
exec su-exec disrupt node disrupt-portal/server.js
