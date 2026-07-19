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

# Generate nginx basic auth credentials from env vars
CONTROL_PLANE_USER=${CONTROL_PLANE_USER:-admin}
CONTROL_PLANE_PASSWORD=${CONTROL_PLANE_PASSWORD:-changeme}
HASH=$(openssl passwd -apr1 "$CONTROL_PLANE_PASSWORD")
printf '%s:%s\n' "$CONTROL_PLANE_USER" "$HASH" > /etc/nginx/.htpasswd

# Generate self-signed TLS cert if not already present
mkdir -p /etc/nginx/ssl
if [ ! -f /etc/nginx/ssl/nginx.crt ]; then
  echo "[init] Generating self-signed TLS certificate..."
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/nginx.key \
    -out /etc/nginx/ssl/nginx.crt \
    -subj "/CN=localhost" 2>/dev/null
fi

# Start backend and nginx
node /app/backend/server.js &
nginx -g 'daemon off;'
