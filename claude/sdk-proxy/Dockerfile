FROM oven/bun:latest

USER root
RUN apt-get update && \
    apt-get install -y --no-install-recommends iptables ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /capture

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY package.json /capture/package.json
COPY intercept-server.ts /capture/intercept-server.ts
COPY capture.ts /capture/capture.ts
COPY api-server.ts /capture/api-server.ts

ENTRYPOINT ["/entrypoint.sh"]
