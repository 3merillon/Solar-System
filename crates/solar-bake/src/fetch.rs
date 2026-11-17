//! One explicit, single-file download per source, recorded in a ledger. A re-run whose
//! file matches the ledger checksum does not download again.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::Path, process::Command};

pub struct SourceSpec {
    pub id: &'static str,
    pub url: &'static str,
    pub file: &'static str,
    pub licence_quote: &'static str,
    pub quote_url: &'static str,
    pub credit: &'static str,
    pub note: &'static str,
}

pub const ETOPO: SourceSpec = SourceSpec {
    id: "etopo",
    url: "https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s/60s_surface_elev_gtif/ETOPO_2022_v1_60s_N90W180_surface.tif",
    file: "etopo/ETOPO_2022_v1_60s_N90W180_surface.tif",
    licence_quote: "NOAA waives any potential copyright and related rights in these data worldwide through the Creative Commons Zero 1.0 Universal Public Domain Dedication (CC0-1.0). (Also: \"These data were produced by NOAA and are not subject to copyright protection in the United States.\" Use constraints are warranty disclaimers only.)",
    quote_url: "https://data.noaa.gov/metaview/page?xml=NOAA/NESDIS/NGDC/MGG/DEM//iso/xml/etopo_2022.xml&view=getDataView&header=none",
    credit: "NOAA National Centers for Environmental Information. 2022: ETOPO 2022 15 Arc-Second Global Relief Model. DOI: 10.25921/fd45-gt74",
    note: "ETOPO 2022 v1, 60 arc-second, ice surface elevation (heights above the geoid, metres). Redistribution of a derived coarse product is permitted by CC0.",
};

pub const MARBLE: SourceSpec = SourceSpec {
    id: "marble",
    url: "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/august/world.200408.3x21600x10800.jpg",
    file: "marble/world.200408.3x21600x10800.jpg",
    licence_quote: "Anyone using or republishing Blue Marble: Next Generation please credit \"NASA Earth Observatory.\" (NASA media guidance: NASA content \"generally are not subject to copyright in the United States\"; \"NASA should be acknowledged as the source of the material.\") This is a credit request, not a stated licence.",
    quote_url: "https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/",
    credit: "Blue Marble: Next Generation was produced by Reto Stockli, NASA Earth Observatory (NASA Goddard Space Flight Center). Credit: NASA Earth Observatory.",
    note: "Blue Marble Next Generation, base map (no topography, no bathymetry shading), August 2004, 21600 x 10800 equirectangular JPEG, 500 m/px at full resolution subsampled to 2 km/px. Seasonal snow and sea ice of the month are baked in; no relief shading.",
};

pub fn sha256_file(path: &Path) -> std::io::Result<(String, u64)> {
    let mut f = fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    let mut total = 0u64;
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
        total += n as u64;
    }
    Ok((hex(&h.finalize()), total))
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn fetch_all(dir: &Path) -> Result<(), String> {
    let ledger_path = dir.join("ledger.json");
    let mut ledger: Value = fs::read_to_string(&ledger_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({"sources": {}}));
    for spec in [&ETOPO, &MARBLE] {
        let path = dir.join(spec.file);
        fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        let recorded = ledger["sources"][spec.id]["sha256"]
            .as_str()
            .map(str::to_owned);
        if path.exists() {
            let (sha, bytes) = sha256_file(&path).map_err(|e| e.to_string())?;
            if recorded.as_deref() == Some(sha.as_str()) {
                eprintln!("{}: checksum matches ledger, not downloading", spec.id);
                continue;
            }
            if recorded.is_none() {
                eprintln!("{}: file present, recording it ({bytes} bytes)", spec.id);
                record(&mut ledger, spec, &sha, bytes);
                continue;
            }
            return Err(format!(
                "{}: file differs from the ledger checksum; delete it to re-download",
                spec.id
            ));
        }
        eprintln!("{}: downloading {}", spec.id, spec.url);
        let tmp = path.with_extension("part");
        let status = Command::new("curl")
            .args(["-L", "--fail", "-sS", "-o"])
            .arg(&tmp)
            .arg(spec.url)
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(format!("curl failed for {}", spec.id));
        }
        fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
        let (sha, bytes) = sha256_file(&path).map_err(|e| e.to_string())?;
        record(&mut ledger, spec, &sha, bytes);
    }
    fs::write(&ledger_path, serde_json::to_string_pretty(&ledger).unwrap())
        .map_err(|e| e.to_string())
}

fn record(ledger: &mut Value, spec: &SourceSpec, sha: &str, bytes: u64) {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    ledger["sources"][spec.id] = json!({
        "url": spec.url, "file": spec.file, "sha256": sha, "bytes": bytes,
        "retrieved_unix": secs, "retrieved": date_from_unix(secs),
        "licence_quote": spec.licence_quote, "quote_url": spec.quote_url,
        "credit": spec.credit, "note": spec.note,
    });
}

/// Civil date (UTC) from a Unix time, days-from-civil inverse.
pub fn date_from_unix(secs: u64) -> String {
    let z = (secs / 86400) as i64 + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    format!("{:04}-{:02}-{:02}", if m <= 2 { y + 1 } else { y }, m, d)
}
