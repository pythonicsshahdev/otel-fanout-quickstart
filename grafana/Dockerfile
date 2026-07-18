FROM grafana/grafana:latest
USER root
RUN apk add --no-cache curl unzip && \
    curl -ksSL "https://grafana.com/api/plugins/grafana-opensearch-datasource/versions/latest/download" \
         -o /tmp/opensearch-plugin.zip && \
    unzip -q /tmp/opensearch-plugin.zip -d /var/lib/grafana/plugins && \
    rm /tmp/opensearch-plugin.zip
USER grafana
