#!/bin/bash
set -e

# Usage: ./scripts/bump-version.sh [major|minor|patch]
# Default: patch

BUMP_TYPE=${1:-patch}

# Get current version from tauri.conf.json
CURRENT=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
echo "Current version: $CURRENT"

# Parse version parts
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

# Bump the appropriate part
case $BUMP_TYPE in
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  patch)
    PATCH=$((PATCH + 1))
    ;;
  *)
    echo "Usage: $0 [major|minor|patch]"
    exit 1
    ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
echo "New version: $NEW_VERSION"

# Update tauri.conf.json
sed -i '' "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" src-tauri/tauri.conf.json

# Update Cargo.toml
sed -i '' "s/^version = \"$CURRENT\"/version = \"$NEW_VERSION\"/" src-tauri/Cargo.toml

# Update package.json if it exists
if [ -f package.json ]; then
  # Replace whatever version is there (handles out-of-sync versions)
  sed -i '' "s/\"version\": \"[0-9]*\.[0-9]*\.[0-9]*\"/\"version\": \"$NEW_VERSION\"/" package.json
fi

echo "Version bumped to $NEW_VERSION in:"
echo "  - src-tauri/tauri.conf.json"
echo "  - src-tauri/Cargo.toml"
[ -f package.json ] && echo "  - package.json"
