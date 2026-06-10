# Disrupt Portal — StartOS container
FROM node:20-alpine

WORKDIR /app

# curl: health checks | yq: configurator YAML parsing | bash: start9 scripts
# sqlite: safe DB backups | su-exec: drop privileges in entrypoint
RUN apk add --no-cache curl yq bash sqlite su-exec

# Install production dependencies first (layer caching)
# better-sqlite3 is a native module — needs python3/make/g++ to compile,
# installed temporarily and removed to keep the image small
COPY package*.json ./
RUN apk add --no-cache --virtual .build-deps python3 make g++ && \
    npm install --production && \
    apk del .build-deps

# Copy application
COPY . .

# Start9 scripts available in PATH
RUN cp start9/*.sh /usr/local/bin/ && chmod +x /usr/local/bin/*.sh

# Non-root app user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S disrupt -u 1001 && \
    mkdir -p /app/data && chown -R disrupt:nodejs /app

# Entrypoint runs as root to fix volume permissions, then drops to disrupt
# (do not set USER here)

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

CMD ["node", "disrupt-portal/server.js"]
