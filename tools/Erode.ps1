param([uint32]$Steps=192,[uint32]$Seed=2026,[string]$Output='evidence/local/basin.json',[string]$Import='')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
New-Item -ItemType Directory -Force 'evidence/local' | Out-Null
$settings = @{seed=$Seed;erosion_steps=$Steps}
$settingsPath = Join-Path (Get-Location) 'evidence/local/erosion-settings.json'
$settings | ConvertTo-Json | Set-Content -LiteralPath $settingsPath -Encoding ASCII
$argsList=@('run','-p','solar-probe','--bin','solar-gpu-probe','--release','--locked','--','--render','--width','640','--height','360','--bookmark','ground','--settings',$settingsPath,'--erosion-export',$Output,'--output','evidence/local/eroded.png')
if ($Import) {$argsList+=@('--erosion-import',$Import,'--erosion-add-steps',"$Steps")}
& cargo @argsList
if ($LASTEXITCODE -ne 0) {throw 'Erosion generation failed.'}
Write-Host "Saved durable simulation state: $Output"
