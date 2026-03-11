FROM oven/bun:latest

USER root
RUN apt-get update && \
    apt-get install -y --no-install-recommends iptables ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY package.json tsconfig.json /app/
RUN bun install

COPY server.ts router.ts keys.ts opik.ts /app/

ENTRYPOINT ["/entrypoint.sh"]
