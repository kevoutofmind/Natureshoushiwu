$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$runtimeLogDir = Join-Path $repoRoot '.runtime-logs'
$npmCommandInfo = Get-Command npm.cmd -ErrorAction SilentlyContinue

if (-not $npmCommandInfo) {
  throw 'npm.cmd was not found. Install Node.js and reopen PowerShell.'
}

$npmCommand = $npmCommandInfo.Source
New-Item -ItemType Directory -Path $runtimeLogDir -Force | Out-Null

function Test-LocalPortListening {
  param([int]$Port)

  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connection = $client.ConnectAsync('127.0.0.1', $Port)
    if (-not $connection.Wait(400)) {
      return $false
    }
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Wait-LocalPortListening {
  param(
    [int]$Port,
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-LocalPortListening -Port $Port) {
      return $true
    }
    Start-Sleep -Seconds 1
  }

  return $false
}

function Start-RoadshowService {
  param(
    [string]$ServiceName,
    [int]$Port,
    [string]$ServiceDirectory,
    [string[]]$NpmArguments
  )

  if (Test-LocalPortListening -Port $Port) {
    Write-Output "$ServiceName is already running on port $Port."
    return
  }

  $startOptions = @{
    FilePath               = $npmCommand
    ArgumentList           = $NpmArguments
    WorkingDirectory       = $ServiceDirectory
    WindowStyle            = 'Hidden'
    RedirectStandardOutput = Join-Path $runtimeLogDir "$ServiceName.log"
    RedirectStandardError  = Join-Path $runtimeLogDir "$ServiceName.err.log"
  }
  Start-Process @startOptions

  Write-Output "Starting $ServiceName."
}

Start-RoadshowService `
  -ServiceName 'backend-roadshow' `
  -Port 3001 `
  -ServiceDirectory (Join-Path $repoRoot 'bknd') `
  -NpmArguments @('run', 'start:roadshow')

if (-not (Wait-LocalPortListening -Port 3001 -TimeoutSeconds 30)) {
  throw "Backend did not open port 3001. Check '$runtimeLogDir\backend-roadshow.err.log'."
}

Start-RoadshowService `
  -ServiceName 'frontend-roadshow' `
  -Port 3000 `
  -ServiceDirectory (Join-Path $repoRoot 'ftnd') `
  -NpmArguments @('run', 'dev:roadshow')

if (-not (Wait-LocalPortListening -Port 3000 -TimeoutSeconds 30)) {
  throw "Frontend did not open port 3000. Check '$runtimeLogDir\frontend-roadshow.err.log'."
}

Write-Output 'MOVE / MATCH roadshow is ready:'
Write-Output '  Teaching: http://localhost:3000/teaching?danceId=dance-001'
Write-Output '  API health: http://localhost:3001/api/vlm-core/health'
