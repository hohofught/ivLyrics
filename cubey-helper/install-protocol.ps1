$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installDir = Join-Path $env:LOCALAPPDATA 'ivLyrics\cubey-helper'
$launcherSource = Join-Path $scriptDir 'start-cubey-helper.ps1'
$launcherDest = Join-Path $installDir 'start-cubey-helper.ps1'
$exeSource = Join-Path $scriptDir 'build\Release\cubey-helper.exe'
$exeDest = Join-Path $installDir 'cubey-helper.exe'
$startupCmdPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'ivLyrics Cubey Helper.cmd'
$protocolRoot = 'HKCU:\Software\Classes\ivlyrics-cubey-helper'
$commandPath = Join-Path $protocolRoot 'shell\open\command'

if (-not (Test-Path -LiteralPath $exeSource)) {
    Write-Error "Missing helper executable: $exeSource"
}

Get-Process -Name 'cubey-helper' -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Path -and $_.Path -ieq $exeDest) {
        Stop-Process -Id $_.Id -Force
    }
}

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item -LiteralPath $exeSource -Destination $exeDest -Force
Copy-Item -LiteralPath $launcherSource -Destination $launcherDest -Force

if (Test-Path -LiteralPath $startupCmdPath) {
    Remove-Item -LiteralPath $startupCmdPath -Force
}

New-Item -Path $protocolRoot -Force | Out-Null
Set-Item -Path $protocolRoot -Value 'URL:ivLyrics Cubey Helper Protocol'
New-ItemProperty -Path $protocolRoot -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null

$defaultIconPath = Join-Path $protocolRoot 'DefaultIcon'
New-Item -Path $defaultIconPath -Force | Out-Null
Set-Item -Path $defaultIconPath -Value $exeDest

New-Item -Path $commandPath -Force | Out-Null
$commandValue = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherDest`" `"%1`""
Set-Item -Path $commandPath -Value $commandValue

& $launcherDest

Write-Output "Installed ivlyrics-cubey-helper protocol"
Write-Output "Protocol command: $commandValue"
Write-Output "Runtime files live at $installDir"
