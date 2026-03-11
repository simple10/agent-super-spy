FROM mitmproxy/mitmproxy:latest

# Generate CA cert on first run, then start mitmweb in dual mode
# mitmproxy runs as UID 1000 by default in this image
# Default CMD; overridden by docker-compose command for env var support
CMD ["mitmweb", "--web-host", "0.0.0.0", "--web-port", "8081"]
