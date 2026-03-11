#!/bin/bash
exec docker compose --profile cli run --rm claude-code "$@"
