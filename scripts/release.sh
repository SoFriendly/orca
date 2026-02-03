#!/bin/bash
set -e

# Usage: ./scripts/release.sh [major|minor|patch]
# This script handles the full release workflow:
# 1. Bumps the version
# 2. Builds macOS (with signing and notarization)
# 3. Commits the version change
# 4. Creates a git tag
# 5. Pushes to trigger CI builds for Linux/Windows

# Check for bump type argument
if [ -z "$1" ]; then
  echo "Usage: ./scripts/release.sh [major|minor|patch]"
  echo ""
  echo "This will:"
  echo "  1. Bump the version"
  echo "  2. Build and sign macOS app"
  echo "  3. Commit the version change"
  echo "  4. Create a git tag"
  echo "  5. Push to trigger Linux/Windows CI builds"
  exit 1
fi

BUMP_TYPE=$1

# Ensure we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "Warning: You're on branch '$CURRENT_BRANCH', not 'main'"
  read -p "Continue anyway? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Check for uncommitted changes (except version files which we'll handle)
if ! git diff --quiet --exit-code -- ':!src-tauri/tauri.conf.json' ':!src-tauri/Cargo.toml' ':!package.json' ':!Cargo.lock'; then
  echo "Error: You have uncommitted changes. Please commit or stash them first."
  exit 1
fi

# Get current version before bump
OLD_VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
echo "Current version: $OLD_VERSION"

# Run macOS build (includes version bump)
echo ""
echo "=== Building macOS ==="
./scripts/build-macos.sh "$BUMP_TYPE"

# Get new version after bump
NEW_VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
echo ""
echo "New version: $NEW_VERSION"

# Check if tag already exists
if git rev-parse "v$NEW_VERSION" >/dev/null 2>&1; then
  echo "Error: Tag v$NEW_VERSION already exists"
  exit 1
fi

# Stage version files
echo ""
echo "=== Committing version bump ==="
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock package.json

# Commit
git commit -m "Bump version to $NEW_VERSION"

# Create tag
echo ""
echo "=== Creating tag v$NEW_VERSION ==="
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"

# Push commit and tag
echo ""
echo "=== Pushing to remote ==="
git push origin "$CURRENT_BRANCH"
git push origin "v$NEW_VERSION"

# Upload macOS builds to Cloudflare R2
echo ""
echo "=== Uploading to Cloudflare R2 ==="
./scripts/upload-to-cloudflare.sh

echo ""
echo "=== Release complete! ==="
echo ""
echo "Version: $NEW_VERSION"
echo "Tag: v$NEW_VERSION"
echo ""
echo "GitHub Actions is building Linux and Windows versions."
echo "Monitor progress at: https://github.com/jmitch/chell/actions"
echo ""
echo "Once CI completes, review and publish the draft release on GitHub."
