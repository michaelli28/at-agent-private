# AT Agent Dashboard Dockerfile
# This Dockerfile builds the Next.js dashboard with Playwright support for running reruns
#
# Build from the at-agent root directory:
#   docker build -f dashboard/Dockerfile -t at-agent-dashboard .

# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy all package files first for better caching
COPY package.json package-lock.json* tsconfig*.json ./
COPY dashboard/package.json dashboard/package-lock.json* ./dashboard/
COPY browser/package.json ./browser/
COPY virtual-screen-reader/package.json ./virtual-screen-reader/
COPY agent/package.json ./agent/

# Install all workspace dependencies
RUN npm ci || npm install

# Copy source code
COPY dashboard/ ./dashboard/
COPY browser/ ./browser/
COPY virtual-screen-reader/ ./virtual-screen-reader/
COPY agent/ ./agent/
COPY scripts/ ./scripts/

# Build all workspace packages (agent, browser, virtual-screen-reader)
RUN npm run build || true

# Build the Next.js dashboard app
WORKDIR /app/dashboard
RUN npm run build

# Production stage - use Playwright image for browser support
FROM mcr.microsoft.com/playwright:v1.40.0-jammy AS runner

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install ts-node for running agent CLI
RUN npm install -g ts-node typescript tsconfig-paths

# Copy built Next.js standalone output
COPY --from=builder /app/dashboard/.next/standalone ./
COPY --from=builder /app/dashboard/.next/static ./.next/static
COPY --from=builder /app/dashboard/public ./public

# Copy root package.json and config (needed for npm run scripts)
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig*.json ./

# Copy workspace packages for rerun worker (with built output)
COPY --from=builder /app/browser ./browser
COPY --from=builder /app/virtual-screen-reader ./virtual-screen-reader
COPY --from=builder /app/agent ./agent
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/node_modules ./node_modules

# Set the AGENT_PATH environment variable to the app root
ENV AGENT_PATH=/app

# Copy service account (will be mounted as volume in production)
# COPY dashboard/src/lib/service.json ./src/lib/service.json

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV HEADLESS=true
ENV RERUN_WORKER_ENABLED=true
ENV RERUN_POLL_INTERVAL=5000

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
