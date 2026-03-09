$ErrorActionPreference = 'Stop'

$helperUrl = 'http://127.0.0.1:15124/health'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $scriptDir 'logs'
$auditLogPath = Join-Path $logDir 'launcher.log'
$stdoutLogPath = Join-Path $logDir 'cubey-helper.stdout.log'
$stderrLogPath = Join-Path $logDir 'cubey-helper.stderr.log'

function Test-HelperHealth {
    param(
        [string]$Url,
        [int]$TimeoutSec = 2
    )

    try {
        $response = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec $TimeoutSec
        return ($response.ok -eq $true)
    } catch {
        return $false
    }
}

function Get-HelperExePath {
    param(
        [string]$BaseDir
    )

    $candidates = @(
        (Join-Path $BaseDir 'cubey-helper.exe'),
        (Join-Path $BaseDir 'build\Release\cubey-helper.exe')
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    return $null
}

if (Test-HelperHealth -Url $helperUrl) {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    Add-Content -LiteralPath $auditLogPath -Value ("{0} healthy args={1}" -f ([DateTime]::UtcNow.ToString('o')), ($args -join ' ')) -Encoding ASCII
    Write-Output 'cubey-helper already healthy'
    exit 0
}

$helperExe = Get-HelperExePath -BaseDir $scriptDir
if (-not $helperExe) {
    Write-Error "cubey-helper.exe not found under $scriptDir"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Add-Content -LiteralPath $auditLogPath -Value ("{0} launch args={1}" -f ([DateTime]::UtcNow.ToString('o')), ($args -join ' ')) -Encoding ASCII

$alreadyRunning = @(Get-Process -Name 'cubey-helper' -ErrorAction SilentlyContinue).Count -gt 0
if (-not $alreadyRunning) {
    Start-Process -FilePath $helperExe `
        -WorkingDirectory (Split-Path -Parent $helperExe) `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutLogPath `
        -RedirectStandardError $stderrLogPath | Out-Null
}

for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-HelperHealth -Url $helperUrl) {
        Write-Output "cubey-helper healthy at $helperUrl"
        exit 0
    }
}

Write-Error "cubey-helper did not become healthy at $helperUrl"
