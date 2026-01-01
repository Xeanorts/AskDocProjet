# Dockerfile pour l'implémentation Node.js du serveur de réception de mails
FROM node:18-alpine AS base

# Installer les dépendances système nécessaires
RUN apk add --no-cache \
    tini \
    && rm -rf /var/cache/apk/*

# Utiliser tini pour une meilleure gestion des signaux
ENTRYPOINT ["/sbin/tini", "--"]

WORKDIR /app

# ----- Builder Stage -----
FROM base AS builder

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer toutes les dépendances (y compris dev pour le build)
RUN npm ci

# Copier le code source
COPY . .

# Si TypeScript est utilisé, décommenter :
# RUN npm run build

# ----- Production Stage -----
FROM base AS production

# Variables d'environnement par défaut
ENV NODE_ENV=production \
    SMTP_PORT=2525 \
    API_PORT=3000

# Créer un utilisateur non-root pour la sécurité
RUN addgroup -g 1001 mailapp && \
    adduser -D -u 1001 -G mailapp mailapp

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer uniquement les dépendances de production
RUN npm ci --only=production && \
    npm cache clean --force

# Copier le code depuis le builder
COPY --from=builder /app/src ./src
# Si TypeScript avec build: COPY --from=builder /app/dist ./dist

# Créer les répertoires nécessaires avec les bonnes permissions
RUN mkdir -p /app/storage/emails /app/storage/attachments /app/logs && \
    chown -R mailapp:mailapp /app

# Passer à l'utilisateur non-root
USER mailapp

# Exposer les ports SMTP et API
EXPOSE 2525 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Démarrer l'application
CMD ["node", "src/index.js"]
# Si TypeScript avec build: CMD ["node", "dist/index.js"]
