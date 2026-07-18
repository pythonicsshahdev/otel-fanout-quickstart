#!/bin/sh
# Initialize shared volumes with defaults on first run

CONFIG_DIR=${CONFIG_OUTPUT_PATH%/*}
TEMPLATE_DIR=${TEMPLATE_PATH%/*}

# Initialize otel-collector config if not present
if [ ! -f "$CONFIG_OUTPUT_PATH" ]; then
  echo "[init] Writing default otel-collector config..."
  mkdir -p "$CONFIG_DIR"
  cp /defaults/otel-collector-config.yaml "$CONFIG_OUTPUT_PATH"
fi

# Initialize HBS template if not present
if [ ! -f "$TEMPLATE_PATH" ]; then
  echo "[init] Writing default HBS template..."
  mkdir -p "$TEMPLATE_DIR"
  cp /defaults/otel-collector-config.hbs "$TEMPLATE_PATH"
fi

# Initialize prometheus config if not present
if [ ! -f "/prometheus-config/prometheus.yml" ]; then
  echo "[init] Writing default prometheus config..."
  mkdir -p /prometheus-config
  cp /defaults/prometheus.yml /prometheus-config/prometheus.yml
fi

# Start backend and nginx
node /app/backend/server.js &
nginx -g 'daemon off;'
