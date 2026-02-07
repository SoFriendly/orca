# Upload Windows artifacts to Cloudflare R2
# Usage: .\scripts\upload-to-cloudflare.ps1

$ErrorActionPreference = "Stop"

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

# Check required environment variables
if (-not $env:CLOUDFLARE_ACCOUNT_ID -or -not $env:CLOUDFLARE_R2_ACCESS_KEY -or -not $env:CLOUDFLARE_R2_SECRET_KEY) {
    Write-Error "Missing Cloudflare R2 credentials. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY, CLOUDFLARE_R2_SECRET_KEY in .env.local"
    exit 1
}

if (-not $env:CLOUDFLARE_R2_BUCKET) {
    $env:CLOUDFLARE_R2_BUCKET = "chell-releases"
}

# Get version from tauri.conf.json
$configContent = Get-Content "src-tauri\tauri.conf.json" -Raw
if ($configContent -match '"version":\s*"([^"]+)"') {
    $VERSION = $matches[1]
} else {
    Write-Error "Could not find version in tauri.conf.json"
    exit 1
}

Write-Host "Uploading version: $VERSION" -ForegroundColor Cyan

# Set AWS credentials for wrangler (R2 is S3-compatible)
$env:AWS_ACCESS_KEY_ID = $env:CLOUDFLARE_R2_ACCESS_KEY
$env:AWS_SECRET_ACCESS_KEY = $env:CLOUDFLARE_R2_SECRET_KEY

# R2 endpoint
$R2_ENDPOINT = "https://$($env:CLOUDFLARE_ACCOUNT_ID).r2.cloudflarestorage.com"

function Upload-File {
    param (
        [string]$LocalPath,
        [string]$RemoteKey
    )
    
    if (Test-Path $LocalPath) {
        Write-Host "Uploading: $RemoteKey"
        npx wrangler r2 object put "$($env:CLOUDFLARE_R2_BUCKET)/$RemoteKey" --file $LocalPath --remote
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Failed to upload $RemoteKey"
        }
    } else {
        Write-Host "Skipping (not found): $LocalPath" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "=== Uploading Windows artifacts ===" -ForegroundColor Green

# Windows MSI
$msiFile = Get-ChildItem -Path "src-tauri\target\release\bundle\msi\*.msi" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($msiFile) {
    Upload-File $msiFile.FullName "v$VERSION/Chell_${VERSION}_x64-setup.msi"
    $msiSig = "$($msiFile.FullName).sig"
    if (Test-Path $msiSig) {
        Upload-File $msiSig "v$VERSION/Chell_${VERSION}_x64-setup.msi.sig"
    }
}

# Windows NSIS installer  
$nsisFile = Get-ChildItem -Path "src-tauri\target\release\bundle\nsis\*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($nsisFile) {
    Upload-File $nsisFile.FullName "v$VERSION/Chell_${VERSION}_x64-setup.exe"
    $nsisSig = "$($nsisFile.FullName).sig"
    if (Test-Path $nsisSig) {
        Upload-File $nsisSig "v$VERSION/Chell_${VERSION}_x64-setup.exe.sig"
    }
}

Write-Host ""
Write-Host "=== Generating latest.json ===" -ForegroundColor Green

# Get Windows signature
$winSig = ""
if ($msiFile -and (Test-Path "$($msiFile.FullName).sig")) {
    $winSig = Get-Content "$($msiFile.FullName).sig" -Raw
    $winSig = $winSig.Trim()
}

$pubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

# Read existing latest.json if it exists to preserve other platforms
$latestJsonPath = "src-tauri\target\release\bundle\latest.json"
$latestJson = @{
    version = $VERSION
    notes = "Update to version $VERSION"
    pub_date = $pubDate
    platforms = @{
        "windows-x86_64" = @{
            signature = $winSig
            url = "https://releases.chell.app/v$VERSION/Chell_${VERSION}_x64-setup.msi"
        }
    }
}

# Try to read existing latest.json to merge platforms
try {
    $existingJson = Invoke-RestMethod -Uri "https://releases.chell.app/latest.json" -ErrorAction Stop
    if ($existingJson.platforms) {
        # Preserve other platforms, update Windows
        foreach ($platform in $existingJson.platforms.PSObject.Properties) {
            if ($platform.Name -ne "windows-x86_64") {
                $latestJson.platforms[$platform.Name] = $platform.Value
            }
        }
    }
    # Keep existing notes if present
    if ($existingJson.notes) {
        $latestJson.notes = $existingJson.notes
    }
} catch {
    Write-Host "Note: Could not fetch existing latest.json, creating new one" -ForegroundColor Yellow
}

$latestJson | ConvertTo-Json -Depth 10 | Set-Content $latestJsonPath -Encoding UTF8

Upload-File $latestJsonPath "latest.json"

Write-Host ""
Write-Host "=== Upload complete! ===" -ForegroundColor Green
Write-Host "Update endpoint: https://releases.chell.app/latest.json"
