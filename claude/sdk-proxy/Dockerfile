FROM oven/bun:latest

USER root
RUN apt-get update && \
    apt-get install -y --no-install-recommends iptables ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY package.json /app/package.json
COPY intercept-server.ts /app/intercept-server.ts
COPY capture.ts /app/capture.ts
COPY api-server.ts /app/api-server.ts
COPY cache-control.ts /app/cache-control.ts
COPY cache-plugin.ts /app/cache-plugin.ts
COPY plugins /app/plugins

ENTRYPOINT ["/entrypoint.sh"]
