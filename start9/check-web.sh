#!/bin/bash

set -ea

PORT="${PORT:-3000}"
# Verified: Disrupt exposes /healthz
URL="http://localhost:${PORT}/healthz"

response_code=$(curl -s -o /dev/null -w "%{http_code}" "$URL" --max-time 10 || echo "000")

if [ "$response_code" = "200" ]; then
    echo '{"result": "success", "message": "Disrupt Portal web interface is ready"}'
elif pgrep -f "node server.js" > /dev/null 2>&1; then
    echo '{"result": "starting", "message": "Disrupt Portal is starting up"}'
else
    echo '{"result": "error", "message": "Disrupt Portal process is not running"}'
fi
