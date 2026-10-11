# Changelog

## 0.3.0

- Package the complete application in a Supervisor-recognized App directory with custom repository metadata.
- Support local amd64 image builds, administrator sidebar access and read-only Home Assistant configuration mounts.
- Restrict App HTTP traffic to Ingress, preserve relative paths and avoid caching the generated base path.
- Validate Supervisor WebSocket authentication separately from REST routing, cancel requests on shutdown and retry failed connections on demand.
- Recognize explicit direct script calls without guessing template targets.
- Preserve editable, browser-persisted Sandbox Mode and read-only Live Mode.

## 0.2.0

- Add isolated Sandbox editing, relationship validation, persistence and JSON import/export.

## 0.1.0

- Initial entity dependency explorer, registry normalization and YAML reference discovery.
