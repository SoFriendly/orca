#!/bin/bash
set -e

# Build Chell for Linux using Docker
# Usage: ./scripts/build-linux-docker.sh [major|minor|patch]

# Load environment variables from .env.local if it exists
if [ -f .env.local ]; then
  export $(cat .env.local | grep -v '^#' | xargs)
fi

# Bump version if argument provided
if [ -n "$1" ]; then
  ./scripts/bump-version.sh "$1"
fi

# For Tauri signing (auto-update signatures)
if [ -z "$TAURI_SIGNING_PRIVATE_KEY" ]; then
  echo "Warning: TAURI_SIGNING_PRIVATE_KEY not set - updates won't be signed"
fi

echo "Building Chell for Linux via Docker..."

# Build the Docker image
docker build -f Dockerfile.linux -t chell-linux-builder .

# Run the build, mounting target directory for output
docker run --rm \
    -v "$PWD/src-tauri/target:/app/src-tauri/target" \
    -e TAURI_SIGNING_PRIVATE_KEY \
    -e TAURI_SIGNING_PRIVATE_KEY_PASSWORD \
    chell-linux-builder

echo ""
echo "Build complete!"

# Fix .deb architecture metadata
echo ""
echo "Fixing .deb architecture metadata..."
./scripts/deb-fix.sh

# Get version for naming
VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')

# Sign the AppImage if key is available
APPIMAGE_FILE=$(find src-tauri/target/release/bundle/appimage -name "*.AppImage" 2>/dev/null | head -1)
if [ -n "$APPIMAGE_FILE" ] && [ -n "$TAURI_SIGNING_PRIVATE_KEY" ]; then
  echo ""
  echo "Signing AppImage for auto-updates..."
  SIGN_ARGS="--private-key $TAURI_SIGNING_PRIVATE_KEY"
  if [ -n "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" ]; then
    SIGN_ARGS="$SIGN_ARGS --password $TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
  fi
  npx @tauri-apps/cli signer sign $SIGN_ARGS "$APPIMAGE_FILE"
  echo "Created: ${APPIMAGE_FILE}.sig"
fi

echo ""
echo "Artifacts:"
ls -la src-tauri/target/release/bundle/deb/ 2>/dev/null || echo "No .deb files found"
ls -la src-tauri/target/release/bundle/appimage/ 2>/dev/null || echo "No AppImage files found"

echo ""
echo "Next steps:"
echo "  1. Run ./scripts/upload-to-cloudflare.sh to upload artifacts"
echo "  2. The upload script will generate latest.json with Linux support"
