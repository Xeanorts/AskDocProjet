#!/bin/bash
#
# Project Name - Deploy Script
# Deploys to /home/ubuntu/stacks/projectname/
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Paths
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="/home/ubuntu/stacks/projectname"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Project Name - Deployment Script${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Source:      ${SOURCE_DIR}"
echo -e "Destination: ${DEPLOY_DIR}"
echo ""

# Function to check prerequisites
check_prerequisites() {
    echo -e "${YELLOW}[1/6] Checking prerequisites...${NC}"

    # Check Docker
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}ERROR: Docker is not installed${NC}"
        exit 1
    fi

    # Check Docker Compose
    if ! docker compose version &> /dev/null; then
        echo -e "${RED}ERROR: Docker Compose is not available${NC}"
        exit 1
    fi

    # Check .env file in source
    if [ ! -f "${SOURCE_DIR}/.env" ]; then
        echo -e "${RED}ERROR: .env file is missing in source${NC}"
        echo -e "  Create it from the template:"
        echo -e "  ${YELLOW}cp .env.example .env${NC}"
        echo -e "  Then configure your credentials"
        exit 1
    fi

    # Check whitelist.json in source
    if [ ! -f "${SOURCE_DIR}/config/whitelist.json" ]; then
        echo -e "${RED}ERROR: config/whitelist.json is missing${NC}"
        echo -e "  Create it from the template:"
        echo -e "  ${YELLOW}cp config/whitelist.json.example config/whitelist.json${NC}"
        exit 1
    fi

    # Check required env vars
    MISTRAL_KEY=$(grep -E "^MISTRAL_API_KEY=" "${SOURCE_DIR}/.env" | cut -d'=' -f2- | tr -d '"')
    IMAP_PASS=$(grep -E "^IMAP_PASSWORD=" "${SOURCE_DIR}/.env" | cut -d'=' -f2- | tr -d '"')

    if [ -z "$MISTRAL_KEY" ] || [ "$MISTRAL_KEY" = "your-mistral-api-key" ]; then
        echo -e "${RED}ERROR: MISTRAL_API_KEY not configured in .env${NC}"
        exit 1
    fi

    if [ -z "$IMAP_PASS" ] || [ "$IMAP_PASS" = "your-password" ]; then
        echo -e "${RED}ERROR: IMAP_PASSWORD not configured in .env${NC}"
        exit 1
    fi

    echo -e "${GREEN}  All prerequisites OK${NC}"
}

# Function to stop existing containers
stop_existing() {
    echo -e "${YELLOW}[2/6] Stopping existing containers...${NC}"

    if [ -d "${DEPLOY_DIR}" ]; then
        cd "${DEPLOY_DIR}"
        docker compose down 2>/dev/null || true
        docker rm -f projectname-reception projectname-orchestrator 2>/dev/null || true
    fi

    echo -e "${GREEN}  Containers stopped${NC}"
}

# Function to sync files
sync_files() {
    echo -e "${YELLOW}[3/6] Syncing files to deployment directory...${NC}"

    # Create deploy directory
    mkdir -p "${DEPLOY_DIR}"

    # Rsync project files (excluding dev files, node_modules, storage, logs)
    rsync -av --delete \
        --exclude '.git' \
        --exclude '.gitignore' \
        --exclude '.claude' \
        --exclude 'node_modules' \
        --exclude '**/node_modules' \
        --exclude 'storage' \
        --exclude 'logs' \
        --exclude '*.log' \
        --exclude '.env' \
        --exclude '.env.example' \
        --exclude 'config/whitelist.json' \
        --exclude '*.md' \
        --exclude 'docs' \
        "${SOURCE_DIR}/" "${DEPLOY_DIR}/"

    # Copy sensitive files separately (not in rsync to avoid accidental deletion)
    echo -e "  Copying configuration files..."
    cp "${SOURCE_DIR}/.env" "${DEPLOY_DIR}/.env"
    cp "${SOURCE_DIR}/config/whitelist.json" "${DEPLOY_DIR}/config/whitelist.json"

    echo -e "${GREEN}  Files synced${NC}"
}

# Function to fix permissions (both containers need write access)
# - orchestrator runs as node (UID 1000)
# - reception-mail runs as mailapp (UID 1001)
fix_permissions() {
    echo -e "${YELLOW}Fixing storage permissions...${NC}"
    cd "${DEPLOY_DIR}"

    # Create directories if they don't exist
    mkdir -p storage/00_mail_in
    mkdir -p storage/10_ia_requests
    mkdir -p storage/11_pdf_cache
    mkdir -p storage/12_conversation_threads
    mkdir -p storage/quarantine
    mkdir -p logs

    # Use 777 to allow both container users (1000 and 1001) to write
    # Ignore errors for files created by containers (owned by different UIDs)
    chmod -R 777 storage/ logs/ 2>/dev/null || true

    echo -e "${GREEN}  Permissions fixed${NC}"
}

# Function to create directories
create_directories() {
    echo -e "${YELLOW}[4/6] Creating storage directories...${NC}"
    fix_permissions
    echo -e "${GREEN}  Directories created${NC}"
}

# Function to build and start
build_and_start() {
    echo -e "${YELLOW}[5/6] Building Docker images...${NC}"

    cd "${DEPLOY_DIR}"
    docker compose build --no-cache

    echo -e "${GREEN}  Build complete${NC}"

    echo -e "${YELLOW}[6/6] Starting services...${NC}"

    docker compose up -d

    echo -e "${GREEN}  Services started${NC}"
}

# Function to show status
show_status() {
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  Deployment Complete!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "Deployed to: ${DEPLOY_DIR}"
    echo ""

    cd "${DEPLOY_DIR}"

    echo -e "${YELLOW}Container status:${NC}"
    docker compose ps

    echo ""
    echo -e "${YELLOW}Commands:${NC}"
    echo -e "  View logs:         ${GREEN}cd ${DEPLOY_DIR} && docker compose logs -f${NC}"
    echo -e "  View orchestrator: ${GREEN}docker compose logs -f orchestrator${NC}"
    echo -e "  View reception:    ${GREEN}docker compose logs -f reception-mail${NC}"
    echo -e "  Stop services:     ${GREEN}docker compose down${NC}"
    echo -e "  Restart:           ${GREEN}docker compose restart${NC}"
    echo ""

    echo -e "${YELLOW}Storage paths:${NC}"
    echo -e "  Incoming emails:  ${DEPLOY_DIR}/storage/00_mail_in/"
    echo -e "  Processed:        ${DEPLOY_DIR}/storage/10_ia_requests/"
    echo -e "  PDF cache:        ${DEPLOY_DIR}/storage/11_pdf_cache/"
    echo -e "  Thread context:   ${DEPLOY_DIR}/storage/12_conversation_threads/"
    echo -e "  Quarantine:       ${DEPLOY_DIR}/storage/quarantine/"
    echo ""
}

# Function to show logs
show_initial_logs() {
    echo -e "${YELLOW}Showing initial logs (Ctrl+C to exit)...${NC}"
    echo ""
    sleep 3
    cd "${DEPLOY_DIR}"
    docker compose logs --tail=50
}

# Main execution
main() {
    check_prerequisites
    stop_existing
    sync_files
    create_directories
    build_and_start
    show_status
    show_initial_logs
}

# Handle arguments
case "${1:-}" in
    --help|-h)
        echo "Usage: $0 [OPTIONS]"
        echo ""
        echo "Deploys Project Name to ${DEPLOY_DIR}"
        echo ""
        echo "Options:"
        echo "  --help, -h         Show this help"
        echo "  --build-only       Only build, don't start"
        echo "  --restart          Restart with permission fix"
        echo "  --logs             Show logs only"
        echo "  --status           Show status only"
        echo "  --sync             Sync files only (no build/start)"
        echo "  --fix-permissions  Fix storage permissions only"
        exit 0
        ;;
    --build-only)
        check_prerequisites
        stop_existing
        sync_files
        create_directories
        echo -e "${YELLOW}Building Docker images...${NC}"
        cd "${DEPLOY_DIR}"
        docker compose build --no-cache
        echo -e "${GREEN}Build complete. Run 'cd ${DEPLOY_DIR} && docker compose up -d' to start.${NC}"
        exit 0
        ;;
    --restart)
        echo -e "${YELLOW}Restarting services...${NC}"
        cd "${DEPLOY_DIR}"
        fix_permissions
        docker compose restart
        docker compose ps
        exit 0
        ;;
    --logs)
        cd "${DEPLOY_DIR}"
        docker compose logs -f
        exit 0
        ;;
    --status)
        cd "${DEPLOY_DIR}"
        docker compose ps
        exit 0
        ;;
    --sync)
        check_prerequisites
        sync_files
        create_directories
        echo -e "${GREEN}Files synced to ${DEPLOY_DIR}${NC}"
        echo -e "Run 'cd ${DEPLOY_DIR} && docker compose restart' to apply changes"
        exit 0
        ;;
    --fix-permissions)
        fix_permissions
        exit 0
        ;;
    *)
        main
        ;;
esac
