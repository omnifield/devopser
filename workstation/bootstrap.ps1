#Requires -Version 5.1
<#
.SYNOPSIS
    Omnifield workstation bootstrap - containers-only base layer.
    Capability: workstation (provision / verify). Provider: windows-winget (MVP).

.DESCRIPTION
    Canon (containers-only, briefs/containers-only-and-management.md, 2026-07-10):
    the machine gets Docker and NOTHING else - no git, no node/pnpm/uv, no
    claude CLI on the host. Everything executes inside containers
    (ghcr.io/omnifield/devbox); files live on the machine via bind-mount.

    This script installs/verifies exactly one thing: Docker Desktop (winget).
    Alternative installs (engine in WSL2 without Desktop, linux servers) are
    manual - see workstation/docker.md.

.PARAMETER Verify
    Report-only preflight: docker binary + engine responsiveness, installs
    nothing. Exit 1 on gaps.

.EXAMPLE
    .\bootstrap.ps1            # provision (install Docker Desktop if missing)
.EXAMPLE
    .\bootstrap.ps1 -Verify    # preflight check only
#>
[CmdletBinding()]
param(
    [switch]$Verify
)

$ErrorActionPreference = 'Stop'

function Update-SessionPath {
    # Installers write PATH to the registry; the current session does not see
    # it until re-read. Append (not replace) so session-only entries survive.
    $machine  = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user     = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = $env:Path + ';' + $machine + ';' + $user
}

function Get-DockerState {
    $cmd = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $cmd) {
        return [pscustomobject]@{ Found = $false; EngineUp = $false; Version = '' }
    }
    $version = 'found (version unknown)'
    $engineUp = $false
    try {
        $ErrorActionPreference = 'Continue'
        $out = docker --version 2>$null | Select-Object -First 1
        if ($out) { $version = "$out".Trim() }
        docker info *>$null
        if ($LASTEXITCODE -eq 0) { $engineUp = $true }
    } catch {
    } finally {
        $ErrorActionPreference = 'Stop'
    }
    return [pscustomobject]@{ Found = $true; EngineUp = $engineUp; Version = $version }
}

function Show-Report {
    param($State)
    Write-Host ''
    Write-Host ('{0,-10} {1,-12} {2}' -f 'TOOL', 'STATUS', 'VERSION')
    Write-Host ('-' * 60)
    if (-not $State.Found)        { $status = 'MISSING' }
    elseif (-not $State.EngineUp) { $status = 'ENGINE-DOWN' }
    else                          { $status = 'OK' }
    Write-Host ('{0,-10} {1,-12} {2}' -f 'docker', $status, $State.Version)
    Write-Host ''
}

Update-SessionPath
$state = Get-DockerState

if ($Verify) {
    Show-Report -State $state
    if (-not $state.Found) {
        Write-Host 'Verify FAILED - docker missing. Run .\bootstrap.ps1 to provision.' -ForegroundColor Red
        exit 1
    }
    if (-not $state.EngineUp) {
        Write-Host 'Verify FAILED - docker binary is present but the engine is not responding (start Docker Desktop / see workstation/docker.md).' -ForegroundColor Red
        exit 1
    }
    Write-Host 'Verify OK - containers-only base layer complete.' -ForegroundColor Green
    exit 0
}

if ($state.Found) {
    Write-Host 'Docker already present - nothing to install.'
} else {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Host 'winget not found. Install "App Installer" from Microsoft Store first (see README troubleshooting), or install Docker manually - workstation/docker.md.' -ForegroundColor Red
        exit 1
    }
    Write-Host 'Installing Docker Desktop via winget (Docker.DockerDesktop)...'
    winget install --id Docker.DockerDesktop --exact --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-Warning ('winget install exited with code {0}' -f $LASTEXITCODE)
    }
    Update-SessionPath
    $state = Get-DockerState
}

Show-Report -State $state

if (-not $state.Found) {
    Write-Host 'Bootstrap incomplete - docker still missing. A new terminal may be required for PATH; then .\bootstrap.ps1 -Verify.' -ForegroundColor Red
    exit 1
}
if (-not $state.EngineUp) {
    Write-Host 'Docker installed but engine not running yet: start Docker Desktop once (license + WSL2 init), then .\bootstrap.ps1 -Verify.' -ForegroundColor Yellow
    exit 0
}
Write-Host 'Containers-only base layer complete. Next: workstation/README.md (post-steps happen INSIDE the container).' -ForegroundColor Green
exit 0
