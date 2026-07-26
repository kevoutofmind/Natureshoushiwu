param(
  [string]$PythonVersion = "3.11",
  [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
$workerRoot = $PSScriptRoot
$venvRoot = Join-Path $workerRoot ".venv"
$venvPython = Join-Path $venvRoot "Scripts\python.exe"
$condaPython = Join-Path $venvRoot "python.exe"

if (
  -not (Test-Path -LiteralPath $venvPython) -and
  -not (Test-Path -LiteralPath $condaPython)
) {
  & py "-$PythonVersion" -m venv $venvRoot
  if ($LASTEXITCODE -ne 0) {
    $conda = Get-Command conda -ErrorAction SilentlyContinue
    if (-not $conda) {
      throw "Python $PythonVersion is required. Install it or make conda available."
    }
    & conda create -y -p $venvRoot "python=$PythonVersion"
    if ($LASTEXITCODE -ne 0) {
      throw "Unable to create the local Whisper Python environment."
    }
  }
}

if (Test-Path -LiteralPath $condaPython) {
  $venvPython = $condaPython
}

& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r (Join-Path $workerRoot "requirements.txt")

Set-Location -LiteralPath $workerRoot
& $venvPython -m uvicorn app:app --host 127.0.0.1 --port $Port
