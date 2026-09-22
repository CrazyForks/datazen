//! DEFLATE-family decompression backends for the Redis value viewer (W3-C).
//!
//! Three *framings* share one DEFLATE core and are **not** interchangeable:
//!
//! * [`Framing::Gzip`] — RFC 1952: 10-byte `1f 8b` header, optional FNAME/
//!   FCOMMENT/EXTRA fields, CRC32 + ISIZE trailer.
//! * [`Framing::Zlib`] — RFC 1950: 2-byte `CMF/FLG` header (`CM == 8`,
//!   `(CMF<<8|FLG) % 31 == 0`) plus an Adler-32 trailer.
//! * [`Framing::Deflate`] — RFC 1951 *raw* DEFLATE: no header, no trailer.
//!
//! Each framing is decoded by its own decoder so a payload wrapped in one
//! format can never be "rescued" by silently trying another: that is what makes
//! `Zlib` vs `Deflate` separately selectable in the UI, and it is why
//! [`sniff_framing`] exists — the detected framing becomes the `suggestedCodec`
//! retry hint instead of a guess baked into the decoder.
//!
//! Decompression output is capped by the caller-supplied `max_output`
//! (zip-bomb guard): the reader is wrapped in [`Read::take`] so a 4-byte
//! payload can never materialise an unbounded allocation.

use std::io::Read;

use flate2::read::{DeflateDecoder, GzDecoder, ZlibDecoder};

/// One concrete DEFLATE wiring.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Framing {
    /// RFC 1952 gzip container (`1f 8b` magic).
    Gzip,
    /// RFC 1950 zlib stream (`78 *` header with the %31 header check).
    Zlib,
    /// RFC 1951 raw DEFLATE bit stream, no container bytes at all.
    Deflate,
}

/// Why a framing rejected the payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DecompressFailure {
    /// Not a stream of this framing (bad header, corrupt or truncated data).
    Failed(String),
    /// The stream is well formed but its expansion exceeds the caller's cap.
    /// Carries the number of bytes produced before the cap tripped.
    TooLarge(usize),
}

impl DecompressFailure {
    pub(crate) fn message(&self) -> String {
        match self {
            DecompressFailure::Failed(reason) => reason.clone(),
            DecompressFailure::TooLarge(produced) => {
                format!("decompressed output exceeded the cap after {produced} bytes")
            }
        }
    }
}

impl Framing {
    /// Canonical wire name — the exact string the UI selects with.
    pub(crate) fn name(self) -> &'static str {
        match self {
            Framing::Gzip => "gzip",
            Framing::Zlib => "zlib",
            Framing::Deflate => "deflate",
        }
    }

    /// Decode exactly this framing. Never falls back to another framing.
    pub(crate) fn decode(
        self,
        bytes: &[u8],
        max_output: usize,
    ) -> Result<Vec<u8>, DecompressFailure> {
        let mut out = Vec::new();
        // Read one byte past the cap so "exactly at the cap" stays accepted
        // while any larger expansion is detectable after the read.
        let limit = max_output.saturating_add(1) as u64;
        let read = match self {
            Framing::Gzip => {
                let mut reader = GzDecoder::new(bytes).take(limit);
                reader.read_to_end(&mut out)
            }
            Framing::Zlib => {
                let mut reader = ZlibDecoder::new(bytes).take(limit);
                reader.read_to_end(&mut out)
            }
            Framing::Deflate => {
                let mut reader = DeflateDecoder::new(bytes).take(limit);
                reader.read_to_end(&mut out)
            }
        };
        match read {
            Ok(_) if out.len() > max_output => Err(DecompressFailure::TooLarge(out.len())),
            Ok(_) => Ok(out),
            Err(err) => Err(DecompressFailure::Failed(err.to_string())),
        }
    }
}

/// RFC 1950 header check: `CM == 8` and `(CMF << 8 | FLG) % 31 == 0`.
fn looks_like_zlib_header(bytes: &[u8]) -> bool {
    if bytes.len() < 2 {
        return false;
    }
    let cmf = bytes[0];
    let flg = bytes[1];
    (cmf & 0x0f) == 8 && (cmf >> 4) <= 7 && (u16::from(cmf) * 256 + u16::from(flg)) % 31 == 0
}

/// Identify a container from its magic bytes only.
///
/// Returns [`None`] for raw DEFLATE, which by definition carries no header: the
/// caller treats that as "no positive detection", never as a rejection.
pub(crate) fn sniff_framing(bytes: &[u8]) -> Option<Framing> {
    if bytes.len() < 2 {
        return None;
    }
    if bytes[0] == 0x1f && bytes[1] == 0x8b {
        return Some(Framing::Gzip);
    }
    if looks_like_zlib_header(bytes) {
        return Some(Framing::Zlib);
    }
    None
}

/// Test-only encoders, shared with the sibling decoder tests so every framing
/// is produced by a real encoder instead of hand-written bytes.
#[cfg(test)]
pub(crate) mod test_support {
    use flate2::write::{DeflateEncoder, GzEncoder, ZlibEncoder};
    use flate2::Compression;
    use std::io::Write;

    pub(crate) fn gzip(payload: &[u8]) -> Vec<u8> {
        let mut e = GzEncoder::new(Vec::new(), Compression::default());
        e.write_all(payload).unwrap();
        e.finish().unwrap()
    }

    pub(crate) fn zlib(payload: &[u8]) -> Vec<u8> {
        let mut e = ZlibEncoder::new(Vec::new(), Compression::default());
        e.write_all(payload).unwrap();
        e.finish().unwrap()
    }

    pub(crate) fn raw_deflate(payload: &[u8]) -> Vec<u8> {
        let mut e = DeflateEncoder::new(Vec::new(), Compression::default());
        e.write_all(payload).unwrap();
        e.finish().unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{gzip, raw_deflate, zlib};
    use super::*;

    const CAP: usize = 4 * 1024 * 1024;

    #[test]
    fn every_framing_round_trips_its_own_container() {
        let payload = b"redis value that compresses redis redis redis".to_vec();
        for (framing, wrapped) in [
            (Framing::Gzip, gzip(&payload)),
            (Framing::Zlib, zlib(&payload)),
            (Framing::Deflate, raw_deflate(&payload)),
        ] {
            let out = framing.decode(&wrapped, CAP).unwrap_or_else(|e| {
                panic!("{:?} rejected its own container: {}", framing, e.message())
            });
            assert_eq!(out, payload);
        }
    }

    #[test]
    fn zlib_stream_is_not_raw_deflate_and_vice_versa() {
        let payload = b"framing must not be guessed".to_vec();
        let zipped = zlib(&payload);
        let raw = raw_deflate(&payload);
        // `78 9c` trips the zlib header check, so raw DEFLATE cannot masquerade
        // as a zlib stream, and a zlib stream is rejected by the raw decoder
        // (its leading bytes are not a valid DEFLATE block for flate2).
        assert!(matches!(
            Framing::Zlib.decode(&raw, CAP),
            Err(DecompressFailure::Failed(_))
        ));
        assert!(matches!(
            Framing::Deflate.decode(&zipped, CAP),
            Err(DecompressFailure::Failed(_))
        ));
        assert!(Framing::Zlib.decode(&zipped, CAP).is_ok());
        assert!(Framing::Deflate.decode(&raw, CAP).is_ok());
    }

    #[test]
    fn gzip_and_zlib_headers_are_distinguished_not_merged() {
        let payload = b"two different headers".to_vec();
        let gz = gzip(&payload);
        let zl = zlib(&payload);
        assert_eq!(gz[0], 0x1f);
        assert_eq!(gz[1], 0x8b);
        assert_eq!(zl[0], 0x78);
        assert_ne!(zl[1], 0x8b);
        assert!(matches!(
            Framing::Gzip.decode(&zl, CAP),
            Err(DecompressFailure::Failed(_))
        ));
        assert!(matches!(
            Framing::Zlib.decode(&gz, CAP),
            Err(DecompressFailure::Failed(_))
        ));
    }

    #[test]
    fn sniff_reads_the_container_without_decoding_it() {
        let payload = b"sniff me".to_vec();
        assert_eq!(sniff_framing(&gzip(&payload)), Some(Framing::Gzip));
        assert_eq!(sniff_framing(&zlib(&payload)), Some(Framing::Zlib));
        // Raw DEFLATE carries no magic: absence of a hit is not a rejection.
        assert_eq!(sniff_framing(&raw_deflate(&payload)), None);
        assert_eq!(sniff_framing(b""), None);
        assert_eq!(sniff_framing(b"\x1f"), None);
        // `78` followed by a byte that fails the %31 check is not zlib.
        assert_eq!(sniff_framing(b"\x78\x02rest"), None);
    }

    #[test]
    fn expansion_beyond_the_cap_reports_too_large_instead_of_allocating() {
        let bomb = gzip(&vec![b'0'; 200_000]);
        let err = Framing::Gzip
            .decode(&bomb, 1024)
            .expect_err("cap must trip");
        assert!(matches!(err, DecompressFailure::TooLarge(_)));
        // The very same payload is fine with a generous cap.
        assert_eq!(
            Framing::Gzip.decode(&bomb, CAP).ok().map(|v| v.len()),
            Some(200_000)
        );
    }

    #[test]
    fn truncated_container_is_an_error_not_a_short_success() {
        let mut gz = gzip(b"truncation must be visible to the caller");
        let cut = gz.len() - 4;
        gz.truncate(cut);
        assert!(matches!(
            Framing::Gzip.decode(&gz, CAP),
            Err(DecompressFailure::Failed(_))
        ));
    }

    #[test]
    fn arbitrary_bytes_are_rejected_rather_than_yielding_garbage() {
        let out = Framing::Gzip.decode(b"plain text, not compressed at all", CAP);
        assert!(matches!(out, Err(DecompressFailure::Failed(_))));
    }
}
