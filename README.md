# Entangle

[![test](https://github.com/jacobthomasjohnson/entangle/actions/workflows/test.yml/badge.svg)](https://github.com/jacobthomasjohnson/entangle/actions/workflows/test.yml)

In a large Home Assistant setup it gets hard to answer simple questions: which automations touch this light, what breaks if I remove this device, which scripts run when this sensor changes. Entangle answers them by mapping how entities, devices, areas, automations and scripts connect, and drawing those relationships as an interactive graph and ordered automation flows.

It connects to Home Assistant over the WebSocket API and never writes state, calls services or edits configuration. A separate **Sandbox Mode** lets you build and rearrange a virtual setup without touching a real system.

**Stack:** Node.js and Fastify backend, React and Vite frontend, React Flow with Dagre for graph layout, Node's built-in test runner (47 tests), packaged as a Docker-based Home Assistant App. Initial target: amd64 Home Assistant OS.

<!-- Screenshot: add docs/screenshot.png showing the graph view, then uncomment the line below. -->
<!-- ![Entangle graph view](docs/screenshot.png) -->

## How it works

- **Live Mode** authenticates to `ws://supervisor/core/websocket` with the Supervisor token and requests only read commands (`get_states` and the entity, device and area registries). Configuration YAML is parsed from a read-only mount to find trigger, condition, action and script references.
- **Graph** normalizes those reads into nodes and edges, then lays them out by device family and area, with filters for entity visibility and diagnostics.
- **Sandbox Mode** reuses the same interface on virtual data stored in the browser, with validated JSON import and export.
- **Security**: tokens stay server-side, HTTP access is limited to the Supervisor Ingress peer, and no host port is exposed.

## Install in Home Assistant

1. Use the public repository **https://github.com/jacobthomasjohnson/entangle**. The default branch contains `repository.yaml` at the root and the complete application inside `entangle/`, so Supervisor can clone and build it without Git credentials.
2. In Home Assistant, open **Settings → Apps → App Store → ⋮ → Repositories** (older versions call Apps **Add-ons**).
3. Add `https://github.com/jacobthomasjohnson/entangle` and close the dialog. Reload the store if necessary.
4. Find **Entangle** under **Entangle Home Assistant Apps**, then select **Install**. Supervisor builds the Docker image from this repository; no published container image is needed.
5. Select **Start** and enable **Show in sidebar**. Start on boot is enabled by default. Open **Web UI** or the **Entangle** sidebar entry as an administrator.
6. Select **Live** in Entangle's header. The backend connects to the hosting Home Assistant using the Supervisor-provided token. No URL, long-lived token or other App settings are required.

The App enables Home Assistant API access and a read-only configuration mount. It has no host port mapping; HTTP access is restricted to the Supervisor Ingress peer. Configuration parsing never writes files or calls services. See [App documentation](entangle/DOCS.md) for coverage and troubleshooting.

## Local development

```powershell
cd entangle
npm ci
npm run build
npm test
npm start
```

Open http://127.0.0.1:8099. Live opens by default and connects automatically. Select Sandbox for an isolated practice workspace without Home Assistant credentials. For local Live Mode, copy `.env.example` to `.env`, set `HA_URL` and `HA_TOKEN`, and restart. Optional `HA_CONFIG_DIR` points at the directory containing `configuration.yaml`. Run `npm run server` and `npm run dev` in separate terminals for Vite development.

From the repository root, build the exact Supervisor context with:

```powershell
docker build --platform linux/amd64 --build-arg BUILD_ARCH=amd64 --build-arg BUILD_VERSION=0.3.5 -t entangle:local ./entangle
```

The container startup command directly runs `node server/index.js` as its only service. No `run.sh`, init system or legacy `build.yaml` is required. Both Docker stages use an explicit `node:24-alpine` base. The App manifest, package and image labels all use version 0.3.5.

## Repository structure

```text
.
├── .github/workflows/test.yml
├── .gitignore
├── README.md
├── repository.yaml
└── entangle/
    ├── .dockerignore
    ├── .env.example
    ├── CHANGELOG.md
    ├── DOCS.md
    ├── README.md
    ├── config.yaml
    ├── Dockerfile
    ├── index.html
    ├── package.json
    ├── package-lock.json
    ├── vite.config.js
    ├── ha/                  # optional sidebar icon module
    ├── server/              # Fastify app, HA WebSocket client, YAML and graph analysis
    │   ├── automation-flow.js
    │   ├── configuration.js
    │   ├── graph.js
    │   ├── ha.js
    │   └── index.js
    ├── src/                 # React UI: graph, area view, automation flows, sandbox, settings
    └── test/                # node --test suites (47 tests)
```

Generated `entangle/node_modules/`, `entangle/dist/` and private `.env` files are excluded from Git; the Docker build installs dependencies and builds assets itself.

## Integration and validation

The backend uses `ws://supervisor/core/websocket`, authenticates with an `auth` frame containing `access_token: SUPERVISOR_TOKEN`, and requests only `get_states`, `config/entity_registry/list`, `config/device_registry/list`, and `config/area_registry/list`. Unsupported registries produce coverage notices. These reads provide all required registry/state data, so no REST requests are needed. The distinct REST proxy route is `http://supervisor/core/api/`, which would require an HTTP bearer token; it is not treated as the WebSocket route.

Snapshots are fetched on entering Live Mode and manual Refresh. Failed connections can retry on reentering Live after a five-second cooldown, or immediately with Refresh. No background polling runs. Pending WebSocket requests are cancelled during shutdown.

Tests cover Supervisor/local authentication contracts using mock WebSocket servers, read-only command restrictions, Ingress peer access, relative assets/API paths, package metadata/build context, YAML analysis, graph normalization and Sandbox persistence. Local Docker builds and HTTP startup are validated; **a real Home Assistant OS installation, Supervisor-issued token, mounted configuration permissions and Ingress/browser behavior must still be tested on the target VM**.

Official references: [App configuration](https://developers.home-assistant.io/docs/apps/configuration/), [repository structure](https://developers.home-assistant.io/docs/apps/repository/), [Ingress requirements](https://developers.home-assistant.io/docs/apps/presentation/), [Supervisor/Core communication](https://developers.home-assistant.io/docs/apps/communication/), [WebSocket API](https://developers.home-assistant.io/docs/api/websocket/).
