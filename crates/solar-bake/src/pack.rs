//! Pack files: one `level-N.bin` per level, plus manifest.json.
//!
//! level file: magic "STPK", u32 count, then per page
//! u8 face, u8 level, u32 x, u32 y, f32 offset, f32 scale, u32 heightBytes, u32 albedoBytes
//! (all little-endian, packed), then the height PNG and the albedo JPEG.
//!
//! Finer levels (4 and up) go in page bundles, one per face and level, `pages/<level>/face-<f>.bin`,
//! read a page at a time with an HTTP byte range, so a level is six files rather than thousands:
//! magic "STPB", u32 version (1), u8 level, u8 face, u16 zero, u32 n (pages per side), then n * n
//! entries of u32 offset, u32 length for page (x, y) at index y * n + x, the offset counted from the
//! start of the file and the length 0 where no page was baked; then the pages in index order, each
//! a one-page level file, so the bytes of one range are exactly what a one-page level file holds.
use crate::{bake::BakedPage, fetch};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use solar_core::pages::PageKey;
use std::{fs, path::Path};

pub const MAGIC: &[u8; 4] = b"STPK";
pub const PAGE_HEADER: usize = 26;
pub const BUNDLE_MAGIC: &[u8; 4] = b"STPB";
pub const BUNDLE_VERSION: u32 = 1;
pub const BUNDLE_HEADER: usize = 16;

/// Where the bundle of one face and level sits in a body pack.
pub fn bundle_path(level: u8, face: u8) -> String {
    format!("pages/{level}/face-{face}.bin")
}

/// Bytes of a bundle's header and index: the first range a reader asks for.
pub fn bundle_index_bytes(level: u8) -> usize {
    let n = 1usize << level;
    BUNDLE_HEADER + 8 * n * n
}

/// `pages[y * n + x]` is the one-page level file of page (x, y), or None where none was baked.
pub fn write_bundle(level: u8, face: u8, pages: &[Option<Vec<u8>>]) -> Result<Vec<u8>, String> {
    let n = 1usize << level;
    if pages.len() != n * n {
        return Err(format!(
            "level {level} has {} pages per face, not {}",
            n * n,
            pages.len()
        ));
    }
    let head = bundle_index_bytes(level);
    let total = head + pages.iter().flatten().map(Vec::len).sum::<usize>();
    if total > u32::MAX as usize {
        return Err(format!("bundle of {total} bytes does not fit u32 offsets"));
    }
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(BUNDLE_MAGIC);
    out.extend_from_slice(&BUNDLE_VERSION.to_le_bytes());
    out.extend_from_slice(&[level, face, 0, 0]);
    out.extend_from_slice(&(n as u32).to_le_bytes());
    let mut at = head;
    for page in pages {
        let len = page.as_ref().map_or(0, Vec::len);
        if page.is_some() && len == 0 {
            return Err("an empty page cannot be told from a missing one".into());
        }
        out.extend_from_slice(&(if len == 0 { 0 } else { at as u32 }).to_le_bytes());
        out.extend_from_slice(&(len as u32).to_le_bytes());
        at += len;
    }
    for page in pages.iter().flatten() {
        out.extend_from_slice(page);
    }
    Ok(out)
}

/// The pages of a bundle as (x, y, bytes of its one-page level file), checked: the header names
/// this face and level, the pages follow the index in order with no gap or trailing bytes, and
/// each is a one-page level file of its own key.
pub type BundlePage<'a> = (u32, u32, &'a [u8]);
pub fn read_bundle(bytes: &[u8], level: u8, face: u8) -> Result<Vec<BundlePage<'_>>, String> {
    let head = bundle_index_bytes(level);
    if bytes.len() < head || &bytes[..4] != BUNDLE_MAGIC {
        return Err("bad bundle magic or truncated index".into());
    }
    let u32_at = |o: usize| u32::from_le_bytes(bytes[o..o + 4].try_into().unwrap());
    let n = 1u32 << level;
    if u32_at(4) != BUNDLE_VERSION || bytes[8] != level || bytes[9] != face || u32_at(12) != n {
        return Err(format!(
            "bundle header is not version {BUNDLE_VERSION}, level {level}, face {face}"
        ));
    }
    let mut at = head;
    let mut pages = Vec::new();
    for i in 0..(n * n) as usize {
        let entry = BUNDLE_HEADER + 8 * i;
        let (offset, len) = (u32_at(entry) as usize, u32_at(entry + 4) as usize);
        if len == 0 {
            if offset != 0 {
                return Err(format!("missing page {i} has offset {offset}"));
            }
            continue;
        }
        if offset != at || offset + len > bytes.len() {
            return Err(format!(
                "page {i} at {offset}+{len} breaks the order (expected {at})"
            ));
        }
        let (x, y) = (i as u32 % n, i as u32 / n);
        let body = &bytes[offset..offset + len];
        let one = read_level(body)?;
        let want = PageKey { face, level, x, y };
        if one.len() != 1 || one[0].key != want {
            return Err(format!("page {i} does not hold page {want:?} alone"));
        }
        pages.push((x, y, body));
        at += len;
    }
    if at != bytes.len() {
        return Err("trailing bytes after the last page".into());
    }
    Ok(pages)
}

/// Bundle the loose page files of a body pack (`pages/<level>/<face>/<x>_<y>.bin`, as bakes before
/// page bundles wrote them) into one bundle per face and level, beside them. Each bundle is read
/// back from disk and every page compared byte for byte with its file. The loose files stay.
/// Returns (level, face, pages, bundle bytes) per bundle written.
pub fn bundle_loose_pages(dir: &Path) -> Result<Vec<(u8, u8, usize, usize)>, String> {
    let mut written = Vec::new();
    for level in 4..=16u8 {
        if !dir.join(format!("pages/{level}")).is_dir() {
            continue;
        }
        let n = 1u32 << level;
        for face in 0..6u8 {
            let mut pages = Vec::with_capacity((n * n) as usize);
            for y in 0..n {
                for x in 0..n {
                    let path = dir.join(format!("pages/{level}/{face}/{x}_{y}.bin"));
                    match fs::read(&path) {
                        Ok(bytes) => {
                            let one = read_level(&bytes)
                                .map_err(|e| format!("{}: {e}", path.display()))?;
                            if one.len() != 1 || one[0].key != (PageKey { face, level, x, y }) {
                                return Err(format!(
                                    "{} does not hold its own page alone",
                                    path.display()
                                ));
                            }
                            pages.push(Some(bytes));
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => pages.push(None),
                        Err(e) => return Err(format!("{}: {e}", path.display())),
                    }
                }
            }
            let count = pages.iter().flatten().count();
            let path = dir.join(bundle_path(level, face));
            write_bundle_file(&path, level, face, &pages)?;
            let back = fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
            let read = read_bundle(&back, level, face)?;
            if read.len() != count
                || !read
                    .iter()
                    .zip(pages.iter().flatten())
                    .all(|(r, o)| r.2 == o.as_slice())
            {
                return Err(format!(
                    "{} does not read back as its page files",
                    path.display()
                ));
            }
            written.push((level, face, count, back.len()));
        }
    }
    Ok(written)
}

/// Write a bundle beside its final name and move it there, so a stopped bake leaves no half file
/// under the name a reader asks for.
pub fn write_bundle_file(
    path: &Path,
    level: u8,
    face: u8,
    pages: &[Option<Vec<u8>>],
) -> Result<(), String> {
    let bundle = write_bundle(level, face, pages)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    let part = path.with_extension("bin.part");
    fs::write(&part, &bundle).map_err(|e| format!("{}: {e}", part.display()))?;
    fs::rename(&part, path).map_err(|e| format!("{}: {e}", path.display()))
}

pub fn write_level(pages: &[&BakedPage]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&(pages.len() as u32).to_le_bytes());
    for p in pages {
        out.push(p.key.face);
        out.push(p.key.level);
        out.extend_from_slice(&p.key.x.to_le_bytes());
        out.extend_from_slice(&p.key.y.to_le_bytes());
        out.extend_from_slice(&p.offset.to_le_bytes());
        out.extend_from_slice(&p.scale.to_le_bytes());
        out.extend_from_slice(&(p.height_png.len() as u32).to_le_bytes());
        out.extend_from_slice(&(p.albedo_jpeg.len() as u32).to_le_bytes());
        out.extend_from_slice(&p.height_png);
        out.extend_from_slice(&p.albedo_jpeg);
    }
    out
}

pub fn read_level(bytes: &[u8]) -> Result<Vec<BakedPage>, String> {
    if bytes.len() < 8 || &bytes[..4] != MAGIC {
        return Err("bad magic".into());
    }
    let count = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let mut at = 8usize;
    let mut pages = Vec::with_capacity(count);
    let u32_at = |b: &[u8], o: usize| u32::from_le_bytes(b[o..o + 4].try_into().unwrap());
    let f32_at = |b: &[u8], o: usize| f32::from_le_bytes(b[o..o + 4].try_into().unwrap());
    for _ in 0..count {
        if at + PAGE_HEADER > bytes.len() {
            return Err("truncated page header".into());
        }
        let h = &bytes[at..at + PAGE_HEADER];
        let (hb, ab) = (u32_at(h, 18) as usize, u32_at(h, 22) as usize);
        let body = at + PAGE_HEADER;
        if body + hb + ab > bytes.len() {
            return Err("truncated page body".into());
        }
        pages.push(BakedPage {
            key: PageKey {
                face: h[0],
                level: h[1],
                x: u32_at(h, 2),
                y: u32_at(h, 6),
            },
            offset: f32_at(h, 10),
            scale: f32_at(h, 14),
            height_png: bytes[body..body + hb].to_vec(),
            albedo_jpeg: bytes[body + hb..body + hb + ab].to_vec(),
        });
        at = body + hb + ab;
    }
    if at != bytes.len() {
        return Err("trailing bytes".into());
    }
    Ok(pages)
}

/// Write level files and the manifest into `dir`. Returns (level, bytes) per level.
pub fn write_pack(
    dir: &Path,
    pages: &[BakedPage],
    attribution: &[&str],
    sources: Value,
    extra: Value,
) -> Result<Vec<(u8, usize)>, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut files = serde_json::Map::new();
    let mut sizes = Vec::new();
    for level in 0..4u8 {
        let sel: Vec<&BakedPage> = pages.iter().filter(|p| p.key.level == level).collect();
        let bytes = write_level(&sel);
        fs::write(dir.join(format!("level-{level}.bin")), &bytes).map_err(|e| e.to_string())?;
        files.insert(
            level.to_string(),
            json!({"bytes": bytes.len(), "sha256": fetch::hex(&Sha256::digest(&bytes)), "pages": sel.len()}),
        );
        sizes.push((level, bytes.len()));
    }
    let manifest = json!({
        "version": "earth-v1",
        "levels": [0, 1, 2, 3],
        "files": files,
        "page_texels": 264,
        "attribution": attribution,
        "sources": sources,
        "bake": extra,
    });
    fs::write(
        dir.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    Ok(sizes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(face: u8, level: u8, x: u32, y: u32) -> Vec<u8> {
        let p = BakedPage {
            key: PageKey { face, level, x, y },
            offset: x as f32,
            scale: 1.0 + y as f32,
            height_png: vec![1, 2, 3, x as u8],
            albedo_jpeg: vec![9; 5 + y as usize],
        };
        write_level(&[&p])
    }

    #[test]
    fn bundle_round_trips_and_keeps_page_bytes() {
        let (level, face) = (2u8, 4u8);
        let pages: Vec<Option<Vec<u8>>> = (0..16u32)
            .map(|i| (i != 5).then(|| page(face, level, i % 4, i / 4)))
            .collect();
        let bundle = write_bundle(level, face, &pages).unwrap();
        assert_eq!(&bundle[..4], BUNDLE_MAGIC);
        let read = read_bundle(&bundle, level, face).unwrap();
        assert_eq!(read.len(), 15);
        for ((x, y, bytes), original) in read.iter().zip(pages.iter().flatten()) {
            assert_eq!(*bytes, original.as_slice());
            assert_eq!(
                read_level(bytes).unwrap()[0].key,
                PageKey {
                    face,
                    level,
                    x: *x,
                    y: *y
                }
            );
        }
        assert!(!read.iter().any(|p| (p.0, p.1) == (1, 1)));
        // The index entry of a missing page is all zero; a reader asks for nothing.
        let entry = BUNDLE_HEADER + 8 * 5;
        assert_eq!(&bundle[entry..entry + 8], &[0; 8]);
    }

    #[test]
    fn bundle_refuses_what_it_does_not_hold() {
        let (level, face) = (1u8, 0u8);
        let pages: Vec<Option<Vec<u8>>> = (0..4u32)
            .map(|i| Some(page(face, level, i % 2, i / 2)))
            .collect();
        let bundle = write_bundle(level, face, &pages).unwrap();
        assert!(read_bundle(&bundle, level, 1).is_err(), "another face");
        assert!(read_bundle(&bundle, 2, face).is_err(), "another level");
        assert!(
            read_bundle(&bundle[..bundle.len() - 1], level, face).is_err(),
            "truncated"
        );
        let mut longer = bundle.clone();
        longer.push(0);
        assert!(read_bundle(&longer, level, face).is_err(), "trailing bytes");
        // A page filed under the wrong key.
        let mut swapped = pages.clone();
        swapped.swap(0, 1);
        let wrong = write_bundle(level, face, &swapped).unwrap();
        assert!(
            read_bundle(&wrong, level, face).is_err(),
            "page under another key"
        );
        assert!(
            write_bundle(level, face, &pages[..3]).is_err(),
            "too few entries"
        );
        assert!(
            write_bundle(level, face, &[Some(vec![]), None, None, None]).is_err(),
            "empty page"
        );
    }
}
