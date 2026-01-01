# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview - MVP

Project Name Reception Module synchronizes emails via IMAP, saving them as JSON files for other programs to access. Built with Node.js (ES modules), it runs in Docker as a single service:

- **IMAP Sync** - Syncs emails from configured mailbox (configurable interval)
- **Storage** - JSON files in `./storage/emails/` accessible from host via Docker volume
- **No REST API** - Other programs read JSON files directly from filesystem
- **No SMTP** - This is IMAP sync only, not an email server

## Quick Start Commands

**Initial Configuration:**
```bash
# 1. Copy configuration template
cp .env.example .env

# 2. Edit .env and configure Zimbra IMAP settings
nano .env

# Set these variables:
# IMAP_HOST=ssl0.ovh.net  # Your Zimbra server
# IMAP_USER=your-email@domain.com
# IMAP_PASSWORD=your-password
# IMAP_SYNC_INTERVAL=300000  # 5 minutes (optional)

# 3. Start the service
docker compose up -d

# 4. Watch sync logs
docker compose logs -f

# 5. View synced emails
ls -lh storage/emails/
npm run list-emails
```

**Without Docker (Local development):**
```bash
# Install dependencies
npm install

# Start IMAP sync
npm start

# Development mode with auto-reload
npm run dev

# View emails
npm run list-emails
```

## Docker Commands

```bash
# View logs
docker compose logs -f
# or
make docker-logs

# Shell into container
docker compose exec reception-mail sh
# or
make docker-shell

# View container status
docker compose ps

# Rebuild image
make docker-rebuild

# Clean all emails (warning!)
make docker-clean
```

## Deployment

```bash
# Deploy to production server
./deploy.sh

# Options:
# 1) Full deployment (backup + copy + build + start)
# 2) Update only (copy + restart)
# 3) Build and restart only
```

## Architecture (MVP)

### IMAP Sync Flow

```
Zimbra (OVH) → IMAP Sync (every 5 min) → Parser → JSON Files (./storage/)
                                                           ↓
                                               Other programs read files
```

**How it works:**
1. **IMAP Connection** (`src/imap/imap-sync.js`) - Connects to Zimbra/OVH IMAP server
2. **Email Polling** - Every 5 minutes (configurable), searches for unread emails
3. **Email Fetching** - Downloads email content via IMAP
4. **Email Parsing** (`src/parser/email-parser.js`) - Extracts headers, body, attachments
5. **Storage** (`src/persistence/file-storage.js`) - Saves as JSON files with naming: `YYYYMMDD_HHMMSS_<uuid>.json`
6. **Mark as Read** - Optionally marks emails as read in Zimbra (prevents re-sync)

### Key Components

**Entry Point**: `src/index.js`
- Loads environment variables from `.env`
- Validates IMAP credentials (mandatory)
- Starts IMAP sync service

**IMAP Sync**: `src/imap/imap-sync.js`
- ImapSyncService class
- Connects to Zimbra/OVH via IMAP (port 993 SSL)
- Searches for UNSEEN emails in INBOX (or configured mailbox)
- Fetches emails in batches
- Parses with mailparser
- Saves to storage
- Marks as read (optional)
- Runs on interval (default: 5 minutes)

**Storage Layer**: `src/persistence/file-storage.js`
- FileStorage singleton for JSON file operations
- Storage path: `./storage/emails/` (bind mounted in Docker to host)
- File naming: `YYYYMMDD_HHMMSS_<uuid>.json` for chronological sorting

**Parser**: `src/parser/email-parser.js`
- Uses mailparser library to extract all email components
- Extracts headers, text/html body, attachments

**Models**: `src/models/email.js`
- Defines Email structure with UUID, from/to/subject/date, headers, text/html body, attachments

**Logger**: `src/utils/logger.js`
- Console logging with methods: info, debug, warn, error

### Module System
Project uses ES modules (`"type": "module"` in package.json). All imports must use `.js` extension.

## Configuration

Environment variables in `.env`:

### IMAP Configuration (Required)
- `IMAP_HOST` - Zimbra IMAP server (e.g., ssl0.ovh.net) **[REQUIRED]**
- `IMAP_USER` - Full email address (user@domain.com) **[REQUIRED]**
- `IMAP_PASSWORD` - Email password **[REQUIRED]**
- `IMAP_PORT` (default: 993) - IMAP port (993 for SSL)
- `IMAP_MAILBOX` (default: INBOX) - Mailbox to sync
- `IMAP_SYNC_INTERVAL` (default: 300000) - Sync interval in milliseconds (5 minutes)
- `IMAP_MARK_AS_READ` (default: true) - Mark synced emails as read
- `IMAP_REJECT_UNAUTHORIZED` (default: false) - SSL certificate validation. Set to `true` for strict validation, keep default `false` for self-signed certificates (Mailcow, etc.)

### Storage & Logging
- `STORAGE_PATH` (default: /app/storage/emails in Docker, ./storage/emails locally) - Email storage directory
- `LOG_LEVEL` (default: info) - Logging level (debug, info, warn, error)
- `NODE_ENV` (default: production) - Node environment

## Accessing Emails from Other Programs

Emails are saved as JSON files in `./storage/emails/` directory. File format: `YYYYMMDD_HHMMSS_<uuid>.json`

**JSON Structure:**
```json
{
  "id": "uuid",
  "from": { "address": "...", "name": "..." },
  "to": [{ "address": "...", "name": "..." }],
  "subject": "...",
  "date": "ISO8601",
  "text": "plain text body",
  "html": "html body",
  "headers": { ... },
  "attachments": [
    {
      "filename": "...",
      "contentType": "...",
      "size": 1234,
      "content": "base64..."
    }
  ]
}
```

Files are sorted chronologically by filename. Latest email = last file when sorted.

**Example: Read latest email (Python):**
```python
import json, os
emails_dir = "./storage/emails"
files = sorted(os.listdir(emails_dir), reverse=True)
if files:
    with open(os.path.join(emails_dir, files[0])) as f:
        email = json.load(f)
        print(f"From: {email['from']['address']}")
        print(f"Subject: {email['subject']}")
```

**Example: Read latest email (Node.js):**
```javascript
import fs from 'fs';
import path from 'path';
const emailsDir = './storage/emails';
const files = fs.readdirSync(emailsDir).sort().reverse();
if (files.length > 0) {
    const email = JSON.parse(fs.readFileSync(path.join(emailsDir, files[0])));
    console.log(`From: ${email.from.address}`);
    console.log(`Subject: ${email.subject}`);
}
```

## Development Notes

### IMAP Testing

1. Configure `.env` with real Zimbra credentials
2. Start the service: `docker compose up -d`
3. Send yourself a test email to your Zimbra address
4. Wait up to 5 minutes for sync
5. Check logs: `docker compose logs -f | grep IMAP`
6. Check storage: `ls -lh storage/emails/`

### SMTP Testing
The SMTP server accepts all connections without authentication. To send test emails:
```bash
telnet localhost 2525
EHLO localhost
MAIL FROM:<sender@example.com>
RCPT TO:<recipient@example.com>
DATA
Subject: Test
<blank line>
Email body here
.
QUIT
```

Or use the test script: `./test-smtp.sh`

### Email Storage Format
Emails from both IMAP and SMTP are stored with identical format as JSON files with filename pattern: `YYYYMMDD_HHMMSS_<uuid>.json`
Each file contains full Email object with id, from, to, subject, date, headers, text, html, attachments array.

### Logger
`src/utils/logger.js` provides console logging with methods: info, debug, warn, error. Used throughout codebase for consistent output.

### Error Handling
- SMTP errors logged but don't crash server
- IMAP errors logged, sync retried on next interval
- All errors are logged with appropriate context for debugging

## Security

⚠️ **IMPORTANT**: Never commit sensitive files to git!

- `.env` - Contains IMAP passwords (in .gitignore)
- `storage/` - Contains email data (in .gitignore)
- `logs/` - May contain sensitive information (in .gitignore)
- SSL certificates - Never commit `.key`, `.pem`, `.crt` files

See `SECURITY.md` for complete security guidelines.

## Documentation

- **README.md** - Project overview and getting started
- **IMAP.md** - Complete IMAP/Zimbra sync guide (START HERE for IMAP setup)
- **STORAGE.md** - Detailed JSON format documentation
- **SECURITY.md** - Security best practices
- **ARCHITECTURE.md** - Complete architecture planning (includes future features)

## Project Status (MVP)

**MVP - COMPLETED**:
- ✅ IMAP sync from Zimbra/OVH (5-minute polling, configurable)
- ✅ Full email parsing (headers, text/html, attachments)
- ✅ JSON file storage accessible from host
- ✅ Docker containerization with bind mount
- ✅ Deployment script for production
- ✅ Comprehensive documentation

**Future Enhancements** (see GitHub Issues):
- [ ] Email sending capability (SMTP outbound)
- [ ] REST API for programmatic access
- [ ] Database storage (PostgreSQL)
- [ ] Webhooks/notifications
- [ ] Web interface

## Docker Setup (MVP)

**Current Setup:**
- Single container: `mail-sync` (Node.js IMAP sync service)
- Dockerfile: `docker/nodejs/Dockerfile`
- Volume: `./storage:/app/storage` (bind mount for host access)
- Volume: `./logs:/app/logs` (bind mount for logs)
- No PostgreSQL, Redis, SMTP, or other services
- Simple and lightweight MVP focused on IMAP synchronization and JSON storage

## Troubleshooting

### IMAP Sync Issues

**Sync not starting:**
- Verify credentials in `.env` (IMAP_HOST, IMAP_USER, IMAP_PASSWORD)
- Check logs: `docker compose logs`
- Ensure `.env` file exists and is readable

**Authentication errors:**
- Ensure IMAP_USER is full email address: `user@domain.com`
- Verify password is correct (no extra spaces)
- Test with email client (Thunderbird) to validate credentials

**No emails syncing:**
- Check emails are marked as UNSEEN in Zimbra
- Check correct mailbox: `IMAP_MAILBOX=INBOX`
- Increase log level: `LOG_LEVEL=debug` and restart

**Emails not saved:**
- Check storage permissions: `ls -la storage/`
- Check logs: `docker compose logs`
- Verify STORAGE_PATH is correct

See `IMAP.md` for complete troubleshooting guide.

## Git Workflow

**Before committing:**
- Verify `.env` is not tracked: `git status` should not show `.env`
- Verify `storage/` is not tracked
- Never commit sensitive data (passwords, email content, SSL keys)

**Cleaning up:**
```bash
# Remove old branches
git branch -d branch-name

# Check for secrets
git log --all --full-history --source -- '.env'
```

See `SECURITY.md` for complete git security guidelines.
