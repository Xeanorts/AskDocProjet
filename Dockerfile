# Dockerfile - Project Name
FROM node:18-alpine

# Install dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++

# Set working directory
WORKDIR /app

# Copy root package files and install
COPY package*.json ./
RUN npm install --production

# Copy and build traitement-ia (TypeScript)
COPY traitement-ia/package*.json ./traitement-ia/
RUN cd traitement-ia && npm install
COPY traitement-ia ./traitement-ia
RUN cd traitement-ia && npm run build

# Copy email-send module
COPY email-send ./email-send

# Copy orchestrator
COPY orchestrator.js ./

# Create storage directories (including PDF cache and SQLite data)
RUN mkdir -p /app/storage/00_mail_in /app/storage/10_ia_requests /app/storage/11_pdf_cache /app/data

# Set permissions
RUN chown -R node:node /app

# Switch to non-root user
USER node

# Default command (orchestrator)
CMD ["node", "orchestrator.js"]
