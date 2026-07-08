#Requires -Version 5.1
<#
.SYNOPSIS
    Omnifield workstation bootstrap - base dev-machine layer.
    Capability: workstation (provision / verify). Provider: windows-winget (MVP).

.DESCRIPTION
    Installs exactly the 5 base-layer tools: git, node LTS (+corepack), uv,
    Docker Desktop, claude CLI. Idempotent: tools already present are skipped
    and reported with their version.

    Everything else self-assembles from pins inside product repos
    (.python-version -> uv fetches CPython, packageManager -> corepack fetches
    pnpm). Do NOT add system Python / pip / global pnpm here - that layer is
    owned by uv/corepack. See workstation/README.md.

.PARAMETER Verify
    Report-only preflight: prints a tool -> status/version table, installs
    nothing. Exit 1 if any tool is missing (usable as CI/session preflight).

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
# winget: corepack ships with node; claude uses the native installer below.
$BaseTools = @(
    [pscustomobject]@{ Name = 'git';      WingetId = 'Git.Git' },
    [pscustomobject]@{ Name = 'node';     WingetId = 'OpenJS.NodeJS.LTS' },
    [pscustomobject]@{ Name = 'corepack'; WingetId = $null },
    [pscustomobject]@{ Name = 'uv';       WingetId = 'astral-sh.uv' },
    [pscustomobject]@{ Name = 'docker';   WingetId = 'Docker.DockerDesktop' },
    [pscustomobject]@{ Name = 'claude';   WingetId = $null }
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
    param([string]$Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
        return [pscustomobject]@{ Name = $Name; Found = $false; Version = '' }
    }
    $version = 'found (version unknown)'
    try {
        $ErrorActionPreference = 'Continue'
        $out = & $Name --version 2>$null | Select-Object -First 1
        if ($out) { $version = "$out".Trim() }
    } catch {
    } finally {
        $ErrorActionPreference = 'Stop'
    }
    return [pscustomobject]@{ Name = $Name; Found = $true; Version = $version }
}

function Get-AllStates {
    foreach ($t in $BaseTools) { Get-ToolState -Name $t.Name }
}

function Show-Report {
    param($States, [hashtable]$Installed)
    Write-Host ''
    Write-Host ('{0,-10} {1,-10} {2}' -f 'TOOL', 'STATUS', 'VERSION')
    Write-Host ('-' * 60)
    foreach ($s in $States) {
        if ($s.Found -and $Installed[$s.Name]) { $status = 'INSTALLED' }
        elseif ($s.Found)                      { $status = 'OK' }
        elseif ($Installed[$s.Name])           { $status = 'FAILED' }
        else                                   { $status = 'MISSING' }
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
    $missing = @($states | Where-Object { -not $_.Found })
    if ($missing.Count -gt 0) {
        Write-Host ('Verify FAILED - missing: ' + (($missing | ForEach-Object { $_.Name }) -join ', ')) -ForegroundColor Red
        Write-Host 'Run .\bootstrap.ps1 (no flags) to provision.'
        exit 1
    }
    Write-Host 'Verify OK - base layer complete.' -ForegroundColor Green
    exit 0
}

# --- provision --------------------------------------------------------------

$installed = @{}
$missing   = @($states | Where-Object { -not $_.Found })

if ($missing.Count -eq 0) {
    Write-Host 'Base layer already complete - nothing to install.'
} else {
    $wingetNeeded = @($missing | Where-Object {
        $name = $_.Name
        ($BaseTools | Where-Object { $_.Name -eq $name }).WingetId
    })
    if ($wingetNeeded.Count -gt 0 -and -not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Host 'winget not found. Install "App Installer" from Microsoft Store first (see README troubleshooting for LTSC/Server).' -ForegroundColor Red
        exit 1
    }

    foreach ($m in $missing) {
        $name = $m.Name
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
        # corepack has no direct install: it ships with node. If node was just
        # installed, the re-scan below picks corepack up automatically.
    }

    Update-SessionPath
}

# corepack enable is idempotent; it needs write access to the node install dir
# (elevation when node lives under Program Files).
if (Get-Command corepack -ErrorAction SilentlyContinue) {
    corepack enable
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "corepack enable failed (likely needs an elevated shell). Run 'corepack enable' as administrator."
    }
} else {
    Write-Warning 'corepack not found (should ship with node LTS) - see README troubleshooting.'
}

# --- final report ------------------------------------------------------------

$states = @(Get-AllStates)
Show-Report -States $states -Installed $installed

$stillMissing = @($states | Where-Object { -not $_.Found })
if ($stillMissing.Count -gt 0) {
    Write-Host ('Bootstrap incomplete - still missing: ' + (($stillMissing | ForEach-Object { $_.Name }) -join ', ')) -ForegroundColor Red
    Write-Host 'A new terminal may be required for PATH changes; then re-run .\bootstrap.ps1 -Verify.'
    exit 1
}

Write-Host 'Base layer complete.' -ForegroundColor Green
Write-Host 'Post-steps (manual, one-time): git auth, claude login, Docker Desktop first run - see workstation/README.md.'
exit 0
