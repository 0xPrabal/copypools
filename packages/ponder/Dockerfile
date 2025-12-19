FROM node:20-slim

WORKDIR /app

# Install pnpm globally (ponder CLI requires it)
RUN npm install -g pnpm

# Copy all files first
COPY . .

# Install dependencies
RUN yarn install

# Expose ponder port
EXPOSE 42069

# Start ponder in production mode
CMD ["yarn", "start"]
