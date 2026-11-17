param([switch]$Gpu)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
function Invoke-SolarCargo([string[]]$CargoArguments) {
    & cargo '+1.87.0' @CargoArguments
    if ($LASTEXITCODE -ne 0) { throw "cargo $CargoArguments failed ($LASTEXITCODE)" }
}
Invoke-SolarCargo @('fmt', '--all', '--', '--check')
Invoke-SolarCargo @('test', '--workspace', '--locked')
Invoke-SolarCargo @('clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings')
Invoke-SolarCargo @('clippy', '-p', 'solar-probe', '--lib', '--target', 'wasm32-unknown-unknown', '--locked', '--', '-D', 'warnings')
Invoke-SolarCargo @('clippy', '-p', 'solar-explorer', '--lib', '--target', 'wasm32-unknown-unknown', '--locked', '--', '-D', 'warnings')
Invoke-SolarCargo @('run', '-p', 'solar-explorer', '--locked', '--', '--validate')
Invoke-SolarCargo @('run', '-p', 'solar-probe', '--example', 'validate_shaders', '--locked')
if ($Gpu) {
    Invoke-SolarCargo @('run', '-p', 'solar-probe', '--bin', 'solar-gpu-probe', '--release', '--locked')
    foreach ($audit in @('--precision','--validate-planet','--validate-prefix','--validate-rebase','--validate-bounds','--validate-normals','--validate-temporal','--validate-water','--compare-media')) {
        Invoke-SolarCargo @('run','-p','solar-probe','--bin','solar-gpu-probe','--release','--locked','--','--render','--width','320','--height','180',$audit)
    }
}
