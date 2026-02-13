#!/bin/bash
set -e

# Usage: ./scripts/build-linux.sh [major|minor|patch]
# If bump type provided, version will be incremented before build

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

echo "Building Chell for Linux..."

# Build the app
pnpm tauri build

echo ""
echo "Build complete!"
echo "Artifacts are in: src-tauri/target/release/bundle/"

# Fix .deb architecture metadata
echo ""
echo "Fixing .deb architecture metadata..."
./scripts/deb-fix.sh

# List the built artifacts
echo ""
echo "Built files:"
ls -la src-tauri/target/release/bundle/appimage/ 2>/dev/null || true
ls -la src-tauri/target/release/bundle/deb/ 2>/dev/null || true
