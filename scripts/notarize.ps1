# Rune — notarize a signed macOS .dmg from Windows using rcodesign + an
# App Store Connect API key. No Mac required (talks to Apple's notary API directly).
#
# One-time setup:
#   1) Install rcodesign:
#        cargo install apple-codesign
#      (or download rcodesign.exe from
#        https://github.com/indygreg/apple-platform-rs/releases and put it on PATH)
#   2) Create an App Store Connect API key:
#        App Store Connect (appstoreconnect.apple.com) -> Users and Access ->
#        Integrations -> App Store Connect API -> Team Keys -> (+) generate,
#        Access = Developer. Download the AuthKey_<KEYID>.p8 (downloadable ONCE!).
#        Note the Issuer ID (top of the page) and the Key ID.
#   3) Encode the key into the JSON rcodesign expects (run once):
#        rcodesign encode-app-store-connect-api-key -o asc-key.json `
#          <ISSUER_ID> <KEY_ID> AuthKey_<KEY_ID>.p8
#
# Usage:
#   .\scripts\notarize.ps1 -Dmg .\Rune_0.1.1_aarch64.dmg
#   .\scripts\notarize.ps1 -Dmg .\Rune_0.1.1_x64.dmg -KeyJson .\asc-key.json
#
# On success the .dmg is notarized AND stapled (opens with no Gatekeeper warning).
# Then re-upload it to the GitHub release, replacing the signed-only one.

param(
  [Parameter(Mandatory = $true)][string]$Dmg,
  [string]$KeyJson = "asc-key.json"
)

if (-not (Get-Command rcodesign -ErrorAction SilentlyContinue)) {
  Write-Error "rcodesign not found on PATH. Install with: cargo install apple-codesign  (or download the release binary)."
  exit 1
}
if (-not (Test-Path $Dmg))     { Write-Error "DMG not found: $Dmg"; exit 1 }
if (-not (Test-Path $KeyJson)) { Write-Error "API key JSON not found: $KeyJson — run 'rcodesign encode-app-store-connect-api-key' first (see header)."; exit 1 }

Write-Host "Submitting '$Dmg' to Apple notary and stapling on success..." -ForegroundColor Cyan
rcodesign notary-submit --api-key-path $KeyJson --staple $Dmg
if ($LASTEXITCODE -ne 0) { Write-Error "Notarization failed (exit $LASTEXITCODE). See output above."; exit $LASTEXITCODE }

Write-Host "OK — '$Dmg' is notarized + stapled. Re-upload it to the GitHub release." -ForegroundColor Green
