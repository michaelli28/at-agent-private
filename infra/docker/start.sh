#!/bin/bash

# Start the Docker browser container
echo "Starting Docker browser container..."
cd "$(dirname "$0")"
docker-compose up -d

# Wait for services to be ready
echo "Waiting for services to start..."
sleep 5

# Check if Chrome is accessible
echo "Checking Chrome CDP endpoint..."
until curl -s http://localhost:9222/json/version > /dev/null 2>&1; do
    echo "Waiting for Chrome..."
    sleep 2
done

echo ""
echo "=========================================="
echo "Docker browser is ready!"
echo ""
echo "  noVNC:  http://localhost:6080/vnc.html"
echo "  CDP:    http://localhost:9222"
echo ""
echo "To use with the agent UI, set these environment variables:"
echo ""
echo "  export USE_DOCKER_BROWSER=true"
echo "  export DOCKER_CDP_ENDPOINT=http://localhost:9222"
echo "  export NOVNC_URL=http://localhost:6080/vnc.html"
echo ""
echo "Then start the UI server:"
echo "  cd ../ui && npx ts-node server.ts"
echo "=========================================="
