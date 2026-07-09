# claude-scope.ps1 - launch Claude Code in the devopser repo under a given scope.
#
#   .\claude-scope.ps1 -Scope main           # architect (full git)
#   .\claude-scope.ps1 -Scope skeleton       # owner-skeleton      -> packages/ + .github/workflows/
#   .\claude-scope.ps1 -Scope registry       # owner-registry      -> registry/
#   .\claude-scope.ps1 -Scope workstation    # owner-workstation   -> workstation/
#
# Scope = zone leaf name (or 'main'). Validated up-front via scope-resolve.mjs (fail-fast).
# Sets OMNIFIELD_SCOPE, which main-session-marker.mjs / scope-identity.mjs read on SessionStart.
# Owner sessions pin model opus; main keeps its own model. Run one terminal per parallel scope.
param(
  [Parameter(Mandatory = $true)][string]$Scope,
  [Parameter(ValueFromRemainingArguments = $true)]$ClaudeArgs
)

$resolveScript = Join-Path $PSScriptRoot ".claude/hooks/scope-resolve.mjs"
if (-not (Test-Path $resolveScript)) {
  Write-Host "[claude-scope] ERROR: $resolveScript not found" -ForegroundColor Red
  exit 2
}

$resolved = node $resolveScript $Scope
if ($LASTEXITCODE -ne 0) {
  Write-Host "[claude-scope] $resolved" -ForegroundColor Red
  exit 1
}

try {
  $info = $resolved | ConvertFrom-Json
  if ($info.kind -eq 'main') { $banner = "scope=main (architect)" }
  else { $banner = "scope=$($info.scope) -> $($info.relativePath)/" }
}
catch { $banner = "scope=$Scope" }

$env:OMNIFIELD_SCOPE = $Scope

if (-not $ClaudeArgs) { $ClaudeArgs = @() }
if ($Scope -ne 'main' -and -not (@($ClaudeArgs) -match '^--model')) {
  $ClaudeArgs = @('--model', 'opus') + @($ClaudeArgs)
  Write-Host "[claude-scope] owner-model: opus" -ForegroundColor DarkCyan
}

Write-Host "[claude-scope] $banner" -ForegroundColor Cyan
claude @ClaudeArgs
