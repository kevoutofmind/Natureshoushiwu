param(
    [string]$GitExe = "git"
)

$ErrorActionPreference = "Stop"
$BackendDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$CacheDir = Join-Path $BackendDir ".cache\cosyvoice"
$CondaDir = Join-Path $CacheDir "miniconda3"
$CondaExe = Join-Path $CondaDir "Scripts\conda.exe"
$EnvDir = Join-Path $CacheDir "env"
$PythonExe = Join-Path $EnvDir "python.exe"
$DependencyMarker = Join-Path $EnvDir ".cosyvoice-dependencies-ready"
$RepoDir = Join-Path $CacheDir "CosyVoice"
$ModelDir = Join-Path $CacheDir "models\CosyVoice-300M-SFT"
$Installer = Join-Path $CacheDir "miniconda-installer.exe"
$WheelDir = Join-Path $CacheDir "wheels"
$TorchWheel = Join-Path $WheelDir "torch-2.3.1+cu121-cp310-cp310-win_amd64.whl"
$TorchUrl = "https://download-r2.pytorch.org/whl/cu121/torch-2.3.1%2Bcu121-cp310-cp310-win_amd64.whl"

New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null

if (-not (Test-Path -LiteralPath $CondaExe)) {
    Write-Host "[1/4] Downloading Miniconda..."
    Invoke-WebRequest `
        -Uri "https://repo.anaconda.com/miniconda/Miniconda3-py310_25.1.1-2-Windows-x86_64.exe" `
        -OutFile $Installer
    Start-Process `
        -FilePath $Installer `
        -ArgumentList "/InstallationType=JustMe", "/RegisterPython=0", "/AddToPath=0", "/S", "/D=$CondaDir" `
        -Wait `
        -WindowStyle Hidden
}

if (-not (Test-Path -LiteralPath $RepoDir)) {
    Write-Host "[2/4] Cloning CosyVoice..."
    & $GitExe clone --recursive https://github.com/FunAudioLLM/CosyVoice.git $RepoDir
    if ($LASTEXITCODE -ne 0) {
        throw "CosyVoice clone failed."
    }
}

if (-not (Test-Path -LiteralPath $PythonExe)) {
    Write-Host "[3/4] Creating Python 3.10 environment..."
    & $CondaExe create --prefix $EnvDir -y python=3.10
    if ($LASTEXITCODE -ne 0) {
        throw "Conda environment creation failed."
    }
}

if (-not (Test-Path -LiteralPath $DependencyMarker)) {
    Write-Host "[3/4] Installing CosyVoice dependencies..."
    & $PythonExe -m pip install "setuptools<81" wheel
    if ($LASTEXITCODE -ne 0) {
        throw "Python build tools installation failed."
    }
    & $PythonExe -m pip install `
        --no-build-isolation `
        --no-deps `
        "openai-whisper==20231117"
    if ($LASTEXITCODE -ne 0) {
        throw "OpenAI Whisper compatibility installation failed."
    }
    & $PythonExe -c "import torch; assert torch.__version__.startswith('2.3.1')"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Downloading CUDA PyTorch with resume support..."
        New-Item -ItemType Directory -Force -Path $WheelDir | Out-Null
        & curl.exe `
            --location `
            --fail `
            --retry 50 `
            --retry-delay 5 `
            --retry-all-errors `
            --speed-limit 1024 `
            --speed-time 30 `
            --continue-at - `
            --output $TorchWheel `
            $TorchUrl
        if ($LASTEXITCODE -ne 0) {
            throw "CUDA PyTorch download failed."
        }
        & $PythonExe -m pip install --no-deps $TorchWheel
        if ($LASTEXITCODE -ne 0) {
            throw "CUDA PyTorch installation failed."
        }
    }
    & $PythonExe -m pip install -r (Join-Path $RepoDir "requirements.txt") `
        -i https://mirrors.aliyun.com/pypi/simple/ `
        --trusted-host mirrors.aliyun.com
    if ($LASTEXITCODE -ne 0) {
        throw "CosyVoice dependencies installation failed."
    }
    New-Item -ItemType File -Force -Path $DependencyMarker | Out-Null
}

if (-not (Test-Path -LiteralPath $ModelDir)) {
    Write-Host "[4/4] Downloading CosyVoice-300M-SFT..."
    New-Item -ItemType Directory -Force -Path (Split-Path $ModelDir -Parent) | Out-Null
    & $PythonExe -c "from modelscope import snapshot_download; snapshot_download('iic/CosyVoice-300M-SFT', local_dir=r'$ModelDir')"
    if ($LASTEXITCODE -ne 0) {
        throw "CosyVoice model download failed."
    }
}

Write-Host "CosyVoice is ready."
Write-Host "Start it with:"
Write-Host "& '$PythonExe' '$PSScriptRoot\cosyvoice-openai-server.py'"
