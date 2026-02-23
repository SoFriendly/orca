# Build script for Windows
# Usage: .\scripts\build-windows.ps1 [major|minor|patch]
# If bump type provided, version will be incremented before build

param(
    [string]$BumpType
)

$ErrorActionPreference = "Stop"

# Add Windows SDK to PATH for signtool
$sdkPath = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.19041.0\x64"
if (Test-Path $sdkPath) {
    $env:PATH = "$sdkPath;$env:PATH"
    Write-Host "Added Windows SDK to PATH: $sdkPath"
}

# Load environment variables from .env.local if it exists
if (Test-Path .env.local) {
    Get-Content .env.local | ForEach-Object {
        if ($_ -match '^([^#][^=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim('"')
            Set-Item -Path "env:$name" -Value $value
        }
    }
}

# Bump version if argument provided
if ($BumpType) {
    # Get current version
    $configContent = Get-Content "src-tauri\tauri.conf.json" -Raw
    if ($configContent -match '"version":\s*"(\d+)\.(\d+)\.(\d+)"') {
        $major = [int]$matches[1]
        $minor = [int]$matches[2]
        $patch = [int]$matches[3]
        $currentVersion = "$major.$minor.$patch"

        switch ($BumpType) {
            "major" { $major++; $minor = 0; $patch = 0 }
            "minor" { $minor++; $patch = 0 }
            "patch" { $patch++ }
            default { Write-Error "Invalid bump type. Use: major, minor, or patch"; exit 1 }
        }

        $newVersion = "$major.$minor.$patch"
        Write-Host "Bumping version: $currentVersion -> $newVersion"

        # Update tauri.conf.json
        $configContent = $configContent -replace '"version":\s*"[^"]+"', "`"version`": `"$newVersion`""
        Set-Content "src-tauri\tauri.conf.json" $configContent -NoNewline

        # Update Cargo.toml
        $cargoContent = Get-Content "src-tauri\Cargo.toml" -Raw
        $cargoContent = $cargoContent -replace 'version\s*=\s*"[^"]+"', "version = `"$newVersion`""
        Set-Content "src-tauri\Cargo.toml" $cargoContent -NoNewline

        # Update package.json if exists
        if (Test-Path "package.json") {
            $pkgContent = Get-Content "package.json" -Raw
            $pkgContent = $pkgContent -replace '"version":\s*"[^"]+"', "`"version`": `"$newVersion`""
            Set-Content "package.json" $pkgContent -NoNewline
        }
    }
}

# Check for signing key (for Tauri update signatures)
if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    Write-Warning "TAURI_SIGNING_PRIVATE_KEY not set - updates won't be signed"
}

# Verify code signing certificate is available (Sectigo USB token)
Write-Host "Checking for code signing certificate..."
$cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -like "*SoFriendly*" }
if ($cert) {
    Write-Host "Found code signing certificate: $($cert.Subject)" -ForegroundColor Green
    Write-Host "Thumbprint: $($cert.Thumbprint)"
    Write-Host "Expires: $($cert.NotAfter)"
} else {
    Write-Warning "Code signing certificate not found. Make sure your Sectigo USB token is connected."
    $response = Read-Host "Continue without code signing? (y/N)"
    if ($response -ne 'y') {
        exit 1
    }
}

Write-Host ""
Write-Host "Building Orca for Windows..."

# Build the app
npm run tauri -- build

Write-Host ""
Write-Host "Build complete!"

# Sign the installers if certificate is available
if ($cert) {
    Write-Host ""
    Write-Host "Signing installers with Sectigo certificate..." -ForegroundColor Cyan
    Write-Host "(Your USB token will prompt for PIN)" -ForegroundColor Yellow
    $signtool = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.19041.0\x64\signtool.exe"
    $thumbprint = $cert.Thumbprint
    
    $msiFiles = Get-ChildItem -Path "src-tauri\target\release\bundle\msi\*.msi" -ErrorAction SilentlyContinue
    foreach ($file in $msiFiles) {
        Write-Host "Signing $($file.Name)..."
        & $signtool sign /sha1 $thumbprint /fd SHA256 /tr http://timestamp.sectigo.com /td SHA256 $file.FullName
    }
    
    $nsisFiles = Get-ChildItem -Path "src-tauri\target\release\bundle\nsis\*.exe" -ErrorAction SilentlyContinue
    foreach ($file in $nsisFiles) {
        Write-Host "Signing $($file.Name)..."
        & $signtool sign /sha1 $thumbprint /fd SHA256 /tr http://timestamp.sectigo.com /td SHA256 $file.FullName
    }
    
    Write-Host "Signing complete!" -ForegroundColor Green
}

Write-Host ""
Write-Host "Artifacts are in: src-tauri\target\release\bundle\"

# List the built artifacts
Write-Host ""
Write-Host "Built files:"
Get-ChildItem -Path "src-tauri\target\release\bundle\msi" -ErrorAction SilentlyContinue
Get-ChildItem -Path "src-tauri\target\release\bundle\nsis" -ErrorAction SilentlyContinue
