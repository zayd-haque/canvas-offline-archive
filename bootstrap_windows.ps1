# [Codex] First-run Windows setup without a separately installed Python.
# This script is shipped with the app; downloaded archives are checksum-pinned.
$ErrorActionPreference = 'Stop'
$launchArguments = @($args)
$root = $PSScriptRoot

function Assert-UnlinkedPath([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        $item = Get-Item -LiteralPath $Path -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Refusing linked setup path: $Path"
        }
    }
}

function Get-RuntimeRelease {
    try {
        $architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    } catch {
        $architecture = $env:PROCESSOR_ARCHITEW6432
        if (-not $architecture) { $architecture = $env:PROCESSOR_ARCHITECTURE }
    }
    switch ($architecture.ToUpperInvariant()) {
        { $_ -in 'ARM64', 'AARCH64' } {
            return @{
                Archive = 'cpython-3.14.8%2B20261013-aarch64-pc-windows-msvc-install_only.tar.gz'
                Digest = '8b7980d500d05821feb9078df2f41f4b5f3bd6a4e4e57b7e6c2fe40c22042a39'
            }
        }
        { $_ -in 'X64', 'AMD64', 'X86_64' } {
            return @{
                Archive = 'cpython-3.14.8%2B20261013-x86_64-pc-windows-msvc-install_only.tar.gz'
                Digest = '3adacae2a39dfcbebe8d95a6e87a0dee167a057ab8f822eacf38e5fa4c97f76e'
            }
        }
        default { throw 'Canvas Offline Archive requires 64-bit Windows (x64 or ARM64).' }
    }
}

function Get-PrivatePython {
    $runtime = Join-Path $root '.python'
    $python = Join-Path $runtime 'python.exe'
    Assert-UnlinkedPath $runtime
    if (Test-Path -LiteralPath $python -PathType Leaf) { return $python }
    if (Test-Path -LiteralPath $runtime) {
        throw 'Private Python setup is incomplete. Rename .python inside App Files, then retry.'
    }
    $release = Get-RuntimeRelease
    $lockPath = Join-Path $root '.python-install.lock'
    Assert-UnlinkedPath $lockPath
    # A live setup owns an exclusive handle. An interrupted setup leaves a file,
    # but its handle is gone, so the next click can acquire it without manual work.
    try {
        $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate,
            [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch { throw 'Another Python setup is running. Let that window finish, then retry.' }
    $stage = Join-Path $root ('.python-download.' + [Guid]::NewGuid().ToString('N'))
    try {
        [IO.Directory]::CreateDirectory($stage) | Out-Null
        $archive = Join-Path $stage 'runtime.tar.gz'
        $url = 'https://github.com/astral-sh/python-build-standalone/releases/download/20261013/' + $release.Archive
        Write-Host 'Setting up Python for this app. You do not need to install Python yourself.'
        Write-Host 'First setup needs internet. Downloading the Windows runtime...'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $ProgressPreference = 'SilentlyContinue'
        $downloaded = $false
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            try {
                Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $archive -TimeoutSec 600
                $downloaded = $true
                break
            } catch {
                if ($attempt -eq 3) { throw 'Python download failed. Check your internet connection and double-click the launcher again.' }
            }
        }
        if (-not $downloaded) { throw 'Python download did not complete.' }
        $digest = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
        if ($digest.ToLowerInvariant() -ne $release.Digest) {
            throw 'Python verification failed. Nothing was installed; retry the launcher.'
        }
        # Use the Windows-supplied tar rather than a third-party PATH executable.
        $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
        if (-not (Test-Path -LiteralPath $tar)) {
            throw 'The Windows archive tool is missing. Use an up-to-date Windows 10 or Windows 11 installation.'
        }
        & $tar -xzf $archive -C $stage
        if ($LASTEXITCODE -ne 0) { throw 'Could not extract the Python runtime.' }
        $stagedPython = Join-Path $stage 'python\python.exe'
        & $stagedPython -I -c 'import sys; raise SystemExit(sys.version_info[:2] != (3, 14))'
        if ($LASTEXITCODE -ne 0) { throw 'The downloaded Python runtime could not start.' }
        # Directory.Move fails if a destination appeared; it never merges into it.
        [IO.Directory]::Move((Join-Path $stage 'python'), $runtime)
    } finally {
        if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
        $lock.Dispose()
        Remove-Item -LiteralPath $lockPath -Force
    }
    return $python
}

try {
    if ($launchArguments -contains '--help' -or $launchArguments -contains '-h') {
        Write-Host 'Double-click Open Canvas Offline Archive Windows.cmd to set up and open the app.'
        Write-Host 'Optional: --setup-only installs without opening; --reinstall recreates the virtual environment.'
        exit 0
    }
    Assert-UnlinkedPath $root
    Assert-UnlinkedPath (Join-Path $root '.venv')
    Assert-UnlinkedPath (Join-Path $root 'Canvas Module Downloader')
    Assert-UnlinkedPath (Join-Path $root 'Canvas Module Downloader\config.json')
    $python = Get-PrivatePython
    & $python -I -c 'import sys; raise SystemExit(sys.version_info[:2] != (3, 14))'
    if ($LASTEXITCODE -ne 0) { throw 'The private Python runtime is not a working Python 3.14 installation.' }
    Set-Location -LiteralPath $root
    & $python (Join-Path $root 'bootstrap_windows.py') @launchArguments
    exit $LASTEXITCODE
} catch {
    Write-Host ('Canvas Offline Archive could not start: ' + $_.Exception.Message)
    Write-Host 'Read WINDOWS_INSTALL.md inside App Files for help.'
    exit 1
}
