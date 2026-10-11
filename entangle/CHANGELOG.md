# Changelog

## 0.3.1

- Add Settings ? Appearance with browser-saved colors, font size, corner roundness, and spacing controls.
- Add area containers and a Live overview, with selectable Areas and Relationships views and both layout directions.
- Preserve explicit area assignments, inherited device membership, cross-area references, and separate saved view positions.
- Add Entangle store icons, app header branding, and a favicon from the supplied SVG.
- Include an optional Home Assistant custom icon module and sidebar setup instructions.

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
