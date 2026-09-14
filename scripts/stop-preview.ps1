$ErrorActionPreference = 'Stop'
$cmsRoot = Split-Path -Parent $PSScriptRoot
$cmsRecord = Join-Path $cmsRoot '.local/preview-processes.json'
if (-not (Test-Path -LiteralPath $cmsRecord)) { return }
$cmsProcesses = Get-Content -Raw -LiteralPath $cmsRecord | ConvertFrom-Json
foreach ($cmsPid in @($cmsProcesses.api, $cmsProcesses.web)) {
    $cmsProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$cmsPid"
    if ($cmsProcess -and ($cmsProcess.CommandLine -match 'Cms.Api.dll|next[/\\]dist[/\\]bin[/\\]next') -and ($cmsProcess.CommandLine.Contains($cmsRoot))) {
        Stop-Process -Id $cmsPid
    }
}
