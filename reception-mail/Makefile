# Makefile pour le serveur de synchronisation IMAP
# Usage: make [target]

.PHONY: help docker-up docker-down docker-logs docker-build docker-clean test

# Détecter la commande docker-compose
DOCKER_COMPOSE := $(shell if docker compose version > /dev/null 2>&1; then echo "docker compose"; else echo "docker-compose"; fi)

# Couleurs pour l'affichage
GREEN  := \033[0;32m
YELLOW := \033[1;33m
NC     := \033[0m # No Color

##@ Général

help: ## Afficher cette aide
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make $(GREEN)<target>$(NC)\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  $(GREEN)%-15s$(NC) %s\n", $$1, $$2 } /^##@/ { printf "\n$(YELLOW)%s$(NC)\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

##@ Docker

docker-up: ## Démarrer la synchronisation IMAP
	@echo "$(GREEN)Démarrage de la synchronisation IMAP...$(NC)"
	@mkdir -p storage/emails logs
	$(DOCKER_COMPOSE) up -d
	@echo "$(GREEN)Service démarré!$(NC)"
	@echo "Emails: ./storage/emails/"

docker-down: ## Arrêter le serveur
	@echo "$(YELLOW)Arrêt du serveur...$(NC)"
	$(DOCKER_COMPOSE) down
	@echo "$(GREEN)Serveur arrêté$(NC)"

docker-logs: ## Voir les logs
	$(DOCKER_COMPOSE) logs -f

docker-build: ## Reconstruire l'image
	@echo "$(GREEN)Reconstruction de l'image Docker...$(NC)"
	$(DOCKER_COMPOSE) build

docker-rebuild: ## Reconstruire sans cache
	@echo "$(GREEN)Reconstruction complète...$(NC)"
	$(DOCKER_COMPOSE) build --no-cache

docker-clean: ## Nettoyer Docker (⚠️ supprime les emails)
	@echo "$(YELLOW)⚠️  Attention: ceci va supprimer tous les emails!$(NC)"
	@read -p "Êtes-vous sûr ? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		$(DOCKER_COMPOSE) down; \
		rm -rf storage/emails/* logs/*; \
		echo "$(GREEN)Nettoyage terminé$(NC)"; \
	else \
		echo "Annulé"; \
	fi

docker-ps: ## Voir l'état du conteneur
	$(DOCKER_COMPOSE) ps

docker-shell: ## Ouvrir un shell dans le conteneur
	$(DOCKER_COMPOSE) exec mail-sync sh

##@ Emails

list-emails: ## Lister les emails reçus
	@echo "$(GREEN)Emails reçus:$(NC)"
	@ls -lh storage/emails/ 2>/dev/null || echo "Aucun email"

show-latest: ## Afficher le dernier email
	@echo "$(GREEN)Dernier email reçu:$(NC)"
	@npm run list-emails 2>/dev/null || echo "npm install requis"

##@ Développement

setup: ## Configuration initiale du projet
	@echo "$(GREEN)Configuration du projet...$(NC)"
	@mkdir -p storage/emails logs
	@echo "$(GREEN)Répertoires créés$(NC)"
	@echo "Lancez: make docker-up ou npm install && npm start"

clean: ## Nettoyer les fichiers temporaires
	@echo "$(GREEN)Nettoyage des fichiers temporaires...$(NC)"
	@rm -rf tmp/ *.log
	@echo "$(GREEN)Nettoyage terminé$(NC)"

logs: ## Voir les logs locaux
	@tail -f logs/*.log 2>/dev/null || echo "$(YELLOW)Aucun fichier de log$(NC)"

##@ Monitoring

stats: ## Afficher les statistiques du conteneur
	@docker stats --no-stream mail-sync

watch: ## Surveiller l'état du conteneur
	@watch -n 2 '$(DOCKER_COMPOSE) ps'

##@ Déploiement

deploy: ## Déployer vers /home/ubuntu/stacks/projectname
	@echo "$(GREEN)Démarrage du déploiement...$(NC)"
	./deploy.sh
