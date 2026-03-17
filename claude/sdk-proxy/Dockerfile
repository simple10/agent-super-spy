FROM oven/bun:latest

USER root
RUN apt-get update && \
    apt-get install -y --no-install-recommends iptables ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY app /app

ENTRYPOINT ["/entrypoint.sh"]
