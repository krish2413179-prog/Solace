# Use Node.js 18 Alpine for smaller image size
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Expose port (Fly.io will set PORT env var)
EXPOSE 8080

# Start command: decode keystores then run agents
CMD ["sh", "-c", "npm run decode && npm start"]
