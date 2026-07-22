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
    Start-Sleep -Seconds 2
  }

  return $false
}

function Ensure-LocalDatabase {
  if (Test-LocalPortListening -Port 5434) {
    return
  }

  $dockerCommandInfo = Get-Command docker.exe -ErrorAction SilentlyContinue
  if (-not $dockerCommandInfo) {
    throw 'docker.exe was not found. Install and start Docker Desktop.'
  }

  $dockerCommand = $dockerCommandInfo.Source
  & $dockerCommand info *> $null
  $dockerReady = $LASTEXITCODE -eq 0

  $dockerDesktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
  if (-not $dockerReady -and (Test-Path -LiteralPath $dockerDesktop)) {
    Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
    Write-Output 'Starting Docker Desktop for the local database.'
  }

  $dockerDeadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $dockerDeadline) {
    & $dockerCommand info *> $null
    if ($LASTEXITCODE -eq 0) {
      $dockerReady = $true
      break
    }
    Start-Sleep -Seconds 2
  }

  if (-not $dockerReady) {
    throw 'Docker Desktop did not become ready within 60 seconds.'
  }

  $containerNames = @(& $dockerCommand ps -a --format '{{.Names}}')
  $databaseContainer = @('flight-system-postgres', 'tiktok-ai-postgres') |
    Where-Object { $containerNames -contains $_ } |
    Select-Object -First 1

  if (-not $databaseContainer) {
    throw 'PostgreSQL container was not found. Create it by following README section 3.'
  }

  & $dockerCommand start $databaseContainer | Out-Null
  if (-not (Wait-LocalPortListening -Port 5434 -TimeoutSeconds 30)) {
    throw "PostgreSQL container '$databaseContainer' did not open port 5434."
  }

  Write-Output "PostgreSQL is ready in container '$databaseContainer'."
}

function Start-DevService {
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

  $stdoutLog = Join-Path $runtimeLogDir "$ServiceName.log"
  $stderrLog = Join-Path $runtimeLogDir "$ServiceName.err.log"

  $startOptions = @{
    FilePath               = $npmCommand
    ArgumentList           = $NpmArguments
    WorkingDirectory       = $ServiceDirectory
    WindowStyle            = 'Hidden'
    RedirectStandardOutput = $stdoutLog
    RedirectStandardError  = $stderrLog
  }
  Start-Process @startOptions

  Write-Output "Starting $ServiceName."
}

Ensure-LocalDatabase

Start-DevService -ServiceName 'backend-dev' -Port 3001 -ServiceDirectory (Join-Path $repoRoot 'bknd') -NpmArguments @('run', 'start:dev')

if (-not (Wait-LocalPortListening -Port 3001 -TimeoutSeconds 30)) {
  throw "Backend did not open port 3001. Check '$runtimeLogDir\backend-dev.err.log'."
}

Start-DevService -ServiceName 'frontend-dev' -Port 3000 -ServiceDirectory (Join-Path $repoRoot 'ftnd') -NpmArguments @('run', 'dev')

if (-not (Wait-LocalPortListening -Port 3000 -TimeoutSeconds 30)) {
  throw "Frontend did not open port 3000. Check '$runtimeLogDir\frontend-dev.err.log'."
}

Write-Output 'MOVE / MATCH is ready at http://localhost:3000.'
