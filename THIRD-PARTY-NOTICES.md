# Third-party notices

The source code of Solar-System v2 is released under the MIT licence in `LICENSE`. That
licence covers the code only. The data the app streams or reads from its packs and the
third-party code listed below keep their own terms; they are not relicensed by `LICENSE`.
Anyone redistributing or selling a build must check these terms first: one imagery source
is **non-commercial**.

This file is a record of what is used and what each provider's page said when it was read
(dates are given where a page was read). It is not legal advice.

## Code adapted from other projects

- `shaders/temporal.wgsl`: temporal reconstruction maths adapted from TMT
  (d6f7dac, `src/engine/passes/post/tsr.wgsl.ts`), ported there from
  `@pmndrs/upscaler` v0.5.0, MIT, Copyright (c) 2026 Dennis Smolek. Its EASU/RCAS and
  temporal architecture derive from AMD FidelityFX FSR 1/2/3, MIT, Copyright (c)
  2021-2023 Advanced Micro Devices, Inc.
- `shaders/finish.wgsl`, the tone curve: AgX, designed by Troy Sobotka. The Rec.2020
  conversion matrices and the AgX inset and outset matrices are the values written in
  three.js, MIT, Copyright © 2010-2026 three.js authors. The sigmoid polynomial and the
  "punchy" look it is tuned from are Benjamin Wrensch's Minimal AgX Implementation, MIT,
  Copyright (c) 2024 Missing Deadlines (Benjamin Wrensch).
- Rust crates compiled into the browser WebAssembly: 51 crates (wgpu, serde, wasm-bindgen,
  earcutr and others), each under MIT, Apache-2.0, ISC, Zlib or Unicode-3.0 terms, most of them
  dual MIT/Apache-2.0. `web/THIRD-PARTY-RUST.txt` reproduces their licence files and ships with
  the app; regenerate it with `node tools/Rust-Notices.mjs` after a `Cargo.lock` change. The
  native tools (`solar-bake`, `solar-probe`) use further crates listed in `Cargo.lock`; they
  are not distributed in builds.
- Procedural scenery conventions were informed by the owner's Pinionfall repositories (see
  `web/THIRD-PARTY-NOTICES.txt`); no Pinionfall assets or code are distributed.

The full licence texts for the first two items are in `web/THIRD-PARTY-NOTICES.txt`, which
ships with the app.

## Published methods and constants

No code is copied for these; the source cites each where it is used.

- The Sun and stars (`crates/solar-core/src/stars.rs`, `shaders/space.wgsl`): nominal solar
  values from IAU 2015 Resolution B3; limb darkening coefficients from Neckel and Labs (1994);
  the corona's brightness profile from Baumbach (1937) as given by Allen (1947); the mean dwarf
  temperature sequence of Pecaut and Mamajek (2013, table version 2022.04.16); the fit to the
  CIE 1931 colour-matching functions of Wyman, Sloan and Shirley (2013).
- Star records for the five systems that can be visited: values from the papers cited beside
  each record, several read through the NASA Exoplanet Archive and SIMBAD. This research has
  made use of the NASA Exoplanet Archive, which is operated by the California Institute of
  Technology, under contract with the National Aeronautics and Space Administration under the
  Exoplanet Exploration Program, and of the SIMBAD database, operated at CDS, Strasbourg,
  France. The worlds round those stars are synthetic.
- Saturn's ring boundaries and optical depths: published values (the NSSDC ring fact sheet;
  Colwell et al.); the fine ringlets and the rocks are synthesized.
- Body radii, rotation and gravity: NAIF's `pck00011.tpc` and `gm_de440.tpc`; atmosphere scale
  heights from the NSSDC planetary fact sheets.
- Bloom after Jimenez (2014); tree forms after ideas in Weber and Penn (1995), Prusinkiewicz
  and Lindenmayer, and Palubicki et al. (2009); rock size distributions after Golombek and
  Rapp (1997) and Pajola et al. (2019); the trip curve after van Wijk and Nuij (2003).

## Data streamed at run time

Requested by the visitor's browser from the provider's own servers; nothing is re-hosted.
The app shows the credits of the sources in view (`web/credits.js`).

| Source | Used for | Terms |
| --- | --- | --- |
| EOX Sentinel-2 cloudless (`tiles.maps.eox.at`), 2024 layer | Earth imagery | CC BY-NC-SA 4.0 (2018 and later layers): **non-commercial**. Credit: "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)" |
| Terrain Tiles, AWS Open Data (Terrarium) | Earth heights and seabed | Per-region upstream terms and credits (3DEP, SRTM, GMTED2010: U.S. Geological Survey; Kartverket; Environment Agency; Geoscience Australia; and others); the full list is shown in the app |
| swisstopo SWISSIMAGE (`wmts.geo.admin.ch`) | Sharp imagery, Switzerland | swisstopo free geodata terms; the source reference is mandatory: "©swisstopo" (the app adds swisstopo's note on Planet material for the largest lakes) |
| OpenFreeMap / OpenMapTiles (`tiles.openfreemap.org`) | Buildings, roads, water vectors | © OpenStreetMap contributors, ODbL 1.0; © OpenMapTiles |

## Data in the packs

The packs are not in this repository's source. `crates/solar-bake` builds them; a local build
downloads them from the repository's `packs-v1` release (`tools/Fetch-Packs.mjs`) and the deployed
app reads the same files from the owner's pack host (README, "Data packs"). Each body's credit is in its pack manifest
and is shown in the app when the body is in view.

| Pack | Built from | Credit shown, and terms as recorded |
| --- | --- | --- |
| Earth, pinned global levels | NOAA ETOPO 2022 (60 arc-second ice surface); NASA Blue Marble Next Generation (August 2004) | "NOAA National Centers for Environmental Information. 2022: ETOPO 2022 15 Arc-Second Global Relief Model. DOI: 10.25921/fd45-gt74", CC0 1.0. "Blue Marble: Next Generation was produced by Reto Stockli, NASA Earth Observatory (NASA Goddard Space Flight Center). Credit: NASA Earth Observatory." |
| Moon | LROC WAC global mosaic 100 m (June 2013); LOLA global elevation 118 m (March 2014) | LRO LROC WAC and LOLA, NASA/GSFC/ASU, NASA/JPL, USGS Astrogeology |
| Mercury | MESSENGER MDIS global mosaic 250 m (2013); MESSENGER USGS elevation 665 m v2 | MESSENGER, NASA/JHUAPL/CIW, NASA/JPL, USGS Astrogeology |
| Venus | Magellan C3-MDIR radar mosaic 2025 m; Magellan topography 4641 m v2 | Magellan, NASA/JPL, USGS Astrogeology |
| Mars | Viking colour mosaic 925 m; MGS MOLA elevation 463 m | Viking, MOLA, NASA/JPL, USGS Astrogeology |
| Phobos | Mars Express SRC global mosaic, 16 pixels per degree | Mars Express SRC, ESA/DLR/FU Berlin, NASA/JPL, USGS Astrogeology |
| Io, Europa, Ganymede, Callisto | Voyager and Galileo SSI global mosaics (1 km, 500 m, 1435 m, 1 km) | Voyager and Galileo SSI, NASA/JPL, USGS Astrogeology |
| Enceladus, Tethys, Titan | Cassini ISS global mosaics (110 m, 293 m, 4 km) | Cassini ISS, NASA/JPL, USGS Astrogeology |
| Dione, Rhea, Iapetus | Cassini and Voyager global mosaics (154 m, 417 m, 783 m) | Cassini ISS and Voyager, NASA/JPL, USGS Astrogeology |
| Triton | Voyager 2 colour mosaic 600 m (gaps filled by its makers) | Voyager 2, NASA/JPL, USGS Astrogeology |
| Pluto, Charon | New Horizons global mosaics and elevation 300 m (July 2017) | New Horizons, NASA/JHUAPL/SwRI, NASA/JPL, USGS Astrogeology |
| Jupiter | Cassini's cylindrical map of December 2000 (NASA Photojournal PIA07782 in the source survey; the bake recorded no file name) | NASA/JPL/Space Science Institute |
| Saturn, Uranus, Neptune | No data: colour by latitude, synthesized (`solar-bake schematic`); the app says so | none |
| Sky | NASA SVS Deep Star Maps 2020 | NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC |
| Bright stars | Yale Bright Star Catalogue, 5th revised edition (Hoffleit and Warren, 1991): the 906 stars brighter than magnitude 4.5 | See the note below |
| Asteroids | JPL Small-Body Database (query API): orbital elements and absolute magnitudes of the numbered bodies | NASA/JPL-Caltech, Solar System Dynamics |

The mosaics and elevation models of the other bodies are the global products USGS Astrogeology
distributes. USGS states that data it authors or produces is in the U.S. public domain and asks
for credit; the product pages ask to cite the authors, and several products were made by
other teams (DLR for several Cassini mosaics, ESA/DLR/FU Berlin for Phobos, the
MESSENGER and New Horizons teams). On 17 November 2026 the product pages could not be read
by the tool used, so their use constraints are recorded here from search summaries, not from
the pages: check a product's page before relying on it. The earlier survey is
[docs/SOLAR-SYSTEM-SOURCES-DRAFT.md](docs/SOLAR-SYSTEM-SOURCES-DRAFT.md); it lists candidates
and is a draft.

The Bright Star Catalogue: NASA's HEASARC offers it "solely for the purposes of scientific
research" and says it does not own the copyright, which Yale University Observatory or the
authors may hold (read 17 November 2026). The pack holds the positions, proper motions and magnitudes of 906 stars from it, and a colour
from each one's spectral class. A commercial build should take those from another catalogue.

## Data in this repository

| Source | Used for | Terms |
| --- | --- | --- |
| IAU Gazetteer of Planetary Nomenclature (IAU WGPSN; USGS Astrogeology Science Center) | The 15,544 named features of 25 bodies, with the origin of each name, `web/landmarks/` (`tools/Bake-Landmarks.mjs`, fetched 15 November 2026) | Public domain (USGS metadata); credit the IAU WGPSN and USGS, shown with each feature |
| JPL planetary and satellite ephemerides, NAIF SPICE kernels (`de440s`, `mar099s`, `jup365`, `sat441`, `ura184`, `nep097`, `plu060`) | Orbits: `crates/solar-core/data/solar-v1.bin` is this project's own Chebyshev fit of those kernels (`solar-bake solar`), with its errors in `solar-v1.fit.json`. It is not a NAIF kernel and NAIF did not make it | NASA/JPL, NAIF. NAIF permits redistribution of unmodified kernels and asks that anything modified carry its modifier's name: this fit is by the Solar-System v2 project |
| JPL Horizons | `crates/solar-core/tests/data/horizons-v1.json`: positions recorded once (31 October 2026) as the test reference for the fit | NASA/JPL Horizons API |
| Screenshots in `docs/images/` | README | Pictures of the running app. The Earth views show EOX Sentinel-2 cloudless and swisstopo imagery, the other bodies the mosaics above; each keeps its credit and terms |

## Sound

The soundtrack is synthesized in the page as it plays, from the owner's own Relative Music
Theory (`docs/MUSIC.md`). There are no samples, no recordings and no third-party audio code.

## What is not used

No Google or Esri data. FABDEM, named in the plans as a possible bare-earth upgrade, is not
used. Nothing is read from NASA SDO: the Sun is a model.

Data keeps its own terms; nothing here is relicensed under MIT. A commercial build must
replace the non-commercial imagery (EOX Sentinel-2 cloudless) and settle the terms noted above.
