# Entangle installation and usage

Install from the custom repository `https://github.com/jacobthomasjohnson/entangle` using **Settings → Apps → App Store → ⋮ → Repositories**. After installation, Start the App, enable **Show in sidebar**, and open Entangle. Access is administrator-only for this MVP. No App configuration values are required.

The repository must contain the published files and be cloneable by Supervisor. The ordinary URL-only setup assumes a public repository; a private repository requires separate Git access on Supervisor. This is separate from the App's automatic Home Assistant API authentication, which never requires a manual Core token.

Select **Live** to connect to this Home Assistant instance automatically. Search for an entity, select it, inspect its current state and immediate connections, and optionally expand one more level. Use **Refresh** to load a new snapshot or reconnect. Connection failures show errors and never replace real data with sandbox fixtures.

The backend authenticates the Supervisor WebSocket proxy at `ws://supervisor/core/websocket` using the Supervisor token inside the authentication frame. Tokens stay server-side and are never included in startup logs, frontend assets or API responses. No REST requests or browser-to-Home-Assistant WebSockets are needed.

Registry relationships include entity/device ownership and direct/inherited area assignments. `/homeassistant` mounts Home Assistant's configuration directory read-only. Accessible YAML includes/packages supply literal trigger, condition, action and direct script-call references; UI-managed automations saved in included `automations.yaml` are included where their IDs map uniquely to a real entity. Templates, blueprint expansion, dynamic targets, missing includes and configuration outside the mount may prevent analysis. Check the graph's **Coverage** notice; relationships are not exhaustive. No states, services or configuration files are modified.

**Sandbox** reuses the same interface for virtual node/relationship editing. Sandbox tools provides Reset, Clear and validated JSON import/export. Data persists in this browser's localStorage, not on the server; export before clearing browser storage or changing Home Assistant's origin. Sandbox does not run automations or communicate with Home Assistant.

## Troubleshooting

- **App missing in the store:** verify that `repository.yaml` is at the GitHub repository root, `entangle/config.yaml` and the application source were pushed together, and the store has reloaded. Initial architecture support is amd64 only.
- **Install/build fails:** check App logs and Supervisor logs. Building requires access to Docker Hub and the npm registry. The image is built from `entangle/`, not the repository root.
- **Web UI unavailable:** Start the App, check its logs, and use Open Web UI through Home Assistant. No public network port is exposed. Direct requests from other container peers are intentionally denied. If the App is stopped or Core/Ingress is restarting, start it again and reopen the UI.
- **Live authentication or connection failure:** no manually supplied token is needed. Check that `homeassistant_api: true` is present in the installed manifest and Core is running. Use Refresh, or reopen Live Mode after five seconds. Unsupported registry permissions produce coverage notices.
- **Missing automation/script edges:** verify configuration is readable under `/homeassistant` and referenced YAML is valid. IDs must map uniquely to current entities. Unsupported or unreadable files are reported, not guessed.
- **Sandbox storage warning:** browser storage is blocked or full, or a saved schema is invalid/outdated. Export current data. Reset/import replaces the saved sandbox; otherwise invalid saved data remains untouched until an edit.

The backend logs startup mode and snapshot counts without credentials. It runs one Fastify process on container port 8099, accepts only the Supervisor Ingress TCP peer (`172.30.32.2`, including IPv4-mapped IPv6), ignores forwarded headers for access checks, and cancels active Home Assistant requests on shutdown. Ingress provides authentication and forwards its base path for relative assets and API requests. The app has no client routes or browser WebSocket requiring additional proxy configuration.

For local development, use the instructions in the [repository README](../README.md); `HA_URL`, `HA_TOKEN` and optionally `HA_CONFIG_DIR` apply only outside Supervisor. The standalone container can run locally without enabling the App-only `ENTANGLE_INGRESS_ONLY` environment variable.
