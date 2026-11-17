# Real Earth data source terms ledger

Other bodies: [SOLAR-SYSTEM-SOURCES-DRAFT.md](SOLAR-SYSTEM-SOURCES-DRAFT.md), which is a draft, read by a smaller model through a fetch tool, and went past the one-request-per-service limit it was given on one USGS bucket. It says so itself.

Dated 30 October 2026. Companion to [REAL-EARTH-PLAN.md](REAL-EARTH-PLAN.md) sections 3 and 13.

This is a record of what public web pages said when read on this date. It is not legal advice and
reaches no legal conclusion beyond the quoted text. Anything not read is marked UNCONFIRMED. Silence
on a point is recorded as silence, not as permission.

Method: public documentation and capabilities pages only, read through a fetch tool that summarises
pages with a small model. Quotes below are the tool's extracts and were not independently checked
against the raw HTML, so re-read each page before shipping. No provider was contacted, no account or key
was requested, and nothing was bulk downloaded. One exception: a single GIBS GetTile request for
BlueMarble_NextGeneration (500m, level 0) was made to learn the tile size (512x512 JPEG).

Project assumption (owner, 30 October 2026): free, non-commercial, no ads, paid tiers or sponsorship;
it may be open source; it converts public tile services into GPU pages in the visitor's browser and keeps
visited tiles in a local browser cache; it hosts only a small pinned pack. Google and Esri are excluded
and were not researched.

Decision values: DEFAULT (may ship in the default manifest), TEST-ONLY (private fixtures, not shipped),
EXCLUDED.

## Summary

| # | Source | Licence as read | Decision |
|---|---|---|---|
| 1 | AWS Terrain Tiles (Terrarium) | Per-source licences (public domain, CC BY, OGL and others) with per-source credit; no single licence for the compiled tiles | DEFAULT |
| 2 | EOX Sentinel-2 cloudless WMTS | CC BY-NC-SA 4.0 for 2018-2025 layers; CC BY 4.0 for 2016 | DEFAULT (non-commercial only) |
| 3 | swisstopo SWISSIMAGE WMTS | swisstopo free geodata terms, source reference mandatory; FSDI fair use | DEFAULT |
| 4 | USGS National Map USGSImageryOnly | "free and in the public domain"; credit requested | DEFAULT |
| 5 | IGN Geoplateforme orthophotos | Layer licence not read; Etalab Open Licence is the stated default | TEST-ONLY |
| 6 | PDOK aerial photo | Capabilities: fees none, constraints none; licence not read from a primary page | TEST-ONLY |
| 7 | NASA GIBS | CC0 default for NASA-led mission data; acknowledgement requested | DEFAULT |
| 8 | NASA Trek WMTS | No terms found | TEST-ONLY |
| 9 | OpenFreeMap | Service terms silent on data licence; OSM ODbL, OpenMapTiles credit | TEST-ONLY |
| 10a | swissALTI3D | Swiss free geodata terms; sample page says test use only | TEST-ONLY |
| 10b | USGS 3DEP 1 m | Public domain per National Map FAQ | TEST-ONLY (validation) |
| 10c | ESA WorldCover on AWS | CC BY 4.0 | TEST-ONLY (validation) |
| 11a | Blue Marble Next Generation in the pinned pack | NASA asks for credit when republishing | DEFAULT |
| 11b | Low-zoom Terrain Tiles in the pinned pack | No statement about redistributing the compiled tiles | TEST-ONLY |
| 11c | NOAA ETOPO 2022 in the pinned pack | CC0-1.0, worldwide, in the primary metadata record | DEFAULT |

## 1. AWS Terrain Tiles (Terrarium)

URLs: https://registry.opendata.aws/terrain-tiles/ and
https://github.com/tilezen/joerd/blob/master/docs/attribution.md

- Licence: the registry page gives no licence of its own, only a link to the attribution document. That
  document lists a licence per upstream source: 3DEP, SRTM and GMTED2010 public domain; ETOPO1 not subject
  to US copyright; New Zealand CC BY 3.0 NZ; UK Open Government Licence v3; Austria CC BY 3.0 AT; Norway
  CC BY 4.0; Australia CC BY 4.0; Canada Open Government Licence Canada; Mexico INEGI free use; ArcticDEM
  "an unlicensed product and may be used, distributed, and modified without permission". EU-DEM has no
  separate licence statement on that page.
- Deciding sentences. Registry: "Terrain Tiles was accessed on `DATE` from https://registry.opendata.aws/terrain-tiles."
  (suggested citation). Attribution document: attribution should "appear in a place that is reasonable to the
  medium or means you are utilising." It also says attribution requirements vary and users are responsible
  for researching each project's licence terms.
- Attribution text: see the manifest section. The document has a general list and a longer list for use of
  Mapzen's hosted service that adds "Mapzen". The tiles here come from the AWS bucket, not Mapzen's service.
- Browser use by anonymous visitors: the registry page says "No AWS account required". It states no rules
  about browser use. CORS behaviour is from the plan's own test, not from the page.
- Local browser cache: silent.
- Rate or volume limits: none stated.
- Registration for a non-commercial app: none stated.
- Maximum useful zoom: not stated. The joerd data-sources page has a per-zoom table ending at zoom 15
  and a native-resolution table with a zoom 16 row; the plan's test used z10.
- Open questions: no licence statement for the compiled tiles as a whole; the pages say nothing about
  traffic volume or whether the bucket will stay anonymous; the per-source credit list must be shown for
  the regions served. Before launch: show the credit list, and pin the tile URL pattern and zoom range
  from the manifest, not from this ledger (the URL pattern was not on the pages read).
- Decision: DEFAULT. The licences of the upstream sources are explicit and permit reuse with credit, but
  no volume statement exists, so treat the host as goodwill-dependent.

## 2. EOX Sentinel-2 cloudless WMTS

URLs: https://cloudless.eox.at/documentation/license, https://cloudless.eox.at/license-non-commercial,
https://cloudless.eox.at/license-legal

- Licence: the non-commercial page says "EOxCloudless WM(T)S layers are free to use for non-commercial
  purposes, provided appropriate attribution is given." The 2018 to 2025 data are CC BY-NC-SA 4.0. For
  2016: "For the year 2016, EOxCloudless is licensed under the Creative Commons Attribution 4.0
  International License." The page gave no separate licence for 2017.
- Commercial use needs "an EOX Commercial Attribution-RestrictedUse 1.2 License" (license page). That
  commercial licence says "The Direct Redistribution of Licensed Material is prohibited – both for sale and
  for free." and does not mention WMTS, caching or service limits.
- Attribution: "The attribution shall be displayed legibly and in proximity to the usage." The documentation
  page says that as of June 2026 the attribution is unified for data and viewing products.
- Browser use by anonymous visitors: the "free to use for non-commercial purposes" sentence covers the
  WM(T)S layers. No statement about visitors specifically.
- Local browser cache: the licence pages are silent, and the share-alike term of CC BY-NC-SA 4.0 is not analysed
  here. The FAQ (below) advises it for the free endpoints. Its entry on in-app caching and offline packs permits both
  under the commercial licence, on condition that tiles stay in the app and "cannot be extracted as raw data".
- Limits: the licence pages say only "The maximum request size is limited to 4096px, but you may stitch multiple
  requests to fit your needs." **Corrected 31 October 2026:** this ledger said no limit was stated, having missed the FAQ,
  https://cloudless.eox.at/documentation/faq, under "Are there hard limits on the public tile services?": "We do not
  publish any specific numeric limits", "our servers will automatically slow down or temporarily block sudden traffic
  spikes", "cache tiles on your own CDN or device", "spread out your requests rather than sending large batches all at
  once." Quotes read directly from that page on 31 October 2026, cut at the reader's length limit.
- Refusals seen: on 31 October 2026 a real session flying a lot had many tile requests blocked, reported by the browser
  as CORS failures, as an error response carries no CORS header. A plain request to the same tiles without a browser
  got HTTP 403, which may only be a filter on such clients. One request with browser-like headers was stopped by a safety
  check, rightly: disguising a request to get past a refusal is not done here. So this does not establish whether a block
  was on the session or on the address. The client now keeps a budget and backs off (M1-LIVE-EARTH.md).
- What the FAQ counts as non-commercial: "Non-commercial use includes personal hobby projects, educational tools,
  non-profit academic atlases", and "Personal tools supported only by voluntary donation links". "Internal government
  agency use, B2B portals, and freemium/paid apps do NOT qualify". A free app with no ads fits this reading, unconfirmed
  by EOX.
- A copy on our own server or CDN: **not settled.** CC BY-NC-SA 4.0 section 2(a)(1) reads "reproduce and Share the Licensed
  Material, in whole or in part, for NonCommercial purposes only", and the limits answer above advises caching on your
  own CDN. But the FAQ lists "Hosting tiles on your own internal servers or CDN." among what the commercial licence covers,
  and the licence page says "You may not ... allow others to re-use it independently without EOX's written permission."
  Bulk download or harvesting from the WMTS is mentioned nowhere. Ask EOX in writing first, which needs the owner's approval.
  Not legal advice.
- Size and price of the whole mosaic: the FAQ gives the 2025 Viewing Ready global dataset as "SQLite map cache: 856 GB",
  "GeoPackage: 1,018 GB". A second pair on the same page reads 559 GB and 633 GB; which product each pair belongs to was not
  checked. Sold only as a whole: "we only provide the dataset as a complete worldwide package". A research agent read
  EUR 6,000 for 2025, EUR 5,000 for each of 2018 to 2024, and EUR 6,000 a year for a hosted endpoint, excluding VAT. Those
  prices were not re-read directly. Spending money needs the owner's approval.
- Registration or permission: not required by the page for non-commercial use.
- Maximum useful zoom: not stated on the pages read. About 10 m source, plan tested z10.
- Open questions: the 2016 layer is the only one under CC BY 4.0 and the only one without the NC clause, but
  it is older; whether a hosted copy in the pinned pack would trigger share-alike; the volume that EOX
  considers fine. Before launch: confirm the year layer the manifest names, and tell EOX the intended use
  (the plan already says to ask).
- Decision: DEFAULT for a non-commercial deployment. Revenue of any kind would require replacing it.

## 3. swisstopo SWISSIMAGE WMTS

URLs: https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices and
https://www.geo.admin.ch/en/general-terms-of-use-fsdi

- Licence (swisstopo terms): "The free geodata and geoservices of swisstopo may be used, distributed and
  made accessible." Commercial use is allowed. "A reference to the source is mandatory."
- FSDI terms: "The acquisition and use of data or services is free of charge, subject to the provisions on
  fair use." "Use of the geoservices of the FSDI does not require registration and is free-of-charge."
  "Fair use is use of the geoservices of the FSDI which is compatible with the common good." Access may be
  restricted for users who do not follow the Fair Use Directive.
- Limits: the page says a maximum number of requests per time unit applies and is listed in a table. That
  table was not in the text read, so the figures are UNCONFIRMED. "Automatic parsing of geoservices via
  bots with high query intensities is to be avoided." Applications expected to exceed the limits should
  contact info@geo.admin.ch beforehand. Web apps "with an average of 20,000 users per day" are described as
  fair use.
- Browser use by anonymous visitors: free and no registration; no visitor-specific statement.
- Local browser cache: silent on both pages.
- The SWISSIMAGE product page (swisstopo.admin.ch/en/geodata/images/ortho/swissimage10.html) gave no
  licence text, only a link to the terms above. It carries one extra credit for the centre of the 20
  largest Swiss lakes in images from 2018 onward: "Includes material © (2016-2018) Planet. All rights reserved".
- Maximum useful zoom: not on the pages read (plan tested z18).
- Open questions: the request-limit figures; whether tile prefetch counts as "bots with high query
  intensities"; the Planet credit when lakes are in view. Before launch: read the Fair Use Directive table
  and contact info@geo.admin.ch if a heavy-use estimate approaches it.
- Decision: DEFAULT, Switzerland only, with the limits table to be read before launch.

## 4. USGS National Map USGSImageryOnly

URLs: https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer,
https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map,
https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits

- Licence: "Map services and data downloaded from The National Map are free and in the public domain."
  On limits: "There are no restrictions;" and the agency asks that its acknowledgment be included.
- Credit line: "Map services and data available from U.S. Geological Survey, National Geospatial Program."
- Service copyright text: "USDA, USGS The National Map: Orthoimagery. Data refreshed June, 2024.v1.2"
- Copyrights page: "USGS-authored or produced data and information are considered to be in the U.S. Public
  Domain", "we ask that proper credit be given", and some images on USGS sites are used with permission
  and are not public domain.
- Browser use and local cache: silent as such; "no restrictions" is the nearest statement.
- Rate or volume limits: none stated on these pages.
- Maximum useful zoom: the service lists 24 levels (0 to 23, 256x256 tiles, 3857), but the description says
  it is "visible to the 1:9,028 zoom scale" and the stated max scale is 9027.977411. By my arithmetic that is
  Web Mercator z16 (not read from a page), which matches the plan's z16 test. Treat z16 as the documented
  ceiling and z17+ as unproven.
- Caveat in the service description: the 10 m Alaska orthoimagery "will not be available for direct download
  from the National Map due to license restrictions". That says nothing about tile display, but it means
  not all content in this service is plainly USGS-authored. Small scales use Landsat and Blue Marble.
- Open questions: Alaska coverage; the 1-metre NAIP leaf-on source is a USDA product (copyright text
  names USDA).
- Decision: DEFAULT, contiguous US, Hawaii and territories as listed by the service; exclude Alaska until
  the licence note is understood.

## 5. IGN Geoplateforme orthophotos

URLs: https://cartes.gouv.fr/cgu/, https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/diffusion/,
https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities

- Licence: "Les données contenues dans les API sont soumises à la licence choisie et renseignée par le
  Fournisseur de données." and "A défaut, la Licence Ouverte / Open Licence – Etalab s'applique sur ce jeu de
  données." The licence recorded for the ORTHOIMAGERY.ORTHOPHOTOS layer itself was not read: the catalogue
  page is script-rendered and the capabilities document read stopped before the layer (3 MB, first 100 kB
  read).
- Use: "Sur la Géoplateforme, l'utilisation des géodonnées et géoservices est gratuite (sauf licence
  spécifique)."
- Limits: the WMTS imagery service is listed as "Non soumis à limite d'usage". "Pour certaines API, une
  limite d'usage fixée en nombre de requêtes par seconde et par IP est mise en place." Exceeding returns
  HTTP 429 with a 5 second block.
- Capabilities header read: Fees "none"; AccessConstraints "Conditions Générales d'Utilisation disponibles
  ici : https://cartes.gouv.fr/cgu".
- Attribution text, browser use by anonymous visitors, local cache, registration: not found. A third-party
  forum mention of the layer's licence was a search result and is not a primary source.
- Maximum useful zoom: not read.
- Decision: TEST-ONLY. UNCONFIRMED: the orthophoto layer's licence and credit text were not read from a
  primary page. Before this can ship, read the layer metadata on cartes.gouv.fr.

## 6. PDOK aerial photo

URLs: https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0?request=GetCapabilities&service=WMTS,
https://www.pdok.nl/copyright

- Capabilities (primary): title "Landelijke Voorziening Beeldmateriaal"; Fees "none"; AccessConstraints
  "none"; provider PDOK. 19 layers including Actueel_orthoHR and Actueel_ortho25. Max tile matrix:
  EPSG:3857 and OGC:1.0:GoogleMapsCompatible level 21; EPSG:28992 level 19.
- Copyright page (primary): CC-BY-4.0 applies to the listed datasets (BRT Achtergrondkaart,
  Bestuurlijke Grenzen, TOPraster, TOPNL), which do not include the aerial photo. It says "treft u bij de
  metadata van elke dataset de juiste informatie aan over het geldende copyright" and "Deze omschrijving is
  daarom leidend." The metadata for the aerial photo was not read: the data.overheid.nl catalogue pages
  returned 404 when fetched.
- A search result snippet listed the 2026 aerial dataset as CC BY 4.0, and an older mailing list thread
  quoted a non-commercial restriction for the 2014 photos. Neither is a primary page; neither is relied
  on.
- Attribution text, browser use, local cache, rate limits: not found.
- Decision: TEST-ONLY. UNCONFIRMED: licence of the aerial photo from the dataset metadata.

## 7. NASA GIBS

URLs: https://nasa-gibs.github.io/gibs-api-docs/, https://nasa-gibs.github.io/gibs-api-docs/access-advanced-topics/,
https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance,
https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml

- Licence: "data provided from a NASA-led mission are licensed as Creative Commons Zero" (CC0) unless
  marked otherwise (data-use guidance). Content with a licence or restriction "shall be labeled as such".
  Non-NASA data is "subject to the license arrangements of the sponsoring organization."
- The GIBS documentation does not state an imagery licence itself. Capabilities (both projections):
  Fees "none", AccessConstraints "none".
- Acknowledgement: "We acknowledge the use of imagery provided by services from NASA's Global Imagery
  Browse Services (GIBS)," followed by "part of NASA's Earth Science Data and Information System (ESDIS)."
- Other conditions: "NASA material may not be used to suggest or imply endorsement by NASA."
- Browser use by anonymous visitors, local cache: silent; CC0 is the nearest statement. Registration: none
  mentioned. Rate limits: none stated ("The page contains no request rate limits or usage policy").
- Layer-level markings for BlueMarble_NextGeneration, BlueMarble_ShadedRelief_Bathymetry and
  VIIRS_Black_Marble were not read (the capabilities document is about 5 MB and only the first 200 kB
  was read, which did not reach them). Whether any is marked otherwise: UNCONFIRMED.
- Maximum useful zoom, EPSG:4326 table from the docs (resolution name, zoom levels): 15.625m 13, 31.25m 12,
  250m 9, 500m 8, 1km 7, 2km 6. Which set each layer uses was not read. The Blue Marble Next Generation
  product is 500 m (Earth Observatory page), so the 500m set with 8 levels is the likely fit.
- Decision: DEFAULT, with layer metadata still to be read for the three named layers. Coarse imagery only.

## 8. NASA Trek WMTS

URLs: https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars and ...?body=moon,
https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/WMTSCapabilities.xml

- Terms: the API pages have no terms of use, licence, rate limits or attribution text. The only copyright
  text is the footer "© 2016 Trek." One layer's capabilities document had no Fees or AccessConstraints
  element. Silence recorded.
- Height products: the API documentation pages read say nothing about elevation, DEM or height products.
  They give the URL template `{WMTS endpoint}/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png`,
  and say some services use .jpg and that a missing tile means no coverage. A search summary reported the
  Mars list has a grayscale DEM and a colour hillshade derived from MOLA, and a forum thread saying Trek
  basemaps are renders, not raw elevation; this is a secondary report and not confirmed. The Mars catalogue
  page returned 404. Whether numeric DEM tiles exist: UNCONFIRMED.
- Tile size: 256x256 in the one capabilities document read.
- NASA general guidance (separate page, not Trek specific): NASA content "generally are not subject to
  copyright in the United States"; "NASA should be acknowledged as the source of the material."
- Decision: TEST-ONLY. UNCONFIRMED terms for this service. This differs from the plan, which treated it as
  a candidate for the Moon and Mars imagery.

## 9. OpenFreeMap

URLs: https://openfreemap.org/, https://openfreemap.org/tos/, https://www.openstreetmap.org/copyright,
https://openmaptiles.org/docs/

- Home page: "Using our public instance is completely free: there are no limits on the number of map views
  or requests." Commercial use: "Yes."
- Terms of service: a "completely free service provided" as-is, with no warranties, under Hungarian law.
  For offline downloads: "at most 3,000 tiles or 50 MB", "at most 4 parallel requests" and a unique
  User-Agent. The terms also prohibit collecting data "in automated ways," except for offline downloads.
  Data licence, commercial use and attribution: the terms do not address them.
- Attribution (home page): "Attribution is required." MapLibre adds it automatically; other clients and
  printed or video media must include "© OpenMapTiles" and "Data from OpenStreetMap." Showing the
  OpenFreeMap name is optional.
- OSM: "OpenStreetMap is open data, licensed under the Open Data Commons Open Database License (ODbL)".
  The page requires credit "by displaying our attribution notice" and clarity "that the data is available
  under the Open Database License."
- OpenMapTiles: "attribute OpenStreetMap data properly as well as attribute the OpenMapTiles project itself"
  and "you are still obliged to follow the original ODbL license". The schema is "open source and licensed
  under BSD + CC-BY" (the page does not give a version).
- Local browser cache: silent. Maximum zoom: not read. Road and building height attributes: not read.
- Open question that blocks DEFAULT: this project turns vector tiles into extracted geometry and prefetches.
  The terms ban "automated" collection outside the offline-download limits, while the home page allows
  unlimited map views. The page does not say which side a renderer falls on. The ODbL obligations for a
  derived database (plan section 3) are separate and unresolved.
- Decision: TEST-ONLY until the operator confirms the use in writing. This differs from the plan, which
  accepted it on the "no request limits" statement alone.

## 10. Validation-only datasets (private use, not shipped)

### swissALTI3D (swisstopo)

URLs: https://www.swisstopo.admin.ch/en/height-model-swissalti3d,
https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d

- Licence: the product page links to the free geodata terms (section 3). The STAC collection record reads
  licence "proprietary", with swisstopo as producer and licensor, and gives no terms link, so the machine
  field does not equal the free-geodata terms. The terms page itself was read; applying it to this product
  is an inference, UNCONFIRMED by the product page.
- Sample route: the product page offers sample data in TIF+TFW, ESRI ASCII GRID and XYZ. "They are free of
  charge and may be used for test purposes only." "It is not permitted to include them in a product."
  Registration is not mentioned. No full-coverage download route was shown.
- Data: 1 km2 tiles, Cloud Optimized GeoTIFF or ASCII XYZ, 0.5 m or 2 m grid, EPSG:2056, 6-year update cycle.
- Decision: TEST-ONLY. Use the sample for the Lausanne to Dents du Midi check only, never in the pinned
  pack. The direct no-account route for a larger area needs the STAC item assets, which were not read.

### USGS 3DEP 1 m

URLs: https://www.usgs.gov/3d-elevation-program/about-3dep-products-services,
https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map

- Licence: "All 3DEP products are available, free of charge and without use restrictions." Also the National
  Map FAQ sentence quoted in section 4. No credit requirement was stated for the DEM on the product page.
- The 1 m DEM "was introduced in 2015 with limited coverage of the U.S., but will be expanding".
- Download route: the page links to "The National Map - Data Delivery" and does not mention an S3 bucket or
  whether an account is needed. The AWS registry entry read (usgs-lidar) is the lidar point cloud, with
  `aws s3 ls --no-sign-request s3://usgs-lidar-public/` and a Requester Pays bucket; it is not the DEM. A
  no-account route for a 1 m DEM sample is UNCONFIRMED.
- Decision: TEST-ONLY for validation.

### ESA WorldCover 10 m on AWS

URL: https://registry.opendata.aws/esa-worldcover-vito/

- Licence: "CC-BY 4.0". Suggested citation: "ESA WorldCover was accessed on `DATE` from
  https://registry.opendata.aws/esa-worldcover-vito."
- Route: bucket `esa-worldcover` in eu-central-1, "No AWS account required", with
  `aws s3 ls --no-sign-request s3://esa-worldcover/`. File layout and tile size were not on the page.
- v100 is the 2020 map and v200 the 2021 map, from different algorithm versions, so changes between them
  "should be treated with caution".
- Decision: TEST-ONLY for validation. CC BY 4.0 may allow more, but it is not needed for this role.

## 11. Pinned pack

### Blue Marble Next Generation

URL: https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation

- Deciding sentence: "Anyone using or republishing Blue Marble: Next Generation please credit "NASA Earth
  Observatory."" Credit line: "Blue Marble: Next Generation was produced by Reto Stöckli, NASA Earth
  Observatory (NASA Goddard Space Flight Center)." Resolution "500 meters", monthly composites.
- This is a request for credit from a NASA page; it does not state a licence. The NASA data-use guidance
  gives CC0 as the default for NASA-led mission data unless marked, and the NASA media page says NASA
  content "generally are not subject to copyright in the United States". Both are general, not specific
  to this product.
- Decision: DEFAULT for the pinned pack, with the credit line shown. The layer's GIBS metadata should still
  be read (section 7).

### GIBS EPSG:4326 endpoint

- Root (documentation): `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/`. The REST pattern appends the
  layer identifier, time, tile matrix set, and zoom/row/column values, then the extension.
- A WMTS KVP GetTile for layer BlueMarble_NextGeneration, tile matrix set `500m`, matrix 0, row 0, column 0,
  `image/jpeg` returned a JPEG of 512 x 512 pixels. That is one observed tile, not documentation.
- Documentation table for the `500m` set: 8 zoom levels, 0.5625 degrees per pixel at the top level. The
  page states neither tile size nor origin; the 512 pixels here is from the returned tile only. The
  level-0 tile extent (512 x 0.5625 = 288 degrees, my arithmetic) and the origin are UNCONFIRMED.
- The REST path I tried with `EPSG4326_500m` and 0/0/0 returned HTTP 400; the capabilities ResourceURL was
  not reached, so the exact REST pattern for this layer is UNCONFIRMED. Take it from the capabilities
  document in the manifest tooling.
- The documentation says of EPSG:3857: "GIBS does not store visualizations in this projection." and tiles
  are "reprojected on-the-fly from Geographic (EPSG:4326) sources". This supports using the 4326 endpoint
  for the polar caps.

### Low-zoom Terrain Tiles

- The registry page and joerd documents state no licence for the compiled tiles and nothing on
  redistribution; per-source licences are in section 1. Whether the sources used at low zoom (the
  data-sources-per-zoom table was not read in full) allow redistribution of derived tiles in a repository
  is UNCONFIRMED.
- Decision: TEST-ONLY. Alternative: bake the low-zoom pack from sources whose own terms were read
  (for instance public-domain sources named in section 1), and record that bake separately. That is what
  was done: the next entry.

### NOAA ETOPO 2022

URL: https://www.ncei.noaa.gov/metadata/geoportal/rest/metadata/item/gov.noaa.ngdc.mgg.dem:etopo_2022/html
(read 31 October 2026), DOI 10.25921/fd45-gt74. The product page itself states no licence; the metadata record does.

- Deciding sentences: "These data were produced by NOAA and are not subject to copyright protection in the
  United States." "NOAA waives any potential copyright and related rights in these data worldwide through the
  Creative Commons Zero 1.0 Universal Public Domain Dedication (CC0-1.0)." "SPDX License: Creative Commons Zero
  v1.0 Universal (CC0-1.0)".
- Limits in the same record: "Not to be used for navigation." NOAA and NCEI give no warranty and assume no liability.
- Citation requested: "NOAA National Centers for Environmental Information. 2022: ETOPO 2022 15 Arc-Second Global
  Relief Model. NOAA National Centers for Environmental Information. https://doi.org/10.25921/fd45-gt74"
- Used: 60 arc-second ice surface grid. The bake records this quote and the credit in the pack's manifest.
- Decision: DEFAULT for the pinned pack's heights, with the credit shown.

## 12. Imagery we could host ourselves (none in the manifest)

Read on 31 October 2026 by a research agent from primary pages, not re-read directly. Check before acting on any of it. Any of these needs a large bake and hosting, which need the owner's approval.

- ESA WorldCover Sentinel-2 composites, 2020 and 2021: CC BY 4.0, "provided free of charge, without restriction of use" (esa-worldcover.org/en/data-access), so hosting is allowed. About 10 m, yearly median of B02, B03, B04, B08, uint16 COGs, 8.5 TB per year, s3://esa-worldcover-s2, "No AWS account required" (registry.opendata.aws/esa-worldcover-vito-composites). Cloud-free, but with "artefacts" from "improperly filtered cloudy and snowy products" (VITO). Colour balance not stated, so not display-ready without a bake of our own.
- Copernicus Sentinel-2 Global Mosaics: EU Legal Notice, "free access ... in so far as it is lawful: (a) reproduction; (b) distribution; (c) communication to the public". 10 m, quarterly first-quartile composite with gaps where no valid pixel. Needs Copernicus Data Space registration, so an account. Years unconfirmed.
- EOX 2016 layer: CC BY 4.0, but the FAQ adds "Do not resell or redistribute the raw source tiles as a standalone GIS dataset" and "a Fair Use Policy applies", undefined. So hosting is open. Data from May 2016 to April 2017.
- JRC GHS-composite-S2: global cloud-free 10 m, 2017 and 2018, 10 TB. Licence and colour balance unconfirmed.
- No other global, display-ready, hostable 10 m source was found.

## Attribution strings for the manifest

Show these in the viewer while the layer is visible. Strings are quoted from the pages read; year and
region parts vary.

| Source | String |
|---|---|
| AWS Terrain Tiles | A credit list per region from the joerd attribution document. Examples: "3DEP data courtesy of the U.S. Geological Survey", "SRTM data courtesy of the U.S. Geological Survey", "GMTED2010 data courtesy of the U.S. Geological Survey", "Norway terrain data © Kartverket", "© Environment Agency copyright and/or database right 2015. All rights reserved.", "Contains information licensed under the Open Government Licence – Canada.", "© Commonwealth of Australia (Geoscience Australia) 2017.", "Produced using Copernicus data and information funded by the European Union - EU-DEM layers.". Check the document for the full list (NZ, Austria, Mexico, ArcticDEM, ETOPO1). |
| EOX cloudless, 2018-2025 | "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)" with the layer's own year. The page showed 2025. |
| EOX cloudless, 2016 | "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017)" |
| swisstopo | "©swisstopo" (or "Federal Office of Topography swisstopo"). Plus, where 2018+ imagery of the 20 largest lakes shows: "Includes material © (2016-2018) Planet. All rights reserved" |
| USGS imagery | "USDA, USGS The National Map: Orthoimagery." and the credit "Map services and data available from U.S. Geological Survey, National Geospatial Program." |
| NASA GIBS | "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)." |
| ETOPO 2022 | "NOAA National Centers for Environmental Information. 2022: ETOPO 2022 15 Arc-Second Global Relief Model. DOI: 10.25921/fd45-gt74" |
| Blue Marble Next Generation | "NASA Earth Observatory" (credit line: Reto Stöckli, NASA Earth Observatory) |
| OpenFreeMap vector tiles (test only) | "© OpenMapTiles" and "© OpenStreetMap contributors", with ODbL notice linked to openstreetmap.org/copyright |
| IGN, PDOK, Trek | None confirmed. Not for the default manifest. |

## Open items before a public launch

- Read the SWISSIMAGE request-limit table and decide whether prefetch needs a limit lower than it.
- Read the licence metadata for IGN orthophotos and PDOK aerial photo, then redo sections 5 and 6.
- Read GIBS layer metadata for the three named layers and confirm the REST pattern and top-level geometry
  of the EPSG:4326 500m matrix set.
- Ask EOX, in writing, about volume and hosting a pinned slice, and settle which year layer is used.
- Ask OpenFreeMap whether tile-to-geometry extraction and prefetch are permitted.
- Resolve Alaska in the USGS service, and re-check that z16 is the maximum.
- Find the Trek terms page, and whether numeric DEM tiles exist, at M2.
- Nothing in this ledger has been tested under load; limits that are stated here are not a promise that a
  provider will tolerate the traffic.
