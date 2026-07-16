FROM timberio/vector:latest-alpine

# Add metadata
LABEL description="Vector OTLP receiver for Boomi Atom telemetry"
LABEL version="1.0.0"

# Copy configuration
COPY vector.toml /etc/vector/vector.toml

# Expose ports
EXPOSE 4317 4318

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8686/health || exit 1

CMD ["--config", "/etc/vector/vector.toml"]