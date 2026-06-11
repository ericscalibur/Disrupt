#!/bin/bash

set -ea

# StartOS backup/restore for the Disrupt data volume.
# Everything that matters lives in /app/data (SQLite DB, .env, secrets).

ACTION="${1:-create}"
DATA_DIR="/app/data"
BACKUP_DIR="/mnt/backup"

case "$ACTION" in
    create)
        mkdir -p "$BACKUP_DIR"
        # Safe SQLite copy: use .backup if sqlite3 is available, else cp
        if command -v sqlite3 >/dev/null 2>&1 && [ -f "$DATA_DIR/disrupt.db" ]; then
            sqlite3 "$DATA_DIR/disrupt.db" ".backup '$BACKUP_DIR/disrupt.db'"
        fi
        cp -r "$DATA_DIR/." "$BACKUP_DIR/" 2>/dev/null || true
        echo "result: success"
        ;;
    restore)
        mkdir -p "$DATA_DIR"
        cp -r "$BACKUP_DIR/." "$DATA_DIR/"
        chown -R disrupt:nodejs "$DATA_DIR" 2>/dev/null || true
        echo "result: success"
        ;;
    *)
        echo "Usage: $0 [create|restore]"
        exit 1
        ;;
esac
