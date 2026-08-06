$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$projectPath = Join-Path $PSScriptRoot "TelemetryClient\TelemetryClient.csproj"
$outputPath = Join-Path $repositoryRoot "artifacts\windows-client"

New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

dotnet publish $projectPath `
    --configuration Release `
    --runtime win-x64 `
    --self-contained true `
    -p:PublishProfile=win-x64 `
    --output $outputPath

if ($LASTEXITCODE -ne 0) {
    throw "Windows client publishing failed with exit code $LASTEXITCODE."
}

$executablePath = Join-Path $outputPath "BroadcastGraphicsClient.exe"
if (-not (Test-Path $executablePath)) {
    throw "Publishing completed without producing BroadcastGraphicsClient.exe."
}

$sizeMb = [Math]::Round((Get-Item $executablePath).Length / 1MB, 1)
Write-Host "Published BroadcastGraphicsClient.exe ($sizeMb MB)"
Write-Host "Output: $outputPath"
