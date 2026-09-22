//! Read-only value decoders for the Redis console (R8, codec set extended by W3-C).
//!
//! Every decoder is strictly *parse-only*: it never executes or materialises
//! host-language objects. Executable / reference opcodes (pickle
//! `GLOBAL`/`REDUCE`/`INST`/`BUILD`/`OBJ`/`NEWOBJ`, Java `TC_OBJECT` instance
//! construction, …) are rejected outright. Length, element-count and recursion
//! caps are enforced before any allocation so malformed input cannot cause
//! OOM or stack overflow.
//!
//! The accepted codec set is the **same set the value viewer offers** (see
//! `ui/value-editors/valueView/codecs.ts`): `none`, `base64`, the three
//! DEFLATE framings (`gzip` / `zlib` / `raw deflate`) and the four structured
//! formats. Headless callers (Workflow steps, the MCP server) select a codec by
//! the same name the GUI button carries, so a choice can no longer be silently
//! unsupported on the backend side.

mod compress;
mod java;
mod msgpack;
mod php;
mod pickle;

use base64::Engine;
use serde_json::Value as JsonValue;

/// Hard ceiling on the raw bytes we will attempt to decode.
pub(crate) const MAX_INPUT_BYTES: usize = 50 * 1024 * 1024; // 50 MiB

/// Hard ceiling on decompressed output (zip-bomb guard), same budget as input.
pub(crate) const MAX_DECOMPRESSED_BYTES: usize = MAX_INPUT_BYTES;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Codec {
    /// Identity: report the stored bytes as-is (UTF-8 view + base64).
    None,
    /// The stored payload is itself base64 *text*; decode it to bytes.
    Base64,
    /// RFC 1952 gzip container.
    Gzip,
    /// RFC 1950 zlib stream.
    Zlib,
    /// RFC 1951 raw DEFLATE (no container bytes).
    Deflate,
    Msgpack,
    Pickle,
    Php,
    Java,
}

/// What a codec produced: a structured tree, or plain bytes to re-inspect.
enum Decoded {
    Json(JsonValue),
    Bytes(Vec<u8>),
}

impl Codec {
    /// Canonical name, identical to the UI option id and to the `codec` field
    /// echoed back in every response.
    fn name(self) -> &'static str {
        match self {
            Codec::None => "none",
            Codec::Base64 => "base64",
            Codec::Gzip => "gzip",
            Codec::Zlib => "zlib",
            Codec::Deflate => "deflate",
            Codec::Msgpack => "msgpack",
            Codec::Pickle => "pickle",
            Codec::Php => "php",
            Codec::Java => "java",
        }
    }

    fn parse(raw: &str) -> Option<Codec> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "none" | "raw" | "identity" => Some(Codec::None),
            "base64" | "b64" => Some(Codec::Base64),
            "gzip" | "gunzip" => Some(Codec::Gzip),
            // `deflate` alone means *raw* DEFLATE, matching the UI option and
            // `CompressionFormat('deflate-raw')`; the zlib-wrapped stream is
            // only reachable under its own names.
            "zlib" | "zlib-stream" | "deflate-zlib" => Some(Codec::Zlib),
            "deflate" | "raw-deflate" | "deflate-raw" => Some(Codec::Deflate),
            "msgpack" | "mpk" => Some(Codec::Msgpack),
            "pickle" | "python" => Some(Codec::Pickle),
            "php" | "php_serialize" | "phpser" => Some(Codec::Php),
            "java" | "java_serialized" => Some(Codec::Java),
            _ => None,
        }
    }

    /// Codecs whose result is a byte payload rather than a JSON tree.
    fn is_byte_codec(self) -> bool {
        matches!(
            self,
            Codec::None | Codec::Base64 | Codec::Gzip | Codec::Zlib | Codec::Deflate
        )
    }

    fn decode(self, bytes: &[u8]) -> Result<Decoded, String> {
        match self {
            Codec::None => Ok(Decoded::Bytes(bytes.to_vec())),
            Codec::Base64 => {
                // The stored value is base64 *text*, so tolerate the line
                // breaks and wrapping whitespace viewers love to insert.
                let stripped: Vec<u8> = bytes
                    .iter()
                    .copied()
                    .filter(|b| !b.is_ascii_whitespace())
                    .collect();
                base64::engine::general_purpose::STANDARD
                    .decode(&stripped)
                    .map(Decoded::Bytes)
                    .map_err(|e| format!("payload is not base64 text: {e}"))
            }
            Codec::Gzip => decompress(compress::Framing::Gzip, bytes),
            Codec::Zlib => decompress(compress::Framing::Zlib, bytes),
            Codec::Deflate => decompress(compress::Framing::Deflate, bytes),
            Codec::Msgpack => msgpack::decode(bytes).map(Decoded::Json),
            Codec::Pickle => pickle::decode(bytes).map(Decoded::Json),
            Codec::Php => php::decode(bytes).map(Decoded::Json),
            Codec::Java => java::decode(bytes).map(Decoded::Json),
        }
    }
}

fn decompress(framing: compress::Framing, bytes: &[u8]) -> Result<Decoded, String> {
    framing
        .decode(bytes, MAX_DECOMPRESSED_BYTES)
        .map(Decoded::Bytes)
        .map_err(|e| e.message())
}

/// Decode a base64 payload with the given codec.
///
/// Input: `{ codec: <name from [`Codec::parse`], data: "<base64>" }`.
/// Output (structured codec):
/// `{ ok: true, codec, kind: "json", inBytes, bytes, json, data: null, text: null }`.
/// Output (byte codec, i.e. `none`/`base64`/the three framings):
/// `{ ok: true, codec, kind: "bytes", inBytes, bytes, data: "<base64>", text, json }`
/// where `text` is present only when the result is valid UTF-8 and `json` only
/// when it parses as JSON — so a `gzip` step can be followed by a second
/// `decode_value` call on the returned `data` for a chained `gzip`+`msgpack`.
pub(crate) fn decode_value(input: &JsonValue) -> Result<JsonValue, String> {
    let codec = input
        .get("codec")
        .and_then(JsonValue::as_str)
        .and_then(Codec::parse)
        .ok_or_else(|| "unsupported codec".to_string())?;

    let b64 = input
        .get("data")
        .and_then(JsonValue::as_str)
        .ok_or_else(|| "command input requires 'data' (base64)".to_string())?;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("invalid base64 payload: {e}"))?;

    if bytes.is_empty() {
        return Err("empty payload".to_string());
    }
    if bytes.len() > MAX_INPUT_BYTES {
        return Err(format!(
            "payload exceeds {MAX_INPUT_BYTES} byte decode limit"
        ));
    }

    let in_bytes = bytes.len();
    Ok(match codec.decode(&bytes)? {
        Decoded::Json(tree) => json_envelope(codec, in_bytes, &tree),
        Decoded::Bytes(out) => bytes_envelope(codec, in_bytes, &out),
    })
}

fn json_envelope(codec: Codec, in_bytes: usize, tree: &JsonValue) -> JsonValue {
    let text = serde_json::to_string_pretty(tree).unwrap_or_else(|_| "null".to_string());
    serde_json::json!({
        "ok": true,
        "codec": codec.name(),
        "kind": "json",
        "inBytes": in_bytes,
        "bytes": in_bytes,
        "json": text,
        "data": serde_json::Value::Null,
        "text": serde_json::Value::Null,
    })
}

fn bytes_envelope(codec: Codec, in_bytes: usize, out: &[u8]) -> JsonValue {
    let utf8 = std::str::from_utf8(out).ok().map(str::to_string);
    let json = utf8
        .as_ref()
        .and_then(|text| serde_json::from_str::<JsonValue>(text).ok())
        .and_then(|tree| serde_json::to_string_pretty(&tree).ok());
    serde_json::json!({
        "ok": true,
        "codec": codec.name(),
        "kind": "bytes",
        "inBytes": in_bytes,
        "bytes": out.len(),
        "data": base64::engine::general_purpose::STANDARD.encode(out),
        "text": utf8,
        "json": json,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    /// The single seam every `decode_value` test goes through.
    ///
    /// W3-C moves decode failures from a thrown command error to an in-band
    /// `{ ok: false, reason, suggestedCodec }` payload; keeping the carrier
    /// behind this function means the assertions below stay valid across that
    /// change (and a caller that only cares about "did it decode" never
    /// re-asserts on error text).
    fn decode_input(input: JsonValue) -> JsonValue {
        match decode_value(&input) {
            Ok(value) => value,
            Err(err) => serde_json::json!({ "ok": false, "error": err }),
        }
    }

    fn decode(codec: &str, bytes: &[u8]) -> JsonValue {
        let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        decode_input(serde_json::json!({ "codec": codec, "data": b64 }))
    }

    fn decoded(value: &JsonValue) -> bool {
        value["ok"].as_bool().unwrap_or(false)
    }

    #[test]
    fn rejects_unknown_codec_and_oversize() {
        assert!(!decoded(&decode_input(
            serde_json::json!({ "codec": "bson", "data": "AAA=" })
        )));
        assert!(!decoded(&decode_input(
            serde_json::json!({ "codec": "msgpack" })
        )));
        assert!(!decoded(&decode("msgpack", b""))); // empty payload
    }

    #[test]
    fn decode_ok_shape_for_supported_codecs() {
        // msgpack {"a":1}
        let r = decode("msgpack", &[0x81, 0xa1, b'a', 0x01]);
        assert!(decoded(&r));
        assert_eq!(r["ok"], serde_json::json!(true));
        assert!(r["json"].as_str().unwrap().contains("\"a\""));
        assert_eq!(r["codec"], serde_json::json!("msgpack"));
        assert_eq!(r["kind"], serde_json::json!("json"));
    }

    #[test]
    fn every_ui_codec_name_is_accepted_by_the_backend() {
        // Mirrors `CODECS` in ui/value-editors/valueView/codecs.ts — if the UI
        // adds an option the backend must answer for it, not shrug.
        let payload = b"datazen".to_vec();
        let vectors: [(&str, Vec<u8>); 5] = [
            ("none", payload.clone()),
            ("base64", b"ZGF0YXplbg==".to_vec()),
            ("gzip", compress::test_support::gzip(&payload)),
            ("zlib", compress::test_support::zlib(&payload)),
            ("deflate", compress::test_support::raw_deflate(&payload)),
        ];
        for (name, stored) in vectors {
            let r = decode(name, &stored);
            assert!(decoded(&r), "codec {name} must decode, got: {r}");
            assert_eq!(r["codec"], serde_json::json!(name));
            assert_eq!(r["kind"], serde_json::json!("bytes"));
            assert_eq!(r["bytes"], serde_json::json!(payload.len()));
            assert_eq!(
                r["text"],
                serde_json::json!("datazen"),
                "codec {name} must surface UTF-8 text"
            );
            let round = base64::engine::general_purpose::STANDARD
                .decode(r["data"].as_str().unwrap())
                .unwrap();
            assert_eq!(round, payload, "codec {name} base64 round trip");
        }
    }

    #[test]
    fn byte_codecs_expose_a_chainable_payload_and_json_when_relevant() {
        // gzip(JSON) => both `data` (for a second decode_value call) and the
        // already-parsed pretty `json` for the viewer.
        let json = br#"{"a":1,"b":[1,2,3]}"#;
        let wrapped = compress::test_support::gzip(json);
        let r = decode("gzip", &wrapped);
        assert!(decoded(&r));
        assert_eq!(r["kind"], serde_json::json!("bytes"));
        assert_eq!(r["inBytes"], serde_json::json!(wrapped.len()));
        assert_eq!(r["bytes"], serde_json::json!(json.len()));
        assert!(r["json"].as_str().unwrap().contains("\"b\""));

        // Non-UTF-8 expansion: `text`/`json` go null, `data` still lossless.
        let binary = [0u8, 0x1f, 0x8b, 0xff, 0xfe];
        let r = decode("deflate", &compress::test_support::raw_deflate(&binary));
        assert!(decoded(&r));
        assert_eq!(r["text"], serde_json::Value::Null);
        assert_eq!(r["json"], serde_json::Value::Null);
        let round = base64::engine::general_purpose::STANDARD
            .decode(r["data"].as_str().unwrap())
            .unwrap();
        assert_eq!(round, binary);
    }

    #[test]
    fn zlib_and_deflate_are_separate_choices() {
        let payload = b"framing matters".to_vec();
        let zipped = compress::test_support::zlib(&payload);
        let raw = compress::test_support::raw_deflate(&payload);
        // Selecting the wrong framing must fail, not "helpfully" succeed.
        assert!(!decoded(&decode("deflate", &zipped)));
        assert!(!decoded(&decode("zlib", &raw)));
        assert!(decoded(&decode("zlib", &zipped)));
        assert!(decoded(&decode("deflate", &raw)));
    }

    #[test]
    fn gzip_payload_is_not_accepted_as_zlib_or_the_other_way_round() {
        // Guards the framing split end to end through the command shape.
        let payload = br#"{"cached":true}"#;
        let gz = compress::test_support::gzip(payload);
        assert!(decoded(&decode("gzip", &gz)));
        assert!(!decoded(&decode("zlib", &gz)));
    }

    #[test]
    fn aliases_map_onto_the_same_codec() {
        assert_eq!(Codec::parse("ZLib"), Some(Codec::Zlib));
        assert_eq!(Codec::parse("  deflate-raw "), Some(Codec::Deflate));
        assert_eq!(Codec::parse("b64"), Some(Codec::Base64));
        assert_eq!(Codec::parse("identity"), Some(Codec::None));
        assert_eq!(Codec::parse("mpk"), Some(Codec::Msgpack));
        assert_eq!(Codec::parse("protobuf"), None);
        assert!(Codec::None.is_byte_codec());
        assert!(!Codec::Msgpack.is_byte_codec());
    }
}
