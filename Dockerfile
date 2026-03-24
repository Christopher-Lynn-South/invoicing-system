# ─── Stage 1: Build React frontend ───────────────────────────────────────────
FROM node:20-alpine AS client-builder

WORKDIR /build

# Install all deps (need devDeps for vite)
COPY package.json package-lock.json ./
RUN npm ci

# Copy client source and build
COPY client/ ./client/
RUN npm run client:build

# ─── Stage 2: Production server ───────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy server source
COPY server/ ./server/
COPY drizzle.config.js ./

# Copy built React app from stage 1
COPY --from=client-builder /build/client/dist ./client/dist

# Prescription file storage (overridden by volume in compose)
RUN mkdir -p /var/orderflow/prescriptions && chmod 700 /var/orderflow/prescriptions

# Uploaded invoices / labels
RUN mkdir -p /app/uploads

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "server/index.js"]
