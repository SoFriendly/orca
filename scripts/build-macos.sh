#!/bin/bash
set -e

# Usage: ./scripts/build-macos.sh [major|minor|patch]
# If bump type provided, version will be incremented before build

# Load environment variables from .env.local if it exists
if [ -f .env.local ]; then
  export $(cat .env.local | grep -v '^#' | xargs)
fi

# Bump version if argument provided
if [ -n "$1" ]; then
  ./scripts/bump-version.sh "$1"
fi

# Check required environment variables
if [ -z "$APPLE_ID" ] || [ -z "$APPLE_PASSWORD" ] || [ -z "$APPLE_TEAM_ID" ]; then
  echo "Error: Missing Apple signing credentials"
  echo "Please set APPLE_ID, APPLE_PASSWORD, and APPLE_TEAM_ID in .env.local"
  exit 1
fi

# For Tauri signing (auto-update signatures)
if [ -z "$TAURI_SIGNING_PRIVATE_KEY" ]; then
  echo "Warning: TAURI_SIGNING_PRIVATE_KEY not set - updates won't be signed"
fi

echo "Building Orca..."
echo "Apple ID: $APPLE_ID"
echo "Team ID: $APPLE_TEAM_ID"

# Set the certificate identity for code signing
export APPLE_CERTIFICATE_IDENTITY="Developer ID Application: SoFriendly LLC (2H66PPM438)"
export APPLE_SIGNING_IDENTITY="$APPLE_CERTIFICATE_IDENTITY"

# Build the app
pnpm tauri build

echo ""
echo "Build complete!"
echo "Artifacts are in: src-tauri/target/release/bundle/"

# Find the built app and DMG
APP_PATH=$(find src-tauri/target/release/bundle/macos -name "*.app" -type d 2>/dev/null | head -1)
DMG_PATH=$(find src-tauri/target/release/bundle/dmg -name "*.dmg" 2>/dev/null | head -1)

# Compile Asset Catalog for macOS Tahoe dark/tinted icon variants
if [ -n "$APP_PATH" ]; then
  echo ""
  echo "Compiling Asset Catalog for icon variants..."
  xcrun actool src-tauri/Icons.xcassets \
    --compile "$APP_PATH/Contents/Resources" \
    --platform macosx \
    --minimum-deployment-target 11.0 \
    --app-icon AppIcon \
    --output-partial-info-plist /tmp/orca-icon-info.plist
  /usr/libexec/PlistBuddy -c "Add :CFBundleIconName string AppIcon" "$APP_PATH/Contents/Info.plist" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconName AppIcon" "$APP_PATH/Contents/Info.plist"
  echo "Asset Catalog compiled and CFBundleIconName set"
fi

# Sign the app if it exists
if [ -n "$APP_PATH" ]; then
  echo ""
  echo "Signing app bundle..."
  codesign --force --options runtime --deep --sign "$APPLE_CERTIFICATE_IDENTITY" "$APP_PATH"
  codesign --verify --deep --strict --verbose=2 "$APP_PATH"
  echo "App signed successfully"
fi

# Create a zip for notarization (required by Apple)
if [ -n "$APP_PATH" ]; then
  echo ""
  echo "Creating zip for notarization..."
  ZIP_PATH="src-tauri/target/release/bundle/Orca.zip"
  ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"
  
  echo "Submitting for notarization..."
  xcrun notarytool submit "$ZIP_PATH" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait
  
  echo "Stapling notarization ticket to app..."
  xcrun stapler staple "$APP_PATH"
  
  # Remove the zip file
  rm "$ZIP_PATH"
  echo "App notarized successfully"
fi

# Sign and notarize the DMG
if [ -n "$DMG_PATH" ]; then
  echo ""
  echo "Signing DMG..."
  codesign --force --sign "$APPLE_CERTIFICATE_IDENTITY" "$DMG_PATH"
  
  echo "Submitting DMG for notarization..."
  xcrun notarytool submit "$DMG_PATH" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait
  
  echo "Stapling notarization ticket to DMG..."
  xcrun stapler staple "$DMG_PATH"
  echo "DMG signed and notarized successfully"
fi

# Get version for naming
VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')

# Create and sign the update bundle
echo ""
echo "Creating update bundle..."

APP_DIR=$(find src-tauri/target/release/bundle/macos -name "*.app" -type d 2>/dev/null | head -1)
if [ -n "$APP_DIR" ]; then
  TAR_FILE="src-tauri/target/release/bundle/Orca_${VERSION}_darwin-aarch64.app.tar.gz"

  # Create tar.gz (COPYFILE_DISABLE prevents macOS resource forks like ._* files)
  COPYFILE_DISABLE=1 tar -czf "$TAR_FILE" -C "$(dirname "$APP_DIR")" "$(basename "$APP_DIR")"
  echo "Created: $TAR_FILE"

  # Sign if private key is available
  if [ -n "$TAURI_SIGNING_PRIVATE_KEY" ]; then
    echo "Signing update bundle..."
    if [ -n "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" ]; then
      pnpm tauri signer sign --private-key "$TAURI_SIGNING_PRIVATE_KEY" --password "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" "$TAR_FILE"
    else
      pnpm tauri signer sign --private-key "$TAURI_SIGNING_PRIVATE_KEY" "$TAR_FILE"
    fi
    echo "Created: ${TAR_FILE}.sig"
  else
    echo "Skipping signing - TAURI_SIGNING_PRIVATE_KEY not set"
  fi
fi

# List the built artifacts
echo ""
echo "Built files:"
ls -la src-tauri/target/release/bundle/macos/ 2>/dev/null || true
ls -la src-tauri/target/release/bundle/dmg/ 2>/dev/null || true
ls -la src-tauri/target/release/bundle/*.tar.gz* 2>/dev/null || true
