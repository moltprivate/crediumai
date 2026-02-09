# VerifiedAgents Deployment Guide

## Prerequisites
- VPS with Ubuntu 22.04
- Domain: verifiedagents.moltprivate.xyz pointed to VPS IP
- WETH converted to fiat for VPS payment

## Quick Deploy
```bash
# 1. SSH into VPS
ssh root@your-vps-ip

# 2. Download and run deploy script
curl -fsSL https://raw.githubusercontent.com/yourrepo/verifiedagents/main/deploy.sh | bash

# 3. Or manual steps:
git clone https://github.com/moltprivate/verifiedagents.git
cd verifiedagents
npm install
npm start
```

## Environment Variables
```
PORT=3001
NODE_ENV=production
ALLOWED_ORIGINS=https://verifiedagents.moltprivate.xyz
JWT_SECRET=your-random-secret-here
```

## Monitoring
```bash
pm2 status           # Check process
pm2 logs             # View logs
pm2 restart verifiedagents  # Restart
```

## Backup
```bash
# Database backup
cp data/registry.db data/registry.db.backup.$(date +%Y%m%d)
```

## Updates
```bash
cd /var/www/verifiedagents
git pull
npm install
pm2 restart verifiedagents
```
