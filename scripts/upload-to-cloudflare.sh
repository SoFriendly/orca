#!/bin/bash
set -e

# Load environment variables from .env.local if it exists
if [ -f .env.local ]; then
  export $(cat .env.local | grep -v '^#' | xargs)
fi

# Check required environment variables (support both CLOUDFLARE_R2_* and AWS_* naming)
[ -z "$CLOUDFLARE_R2_ACCESS_KEY" ] && CLOUDFLARE_R2_ACCESS_KEY="$AWS_ACCESS_KEY_ID"
[ -z "$CLOUDFLARE_R2_SECRET_KEY" ] && CLOUDFLARE_R2_SECRET_KEY="$AWS_SECRET_ACCESS_KEY"

if [ -z "$CLOUDFLARE_ACCOUNT_ID" ] || [ -z "$CLOUDFLARE_R2_ACCESS_KEY" ] || [ -z "$CLOUDFLARE_R2_SECRET_KEY" ]; then
  echo "Error: Missing Cloudflare R2 credentials"
  echo "Please set CLOUDFLARE_ACCOUNT_ID and either CLOUDFLARE_R2_ACCESS_KEY/SECRET_KEY or AWS_ACCESS_KEY_ID/SECRET_ACCESS_KEY"
  exit 1
fi

if [ -z "$CLOUDFLARE_R2_BUCKET" ]; then
  CLOUDFLARE_R2_BUCKET="chell-releases"
fi

# Get version from tauri.conf.json
VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
echo "Uploading version: $VERSION"

# Extract changelog for this version from CHANGELOG.md
extract_changelog() {
  local version=$1
  local changelog_file="CHANGELOG.md"

  if [ ! -f "$changelog_file" ]; then
    echo "Update to version ${version}"
    return
  fi

  # First try exact version match, then fall back to most recent entry
  # Allow ### sub-headings but stop at next ## version header
  local notes=$(awk -v ver="$version" '
    /^## \[/ {
      if (found) exit
      if ($0 ~ "\\[" ver "\\]") found=1
      next
    }
    found && !/^## / { print }
  ' "$changelog_file" | sed '/^$/d' | sed 's/^- /• /' | sed 's/^  - /  ◦ /' | sed 's/^### \(.*\)/\n\1:/')

  # If no exact match, get the most recent changelog entry
  if [ -z "$notes" ]; then
    notes=$(awk '
      /^## \[/ {
        if (found) exit
        found=1
        next
      }
      found && !/^## / { print }
    ' "$changelog_file" | sed '/^$/d' | sed 's/^- /• /' | sed 's/^  - /  ◦ /' | sed 's/^### \(.*\)/\n\1:/')
  fi

  echo "$notes"
}

CHANGELOG_NOTES=$(extract_changelog "$VERSION")
if [ -z "$CHANGELOG_NOTES" ]; then
  CHANGELOG_NOTES="Update to version ${VERSION}"
fi
echo "Changelog notes:"
echo "$CHANGELOG_NOTES"

# R2 endpoint
R2_ENDPOINT="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"

# Function to upload file to R2
upload_file() {
  local file=$1
  local key=$2

  if [ -f "$file" ]; then
    echo "Uploading: $key"
    AWS_ACCESS_KEY_ID=$CLOUDFLARE_R2_ACCESS_KEY \
    AWS_SECRET_ACCESS_KEY=$CLOUDFLARE_R2_SECRET_KEY \
    aws s3 cp "$file" "s3://${CLOUDFLARE_R2_BUCKET}/${key}" \
      --endpoint-url "$R2_ENDPOINT" \
      --no-progress
  else
    echo "Skipping (not found): $file"
  fi
}

echo ""
echo "=== Uploading macOS artifacts ==="

# macOS DMG
DMG_FILE=$(find src-tauri/target/release/bundle/dmg -name "*.dmg" 2>/dev/null | head -1)
[ -n "$DMG_FILE" ] && upload_file "$DMG_FILE" "v${VERSION}/Chell_${VERSION}_aarch64.dmg"

# macOS app bundle (for updates) - tar.gz is created and signed by build-macos.sh
TAR_FILE="src-tauri/target/release/bundle/Chell_${VERSION}_darwin-aarch64.app.tar.gz"
if [ -f "$TAR_FILE" ]; then
  upload_file "$TAR_FILE" "v${VERSION}/Chell_${VERSION}_darwin-aarch64.app.tar.gz"
  [ -f "${TAR_FILE}.sig" ] && upload_file "${TAR_FILE}.sig" "v${VERSION}/Chell_${VERSION}_darwin-aarch64.app.tar.gz.sig"
else
  echo "Warning: $TAR_FILE not found - run build-macos.sh first"
fi

echo ""
echo "=== Uploading Linux artifacts ==="

# Linux AppImage - x86_64 (check GH Actions artifacts dir first, then local build)
APPIMAGE_X64=$(find artifacts/linux-appimage-x86_64 -name "*.AppImage" 2>/dev/null | head -1)
[ -z "$APPIMAGE_X64" ] && APPIMAGE_X64=$(find src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage -name "*.AppImage" 2>/dev/null | head -1)
[ -z "$APPIMAGE_X64" ] && APPIMAGE_X64=$(find src-tauri/target/release/bundle/appimage -name "*amd64*.AppImage" -o -name "*x86_64*.AppImage" 2>/dev/null | head -1)
[ -n "$APPIMAGE_X64" ] && upload_file "$APPIMAGE_X64" "v${VERSION}/Chell_${VERSION}_amd64.AppImage"
[ -n "$APPIMAGE_X64" ] && [ -f "${APPIMAGE_X64}.sig" ] && upload_file "${APPIMAGE_X64}.sig" "v${VERSION}/Chell_${VERSION}_amd64.AppImage.sig"
# Also check for separate .sig file in artifacts dir
[ -n "$APPIMAGE_X64" ] && for sig in artifacts/linux-appimage-x86_64/*.AppImage.sig; do [ -f "$sig" ] && upload_file "$sig" "v${VERSION}/Chell_${VERSION}_amd64.AppImage.sig"; done

# Linux AppImage - aarch64
APPIMAGE_ARM=$(find artifacts/linux-appimage-aarch64 -name "*.AppImage" 2>/dev/null | head -1)
[ -z "$APPIMAGE_ARM" ] && APPIMAGE_ARM=$(find src-tauri/target/aarch64-unknown-linux-gnu/release/bundle/appimage -name "*.AppImage" 2>/dev/null | head -1)
[ -n "$APPIMAGE_ARM" ] && upload_file "$APPIMAGE_ARM" "v${VERSION}/Chell_${VERSION}_arm64.AppImage"
[ -n "$APPIMAGE_ARM" ] && [ -f "${APPIMAGE_ARM}.sig" ] && upload_file "${APPIMAGE_ARM}.sig" "v${VERSION}/Chell_${VERSION}_arm64.AppImage.sig"
# Also check for separate .sig file in artifacts dir
[ -n "$APPIMAGE_ARM" ] && for sig in artifacts/linux-appimage-aarch64/*.AppImage.sig; do [ -f "$sig" ] && upload_file "$sig" "v${VERSION}/Chell_${VERSION}_arm64.AppImage.sig"; done

# Linux .deb - x86_64
DEB_X64=$(find artifacts/linux-deb-x86_64 -name "*.deb" 2>/dev/null | head -1)
[ -z "$DEB_X64" ] && DEB_X64=$(find src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb -name "*.deb" 2>/dev/null | head -1)
[ -z "$DEB_X64" ] && DEB_X64=$(find src-tauri/target/release/bundle/deb -name "*amd64*.deb" 2>/dev/null | head -1)
[ -n "$DEB_X64" ] && upload_file "$DEB_X64" "v${VERSION}/Chell_${VERSION}_amd64.deb"

# Linux .deb - aarch64
DEB_ARM=$(find artifacts/linux-deb-aarch64 -name "*.deb" 2>/dev/null | head -1)
[ -z "$DEB_ARM" ] && DEB_ARM=$(find src-tauri/target/aarch64-unknown-linux-gnu/release/bundle/deb -name "*.deb" 2>/dev/null | head -1)
[ -n "$DEB_ARM" ] && upload_file "$DEB_ARM" "v${VERSION}/Chell_${VERSION}_arm64.deb"

echo ""
echo "=== Uploading Windows artifacts ==="

# Windows MSI
MSI_FILE=$(find src-tauri/target/release/bundle/msi -name "*.msi" 2>/dev/null | head -1)
[ -n "$MSI_FILE" ] && upload_file "$MSI_FILE" "v${VERSION}/Chell_${VERSION}_x64-setup.msi"
[ -f "${MSI_FILE}.sig" ] && upload_file "${MSI_FILE}.sig" "v${VERSION}/Chell_${VERSION}_x64-setup.msi.sig"

# Windows NSIS installer
NSIS_FILE=$(find src-tauri/target/release/bundle/nsis -name "*.exe" 2>/dev/null | head -1)
[ -n "$NSIS_FILE" ] && upload_file "$NSIS_FILE" "v${VERSION}/Chell_${VERSION}_x64-setup.exe"
[ -f "${NSIS_FILE}.sig" ] && upload_file "${NSIS_FILE}.sig" "v${VERSION}/Chell_${VERSION}_x64-setup.exe.sig"

echo ""
echo "=== Updating latest.json ==="

# Collect signatures
MAC_SIG=""
LINUX_SIG=""
LINUX_ARM_SIG=""
WIN_SIG=""

[ -f "src-tauri/target/release/bundle/Chell_${VERSION}_darwin-aarch64.app.tar.gz.sig" ] && \
  MAC_SIG=$(cat "src-tauri/target/release/bundle/Chell_${VERSION}_darwin-aarch64.app.tar.gz.sig")

# Linux x64 signature
if [ -n "$APPIMAGE_X64" ] && [ -f "${APPIMAGE_X64}.sig" ]; then
  LINUX_SIG=$(cat "${APPIMAGE_X64}.sig")
elif [ -f "$(find artifacts/linux-appimage-x86_64 -name "*.AppImage.sig" 2>/dev/null | head -1)" ]; then
  LINUX_SIG=$(cat "$(find artifacts/linux-appimage-x86_64 -name "*.AppImage.sig" | head -1)")
fi

# Linux ARM signature
if [ -n "$APPIMAGE_ARM" ] && [ -f "${APPIMAGE_ARM}.sig" ]; then
  LINUX_ARM_SIG=$(cat "${APPIMAGE_ARM}.sig")
elif [ -f "$(find artifacts/linux-appimage-aarch64 -name "*.AppImage.sig" 2>/dev/null | head -1)" ]; then
  LINUX_ARM_SIG=$(cat "$(find artifacts/linux-appimage-aarch64 -name "*.AppImage.sig" | head -1)")
fi

[ -n "$MSI_FILE" ] && [ -f "${MSI_FILE}.sig" ] && \
  WIN_SIG=$(cat "${MSI_FILE}.sig")

LATEST_JSON="src-tauri/target/release/bundle/latest.json"

# Fetch existing latest.json from R2
echo "Fetching existing latest.json..."
AWS_ACCESS_KEY_ID=$CLOUDFLARE_R2_ACCESS_KEY \
AWS_SECRET_ACCESS_KEY=$CLOUDFLARE_R2_SECRET_KEY \
aws s3 cp "s3://${CLOUDFLARE_R2_BUCKET}/latest.json" "$LATEST_JSON" \
  --endpoint-url "$R2_ENDPOINT" \
  --no-progress 2>/dev/null || echo '{"platforms":{}}' > "$LATEST_JSON"

# Build jq filter to update only platforms that were built
JQ_FILTER=""

if [ -n "$MAC_SIG" ]; then
  echo "Updating macOS entries..."
  JQ_FILTER="$JQ_FILTER | .platforms[\"darwin-aarch64\"] = {\"signature\": \$mac_sig, \"url\": \"https://releases.chell.app/v\($ver)/Chell_\($ver)_darwin-aarch64.app.tar.gz\"}"
  JQ_FILTER="$JQ_FILTER | .platforms[\"darwin-x86_64\"] = {\"signature\": \$mac_sig, \"url\": \"https://releases.chell.app/v\($ver)/Chell_\($ver)_darwin-x86_64.app.tar.gz\"}"
fi

if [ -n "$LINUX_SIG" ]; then
  echo "Updating Linux x64 entry..."
  JQ_FILTER="$JQ_FILTER | .platforms[\"linux-x86_64\"] = {\"signature\": \$linux_sig, \"url\": \"https://releases.chell.app/v\($ver)/Chell_\($ver)_amd64.AppImage\"}"
fi

if [ -n "$LINUX_ARM_SIG" ]; then
  echo "Updating Linux ARM entry..."
  JQ_FILTER="$JQ_FILTER | .platforms[\"linux-aarch64\"] = {\"signature\": \$linux_arm_sig, \"url\": \"https://releases.chell.app/v\($ver)/Chell_\($ver)_arm64.AppImage\"}"
fi

if [ -n "$WIN_SIG" ]; then
  echo "Updating Windows entry..."
  JQ_FILTER="$JQ_FILTER | .platforms[\"windows-x86_64\"] = {\"signature\": \$win_sig, \"url\": \"https://releases.chell.app/v\($ver)/Chell_\($ver)_x64-setup.msi\"}"
fi

if [ -n "$JQ_FILTER" ]; then
  # Remove leading " | "
  JQ_FILTER="${JQ_FILTER# | }"

  jq --arg ver "$VERSION" \
     --arg mac_sig "$MAC_SIG" \
     --arg linux_sig "$LINUX_SIG" \
     --arg linux_arm_sig "$LINUX_ARM_SIG" \
     --arg win_sig "$WIN_SIG" \
     "$JQ_FILTER" "$LATEST_JSON" > "${LATEST_JSON}.tmp" && mv "${LATEST_JSON}.tmp" "$LATEST_JSON"

  upload_file "$LATEST_JSON" "latest.json"
else
  echo "No platforms to update (no signatures found)"
fi

echo ""
echo "=== Upload complete! ==="
echo "Update endpoint: https://releases.chell.app/latest.json"
