$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$env:SOLAR_SHADER_BUILD_KEY = & node tools/Verify-Explorer-Build.mjs --key
if ($LASTEXITCODE -ne 0) { throw 'Shader provenance key failed' }
& cargo '+1.87.0' run -p solar-explorer -- --validate
if ($LASTEXITCODE -ne 0) { throw 'Explorer shader validation failed' }
& cargo '+1.87.0' build -p solar-explorer --lib --release --target wasm32-unknown-unknown --locked
if ($LASTEXITCODE -ne 0) { throw 'Explorer WASM build failed' }
& wasm-bindgen --target web --out-dir web/pkg --out-name solar_explorer target/wasm32-unknown-unknown/release/solar_explorer.wasm
if ($LASTEXITCODE -ne 0) { throw 'Explorer packaging failed' }
& node tools/Compress-Explorer.mjs
if ($LASTEXITCODE -ne 0) { throw 'Explorer transport compression failed' }
$shaderProvenance = & node tools/Verify-Explorer-Build.mjs web/pkg/solar_explorer_bg.wasm
if ($LASTEXITCODE -ne 0) { throw 'Packaged WASM contains stale shaders' }
$sourceHashes = [ordered]@{}
# Enumerate sources without ripgrep: tracked crate directories recursively plus the listed files.
$sourcePaths = @()
foreach ($dir in @('crates/solar-explorer', 'crates/solar-core')) { $sourcePaths += Get-ChildItem -LiteralPath $dir -Recurse -File | Where-Object { $_.FullName -notmatch '[\/]target[\/]' } | ForEach-Object { $_.FullName.Substring((Get-Location).Path.Length + 1).Replace('\', '/') } }
$sourcePaths += @('crates/solar-probe/src/gpu.rs', 'shaders/explorer.wgsl', 'shaders/surface_field.wgsl', 'shaders/terrain_gpu.wgsl', 'shaders/water.wgsl', 'shaders/clouds.wgsl', 'shaders/scenery.wgsl', 'shaders/scenery_common.wgsl', 'shaders/scenery_trees.wgsl', 'shaders/scenery_cover.wgsl', 'shaders/surface_detail.wgsl', 'shaders/sun_visibility.wgsl', 'shaders/sun_clouds.wgsl', 'shaders/sun_casters.wgsl', 'shaders/present.wgsl', 'shaders/buildings.wgsl', 'shaders/space.wgsl', 'shaders/finish.wgsl', 'web/solar.js', 'web/giant-flight.js', 'web/saturn-opal-2023b.png', 'web/planet-indicators.js','web/credits.js','web/game-input.js','web/flight-deck.js','web/flight-deck.css','web/celestial-music.js', 'web/index.html', 'web/explorer.js', 'web/flight.js', 'web/touch.js', 'web/quality.js', 'web/explorer.html', 'web/explorer.css', 'web/worker-client.js', 'web/render-worker.js', 'web/gpu-startup.js', 'web/pack-base.js')
$sourcePaths += Get-ChildItem -LiteralPath web/field -Recurse -File | ForEach-Object { $_.FullName.Substring((Get-Location).Path.Length + 1).Replace('\', '/') }
foreach ($path in ($sourcePaths | Sort-Object -Unique)) { $sourceHashes[$path] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
[ordered]@{ built_utc = [DateTime]::UtcNow.ToString('o'); wasm_sha256 = (Get-FileHash -LiteralPath web/pkg/solar_explorer_bg.wasm -Algorithm SHA256).Hash.ToLowerInvariant(); sources = $sourceHashes; shaders = ($shaderProvenance | ConvertFrom-Json) } | ConvertTo-Json -Depth 5 | Set-Content web/pkg/explorer-manifest.json -Encoding UTF8
