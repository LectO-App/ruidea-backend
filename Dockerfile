FROM node:20-bookworm-slim

# Install system Chromium (used by Puppeteer instead of a bundled download)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    ca-certificates \
    wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# Prisma: no update/telemetry checks at build or start.
ENV CHECKPOINT_DISABLE=1

WORKDIR /usr/src/app

# Install deps from the lockfile only (reproducible, no implicit upgrades)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Generate the Prisma client for prisma/schema.prisma (engines come from npm ci above).
RUN ./node_modules/.bin/prisma generate

# Drop root: run as the built-in unprivileged "node" user
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Apply pending database migrations to DATABASE_URL (idempotent; an empty database gets the
# whole schema), then start the API as before. If migrations fail the container exits.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && exec npm start"]
