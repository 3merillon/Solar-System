# Solar system data sources ledger (DRAFT)

Dated 31 October 2026. Companion to [REAL-EARTH-SOURCES.md](REAL-EARTH-SOURCES.md). Draft, not reviewed by the owner.

This records what public pages said, and what a few small requests returned, on this date. It is not
legal advice and reaches no legal conclusion beyond the quoted text. Silence is recorded as silence, not
permission. Anything not read is marked UNCONFIRMED.

Method. Pages were read through a fetch tool that summarises with a small model, so quotes are the
tool's extracts and were not checked against raw HTML; re-read before shipping. "TESTED" means a curl
request from this machine on this date. A "TESTED" CORS result means the response did or did not carry
`Access-Control-Allow-Origin` when the request carried `Origin: https://example.org`; no browser was run,
so preflight behaviour for `Range` requests (Access-Control-Allow-Headers, Access-Control-Expose-Headers
for Content-Range) is UNCONFIRMED everywhere. No User-Agent was set or spoofed. No account, key or
contact. No tiles.maps.eox.at, Google or Esri host was requested.

Request budget, stated plainly. Roughly 50 curl requests in total, which is under 60. But about 23 of them
were paginated S3 key listings of one bucket (asc-pds-services) to learn file names and sizes, and 8
were 64 kB / 4 kB range reads of TIFF headers on that bucket. That is more than "one request per
service" and is closer to a loop than I intended; no mosaic or DEM body was downloaded. Trek received 3
requests (2 HEAD, 1 GET of a guessed name that returned 404). The fetch tool made about 40 further page
reads on top.

Decision values: DEFAULT (may ship in the default manifest), TEST-ONLY, EXCLUDED.

Added by the session that uses this draft, after it: the Yale Bright Star Catalogue (`tdc-www.harvard.edu/catalogs/BSC5`, terms not read), NASA Deep Star Maps 2020 (`svs.gsfc.nasa.gov/4851`: asks for credit to NASA/GSFC Scientific Visualization Studio and for Gaia DR2 to ESA/Gaia/DPAC, links NASA's reproduction guidelines, no further terms), JPL's Small-Body Database Query API (terms not read), each fetched once, and Tycho-2 from the VizieR mirror at vizier.cfa.harvard.edu, since the CDS host refused the connection (terms not read). Tycho-2 is downloaded locally and not used. **All three remain to be read before anything ships.**

## 0. Headline findings

1. USGS Astrogeology's S3 bucket `asc-pds-services` (path `mosaic/`) holds a global map for most bodies,
   served over HTTPS with `Accept-Ranges: bytes` and `Access-Control-Allow-Origin: *` (TESTED on the Mars
   MOLA DEM file). Anonymous directory listing works (TESTED).
2. They are NOT cloud-optimised GeoTIFFs. The four DEM files whose headers were read (Mars MOLA, Mercury
   MDIS, Pluto NH, Vesta Dawn) are classic TIFF, uncompressed, one row per strip, no tiling, no overviews
   (TESTED by reading the IFD). A browser can range-read rows, but one row of the Mars DEM is 92 kB, so a
   small longitude window costs one request per row or a coalesced multi-row range of full-width rows.
   Practical route is to bake a pack, not to read these live. The Mars MOLA IFD sits at the end of the
   2.1 GB file (offset 2,125,586,176), so a reader must first fetch the tail.
3. NASA Trek tiles answer with `Access-Control-Allow-Origin: *` (TESTED, Moon WAC and Mars MDIM21 z0 JPEG),
   but the pages read give no terms, no DEM numeric-access description, and a guessed Mars DEM layer name
   returned 404. Trek numeric DEM remains UNCONFIRMED. Trek zoom is shallow (Moon LOLA colour-shade layer
   has zoom 0 to 5 only).
4. NAIF kernels and JPL Horizons send no `Access-Control-Allow-Origin` (TESTED): a browser cannot fetch
   them directly. Ephemeris must be baked into a pack (Chebyshev coefficients) or proxied.
5. No free global DEM exists for Mimas (not confirmed either way), the Uranian moons, Io, Europa,
   Ganymede, Callisto, Iapetus-as-DEM, Tethys, Dione, Rhea, Triton, or Deimos in what I read. Those bodies
   have imagery only, so height must be a documented fallback (sphere/ellipsoid or shape model).
6. I did not find a global cylindrical map for Saturn, Uranus, or Neptune. Jupiter has one
   (PIA07782). The Sun has live SDO images but they carry no CORS header.
7. The Photojournal asset host (`assets.science.nasa.gov`) sends `Access-Control-Allow-Origin: *`
   (TESTED).

## 1. Summary table per body

Resolution in metres per pixel at the equator. Where only a pixels-per-degree figure is in the file name,
the metre value is computed by me as 2 pi R / (360 x ppd) using the SSD mean radius; marked "(computed)".
Sizes are the S3 object size from the bucket listing. All `asc` URLs are under
`https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/` (call it ASC/). ASC/ files are plain
GeoTIFF unless noted; "range+CORS" = Accept-Ranges and ACAO * were seen on the bucket (TESTED on one file;
assumed for the others from the same bucket, UNCONFIRMED per file).

Colour: "pan" = single band, not true colour.

| Body | Imagery (best free global) | Height (global) | Decision |
|---|---|---|---|
| Moon | LROC WAC mosaic `Lunar_LRO_LROC-WAC_Mosaic_global_100m_June2013.tif` 100 m, pan, 5.96 GB; `LRO_WAC_Mosaic_Global_303ppd_v3.jp2` 2.50 GB; Trek tile service (WAC 303ppd v02) | LOLA global LDEM 118 m `Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif` 8.49 GB; LOLA+Kaguya 60N60S 512ppd (59 m, about 3 to 4 m vertical, per search summary) `LolaKaguya_Topo/...512ppd.tif` 22.7 GB; 128ppd (about 237 m, computed) `.cub` 2.1 GB; Kaguya LALT 1895 m `.cub` 33 MB | Imagery: DEFAULT via a baked pack (USGS public domain statement); Trek TEST-ONLY. Height: DEFAULT via baked pack |
| Mercury | MESSENGER MDIS BDR basemap 166 m (`Mercury_MESSENGER_MDIS_Basemap_BDR_Mosaic_Global_166m.tif`, 4.25 GB), 256ppd (3.06 GB), colour (enhanced / MD3) 665 m (796 MB). Colour is false/enhanced, not true. | `Mercury_Messenger_USGS_DEM_Global_665m_v2.tif` 531 MB, int16, 23040 x 11520 (TESTED header) | DEFAULT via pack |
| Venus | No optical surface. Magellan SAR (radar, not visible light): C3-MDIR global 2025 m 176 MB; 4641 m colourised 101 MB; full-res 75 m left/right look 117 GB each. | `Venus_Magellan_Topography_Global_4641m_v02.tif` 67 MB (23 ppd). Radar altimetry, coarse. | DEFAULT via pack (radar map is not what the eye sees; cloud-covered in reality) |
| Mars | Viking MDIM 2.1 mono 232 m (4.25 GB), colour 232 m (12.7 GB), colour 925 m (798 MB); MOLA+THEMIS blend 100 m jp2 4.21 GB; Trek tiles (Viking MDIM21 colour z0 answered). CTX global mosaic (Murray Lab) not read, cert error. | `Mars_MGS_MOLA_DEM_mosaic_global_463m.tif` 2.13 GB, int16, 46080 x 23040, uncompressed strips (TESTED header); `mola128_88Nto88S_Simp_clon0.tif` 2.08 GB | DEFAULT via pack; Trek TEST-ONLY |
| Phobos | Viking mosaic 40ppd about 4.8 m (computed) `Phobos_Viking_Mosaic_40ppd_DLRcontrol.tif` 104 MB; HRSC colour 2ppd; SRC 16ppd about 12 m (computed) 16.6 MB | HRSC DEM 2ppd (about 97 m computed) 0.5 MB; coarse | DEFAULT via pack, imagery has gaps (coverage percent UNCONFIRMED) |
| Deimos | No mosaic found in the bucket listing | None found | EXCLUDED for now: no global data found (not searched outside the USGS bucket) |
| Ceres | Dawn FC DLR global 20ppd (about 410 m computed) 27 MB; 59ppd (about 139 m computed) `.cub` 224 MB | `Ceres_Dawn_FC_HAMO_DTM_DLR_Global_60ppd_Oct2016.tif` 467 MB (about 137 m computed); polar 127 m DTMs 255 MB each | DEFAULT via pack |
| Vesta | `Vesta_Dawn_FC_HAMO_Mosaic_Global_74ppd.tif` about 62 m (computed) 357 MB; colour-shade 48ppd 448 MB | `Vesta_Dawn_HAMO_DTM_DLR_Global_48ppd.tif` 597 MB, float32, 17280 x 8640 (TESTED header) | DEFAULT via pack |
| Io | `Io_GalileoSSI-Voyager_Global_Mosaic_1km.tif` 65.5 MB (mono); colour merge 1 km 197 MB; false colour 197 MB | None global found (Tvashtar 900 m DEM is regional) | DEFAULT imagery via pack; height = documented sphere fallback |
| Europa | `Europa_Voyager_GalileoSSI_global_mosaic_500m.tif` 193 MB | None found | DEFAULT imagery; height fallback |
| Ganymede | `Ganymede_Voyager_GalileoSSI_global_mosaic_1km.tif` 137 MB; colour 1435 m 199 MB | None found | DEFAULT imagery; height fallback |
| Callisto | `Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif` 114.6 MB | None found | DEFAULT imagery; height fallback |
| Mimas | A `Mimas/` folder exists in the bucket; contents not listed | UNCONFIRMED | TEST-ONLY until read |
| Enceladus | `Enceladus_Cassini_ISS_Global_Mosaic_100m_HPF.tif` 125 MB (110 m version 104 MB) | Shape model radius/topography rasters, 1 MB each, under `Enceladus/enceladus_cassini_iss_shapemodel_bland_2019/` (resolution UNCONFIRMED) | DEFAULT imagery; height from shape model needs a decision |
| Tethys | `Tethys_Cassini_mosaic_global_293m.tif` 66 MB | None found | DEFAULT imagery; fallback |
| Dione | `Dione_Cassini_Voyager_mosaic_global_154m.tif` 265 MB | None found | DEFAULT imagery; fallback |
| Rhea | `Rhea_Cassini_Voyager_mosaic_global_417m.tif` 66 MB | None found | DEFAULT imagery; fallback |
| Titan | ISS global 4 km `Titan_ISS_P19658_Mosaic_Global_4km.tif` 8 MB; ISS 65S-45N 450 m 1.58 GB; SAR 128ppd (about 351 m computed) 654 MB to 1.06 GB, partial coverage (percent UNCONFIRMED) | Corlies et al. 2017 on Cornell eCommons (DOI 10.7298/m4dv-gv95), ISIS .cub; file names suggest 4 ppd and 32 ppd; about 9% measured, rest interpolated (per a search summary, not a primary page read) | Imagery DEFAULT via pack (surface is hidden by haze in visible light; atmosphere model needed); height TEST-ONLY until primary page read |
| Iapetus | `Iapetus_Cassini_Voyager_mosaic_global_783m.tif` 16.6 MB | None found | DEFAULT imagery; fallback |
| Miranda, Ariel, Umbriel, Titania, Oberon | Nothing found in the bucket's top-level listing | None found | EXCLUDED from default: no global map found (other hosts not searched) |
| Triton | `Triton_Voyager2_ClrMosaic_GlobalFill_600m.tif` 300 MB (GlobalFill suggests interpolated gaps; coverage percent UNCONFIRMED) | None found | DEFAULT imagery with gaps flagged; fallback |
| Pluto | `Pluto_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif` 310 MB; New Horizons covers one hemisphere at high resolution, rest is low-resolution (coverage percent UNCONFIRMED) | `Pluto_NewHorizons_Global_DEM_300m_Jul2017_16bit.tif` 620 MB, int16, 24888 x 12444 (TESTED header); vertical accuracy and unmapped-area handling UNCONFIRMED | DEFAULT via pack, gaps flagged |
| Charon | `Charon_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif` 81 MB | `Charon_NewHorizons_Global_DEM_300m_Jul2017_16bit.tif` 161 MB | DEFAULT via pack, gaps flagged |
| Sun | SDO AIA/HMI latest JPEG, 4096 / 2048 / 1024 / 512 px (UV/EUV false colour or magnetogram; not visible-light true colour) | none | Live fetch is NOT possible from a browser (no ACAO, TESTED). TEST-ONLY; use a procedural photosphere instead |
| Jupiter | PIA07782 Cassini ISS cylindrical map, features about 120 km, JPEG 431 kB, TIFF 18.56 MB; 750 nm + 451 nm, "close to those the human eye would see" (page), not true colour. Juno global map not found. | none (gas giant) | DEFAULT via pack (credit NASA/JPL/Space Science Institute); live fetch possible: assets host ACAO * |
| Saturn | No global cylindrical map found. PIA11141 is a full-disk mosaic (70 km/px) with rings, not a map. | none | UNCONFIRMED; EXCLUDED until a map is read |
| Rings | No ring radial profile found on a page I read. PDS Ring-Moon Systems Node home page lists Saturn, Cassini and OPUS but states no profile data or terms | none | UNCONFIRMED; EXCLUDED until read |
| Uranus | Nothing found | none | EXCLUDED until a source is read |
| Neptune | Nothing found | none | EXCLUDED until a source is read |

The user's "known leads" not read or not resolved: Murray Lab CTX mosaic (TLS certificate failure from the
fetch tool; not retried with any workaround), PDS Geosciences MOLA/HRSC blends (only the USGS blend file
names seen), Magellan GTDR (only the USGS-hosted 4641 m product seen), Cassini UVIS/VIMS ring profiles,
Juno global map, Voyager Uranus/Neptune maps.

## 2. Providers

### 2.1 USGS Astrogeology bucket (asc-pds-services) and Astropedia

URLs: https://planetarymaps.usgs.gov/mosaic/ (302 to https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/),
https://astrogeology.usgs.gov/search (Astropedia), https://stac.astrogeology.usgs.gov/docs/,
https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits

TESTED:
- `curl -sI` on `planetarymaps.usgs.gov/mosaic/` returns 302 to the S3 host (Cloudflare in front of the
  redirect only).
- S3 object `Mars_MGS_MOLA_DEM_mosaic_global_463m.tif`: 200, `Content-Length: 2125771142`,
  `Accept-Ranges: bytes`, `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, HEAD`,
  `Vary: Origin, Access-Control-Request-Headers, Access-Control-Request-Method`. No `Allow-Headers` or
  `Expose-Headers` seen on a plain HEAD, so range-request preflight is UNCONFIRMED.
- Anonymous listing (`?list-type=2&prefix=mosaic/&delimiter=/`) works; the bucket holds large numbers of
  other products (Mars CTX, HiRISE, MSL, etc. well beyond 21,000 keys).
- TIFF layout: see headline 2. Header read for four DEMs.
- Not COG: no tiling tags (322/323) in the four files read; other files not checked.
- Sibling bucket `asc-moon.s3.us-west-2.amazonaws.com`: listing is public (200). Contains
  `Lunar_LRO_LOLAKaguya_DEMmerge_60N60S_512ppd_radius.tif` (12,984,894,451 bytes) and `lola.copc.laz`
  (53,482,785,751 bytes). Whether that .tif is tiled/COG: UNCONFIRMED.
- STAC API `https://stac.astrogeology.usgs.gov/api/collections` with an Origin header:
  `Access-Control-Allow-Origin: *`. It lists 18 collections (LOLA shots, Kaguya TC observations and DTMs,
  Galileo and Voyager controlled observations/mosaics, HiRISE, CTX DTMs, THEMIS controlled mosaics), all
  tagged `CC0-1.0` in the collection metadata (TESTED). No global basemap collection is among them.
  Other asc-* buckets named in the brief (e.g. asc-mars) were not tested.

Terms as read:
- USGS: "USGS-authored or produced data and information are considered to be in the U.S. Public Domain."
  Also: "not all information, illustrations, or photographs on our site are." And: "we ask that proper
  credit be given." Third-party: "To use these copyrighted materials, you must obtain permission from the
  copyright holder."
- The Astropedia search page contained no terms or data-use statement. The STAC landing page had none.
  No bucket-level terms page was found. Per-product licence for each mosaic is UNCONFIRMED. Many mosaics
  are built from non-USGS teams (DLR Dawn, Kaguya/JAXA, MESSENGER, New Horizons); the USGS page does not
  say those inherit the USGS public-domain statement. A search summary reported the USGS map page for the
  LOLA-Kaguya merge asks credit to the LOLA Team and JAXA SELENE/Kaguya Team; page not read directly.
- Decision: DEFAULT for pack baking, with per-product credit lines read from each Astropedia product page
  before shipping. Live use is not recommended (strip layout).

### 2.2 NASA Trek (trek.nasa.gov)

URLs: https://trek.nasa.gov/tiles/apidoc/trekAPI.html,
https://trek.nasa.gov/tiles/Moon/EQ/LRO_LOLA_ClrShade_Global_128ppd_v04/1.0.0/WMTSCapabilities.xml

- API doc quote: "Map layers are available through the OGC RESTful WMTS protocol." Template
  `https://{WMTS endpoint}/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png`.
- Terms: none on the API page; the only text is a "(c) 2016 Trek" notice. Moon Trek home page: no terms,
  no data policy, no API, no elevation text. The capabilities document read has no Fees or AccessConstraints.
- Numeric DEM: the API page does not mention it. A search found no Trek documentation confirming 16-bit
  DEM tiles. A guessed URL for a Mars MOLA DEM layer returned 404. UNCONFIRMED.
- Capabilities (LOLA colour-shade): `image/png`, 256 x 256, matrix set `default028mm`, zoom 0 to 5
  (2 x 1 up to 64 x 32 tiles), bbox whole globe. That is about 2.4 km/px at best at zoom 5; very shallow.
- TESTED: Moon WAC (`LRO_WAC_Mosaic_Global_303ppd_v02`) z0 tile JPEG: 200, 49,475 bytes,
  `Access-Control-Allow-Origin: *`. Mars Viking MDIM21 colour z0: 200, 52,978 bytes, ACAO *.
- Decision: TEST-ONLY (no terms, shallow zoom).

### 2.3 NASA media usage and Photojournal

URLs: https://www.nasa.gov/nasa-brand-center/images-and-media/,
https://science.nasa.gov/photojournal/cassinis-best-maps-of-jupiter-cylindrical-map,
https://science.nasa.gov/photojournal/saturn-four-years-on

- Media guidelines quotes: "NASA should be acknowledged as the source of the material." "it must not
  explicitly or implicitly convey NASA's endorsement of commercial goods or services." "Otherwise, NASA
  imagery can be generally used editorially within published works that are not promotional in nature."
  Third party: "Those wishing to use copyright protected material of third parties must contact the
  copyright holder directly."
- PIA07782 page: credit NASA/JPL/Space Science Institute. No usage terms on the image page beyond the credit
  and a link to the brand and usage guidelines. JPEG 430.94 kB, TIFF 18.56 MB at
  `https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia/pia07/pia07782/PIA07782.jpg`
  (and `.tif`). Pixel dimensions not stated. TESTED: JPEG is 441,285 bytes, ACAO *.
- PIA11141 page: not a map. Natural-colour full-disk mosaic, 70 km/px, 29.47 MB TIFF.
- Old `photojournal.jpl.nasa.gov` URLs 301 to science.nasa.gov.
- `jpl.nasa.gov/images/policy/` returned 404; JPL image policy not read.

### 2.4 SDO

URLs: https://sdo.gsfc.nasa.gov/data/, https://sdo.gsfc.nasa.gov/data/rules.php

- Quotes: "SDO images and movies are not copyrighted unless explicitly noted." Non-commercial and public
  education use is "strongly encouraged and requires no expressed authorization." Credit: "Courtesy of
  NASA/SDO and the AIA, EVE, and HMI science teams." "Browse products are not intended for science
  analysis or publication."
- Latest images: `/assets/img/latest/latest_{4096|2048|1024|512}_{0193,0171,0304,...,HMIB,...}.jpg`.
- TESTED: `latest_2048_0304.jpg` 200, 876,207 bytes, NO `Access-Control-Allow-Origin`. A browser canvas/WebGL
  texture cannot use it without a proxy. Rate etiquette: silent in what was read.
- SOHO: not researched.
- Decision: TEST-ONLY.

### 2.5 PDS and others

- PDS policy URL tried returned 404; no PDS-wide terms read. PDS Ring-Moon Systems Node home page: no data
  use or citation terms on the page, no profile data named. PDS LOLA/SLDEM2015 tiles: listing read only for
  LDEM 1024 ppd tiles (about 944 MB `.img` each, 30 x 15 degree tiles; JP2 about 80 to 100 MB each); not
  needed given the USGS-hosted global versions. SLDEM2015 facts (512 ppd, +-60 degrees, about 3 to 4 m
  vertical) come from a search summary of PGDA/USGS pages, not a primary page I read.
- Corlies Titan topography: search summary only. See table.
- Murray Lab CTX: page unreadable (certificate error from the fetch tool). Terms UNCONFIRMED.

## 3. Ephemeris and rotation

NAIF terms (https://naif.jpl.nasa.gov/naif/rules.html), quotes: "SPICE kernels placed on the NAIF server may
be downloaded and used by anyone". "Redistribution of SPICE kernels distributed by NAIF is permitted as long
as they have not been modified." If modified, the attribution must be replaced with the modifier's name.
"No fees or licensing are required." Acknowledgement "is encouraged." "Redistribution of the unmodified SPICE
Toolkit, such as from a mirror site, is prohibited" without written clearance. Whether baking Chebyshev
coefficients out of a kernel counts as "modified" redistribution: the page is silent; I draw no conclusion.

CORS: `naif.jpl.nasa.gov` kernels sent no `Access-Control-Allow-Origin` (TESTED on `pck00011.tpc`; HEAD on
`de440s.bsp` also lacked it in the headers printed). Not browser-readable. `Accept-Ranges: bytes` present.

Planetary SPKs, directory `https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/` (listing via
fetch tool):
- `de440.bsp` 114 MB (2020-12-21), `de440s.bsp` 31 MB (TESTED `Content-Length: 32726016`),
  `de441_part-1.bsp` and `_part-2.bsp` 1.5 GB each, `de440_and_de441.pdf` 5.2 MB, `de440_tech-comments.txt` 58 kB.
- Time span of DE440 / DE440s: NOT read from a primary page in this session (UNCONFIRMED). From memory,
  DE440 covers 1550 to 2650 and DE440s 1849 to 2150; do not use until read from the comments file.
- DE441 parts are 1.5 GB each: not suitable.

Satellite SPKs, `https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/` (listing TESTED with
curl, matches the fetch tool; spans from `aa_summaries.txt` read by the fetch tool):

| System | File | Size | Covers (body IDs) | Span |
|---|---|---|---|---|
| Mars | `mar099s.bsp` | 64 MB | 401, 402, 499 | 1995 JAN 01 to 2050 JAN 01 |
| Mars | `mar099.bsp` | 1.1 GB | same | 1600 to 2600 |
| Jupiter | `jup365.bsp` | 1.1 GB | 501-505, 514-516, 599 | 1600 to 2200 |
| Jupiter | `jup365_2200_2600.bsp` | 1.4 GB | same | 2200 to 2600 |
| Jupiter | `jup349.bsp` | 93 MB | 599 and 55531-55544 (small outer moons) | 1799 to 2199 |
| Saturn | `sat441.bsp` | 631 MB | 601-609, 612-614, 632, 634, 699 | 1749 to 2250 |
| Saturn | `sat459.bsp` | 80 MB | 699, 65286-65303 | 1749 to 2150 |
| Saturn | `sat480.bsp` | 12 MB | 699, 65304 | 1950 to 2050 |
| Uranus | `ura184_part-1/2.bsp` | 1.9 GB each | 706-715, 725-727, 799 | 1900 to 2100 |
| Uranus | `ura184_part-3.bsp` | 369 MB | 701-705, 716-724, 799 | 1600 to 2399 |
| Neptune | `nep105.bsp` | 201 MB | 802, 899 | 1600 to 2400 |
| Neptune | `nep098_part-1/2/3.bsp` | 784 MB / 1.7 GB / 1.7 GB | 801-808, 814, 899 | 1800 to 2199 |
| Pluto | `plu060.bsp` | 129 MB | 901-905, 999 | 1800 to 2199 |

Notes: the aa_summaries source "does not state a recommended kernel". The satellite README says there is
no file for the Moon in this folder ("the ephemeris for the earth's moon is *NOT* available in a file found in
this folder"); the Moon is in the DE kernels. Each file carries its planet's mass centre. Other files listed
(sat415, sat455-457, ura111xl-*, ura116xl, nep097*, nep101xl, nep104, sat441xl parts, jup347/348, mar099s) exist;
the recommended minimal set for a browser pack is a judgement for the owner. File sizes are all too large for
direct use; they need baking. Which Uranian file holds Miranda..Oberon within ura184: part-3 (701-705).

JPL Horizons API (https://ssd-api.jpl.nasa.gov/doc/horizons.html), as read:
- "The Horizons `TLIST` parameter allows specification of up to 10,000 discrete output times." URL length
  may lower the practical count; TLIST cannot be combined with START_TIME, STOP_TIME, STEP_SIZE.
- Rate limits: not stated on that page. Maximum output lines: not stated. Terms of use: not covered; footer
  links to privacy and image policy only. CORS: not mentioned.
- The Horizons manual (first 100k of ~196k characters read): email requests allow "up to 10000 discrete
  times" and "up to 200 objects at once"; scripted email should "space requests at 1-2 seconds". No terms
  beyond a statement that suitability is "ultimately the users' responsibility."
- TESTED: one GET for Earth vectors (1 day) returned JSON `{"signature":{"version":"1.2","source":"NASA/JPL
  Horizons API"}, "result": "...text table..."}` with `Content-Type: application/json` and NO
  `Access-Control-Allow-Origin`. The result is a text blob, not structured fields. HEAD returns 405.
  Not usable from a browser without a proxy. Source line said DE441 for Earth/Sun.

IAU WGCCRE 2015 (Archinal et al. 2018, Celestial Mechanics and Dynamical Astronomy 130:22,
https://doi.org/10.1007/s10569-017-9805-5): the Springer page redirected to a login/auth step in the fetch
tool and was not read; whether it is open access is UNCONFIRMED. The machine-readable version is NAIF
`pck00011.tpc`: https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc, 131,226 bytes
(TESTED), dated 2022-12-27. NAIF `aareadme.txt` (14 kB, 2022): "The latest files, released December 27,
2022"; Mars data in `pck00011.tpc` need Toolkit N0067 or later; `pck00011_n0066.tpc` (129 kB) is for N0066
and earlier. Newer Mars files in the same folder: `mars_konopliv_2026_v1.tpc` (18 kB) and
`mars_konopliv_2026_n0066_v1.tpc` (19 kB), dated 2026-10-03; their content and status as
"current" not read. Also present: `gm_de440.tpc` (12 kB, 2022-12-14), `gm_de431.tpc`, `de-403-masses.tpc`.

Earth-specific caveats (from the pck00011 header and NAIF README, as read):
- "The IAU report [1] no longer provides rotational elements for the Earth. Data in this file are from [3]."
- "NAIF strongly cautions against using the earth rotation model presented here" and the model has "an error
  in the prime meridian location of magnitude at least 150 arcseconds".
- Earth orientation comes from binary Earth PCKs (precession, nutation, UT1-TAI, polar motion):
  `earth_latest_high_prec.bpc` (4.9 MB, 2026-10-30), `earth_1962_260806_2126_combined.bpc` (30 MB),
  `earth_2026_260806_2126_predict.bpc` (18 MB). The high-accuracy file is updated at least twice a week.
- The Moon has no IAU rotational elements either; NAIF supplies `moon_pa_de440_200625.bpc` (12 MB) for the
  DE440 libration and a rougher fallback in the text PCK.
- Example in the file: `BODY399_RADII = ( 6378.1366 6378.1366 6356.7519 )` (illustrative).

## 4. Atmosphere numbers

Sources: NSSDC planetary fact sheets, https://nssdc.gsfc.nasa.gov/planetary/factsheet/ (pages: earthfact,
marsfact, venusfact, jupiterfact, saturnfact, uranusfact, neptunefact, plutofact). The fact sheets are
summary tables, not reference atmosphere models; none states a "top of atmosphere". The sheets carry no
licence statement in the text I read.

| Body | Surface pressure | Surface / 1 bar density | Scale height | Main composition (by volume) | Top for reference model |
|---|---|---|---|---|---|
| Earth | 1014 mb | 1.217 kg/m3 | 8.5 km | 78.08% N2, 20.95% O2, Ar 9340 ppm, CO2 420 ppm | US Standard Atmosphere 1976 tables go to 1000 km (NTRS 19770009539: "The main tables of atmospheric properties to 1000 km are given in Part 4"); sea-level values not stated on that page |
| Mars | 6.36 mb at mean radius (4.0 to 8.7 mb seasonal; Viking 1 site 6.9 to 9 mb) | about 0.016 +/- 0.006 kg/m3 | 11.0 km | 95.1% CO2, 2.59% N2, 1.94% Ar, 0.16% O2, 0.06% CO | UNCONFIRMED (Mars-GRAM / MCD not read) |
| Venus | 92 bars | about 65 kg/m3 | 15.9 km | 96.5% CO2, 3.5% N2 | UNCONFIRMED (VIRA not read) |
| Titan | 1467 +- 1 hPa; 93.65 +- 0.25 K (Fulchignoni et al. 2005, Nature 438:785-791, HASI; as reported by a search summary of the ESA and Open University abstracts) | UNCONFIRMED | UNCONFIRMED | N2 dominant, CH4 minor: composition not read from a primary source | Profile "from an altitude of 1,400 km down to the surface" (abstract text); Yelle / Cassini model tops not read |
| Pluto | about 13 microbar (this sheet predates New Horizons; a later value is expected to be about 1 Pa = 10 microbar, UNCONFIRMED) | not listed | about 18 km lower, about 50 km above 30 km | 99% N2, 0.5% CH4, 0.05% CO | UNCONFIRMED |
| Jupiter | >>1000 bars (no true surface); 1 bar level at 165 K | 0.16 kg/m3 at 1 bar | 27 km | 89.8% H2, 10.2% He, CH4 3000 ppm | 1 bar equatorial radius 71,492 km; volumetric mean 69,911 km |
| Saturn | 1 bar level at 134 K | 0.19 kg/m3 | 59.5 km | 96.3% H2, 3.25% He, CH4 4500 ppm | 1 bar equatorial 60,268 km; mean 58,232 km |
| Uranus | 1 bar level at 76 K | 0.42 kg/m3 | 27.7 km | 82.5% H2, 15.2% He, CH4 2.3% | 1 bar equatorial 25,559 km; mean 25,362 km |
| Neptune | 1 bar level at 72 K | 0.45 kg/m3 | 19.1 to 20.3 km | 80.0% H2, 19.0% He, CH4 1.5% | 1 bar equatorial 24,764 km; mean 24,622 km |

Caveats: the Jupiter sheet does not define "surface" for its pressure row; its only Rj definition is 71,398 km
for the magnetosphere. The Mars sheet's total mass is about 2.5e16 kg, Venus 4.8e20 kg, Earth 5.1e18 kg
(superscripts were lost in extraction; I reconstructed exponents from magnitude, treat as UNCONFIRMED
typographically). "Top of atmosphere" as a rendering cutoff is a project choice, not a number these pages give.

## 5. GM and mean radii

GM values: JPL SSD astrodynamic parameters page https://ssd.jpl.nasa.gov/astro_par.html ("from the JPL
planetary ephemeris DE440", Park et al. 2021, AJ 161:105). It gives systems for the giants, not planet-only
values, and no radii.

| Body | GM | Source |
|---|---|---|
| Sun | 1.32712440041279419e20 m3/s2 | SSD astro_par |
| Mercury | 22031.868551 km3/s2 | SSD astro_par |
| Venus | 324858.592000 km3/s2 | SSD astro_par |
| Earth | 398600.435507 km3/s2 | SSD astro_par |
| Moon | 4902.800118 km3/s2 | SSD astro_par (4902.800 +- 0.001, DE440, on the satellite page) |
| Mars system | 42828.375816 km3/s2 | SSD astro_par |
| Jupiter system | 126712764.100000 km3/s2 | SSD astro_par |
| Saturn system | 37940584.841800 km3/s2 | SSD astro_par |
| Uranus system | 5794556.400000 km3/s2 | SSD astro_par |
| Neptune system | 6836527.100580 km3/s2 | SSD astro_par |
| Pluto system | 975.500000 km3/s2 | SSD astro_par ("included in JPL's planetary ephemeris for historical reasons") |

Multiply km3/s2 by 1e9 for m3/s2. Satellites, from https://ssd.jpl.nasa.gov/sats/phys_par/ (GM km3/s2, mean
radius km, with the stated source ephemeris; radii reference Archinal et al. 2018 except Charon, from
Nimmo et al. 2017):

| Body | GM | Mean radius | GM source |
|---|---|---|---|
| Phobos | 0.0007087 | 11.08 | MAR097 |
| Deimos | 0.0000962 | 6.2 | MAR097 |
| Io | 5959.91547 | 1821.49 | JUP365 |
| Europa | 3202.71210 | 1560.80 | JUP365 |
| Ganymede | 9887.83275 | 2631.20 | JUP365 |
| Callisto | 7179.28340 | 2410.30 | JUP365 |
| Mimas | 2.50349 | 198.20 | SAT441 |
| Enceladus | 7.21037 | 252.10 | SAT441 |
| Tethys | 41.21353 | 531.10 | SAT441 |
| Dione | 73.11607 | 561.40 | SAT441 |
| Rhea | 153.94175 | 763.50 | SAT441 |
| Titan | 8978.13710 | 2574.76 | SAT441 |
| Iapetus | 120.51511 | 734.30 | SAT441 |
| Miranda | 4.3 +- 0.2 | 235.8 | URA111 |
| Ariel | 83.5 +- 1.4 | 578.9 | URA111 |
| Umbriel | 85.1 +- 1.9 | 584.7 | URA111 |
| Titania | 226.9 +- 4.1 | 788.9 | URA111 |
| Oberon | 205.3 +- 5.8 | 761.4 | URA111 |
| Triton | 1428.49546 | 1352.60 | NEP097 |
| Charon | 106.1 +- 0.3 | 606.0 | PLU060 |
| Moon | 4902.800 | 1737.4 | DE440 |

Planet mean radii (NSSDC fact sheets, "volumetric mean radius"): Venus 6051.8, Earth 6371.0, Mars 3389.5,
Jupiter 69,911, Saturn 58,232, Uranus 25,362, Neptune 24,622, Pluto 1188 km. These are volumetric means,
not the 1-bar equatorial radii in section 4. Giants have no surface; pick the 1 bar radius deliberately.

The SSD satellite page has no row for Pluto itself, Mercury, Ceres, Vesta or the Sun's radius. For Pluto alone,
975.5 - 106.1 = 869.4 km3/s2 is a subtraction I made, not a published value; Hydra/Nix/Styx/Kerberos
are ignored in it. Mercury, Ceres, Vesta, and Sun mean radii, and Ceres and Vesta GM: UNCONFIRMED (the
pck00011 excerpt read did not include them, and I did not find them on a page).

## 6. Falsifiability notes, for the experiments

- "Live and browser-readable" here means CORS-open and range-capable. For USGS strips, per-row requests make
  a camera cut at 100 m/px prohibitively slow; cold-cache cost must be measured, not assumed.
- Coverage gaps: Triton (GlobalFill), Pluto (about half the surface imaged at low resolution), Titan SAR, Phobos,
  Venus (radar 75 m only in the 117 GB products) must be exposed as unresolved, not hidden by smooth fill.
- Heights are in different datums and quantisation (int16 in what units and scale? not read from the PDS
  labels; Mars MOLA int16 scale and offset UNCONFIRMED; Pluto int16 UNCONFIRMED; Vesta float32).
- A DEM at 463 m (Mars) says nothing about silhouette or normal accuracy at metre scale. No bound is claimed.

## 7. UNCONFIRMED list

- Terms for every individual USGS mosaic; whether Dawn/DLR, Kaguya/JAXA, MESSENGER, New Horizons derived
  products inherit the USGS public-domain statement.
- Trek: terms, numeric DEM access, DEM layer names, HEAD/GET behaviour beyond z0 tiles.
- CORS preflight for `Range` on any host; CORS on `asc-moon` bucket; CORS on files other than the Mars DEM.
- Whether the other ASC GeoTIFFs are striped (only four were read).
- Coverage percentages for every body; Pluto, Triton, Titan, Phobos, Venus gaps.
- Vertical accuracy for every DEM except SLDEM2015 (search summary only); integer scale/offset for all.
- Mimas folder contents; any Uranian moon map; any Deimos map; Jupiter pixel dimensions; any Saturn,
  Uranus, Neptune global map; Juno map; Saturn ring radial profiles (UVIS/VIMS/occultation).
- Murray Lab CTX mosaic and terms; SOHO; PDS-wide data policy; JPL image policy; SLDEM2015 primary page;
  Corlies resolution and terms.
- DE440/DE440s time spans from a primary page; current-ness of `mars_konopliv_2026_*`; open-access status of
  Archinal et al. 2018 and whether tables are readable.
- Horizons: rate limit, output-line cap, usage terms (none found), and its CORS (none sent).
- Atmosphere: Titan density and scale height, Pluto post-New Horizons pressure, reference-model tops for
  Mars (Mars-GRAM/MCD), Venus (VIRA), Titan (Yelle/HASI), Earth sea-level values from US Std 1976.
- GM and radii for Mercury, Ceres, Vesta; Sun mean radius.
