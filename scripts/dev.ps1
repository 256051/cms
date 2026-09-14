param([ValidateSet('Api','Web','Initialize')][string]$Target = 'Api')
$ErrorActionPreference = 'Stop'
$cmsRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $cmsRoot
New-Item -ItemType Directory -Force (Join-Path $cmsRoot '.local') | Out-Null
if (-not $env:Database__Type) { $env:Database__Type = 'Sqlite' }
if (-not $env:Database__ConnectionString) { $env:Database__ConnectionString = 'Data Source=' + (Join-Path $cmsRoot '.local/dev.db') }
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:Storage__Path = Join-Path $cmsRoot '.local/uploads'
$env:Security__KeyPath = Join-Path $cmsRoot '.local/keys'
$env:Urls = 'http://127.0.0.1:5080'
$env:NEXT_TELEMETRY_DISABLED = '1'
if ($Target -eq 'Web') {
    Set-Location -LiteralPath (Join-Path $cmsRoot 'web')
    npm run dev
} elseif ($Target -eq 'Initialize') {
    if (-not $env:Setup__Username) { $env:Setup__Username = Read-Host '管理员账号（小写字母/数字，3–64 位）' }
    if (-not $env:Setup__Password) { $cmsPassword = Read-Host '管理员密码（至少 12 字符）' -AsSecureString; $env:Setup__Password = [System.Net.NetworkCredential]::new('', $cmsPassword).Password }
    try { dotnet run --project src/Cms.Api -- --initialize } finally { $env:Setup__Password = $null }
} else { dotnet run --project src/Cms.Api }
if ($LASTEXITCODE -ne 0) { throw 'Command failed.' }
