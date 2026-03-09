<#
.SYNOPSIS
Sync ivLyrics runtime files into the active Spicetify CustomApps path and run `spicetify apply`.

.EXAMPLE
.\deploy-to-spicetify.ps1

.EXAMPLE
.\deploy-to-spicetify.ps1 -Files Addon_Lyrics_BetterLyricsEngine.js,Addon_Lyrics_Lrclib.js,LyricsService.js

.EXAMPLE
.\deploy-to-spicetify.ps1 -ChangedOnly -WhatIf

.EXAMPLE
.\deploy-to-spicetify.ps1 -SkipHelper

.EXAMPLE
.\deploy-to-spicetify.ps1 -HelperBuildConfig Debug
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [AllowEmptyString()]
    [string]$SourceRoot,
    [AllowEmptyString()]
    [string]$AppName,
    [AllowEmptyString()]
    [string]$TargetPath,
    [AllowEmptyString()]
    [string[]]$Files,
    [switch]$ChangedOnly,
    [switch]$SkipConfig,
    [switch]$SkipApply,
    [switch]$SkipHelper,
    [AllowEmptyString()]
    [string]$HelperBuildConfig = 'Release'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Spicetify {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & spicetify @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "spicetify $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Get-SpicetifyOutput {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $output = & spicetify @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) {
        return $null
    }

    return (($output | ForEach-Object { "$_".Trim() }) -join "`n").Trim()
}

function Get-ManifestRuntimeFiles {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath
    )

    $manifestPath = Join-Path $RootPath 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        throw "manifest.json not found under $RootPath"
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $set = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($path in @('manifest.json', 'index.js', 'style.css')) {
        [void]$set.Add($path)
    }

    foreach ($propertyName in @('preview', 'readme')) {
        $value = $manifest.$propertyName
        if ($value) {
            [void]$set.Add([string]$value)
        }
    }

    foreach ($propertyName in @('subfiles', 'subfiles_extension')) {
        foreach ($value in @($manifest.$propertyName)) {
            if ($value) {
                [void]$set.Add([string]$value)
            }
        }
    }

    foreach ($extra in @('blacklist.json', 'version.txt')) {
        if (Test-Path -LiteralPath (Join-Path $RootPath $extra)) {
            [void]$set.Add($extra)
        }
    }

    return @($set | Sort-Object)
}

function Get-ChangedRepoFiles {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath
    )

    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) {
        Write-Warning 'git was not found. Falling back to the full runtime file list.'
        return @()
    }

    $status = & git -C $RootPath status --porcelain --untracked-files=all
    if ($LASTEXITCODE -ne 0) {
        Write-Warning 'git status failed. Falling back to the full runtime file list.'
        return @()
    }

    $paths = foreach ($line in $status) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.Length -lt 4) {
            continue
        }

        $pathText = $line.Substring(3).Trim()
        if ($pathText -like '* -> *') {
            $pathText = ($pathText -split ' -> ', 2)[1].Trim()
        }

        if ($pathText.StartsWith('"') -and $pathText.EndsWith('"')) {
            $pathText = $pathText.Trim('"')
        }

        ($pathText -replace '\\', '/')
    }

    return @($paths | Where-Object { $_ } | Select-Object -Unique)
}

function Resolve-AppName {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath,
        [string]$ConfiguredName
    )

    if ($ConfiguredName) {
        return $ConfiguredName
    }

    $manifest = Get-Content -LiteralPath (Join-Path $RootPath 'manifest.json') -Raw | ConvertFrom-Json
    if (-not $manifest.name) {
        throw 'manifest.json does not contain a name field.'
    }

    return [string]$manifest.name
}

function Resolve-TargetAppPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ResolvedAppName,
        [string]$ExplicitTargetPath
    )

    if ($ExplicitTargetPath) {
        return [System.IO.Path]::GetFullPath($ExplicitTargetPath)
    }

    $existingPath = Get-SpicetifyOutput -Arguments @('path', '-a', $ResolvedAppName)
    if ($existingPath) {
        return $existingPath
    }

    $customAppsRoot = Get-SpicetifyOutput -Arguments @('path', '-a', 'root')
    if (-not $customAppsRoot) {
        $customAppsRoot = Join-Path $env:LOCALAPPDATA 'spicetify\CustomApps'
    }

    return (Join-Path $customAppsRoot $ResolvedAppName)
}

function Ensure-AppEnabled {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ResolvedAppName
    )

    $configured = Get-SpicetifyOutput -Arguments @('config', 'custom_apps')
    $apps = @()
    if ($configured) {
        $apps = @($configured -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }

    if ($apps -contains $ResolvedAppName) {
        Write-Host "custom_apps already includes $ResolvedAppName"
        return
    }

    if ($PSCmdlet.ShouldProcess("spicetify custom_apps", "Add $ResolvedAppName")) {
        Invoke-Spicetify -Arguments @('config', 'custom_apps', $ResolvedAppName)
    }
}

function Copy-RelativeFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath,
        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    $normalizedRelativePath = ($RelativePath -replace '\\', '/').TrimStart('/')
    $sourcePath = Join-Path $RootPath $normalizedRelativePath
    if (-not (Test-Path -LiteralPath $sourcePath)) {
        throw "Source file not found: $normalizedRelativePath"
    }

    $destinationPath = Join-Path $DestinationRoot $normalizedRelativePath
    $destinationDir = Split-Path -Parent $destinationPath
    if ($destinationDir -and -not (Test-Path -LiteralPath $destinationDir)) {
        if ($PSCmdlet.ShouldProcess($destinationDir, 'Create directory')) {
            New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
        }
    }

    if ($PSCmdlet.ShouldProcess($destinationPath, "Copy $normalizedRelativePath")) {
        Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
    }
}

# ── cubey-helper cmake build ──────────────────────────────────────────────────

function Build-CubeyHelper {
    param(
        [Parameter(Mandatory = $true)]
        [string]$HelperRoot,
        [string]$Config = 'Release'
    )

    $cmake = Get-Command cmake -ErrorAction SilentlyContinue
    if (-not $cmake) {
        Write-Warning 'cmake was not found in PATH. Skipping cubey-helper build.'
        return $null
    }

    $buildDir = Join-Path $HelperRoot 'build'
    $exePath = Join-Path $buildDir "$Config\cubey-helper.exe"

    # Configure if not yet done
    if (-not (Test-Path -LiteralPath (Join-Path $buildDir 'CMakeCache.txt'))) {
        Write-Host '[cubey-helper] Configuring cmake...'
        if ($PSCmdlet.ShouldProcess($buildDir, 'cmake configure')) {
            & cmake -S $HelperRoot -B $buildDir | Out-Host
            if ($LASTEXITCODE -ne 0) {
                throw "cmake configure failed with exit code $LASTEXITCODE"
            }
        }
    }

    # Build
    Write-Host "[cubey-helper] Building ($Config)..."
    if ($PSCmdlet.ShouldProcess($buildDir, "cmake build --config $Config")) {
        & cmake --build $buildDir --config $Config | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "cmake build failed with exit code $LASTEXITCODE"
        }
    }

    if (Test-Path -LiteralPath $exePath) {
        Write-Host "[cubey-helper] Built: $exePath"
        return $exePath
    }

    Write-Warning "cubey-helper.exe not found at expected path: $exePath"
    return $null
}

# ── main ──────────────────────────────────────────────────────────────────────

$spicetify = Get-Command spicetify -ErrorAction SilentlyContinue
if (-not $spicetify) {
    throw 'spicetify CLI was not found in PATH.'
}

$SourceRoot = if ([string]::IsNullOrWhiteSpace($SourceRoot)) { $null } else { $SourceRoot.Trim() }
$AppName = if ([string]::IsNullOrWhiteSpace($AppName)) { $null } else { $AppName.Trim() }
$TargetPath = if ([string]::IsNullOrWhiteSpace($TargetPath)) { $null } else { $TargetPath.Trim() }
$Files = @($Files | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$HelperBuildConfig = if ([string]::IsNullOrWhiteSpace($HelperBuildConfig)) { 'Release' } else { $HelperBuildConfig.Trim() }

$effectiveSourceRoot = $SourceRoot
if ([string]::IsNullOrWhiteSpace($effectiveSourceRoot)) {
    $effectiveSourceRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Split-Path -Parent $MyInvocation.MyCommand.Path) }
}

$resolvedSourceRoot = [System.IO.Path]::GetFullPath($effectiveSourceRoot)
$resolvedAppName = Resolve-AppName -RootPath $resolvedSourceRoot -ConfiguredName $AppName
$resolvedTargetPath = Resolve-TargetAppPath -ResolvedAppName $resolvedAppName -ExplicitTargetPath $TargetPath

$runtimeFiles = Get-ManifestRuntimeFiles -RootPath $resolvedSourceRoot
$requestedFiles = @($Files)
$selectedFiles = if ($requestedFiles.Count -gt 0) {
    @(
        $requestedFiles |
            ForEach-Object { $_ -split ',' } |
            ForEach-Object { ($_ -replace '\\', '/').Trim() } |
            Where-Object { $_ } |
            ForEach-Object { $_.TrimStart('/') } |
            Select-Object -Unique
    )
} else {
    $runtimeFiles
}

if ($ChangedOnly) {
    $changedFiles = Get-ChangedRepoFiles -RootPath $resolvedSourceRoot
    if (@($changedFiles).Count -gt 0) {
        $selectedFiles = @($selectedFiles | Where-Object { $changedFiles -contains $_ })
    } else {
        Write-Warning 'No changed files were detected, or git fallback was used. Continuing with the current selection.'
    }
}

if (@($selectedFiles).Count -eq 0) {
    throw 'No files were selected for deployment.'
}

Write-Host "Source: $resolvedSourceRoot"
Write-Host "Target: $resolvedTargetPath"
Write-Host "App:    $resolvedAppName"
Write-Host "Files:  $(@($selectedFiles).Count)"

if ($PSCmdlet.ShouldProcess($resolvedTargetPath, 'Create target directory')) {
    New-Item -ItemType Directory -Force -Path $resolvedTargetPath | Out-Null
}

foreach ($relativePath in $selectedFiles) {
    Copy-RelativeFile -RootPath $resolvedSourceRoot -DestinationRoot $resolvedTargetPath -RelativePath $relativePath
}

# ── cubey-helper build & deploy ───────────────────────────────────────────────

if (-not $SkipHelper) {
    $helperRoot = Join-Path $resolvedSourceRoot 'cubey-helper'
    if (Test-Path -LiteralPath (Join-Path $helperRoot 'CMakeLists.txt')) {
        $helperExe = Build-CubeyHelper -HelperRoot $helperRoot -Config $HelperBuildConfig
        if ($helperExe) {
            $helperTargetDir = Join-Path $resolvedTargetPath 'cubey-helper'
            if ($PSCmdlet.ShouldProcess($helperTargetDir, 'Deploy cubey-helper.exe')) {
                New-Item -ItemType Directory -Force -Path $helperTargetDir | Out-Null
                Copy-Item -LiteralPath $helperExe -Destination (Join-Path $helperTargetDir 'cubey-helper.exe') -Force
                Write-Host "[cubey-helper] Deployed to $helperTargetDir"
            }
        }
    } else {
        Write-Host '[cubey-helper] No CMakeLists.txt found, skipping helper build.'
    }
}

# ── spicetify config & apply ─────────────────────────────────────────────────

if (-not $SkipConfig) {
    Ensure-AppEnabled -ResolvedAppName $resolvedAppName
}

if (-not $SkipApply) {
    if ($PSCmdlet.ShouldProcess('spicetify', 'Run apply')) {
        Invoke-Spicetify -Arguments @('apply')
    }
}

Write-Host 'Deployment complete.'
