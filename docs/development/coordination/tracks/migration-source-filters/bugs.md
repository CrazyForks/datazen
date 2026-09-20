# Source filter track bugs

No unresolved correctness defects are known in the implemented Transfer filter path.

The driver API default for parameterized streaming delegates to the existing materializing `query_with_params` implementation when a driver has no wire-level override. This preserves correctness and typed binding; drivers that need bounded filtered scans should override `query_stream_with_params` with a native streaming implementation as part of the bounded-snapshot wave.
