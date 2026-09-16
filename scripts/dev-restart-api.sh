#!/usr/bin/env bash
# Restarts the API for local verification: frees port 4000, then boots tsx.
set -u
PORT=${1:-4000}
for pid in $(netstat -ano | grep -E "LISTENING" | grep ":$PORT " | awk '{print $NF}' | sort -u); do
  taskkill //PID "$pid" //F >/dev/null 2>&1 && echo "stopped pid $pid on :$PORT"
done
sleep 1
