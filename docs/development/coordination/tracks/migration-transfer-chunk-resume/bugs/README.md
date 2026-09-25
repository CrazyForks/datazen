# migration-transfer-chunk-resume Bug Index

- Round 7: no new confirmed defects. Independent R7 retest marks BUG-001 through BUG-005 verified; see `R7_TEST_REPORT_DATA_TRANSFER_CHUNK_RESUME.md` and each BUG file for evidence and limitations.
- BUG-001 is verified for fail-closed exact numeric cursor gating and transactional whole-table fallback. Live adjacent numeric values above 2^53 were not exercised.
- BUG-002 is verified for unknown target transaction metadata (no token) and changed target contract (pre-write rejection and replay prevention).
- BUG-003 is verified by both-direction cancel/resume and source-mutation refusal WDIO journeys.
- BUG-004 and BUG-005 are verified by both-direction acknowledgement-loss WDIO journeys.
