#!/bin/bash
set -e
cd /opt/apps/memevault
git pull origin master
docker compose up --build -d
echo "memevault deployed successfully"
