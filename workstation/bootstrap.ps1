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

    Provisioning steps (each idempotent - already done => skip):
      1. Docker Desktop via winget.
      2. WSL distro (Ubuntu): `wsl --install -d Ubuntu --no-launch` +
         non-interactive init - user with uid 1000 (= `vscode` in the devbox
         image; the uid is the bind-mount ownership contract), NOPASSWD sudo,
         `[user] default=<user>` in /etc/wsl.conf. Canon "Windows: clones live
         in WSL2 FS" needs a real distro, the service-only `docker-desktop`
         distro is not one (briefs/feedback-container-sessions-brainer.md, K1).
      3. Docker Desktop WSL integration for that distro in settings-store.json
         (IntegratedWslDistros += distro, EnableIntegrationWithDefaultWslDistro).
         Desktop is restarted ONLY when a value actually changed.

    Alternative installs (engine in WSL2 without Desktop, linux servers) are
    manual - see workstation/docker.md.

.PARAMETER Verify
    Report-only preflight, installs/changes nothing: docker binary + engine,
    WSL distro registered, distro default user uid=1000, `docker version`
    answers from inside the distro (Desktop integration alive). Exit 1 on gaps.

.EXAMPLE
    .\bootstrap.ps1            # provision (Docker Desktop + WSL distro + integration)
.EXAMPLE
    .\bootstrap.ps1 -Verify    # preflight check only
#>
[CmdletBinding()]
param(
    [switch]$Verify
)

$ErrorActionPreference = 'Stop'

# --- contract knobs -----------------------------------------------------------
$WslDistro = 'Ubuntu'
$WslUser   = 'ubuntu'  # name is cosmetic; the contract is uid 1000 (= vscode in devbox image)
$WslUid    = 1000
$DockerSettingsStore = Join-Path $env:APPDATA 'Docker\settings-store.json'

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

function Invoke-WslCommand {
    # Runs wsl.exe and returns { ExitCode; Lines }. PS 5.1 gotcha: wsl.exe's own
    # output (e.g. `wsl -l -q`) is UTF-16LE, which PS 5.1 mis-decodes into
    # NUL-riddled strings ("U`0b`0u`0..."). WSL_UTF8=1 asks modern WSL for UTF-8;
    # the NUL-strip below covers older builds as belt-and-braces.
    param([string[]]$Arguments)
    $prevUtf8 = $env:WSL_UTF8
    $env:WSL_UTF8 = '1'
    $raw = $null
    $code = 1
    try {
        $ErrorActionPreference = 'Continue'
        $raw = & wsl.exe @Arguments 2>$null
        $code = $LASTEXITCODE
    } catch {
    } finally {
        $ErrorActionPreference = 'Stop'
        if ($null -eq $prevUtf8) {
            Remove-Item Env:\WSL_UTF8 -ErrorAction SilentlyContinue
        } else {
            $env:WSL_UTF8 = $prevUtf8
        }
    }
    $lines = @()
    foreach ($l in @($raw)) {
        $clean = ("$l" -replace "`0", '').Trim()
        if ($clean -ne '') { $lines += $clean }
    }
    return [pscustomobject]@{ ExitCode = $code; Lines = $lines }
}

function Test-WslDistroPresent {
    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { return $false }
    $res = Invoke-WslCommand @('-l', '-q')
    return [bool]($res.Lines -contains $WslDistro)
}

function Get-WslDefaultUid {
    # uid of the distro's DEFAULT user - validates both the uid-1000 user and
    # that [user] default= in /etc/wsl.conf took effect.
    $res = Invoke-WslCommand @('-d', $WslDistro, '--', 'id', '-u')
    if ($res.ExitCode -eq 0 -and $res.Lines.Count -ge 1) { return $res.Lines[0] }
    return $null
}

function Test-WslDockerIntegration {
    # docker CLI answering from INSIDE the distro = Desktop WSL integration alive.
    $res = Invoke-WslCommand @('-d', $WslDistro, '--', 'docker', 'version')
    return ($res.ExitCode -eq 0)
}

function Initialize-WslDistro {
    # Non-interactive init (no Ubuntu OOBE): create uid-1000 user, NOPASSWD
    # sudo, make it the default via /etc/wsl.conf. Safe to re-run.
    $sh = ('set -e; ' +
        'if ! id -u {0} >/dev/null 2>&1; then useradd -m -u {0} -s /bin/bash {1}; fi; ' +
        'u=$(id -nu {0}); ' +
        'printf ''%s ALL=(ALL) NOPASSWD:ALL\n'' $u > /etc/sudoers.d/90-omnifield-nopasswd; ' +
        'chmod 0440 /etc/sudoers.d/90-omnifield-nopasswd; ' +
        'grep -q ''^\[user\]'' /etc/wsl.conf 2>/dev/null || printf ''[user]\ndefault=%s\n'' $u >> /etc/wsl.conf'
        ) -f $WslUid, $WslUser
    $res = Invoke-WslCommand @('-d', $WslDistro, '-u', 'root', '--', 'sh', '-c', $sh)
    if ($res.ExitCode -ne 0) {
        Write-Warning ('WSL distro init failed (exit {0}). Re-run bootstrap; if it persists, init manually - see workstation/README.md.' -f $res.ExitCode)
        return $false
    }
    # wsl.conf [user] default= applies on next distro start.
    Invoke-WslCommand @('--terminate', $WslDistro) | Out-Null
    Write-Host ('{0} initialized: user uid={1}, NOPASSWD sudo, default user set.' -f $WslDistro, $WslUid)
    return $true
}

function Set-DockerDesktopWslIntegration {
    # Ensures IntegratedWslDistros contains $WslDistro and
    # EnableIntegrationWithDefaultWslDistro=true in settings-store.json.
    # Returns 'unavailable' | 'ok' (nothing changed) | 'changed'.
    if (-not (Test-Path $DockerSettingsStore)) { return 'unavailable' }
    $settings = [IO.File]::ReadAllText($DockerSettingsStore) | ConvertFrom-Json
    $changed = $false
    $names = @($settings.PSObject.Properties.Name)

    if ($names -contains 'EnableIntegrationWithDefaultWslDistro') {
        if (-not $settings.EnableIntegrationWithDefaultWslDistro) {
            $settings.EnableIntegrationWithDefaultWslDistro = $true
            $changed = $true
        }
    } else {
        $settings | Add-Member -NotePropertyName 'EnableIntegrationWithDefaultWslDistro' -NotePropertyValue $true
        $changed = $true
    }

    $distros = @()
    if (($names -contains 'IntegratedWslDistros') -and ($null -ne $settings.IntegratedWslDistros)) {
        $distros = @($settings.IntegratedWslDistros)
    }
    if ($distros -notcontains $WslDistro) {
        $distros = $distros + $WslDistro
        if ($names -contains 'IntegratedWslDistros') {
            $settings.IntegratedWslDistros = $distros
        } else {
            $settings | Add-Member -NotePropertyName 'IntegratedWslDistros' -NotePropertyValue $distros
        }
        $changed = $true
    }

    if (-not $changed) { return 'ok' }

    $json = $settings | ConvertTo-Json -Depth 64
    # ☠ BOM landmine (caught live, feedback-container-sessions-brainer.md K1):
    # PS 5.1 Set-Content/Out-File -Encoding utf8 write UTF-8 WITH BOM and Docker
    # Desktop dies on start ("formatting settings-store.json: invalid character 'ï'").
    # settings-store.json must be written BOM-less - only via WriteAllText below.
    [IO.File]::WriteAllText($DockerSettingsStore, $json, [Text.UTF8Encoding]::new($false))
    return 'changed'
}

function Wait-DockerEngine {
    param([int]$TimeoutSec = 180)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $ErrorActionPreference = 'Continue'
            docker info *>$null
        } catch {
        } finally {
            $ErrorActionPreference = 'Stop'
        }
        if ($LASTEXITCODE -eq 0) { return $true }
        Start-Sleep -Seconds 5
    }
    return $false
}

function Restart-DockerDesktop {
    # Integration provisioning race (caught live): right after enabling WSL
    # integration, /mnt/wsl/docker-desktop/docker-desktop-user-distro can stay
    # 0-byte and the distro proxy fails with "Permission denied" / window
    # "running wsl distro proxy ... exit status 1". Cure: FULL `wsl --shutdown`
    # before relaunching Desktop, so the service distro re-provisions cleanly.
    Write-Host 'Restarting Docker Desktop (WSL integration changed)...'
    foreach ($name in @('Docker Desktop', 'com.docker.backend')) {
        Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    Invoke-WslCommand @('--shutdown') | Out-Null
    $exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (-not (Test-Path $exe)) {
        Write-Warning ('Docker Desktop.exe not found at "{0}" - start Docker Desktop manually.' -f $exe)
        return
    }
    Start-Process -FilePath $exe | Out-Null
    Write-Host 'Waiting for the engine (up to 180 s)...'
    if (Wait-DockerEngine -TimeoutSec 180) {
        Write-Host 'Engine is up.'
    } else {
        Write-Warning 'Engine did not answer within 180 s - check the Docker Desktop window, then .\bootstrap.ps1 -Verify.'
    }
}

function Get-WorkstationReport {
    # Shared read-only state collector for -Verify and the end-of-provision report.
    $rows = @()
    $failures = @()

    $docker = Get-DockerState
    if (-not $docker.Found) {
        $rows += [pscustomobject]@{ Check = 'docker'; Status = 'MISSING'; Detail = '' }
        $failures += 'docker missing - run .\bootstrap.ps1 to provision.'
    } elseif (-not $docker.EngineUp) {
        $rows += [pscustomobject]@{ Check = 'docker'; Status = 'ENGINE-DOWN'; Detail = $docker.Version }
        $failures += 'docker binary present but engine not responding (start Docker Desktop / see workstation/docker.md).'
    } else {
        $rows += [pscustomobject]@{ Check = 'docker'; Status = 'OK'; Detail = $docker.Version }
    }

    $distroPresent = Test-WslDistroPresent
    if ($distroPresent) {
        $rows += [pscustomobject]@{ Check = 'wsl-distro'; Status = 'OK'; Detail = ('{0} registered' -f $WslDistro) }
    } else {
        $rows += [pscustomobject]@{ Check = 'wsl-distro'; Status = 'MISSING'; Detail = ('{0} not registered' -f $WslDistro) }
        $failures += ('WSL distro {0} missing - run .\bootstrap.ps1 (reboot may be required after WSL feature install).' -f $WslDistro)
    }

    if ($distroPresent) {
        $uid = Get-WslDefaultUid
        if ("$uid" -eq "$WslUid") {
            $rows += [pscustomobject]@{ Check = 'wsl-user'; Status = 'OK'; Detail = ('default user uid={0}' -f $uid) }
        } else {
            $detail = 'id -u failed'
            if ($null -ne $uid) { $detail = ('default user uid={0}, expected {1}' -f $uid, $WslUid) }
            $rows += [pscustomobject]@{ Check = 'wsl-user'; Status = 'BAD-UID'; Detail = $detail }
            $failures += ('distro default user is not uid {0} (bind-mount ownership contract with devbox `vscode`) - re-run .\bootstrap.ps1.' -f $WslUid)
        }

        if (Test-WslDockerIntegration) {
            $rows += [pscustomobject]@{ Check = 'wsl-docker'; Status = 'OK'; Detail = ('docker answers inside {0}' -f $WslDistro) }
        } else {
            $rows += [pscustomobject]@{ Check = 'wsl-docker'; Status = 'NO-INTEGRATION'; Detail = ('docker not responding inside {0}' -f $WslDistro) }
            $failures += 'Docker Desktop WSL integration not alive - run .\bootstrap.ps1; if Desktop shows "wsl distro proxy ... exit status 1", do `wsl --shutdown` and start Desktop again (see README troubleshooting).'
        }
    } else {
        $rows += [pscustomobject]@{ Check = 'wsl-user';   Status = 'SKIPPED'; Detail = 'no distro' }
        $rows += [pscustomobject]@{ Check = 'wsl-docker'; Status = 'SKIPPED'; Detail = 'no distro' }
    }

    return [pscustomobject]@{ Rows = $rows; Failures = $failures; Docker = $docker }
}

function Show-Report {
    param($Report)
    Write-Host ''
    Write-Host ('{0,-12} {1,-16} {2}' -f 'CHECK', 'STATUS', 'DETAIL')
    Write-Host ('-' * 64)
    foreach ($r in $Report.Rows) {
        Write-Host ('{0,-12} {1,-16} {2}' -f $r.Check, $r.Status, $r.Detail)
    }
    Write-Host ''
}

Update-SessionPath

# ------------------------------------------------------------------ verify ----
if ($Verify) {
    $report = Get-WorkstationReport
    Show-Report -Report $report
    if ($report.Failures.Count -gt 0) {
        foreach ($f in $report.Failures) {
            Write-Host ('Verify FAILED - {0}' -f $f) -ForegroundColor Red
        }
        exit 1
    }
    Write-Host 'Verify OK - containers-only base layer complete (docker + WSL distro + integration).' -ForegroundColor Green
    exit 0
}

# --------------------------------------------------------------- provision ----
# Step 1/3: Docker Desktop
$state = Get-DockerState
if ($state.Found) {
    Write-Host 'Docker already present - install skip.'
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
}

# Step 2/3: WSL distro with uid-1000 default user
Write-Host ''
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    Write-Warning 'wsl.exe not found - enable WSL first (`wsl --install`, reboot), then re-run bootstrap.'
} else {
    if (Test-WslDistroPresent) {
        Write-Host ('WSL distro {0} already registered - install skip.' -f $WslDistro)
    } else {
        Write-Host ('Installing WSL distro {0} (wsl --install -d {0} --no-launch)...' -f $WslDistro)
        $ins = Invoke-WslCommand @('--install', '-d', $WslDistro, '--no-launch')
        if ($ins.ExitCode -ne 0) {
            Write-Warning ('wsl --install exited with code {0}. If WSL features were just enabled, reboot and re-run bootstrap.' -f $ins.ExitCode)
        }
    }
    if (Test-WslDistroPresent) {
        $uid = Get-WslDefaultUid
        if ("$uid" -eq "$WslUid") {
            Write-Host ('{0} default user already uid={1} - init skip.' -f $WslDistro, $WslUid)
        } else {
            Initialize-WslDistro | Out-Null
        }
    }
}

# Step 3/3: Docker Desktop WSL integration (restart ONLY on real change)
Write-Host ''
$integration = Set-DockerDesktopWslIntegration
if ($integration -eq 'unavailable') {
    Write-Host ('settings-store.json not found ({0}) - Docker Desktop has not completed first run yet. Start Docker Desktop once, then re-run .\bootstrap.ps1.' -f $DockerSettingsStore) -ForegroundColor Yellow
} elseif ($integration -eq 'ok') {
    Write-Host 'Docker Desktop WSL integration already configured - no restart.'
} else {
    Restart-DockerDesktop
}

# ------------------------------------------------------------ final report ----
$report = Get-WorkstationReport
Show-Report -Report $report

if (-not $report.Docker.Found) {
    Write-Host 'Bootstrap incomplete - docker still missing. A new terminal may be required for PATH; then .\bootstrap.ps1 -Verify.' -ForegroundColor Red
    exit 1
}
if ($report.Failures.Count -gt 0) {
    Write-Host 'Bootstrap ran, gaps remain (typical on first pass: Docker Desktop first run, WSL reboot). Address the hints below, then re-run .\bootstrap.ps1 - it is idempotent:' -ForegroundColor Yellow
    foreach ($f in $report.Failures) {
        Write-Host ('  - {0}' -f $f) -ForegroundColor Yellow
    }
    exit 0
}
Write-Host 'Containers-only base layer complete (docker + WSL distro + integration). Next: workstation/README.md (post-steps happen INSIDE the container).' -ForegroundColor Green
exit 0
