$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $projectRoot 'research-link-manager'
$outputDirectory = Join-Path $projectRoot 'outputs'
$manifest = Get-Content -Raw -LiteralPath (Join-Path $source 'manifest.json') | ConvertFrom-Json
$version = $manifest.version
$zip = Join-Path $outputDirectory "research-link-manager-$version.zip"
$xpi = Join-Path $outputDirectory "research-link-manager-$version.xpi"
$sourceZip = Join-Path $outputDirectory "research-link-manager-source-$version.zip"
$architectureOutput = Join-Path $outputDirectory 'Research-Link-Manager-Architecture.md'

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
if (Test-Path -LiteralPath $zip) {
  Remove-Item -LiteralPath $zip -Force
}
if (Test-Path -LiteralPath $xpi) {
  Remove-Item -LiteralPath $xpi -Force
}
if (Test-Path -LiteralPath $sourceZip) {
  Remove-Item -LiteralPath $sourceZip -Force
}

Compress-Archive -Path (Join-Path $source '*') -DestinationPath $zip -CompressionLevel Optimal
Move-Item -LiteralPath $zip -Destination $xpi
Compress-Archive -Path @(
  (Join-Path $projectRoot 'research-link-manager'),
  (Join-Path $projectRoot 'test'),
  (Join-Path $projectRoot 'scripts'),
  (Join-Path $projectRoot 'package.json'),
  (Join-Path $projectRoot 'README.md'),
  (Join-Path $projectRoot 'ARCHITECTURE.md'),
  (Join-Path $projectRoot 'TESTING.md')
) -DestinationPath $sourceZip -CompressionLevel Optimal
Copy-Item -LiteralPath (Join-Path $projectRoot 'ARCHITECTURE.md') -Destination $architectureOutput -Force
Write-Output $xpi
Write-Output $sourceZip
Write-Output $architectureOutput
