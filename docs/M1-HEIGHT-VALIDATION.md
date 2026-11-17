# M1 height validation against lidar

Dated 30 October 2026. Gate: "Height error against swissALTI3D and 3DEP, split into forest, urban and open land." Script: `tools/Validate-Height.py`, output `$SOLAR_DATA\validation\report.json`, which holds URLs, sha256, all statistics and the resolution probe.

## Method

Four areas of about 5 x 5 km: Lausanne, Dents du Midi (steep), Enumclaw WA, Boulder CO. References: swissALTI3D 2 m (85 tiles, sha256 matches the STAC multihash) and 3DEP 1 m (range reads; the hash is of the clipped window, not the 227 MB tiles). Land cover: WorldCover v200 (2021): forest 10, urban 50, open 20, 30, 40, 60; the rest skipped. Terrarium z12 and z13 (26 requests), pure Python decode. 1000 seeded random points per class and area; error = tile minus lidar; reference read bilinearly.

## Datum assumptions

Swiss: LV95, LN02 heights, PROJ without grid (Bern check 0.01 m; real error about 1 m). US: NAD83 UTM, NAVD88, WGS84 taken as NAD83. No geoid model applied. The vertical offset is estimated as the open-land mean error and not removed below.

## Result (z13, bilinear; last column z12)

| Area | Class (area share) | Bias m | RMSE m | Median abs | P95 abs | z12 RMSE |
|---|---|---|---|---|---|---|
| Lausanne | forest 41% | 4.79 | 9.03 | 3.75 | 21.05 | 9.03 |
| | urban 38% | 2.85 | 5.23 | 3.17 | 10.33 | 5.21 |
| | open 8% | 0.36 | 4.00 | 2.08 | 7.57 | 4.00 |
| Dents du Midi | forest 44% | 3.25 | 18.94 | 10.83 | 37.17 | 18.95 |
| | urban 1.5% | 6.24 | 8.68 | 5.21 | 18.47 | 8.74 |
| | open 47% | -11.67 | 49.78 | 11.07 | 96.53 | 49.84 |
| Enumclaw | forest 30% | -0.03 | 0.98 | 0.37 | 2.10 | 1.23 |
| | urban 16% | -0.06 | 0.67 | 0.19 | 1.43 | 0.69 |
| | open 55% | -0.01 | 0.56 | 0.15 | 1.10 | 0.58 |
| Boulder | forest 43% | 0.05 | 0.65 | 0.18 | 1.14 | 1.15 |
| | urban 41% | 0.06 | 0.37 | 0.16 | 0.63 | 0.53 |
| | open 16% | 0.12 | 0.59 | 0.18 | 1.11 | 1.12 |

The B-spline, applied on the tile grid (an approximation of the page read), is within 0.06 m RMSE of bilinear, except Boulder z12 (up to 0.14).

## What it says about the risk

- **US areas are not independent.** The ledger lists 3DEP as a Terrain Tiles source, so near-zero error there shows only that these tiles carry 3DEP bare earth. It says nothing about the global SRTM base.
- **Lausanne is the usable test.** Forest sits 4.4 m above open land (mean +4.8 m, p95 21 m; +6.2 m where the 3x3 WorldCover neighbourhood is all forest). Urban sits 2.5 m above (+3.1 m interior). This is positive bias consistent with canopy and buildings in a radar-derived surface. The tile source there is unknown; the cause is inferred.
- **Implication.** On Swiss forest and town, an object placed on lidar-true ground would sit about 3 to 6 m below the rendered ground (buried); one placed on the rendered ground with its own height added would float by the same amount. Local errors reach 20 m.
- **Dents du Midi is not a bias test.** Open land includes cliffs and summits, so -11.7 m is not a datum offset. A half-pixel shift test left RMSE unchanged, so registration is not the cause; the pixel cannot hold the relief.
- **Effective resolution.** Only Boulder shows a minimum against a box-filtered reference: z13 at 17 m (pixel 15 m), z12 at 33 m (pixel 29 m), about 1.1 pixels. Enumclaw is flat between 17 and 65 m; Swiss error falls steadily to 130 m, so it is not measurable there.

## Limits

Four areas, 1000 clustered points per class, 10 m labels against 13 to 26 m pixels, no geoid grid. Not a global statement. Nothing failed to download.
