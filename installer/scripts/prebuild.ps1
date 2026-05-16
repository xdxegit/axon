$ErrorActionPreference = "Continue"

# Read version from installer/package.json so the output path stays in lockstep
# with electron-builder's "../release-installer-${version}" config.
$pkgPath = Join-Path $PSScriptRoot "..\package.json"
$version = "0.0.0"
try {
    $pkg = Get-Content -Raw -LiteralPath $pkgPath | ConvertFrom-Json
    $version = $pkg.version
} catch {
    Write-Host "WARN: could not read version from package.json, defaulting to 0.0.0"
}

$outDir = Join-Path $PSScriptRoot "..\..\release-installer-$version"
Write-Host "Pre-build clean: $outDir"

if (Test-Path $outDir) {
    try {
        Remove-Item -Path $outDir -Recurse -Force -ErrorAction Stop
        Write-Host "  Removed previous output directory."
    } catch {
        Write-Host ""
        Write-Host "ERROR: could not clean $outDir" -ForegroundColor Red
        Write-Host "Reason: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Close any window showing files inside this folder and re-run the build." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  Output directory does not exist, nothing to clean."
}

exit 0
