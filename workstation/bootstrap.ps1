#Requires -Version 5.1
<#
.SYNOPSIS
    Omnifield workstation bootstrap - base dev-machine layer.
    Capability: workstation (provision / verify). Provider: windows-winget (MVP).

.DESCRIPTION
    Installs exactly the 6 base-layer tools (canon: commons
    standards/workflow/toolchain-pins.md): git, node LTS, pnpm >=10, uv,
    Docker Desktop, claude CLI. Idempotent: tools already present are skipped
    and reported with their version.

    Everything else self-assembles from pins inside product repos
    (.python-version -> uv fetches CPython, packageManager -> pnpm >=10
    switches itself to the pinned version). Do NOT add system Python / pip
    here - that layer is owned by the pins. Corepack is deprecated and is NOT
    used anywhere (no corepack enable). See workstation/README.md.

.PARAMETER Verify
    Report-only preflight: prints a tool -> status/version table, installs
    nothing. Exit 1 if any tool is missing or below its minimum major version
    (usable as CI/session preflight).

.EXAMPLE
    .\bootstrap.ps1            # provision the machine
.EXAMPLE
    .\bootstrap.ps1 -Verify    # preflight check only
#>
[CmdletBinding()]
param(
    [switch]$Verify
)

$ErrorActionPreference = 'Stop'

# Base layer registry. WingetId = $null means the tool is not installed via
# winget (claude uses the native installer below). MinMajor: found-but-older
# counts as a gap (pnpm <10 cannot execute packageManager pins itself).
$BaseTools = @(
    [pscustomobject]@{ Name = 'git';    WingetId = 'Git.Git';              MinMajor = $null },
    [pscustomobject]@{ Name = 'node';   WingetId = 'OpenJS.NodeJS.LTS';    MinMajor = $null },
    [pscustomobject]@{ Name = 'pnpm';   WingetId = 'pnpm.pnpm';            MinMajor = 10 },
    [pscustomobject]@{ Name = 'uv';     WingetId = 'astral-sh.uv';         MinMajor = $null },
    [pscustomobject]@{ Name = 'docker'; WingetId = 'Docker.DockerDesktop'; MinMajor = $null },
    [pscustomobject]@{ Name = 'claude'; WingetId = $null;                  MinMajor = $null }
)

function Update-SessionPath {
    # Installers write PATH to the registry; the current session does not see
    # it until re-read. Append (not replace) so session-only entries survive;
    # duplicates are harmless.
    $machine  = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user     = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = $env:Path + ';' + $machine + ';' + $user
}

function Get-ToolState {
    param([pscustomobject]$Tool)
    $cmd = Get-Command $Tool.Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
        return [pscustomobject]@{ Name = $Tool.Name; Found = $false; Satisfied = $false; Version = '' }
    }
    $version = 'found (version unknown)'
    try {
        $ErrorActionPreference = 'Continue'
        $out = & $Tool.Name --version 2>$null | Select-Object -First 1
        if ($out) { $version = "$out".Trim() }
    } catch {
    } finally {
        $ErrorActionPreference = 'Stop'
    }
    $satisfied = $true
    if ($Tool.MinMajor) {
        $m = [regex]::Match($version, '\d+')
        if (-not $m.Success -or [int]$m.Value -lt $Tool.MinMajor) { $satisfied = $false }
    }
    return [pscustomobject]@{ Name = $Tool.Name; Found = $true; Satisfied = $satisfied; Version = $version }
}

function Get-AllStates {
    foreach ($t in $BaseTools) { Get-ToolState -Tool $t }
}

function Show-Report {
    param($States, [hashtable]$Installed)
    Write-Host ''
    Write-Host ('{0,-10} {1,-10} {2}' -f 'TOOL', 'STATUS', 'VERSION')
    Write-Host ('-' * 60)
    foreach ($s in $States) {
        if ($s.Satisfied -and $Installed[$s.Name])   { $status = 'INSTALLED' }
        elseif ($s.Satisfied)                        { $status = 'OK' }
        elseif ($s.Found)                            { $status = 'OUTDATED' }
        elseif ($Installed[$s.Name])                 { $status = 'FAILED' }
        else                                         { $status = 'MISSING' }
        Write-Host ('{0,-10} {1,-10} {2}' -f $s.Name, $status, $s.Version)
    }
    Write-Host ''
}

function Install-ClaudeCli {
    # Native installer (self-updating, no dependency on node/npm being live on
    # PATH mid-bootstrap). Choice rationale: workstation/README.md.
    Write-Host 'Installing claude CLI (native installer, claude.ai/install.ps1)...'
    Invoke-RestMethod -Uri 'https://claude.ai/install.ps1' | Invoke-Expression
}

# --- scan -------------------------------------------------------------------

# Sync PATH from the registry up front: a shell opened before a previous
# bootstrap run has a stale PATH and would re-detect installed tools as missing.
Update-SessionPath
$states = @(Get-AllStates)

if ($Verify) {
    Show-Report -States $states -Installed @{}
    $gaps = @($states | Where-Object { -not $_.Satisfied })
    if ($gaps.Count -gt 0) {
        Write-Host ('Verify FAILED - gaps: ' + (($gaps | ForEach-Object { $_.Name }) -join ', ')) -ForegroundColor Red
        Write-Host 'Run .\bootstrap.ps1 (no flags) to provision.'
        exit 1
    }
    Write-Host 'Verify OK - base layer complete.' -ForegroundColor Green
    exit 0
}

# --- provision --------------------------------------------------------------

$installed = @{}
$gaps      = @($states | Where-Object { -not $_.Satisfied })

if ($gaps.Count -eq 0) {
    Write-Host 'Base layer already complete - nothing to install.'
} else {
    $wingetNeeded = @($gaps | Where-Object {
        $name = $_.Name
        ($BaseTools | Where-Object { $_.Name -eq $name }).WingetId
    })
    if ($wingetNeeded.Count -gt 0 -and -not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Host 'winget not found. Install "App Installer" from Microsoft Store first (see README troubleshooting for LTSC/Server).' -ForegroundColor Red
        exit 1
    }

    foreach ($g in $gaps) {
        $name = $g.Name
        $tool = $BaseTools | Where-Object { $_.Name -eq $name }
        if ($tool.WingetId) {
            Write-Host ('Installing {0} via winget ({1})...' -f $tool.Name, $tool.WingetId)
            winget install --id $tool.WingetId --exact --source winget --accept-package-agreements --accept-source-agreements
            if ($LASTEXITCODE -eq 0) {
                $installed[$tool.Name] = $true
            } else {
                Write-Warning ('winget install {0} exited with code {1}' -f $tool.WingetId, $LASTEXITCODE)
                $installed[$tool.Name] = $true  # attempted; final re-scan decides OK/FAILED
            }
        } elseif ($tool.Name -eq 'claude') {
            try {
                Install-ClaudeCli
                $installed['claude'] = $true
            } catch {
                Write-Warning ('claude CLI install failed: ' + $_.Exception.Message)
                $installed['claude'] = $true
            }
        }
    }

    Update-SessionPath
}

# --- final report ------------------------------------------------------------

$states = @(Get-AllStates)
Show-Report -States $states -Installed $installed

$remaining = @($states | Where-Object { -not $_.Satisfied })
if ($remaining.Count -gt 0) {
    Write-Host ('Bootstrap incomplete - remaining gaps: ' + (($remaining | ForEach-Object { $_.Name }) -join ', ')) -ForegroundColor Red
    Write-Host 'A new terminal may be required for PATH changes; then re-run .\bootstrap.ps1 -Verify.'
    exit 1
}

Write-Host 'Base layer complete.' -ForegroundColor Green
Write-Host 'Post-steps (manual, one-time): git auth, claude login, Docker Desktop first run - see workstation/README.md.'
exit 0
