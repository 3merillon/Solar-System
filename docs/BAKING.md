# Baking the data packs from their sources

Current (17 November 2026). The data packs (README, "Data packs") can be downloaded finished, or built on your own
machine from the original public sources with one command:

```
node tools/Rebake-Packs.mjs                 # everything into web/pack/, sources into rebake-sources/
node tools/Rebake-Packs.mjs --plan          # what it would download and bake, and the disk it needs; changes nothing
node tools/Rebake-Packs.mjs --only small    # the packs whose sources are under 1 GB each (no Moon, Mars, Mercury)
```

It needs what the README already asks for: Rust through rustup (the toolchain pinned in `rust-toolchain.toml`
installs itself) and Node 22 or later, no packages, no Python, no GDAL.

## What it does

1. Reads `tools/rebake.json`: every source (URL, size, SHA-256, the product's page, its credit) and every product
   (which sources it reads, the recorded options, and why each option has its value).
2. Says how much it will download, how much disk it needs and how much is free, and stops there with `--plan`.
3. Downloads each missing source, one at a time, resuming a broken download where it stopped (HTTP ranges), and
   checks its size and SHA-256. A file that is not the recorded one is reported and nothing is baked. A source that is
   checked once is not hashed again on the next run (size and time are remembered in `.verified.json` beside it).
4. Builds the baker (`cargo build --release --locked -p solar-bake`).
5. Bakes each product into a work folder and moves it into place when it is complete. A run that was stopped starts
   again at the first unfinished product (`.rebake-state.json` in the output folder).
6. Compares every file with `tools/packs.json`, the size and SHA-256 of the 169 published files, and prints what
   matched. It exits with an error if anything differs.

Options: `--sources DIR`, `--out DIR`, `--only LIST` (product names such as `moon`, `sky`, `stars`; pack folders such
as `moon-v1`; the groups `small`, `bodies`, `solar`, `all`), `--check` (only the comparison), `--threads N` (the output
does not depend on it), `--remove-sources` (delete the sources of a run in which everything matched),
`--ephemeris-from-kernels` (below).

## Cost, measured here

One Windows 11 machine (20 threads, 64 GB of memory, SSD), 17 November 2026, sources downloaded fresh:

| | |
| --- | --- |
| Download | 23.4 GB in 30 files (USGS 22.4 GB, the rest NOAA, NASA, Harvard, JPL): about 55 min here, USGS at about 8 MB/s, NOAA at about 1.5 MB/s. Checking the hashes adds a few minutes, once |
| Disk | 23.4 GB of sources + 2.5 GB of packs; temporary files are only the product being baked |
| Baking | 13 min for all 28 products, of which the Moon 6 min, Earth 2 min, Mars 2 min, Mercury 1 min; every other body under 20 s. Building the baker adds about a minute |
| Memory | peak working set: Mercury 28.0 GB (its 1.9 GB image is read whole), Moon 25.5 GB, Mars 17.6 GB, Pluto 6.6 GB, Dione 4.0 GB, Earth 2.8 GB; the other bodies less |

A machine with 16 GB of memory can bake `--only small` (everything but the Moon, Mars and Mercury); those three need about 32 GB.

## What matches

On this machine, from sources downloaded fresh on 17 November 2026, **every published file is reproduced byte for
byte** except where noted. That was first shown for the packs as published that morning (all version 1); the bodies
whose packs then changed to version 2 (below) were rebaked from the same sources and published as baked, and the Moon,
whose recipe changed in name only, still gives its version 1 bytes.

| Files | Result |
| --- | --- |
| 18 body packs: 72 level files, 30 page bundles (Europa level 4, Mercury 4, Mars 4 and 5, Moon 4 to 6), 18 maps | identical (14 bodies at version 2; the Moon, Venus, Pluto and Charon at version 1) |
| 19 manifests (18 bodies and Earth) | identical once the bake's wall time (`bake.seconds`) is set aside, and for Earth the day its two sources were downloaded (`sources.*.retrieved`, `retrieved_unix`): those record the run, not the data, and can never match. The script compares manifests that way; `tools/rebake.json` holds the hash of each published manifest without those fields |
| Earth pack, 4 level files | identical |
| Earth, Jupiter, Saturn, Uranus, Neptune maps | identical |
| Sky cube, 6 faces | identical |
| `stars.bin` | identical |
| `solar-v1.bin` | identical (copied from `crates/solar-core/data/solar-v1.bin`, or refitted, below) |
| `asteroids.bin` | identical from the query answer recorded on 31 October 2026, published with the packs (release `packs-v2`). JPL's database changes daily, so a live query today gives a different file (9 of 100,000 rows on 17 November); the script falls back to the live query, and says so, only when the recorded answer cannot be downloaded |

The baker's output does not depend on the number of threads (Charon at 1, 3 and 20 threads, identical). Byte equality
is shown on Windows x86-64 only. The baker's sines, arctangents and powers come from the platform's maths library, so
on Linux or macOS a few texels may round the other way and a file may differ in a few bytes; that has not been tested.

### Every source is what was baked in October

Each USGS mosaic downloaded on 17 November has the S3 ETag (an MD5 per 8 MiB part) of the copy downloaded on
31 October and baked then, and the same SHA-256. The NAIF kernels are served at the same sizes and dates. No source
has moved or been replaced upstream.

## How the options were recovered

The bakes of 31 October 2026 (version 1 of every pack) were run by hand and their command lines were not kept. They
were recovered by reproducing the published bytes, one option at a time; every value is in `tools/rebake.json` with
its reason, and the two that were wrong are corrected in version 2 ("Pack versions", below):

- **Credit, what the image is, finest level**: from each published manifest.
- **`--no-data none`** (15 bodies, version 1): the packs of all bodies but Venus, Pluto and Charon were baked on
  31 October before 21:00, when the baker did not yet read a GeoTIFF's own no-data tag. A pixel of value 0 counted as
  black, not as a hole. Today's default reads the tag and changes the pages, so the old behaviour is asked for by
  name. `none` was added to the baker for this; before, no such value could be written.
- **Venus, Pluto, Charon**: baked at 20:43 that day with today's defaults (the tags read, holes in the heights
  filled), and heights in metres as their files store them.
- **Height scale**: the Moon's elevation file says 0.5 m per unit (GeoTIFF metadata, ISIS label, product page) and was
  baked so. Mercury's says the same, but **Mercury's version 1 was baked at 1 m per unit**: every page's height
  offset and step are exactly twice what 0.5 gives, and the page images are otherwise identical, so its relief was
  twice the measured relief.
- **Decimation**: only the Moon, 2 x 2 for both files (its image read whole needs about 70 GB). The impostor map
  depends only on the image and this factor, so it fixed the image's factor alone (2 matches, 3 does not); the
  heights' factor was then fixed by the pages.
- **Elevation no-data**: none of the six elevation files but Venus's, Pluto's and Charon's has a no-data cell, so
  that option changes nothing for Mars, Mercury and the Moon.
- **Fine levels**: today's baker writes the page bundles of levels 4 and up directly, and they are identical to the
  published ones, which were bundled from loose page files on 16 November (`solar-bake bundle`). The separate
  bundling step is not needed.
- **Jupiter**: NASA Photojournal PIA07782, "Cassini's Best Maps of Jupiter (Cylindrical Map)", the JPEG: reproduced
  byte for byte, so this is the map, not a candidate.
- **Sky**: NASA SVS Deep Star Maps 2020, `starmap_2020_8k.exr` (8192 x 4096). The 4k map was fetched first and does
  not give these faces.
- **Earth**: as recorded in its own manifest (JPEG quality 88, 4:4:4, height step 1 m, up to 16 m at a page's
  roughness / 4, 15 zopfli iterations), which are also the defaults; its two sources are those `solar-bake fetch`
  names.
- **Ephemeris**: `solar-bake solar` on the ten NAIF kernels (DE440s, `mar099s`, `jup365`, `sat441`, `ura184` parts
  2 and 3, `nep097`, `plu060`, `pck00011`, `gm_de440`) reproduces `solar-v1.bin` byte for byte. The script copies the
  repository's copy by default; `--ephemeris-from-kernels` downloads the 4.6 GB of kernels and refits it.

## Pack versions

A body's pack lives in a folder named for its version, `<body>-v<N>/`, with its far map at
`solar/maps/<body>-v<N>.jpg` (`solar/maps/<body>.jpg` for version 1). A pack whose content changes is published under
the next version, in a new folder and a new release, and the files of the earlier version are left as they were: a
browser that cached pages of one bake never mixes them with pages of another, and a deployment of older code still
finds the files it reads. The version of each body is one table in the app, `PACK_VERSION` in `web/pack-base.js`;
`tools/Rebake-Packs.mjs` reads the same table, so a rebake writes the folders the app reads.

| Version | Bodies | What it is |
| --- | --- | --- |
| 1 (31 October 2026; release `packs-v1`) | the Moon, Venus, Pluto, Charon (current); the 14 below (replaced) | as baked by hand on 31 October 2026, options recovered above |
| 2 (17 November 2026; release `packs-v2`) | Mercury, Mars, Phobos, Io, Europa, Ganymede, Callisto, Titan, Rhea, Iapetus, Dione, Tethys, Enceladus, Triton | every option at the baker's default unless the product states otherwise; two corrections, below |

What version 2 corrects:

- **No-data is read from each source's own tag.** Where a mosaic has no image the pack is mid grey, as Venus, Pluto and
  Charon already were, instead of black. It shows where a mosaic has gaps: Triton (38.6% of its mosaic is no-data, the
  hemisphere Voyager 2 did not see), Europa (4.3%), Callisto (3.9%), Ganymede (3.6%) and Phobos (0.5%); under 0.2% for
  Dione, Enceladus, Tethys, Titan, Io, Iapetus, Rhea and Mars (the share of samples equal to each file's no-data
  value). The Moon's files hold no such sample, so its pack is unchanged and stays at version 1.
- **Mercury's heights are at the product's 0.5 m per unit**, so its relief is the measured relief, half of version 1's.

Version 1 of these bodies can still be baked: add `"--no-data": "none"` to the body's options in `tools/rebake.json`
(and `"--height-scale": 1` for Mercury), and set its version in `web/pack-base.js` back to 1.

## Sources

`tools/rebake.json` lists each file with its URL, size and SHA-256. In short:

| Product | File | Size |
| --- | --- | --- |
| USGS Astrogeology global mosaics and elevation models (24 files; each entry names its product page) | `https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/` | 22.4 GB, of which the Moon 14.5 GB, Mars 2.9 GB, Mercury 2.4 GB |
| NOAA ETOPO 2022, 60 arc-second surface | `ETOPO_2022_v1_60s_N90W180_surface.tif` | 466 MB |
| NASA Blue Marble Next Generation, August 2004 | `world.200408.3x21600x10800.jpg` | 21 MB |
| NASA Photojournal PIA07782 (Jupiter) | `PIA07782.jpg` | 0.4 MB |
| NASA SVS Deep Star Maps 2020 | `starmap_2020_8k.exr` | 131 MB |
| Yale Bright Star Catalogue, 5th revised edition | `BSC5` (binary, Harvard TDC) | 0.3 MB |
| JPL Small-Body Database, the query answer of 31 October 2026 (kept in the `packs-v2` release, as JPL's answer changes daily) | `sbdb-asteroids.json` | 18 MB |
| NAIF kernels (only with `--ephemeris-from-kernels`) | 10 files | 4.6 GB |

The SVS host sends its certificate without the intermediate that links it to a trusted root. The script does what a
browser does: it fetches the issuer certificates the server's certificate names and verifies the whole chain against
Node's own roots, so nothing is trusted that was not before.

## Adding a body

1. Add its sources to `tools/rebake.json` (`file`, `url`, `bytes`, `sha256`, `page`, `credit`). Read the product's
   label for its units, scale and no-data value.
2. Add a product: `{"id", "kind": "body", "name", "image", "height" (optional), "finest", "credit", "image_is",
   "options": {...}, "why": {...}}`. Options are the baker's (`crates/solar-bake/src/main.rs`): `--height-scale`,
   `--height-offset`, `--no-data`, `--height-no-data`, `--decimate-image`, `--decimate-height`. Leave `--no-data` at
   its default for a new body: the file's own tag is right.
3. Run `node tools/Rebake-Packs.mjs --only NAME`. The check reports the new files as not published.
4. To publish a new or changed pack: give the body its next version in `PACK_VERSION` (`web/pack-base.js`) and bake it,
   so its files land in a new folder; run `node tools/Fetch-Packs.mjs --write-index DIR --release packs-vN` on the full
   set of packs, which marks every new or changed file as in release `packs-vN`; upload those files to that release
   (asset names: the path with `/` as `__`) and to the pack host, and only then publish the code that reads them.
   Leave the earlier folders where they are.
