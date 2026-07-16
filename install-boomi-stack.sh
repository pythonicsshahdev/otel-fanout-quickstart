#!/bin/bash
set -e

echo "=================================================="
echo "Boomi Observability Stack - Docker Run Installer"
echo "=================================================="
echo ""

# Create network
echo "1. Creating network..."
docker network create boomi-net 2>/dev/null || echo "  Network already exists"

# Start OpenSearch
echo "2. Starting OpenSearch..."
docker run -d \
  --name opensearch \
  --network boomi-net \
  -p 9200:9200 \
  -e "discovery.type=single-node" \
  -e "DISABLE_SECURITY_PLUGIN=true" \
  -e "OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m" \
  -v opensearch-data:/usr/share/opensearch/data \
  --restart unless-stopped \
  opensearchproject/opensearch:latest

# Wait for OpenSearch
echo "3. Waiting for OpenSearch to start (30 seconds)..."
sleep 30

# Start OpenSearch Dashboards
echo "4. Starting OpenSearch Dashboards..."
docker run -d \
  --name opensearch-dashboards \
  --network boomi-net \
  -p 5601:5601 \
  -e "OPENSEARCH_HOSTS=http://opensearch:9200" \
  -e "DISABLE_SECURITY_DASHBOARDS_PLUGIN=true" \
  --restart unless-stopped \
  opensearchproject/opensearch-dashboards:latest

# Start Vector
echo "5. Starting Vector (OTLP receiver)..."
docker run -d \
  --name vector \
  --network boomi-net \
  -p 4317:4317 \
  -p 4318:4318 \
  --restart unless-stopped \
  pythonicshahdev/boomi-vector:latest

# Start OTel Collector
echo "6. Starting OTel Collector (Traces)..."
docker run -d \
  --name otel-collector \
  --network boomi-net \
  -p 4319:4317 \
  -p 4320:4318 \
  --restart unless-stopped \
  pythonicshahdev/boomi-otel-collector:latest

# Start Grafana
echo "7. Starting Grafana..."
docker run -d \
  --name grafana \
  --network boomi-net \
  -p 3000:3000 \
  -e "GF_SECURITY_ADMIN_PASSWORD=admin" \
  -e "GF_SECURITY_ADMIN_USER=admin" \
  -v grafana-data:/var/lib/grafana \
  --restart unless-stopped \
  grafana/grafana:latest

echo ""
echo "=================================================="
echo "✅ Boomi Observability Stack Started!"
echo "=================================================="
echo ""
echo "Access Points:"
echo "  📊 Grafana:              http://localhost:3000"
echo "     Login: admin / admin"
echo ""
echo "  🔍 OpenSearch Dashboards: http://localhost:5601"
echo ""
echo "  🔌 OpenSearch API:        http://localhost:9200"
echo ""
echo "=================================================="
echo "Configure Your Boomi Atom:"
echo "=================================================="
echo ""
echo "Add these environment variables:"
echo ""
echo "  OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4317"
echo "  OTEL_EXPORTER_OTLP_PROTOCOL=grpc"
echo "  OTEL_LOGS_EXPORTER=otlp"
echo "  OTEL_METRICS_EXPORTER=otlp"
echo "  OTEL_SERVICE_NAME=boomi-runtime"
echo ""
echo "For traces (optional):"
echo "  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://host.docker.internal:4319"
echo "  OTEL_TRACES_EXPORTER=otlp"
echo ""
echo "=================================================="
echo "Running Containers:"
echo "=================================================="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""
echo "=================================================="
