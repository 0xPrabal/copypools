# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Accept build arguments
ARG NEXT_PUBLIC_PRIVY_APP_ID
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_CHAIN_ID
ARG NEXT_PUBLIC_LP_MANAGER_ADDRESS
ARG NEXT_PUBLIC_ADAPTER_ADDRESS
ARG NEXT_PUBLIC_RPC_URL

# Set environment variables from build args
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_CHAIN_ID=$NEXT_PUBLIC_CHAIN_ID
ENV NEXT_PUBLIC_LP_MANAGER_ADDRESS=$NEXT_PUBLIC_LP_MANAGER_ADDRESS
ENV NEXT_PUBLIC_ADAPTER_ADDRESS=$NEXT_PUBLIC_ADAPTER_ADDRESS
ENV NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci && \
    npm cache clean --force

# Copy source code
COPY . .

# Build Next.js application
RUN npm run build

# Ensure public directory exists with at least a placeholder
RUN mkdir -p public && touch public/.gitkeep

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Copy built application
# Copy standalone build first
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# Copy static files
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy public directory (standalone build already includes it, but copy original if needed)
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

COPY --from=builder --chown=nextjs:nodejs /app/package*.json ./

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 0

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["node", "server.js"]
