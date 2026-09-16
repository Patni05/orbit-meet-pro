#!/usr/bin/env bash
# Stops only the app servers, by port.
#
# `taskkill /F /IM node.exe` also kills Docker Desktop's own Node helpers and
# takes the whole daemon down with it, so the ports are targeted instead.
set -u
for port in "$@"; do
  for pid in $(netstat -ano 2>/dev/null | grep ":${port} " | grep LISTENING | awk '{print $5}' | sort -u); do
    taskkill //F //PID "$pid" >/dev/null 2>&1 && echo "stopped pid ${pid} on port ${port}"
  done
done
exit 0
