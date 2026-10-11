# Changelog

## 0.3.4

- Open automations and scripts in a dedicated flow view with the automation first, alternative triggers, condition gates, and numbered actions in YAML order.
- Preserve if/else, first-match choices, parallel branches, repeats, waits, delays, disabled steps, and stop behavior without inventing a linear order.
- Expand direct script calls in place with recursion and nesting guards; show target area/device context beside the sequence.
- Keep dynamic and unsupported steps visible, omit templates and arbitrary action data, and bound flow parsing and context sizes.
- Show unordered reference groups when configuration is unavailable or ambiguous, including Sandbox and blueprint automations.

## 0.3.3

- Replace the default Areas flowchart with compact device containers holding their visible entities.
- Remove ownership lines in Areas and show other connections on selection, with an option to show all references.
- Repack filtered entities before layout to eliminate automatic gaps and replace old Areas coordinates automatically.
- Keep direction controls in Relationships and route reverse ownership edges from the correct handles.
- Preserve explicit area overrides, nested group dragging, and all source relationships in the Inspector.

## 0.3.2

- Organize the Areas view into device families, with entities beside or below their device in both layout directions.
- Keep unassigned device families together and honor explicit entity area overrides and saved manual positions.
- Add browser-saved entity visibility controls for whole domains and device classes, including battery sensors and firmware updates.
- Apply visibility choices across both views, search, and relationship inspection without deleting source data.

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
