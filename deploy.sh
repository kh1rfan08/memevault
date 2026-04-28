#!/bin/bash
set -e
cd /opt/apps/memevault
git pull origin main
docker compose up --build -d
echo "memevault deployed successfully"
