#!/bin/bash
# PulseAi Docker Deployment Script
# Run this on your server: 109.75.40.220

echo "🚀 Deploying PulseAi..."

# Create the docker network if it doesn't exist
docker network create web 2>/dev/null || true

# Stop and remove existing container if running
docker stop pulseai 2>/dev/null || true
docker rm pulseai 2>/dev/null || true

# Build and start
docker compose up -d --build

echo ""
echo "✅ PulseAi deployed!"
echo "🔗 Access at: http://109.75.40.220/PulseAi"
echo ""
echo "📋 Check logs: docker logs pulseai"
echo "🔄 Restart:    docker compose restart"
echo "🛑 Stop:       docker compose down"
