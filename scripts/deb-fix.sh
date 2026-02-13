#!/bin/bash
# Fix .deb architecture metadata and filenames
# This script corrects the Control file Architecture field and renames .deb files
# to match their actual build architecture.

set -e

DEB_DIR="src-tauri/target/release/bundle/deb"

if [ ! -d "$DEB_DIR" ]; then
  echo "Error: No deb bundle directory found at $DEB_DIR"
  exit 1
fi

echo "Checking and fixing .deb files in $DEB_DIR..."

# Detect the actual build architecture
BUILD_ARCH=$(rustc -vV | grep "^host:" | awk '{print $2}')
echo "Build architecture: $BUILD_ARCH"

# Map Rust target to Debian architecture
case "$BUILD_ARCH" in
  x86_64-unknown-linux-gnu)
    DEB_ARCH="amd64"
    ;;
  aarch64-unknown-linux-gnu)
    DEB_ARCH="arm64"
    ;;
  *)
    echo "Warning: Unknown architecture $BUILD_ARCH, skipping fix"
    exit 0
    ;;
esac

echo "Target Debian architecture: $DEB_ARCH"

# Process all .deb files
for deb_file in "$DEB_DIR"/*.deb; do
  if [ ! -f "$deb_file" ]; then
    continue
  fi

  filename=$(basename "$deb_file")
  echo "Processing: $filename"

  # Create a temporary directory for extraction
  TEMP_DIR=$(mktemp -d)
  trap "rm -rf $TEMP_DIR" EXIT

  # Extract the .deb
  cd "$TEMP_DIR"
  ar x "$deb_file"

  # Extract the control.tar.gz
  mkdir control_extract
  tar -xzf control.tar.gz -C control_extract

  # Update the Architecture field in the Control file
  CONTROL_FILE="control_extract/control"
  if [ -f "$CONTROL_FILE" ]; then
    echo "  Updating Architecture field to: $DEB_ARCH"
    sed -i "s/^Architecture: .*/Architecture: $DEB_ARCH/" "$CONTROL_FILE"
  fi

  # Recreate control.tar.gz
  cd control_extract
  tar -czf ../control.tar.gz ./
  cd ..

  # Recreate the .deb
  ar rcs "$deb_file" debian-binary control.tar.gz data.tar.xz

  cd -

  # Rename the file if the architecture in the name is wrong
  if [[ "$filename" == *"amd64"* ]] && [ "$DEB_ARCH" != "amd64" ]; then
    new_filename=$(echo "$filename" | sed "s/amd64/$DEB_ARCH/g")
    new_path="$DEB_DIR/$new_filename"
    echo "  Renaming: $filename → $new_filename"
    mv "$deb_file" "$new_path"
  elif [[ "$filename" == *"arm64"* ]] && [ "$DEB_ARCH" != "arm64" ]; then
    new_filename=$(echo "$filename" | sed "s/arm64/$DEB_ARCH/g")
    new_path="$DEB_DIR/$new_filename"
    echo "  Renaming: $filename → $new_filename"
    mv "$deb_file" "$new_path"
  else
    echo "  Architecture matches, no rename needed"
  fi
done

echo ""
echo "Fixed .deb files:"
ls -lh "$DEB_DIR"/*.deb
