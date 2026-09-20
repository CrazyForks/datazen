# Data Sync task persistence defects

## Closed in this track

- Legacy task files persisted process-local database session ids. After restart, conflict checking could pass that stale id to `get_session`, causing a lookup failure or an unsafe assumption about the endpoint. The store now drops those ids and the command resolves from stable connection ids.
- Legacy offset/continue fields looked resumable even though no durable source snapshot, target checkpoint, or idempotent write contract was stored. They now become explicit interrupted/unknown state and require a fresh run.

## Remaining limitations

- There is no durable row-level checkpoint/resume engine in this track. A user must compare and run again from the beginning after interruption.
- The persisted task format stores optional catalog/schema identity but does not create a dedicated profile/run-history model. That remains a later parity wave.
- Conflict checking resolves and validates both endpoints, but it only counts source rows for the incomplete tables, preserving the existing IPC result shape.
