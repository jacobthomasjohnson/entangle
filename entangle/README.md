# Entangle

A Home Assistant entity explorer with read-only **Live** mode and an editable, isolated **Sandbox**. Both modes use the same React Flow graph, search, inspector and navigation. Fastify holds Home Assistant credentials server-side. No database, polling, analytics or control service calls.

## Local use

Requires Node.js 22.12+ (Node 24 recommended).

```powershell
npm ci
npm run build
npm start
```

Open http://127.0.0.1:8099. Live opens by default and connects automatically. Sandbox remains available without credentials through the mode selector. For local Live mode, copy `.env.example` to `.env`, set `HA_URL` and `HA_TOKEN` (a Home Assistant long-lived access token), and restart the server. Optionally set `HA_CONFIG_DIR` to the directory containing your real `configuration.yaml`. Without it, registry relationships still work. For frontend development run `npm run server` and `npm run dev` in separate terminals; open the Vite URL. Production runs one server process.

## Sandbox

Live is the default landing mode and loads a read-only snapshot automatically. Sandbox is available through the mode selector and is clearly labeled as virtual practice data. While Sandbox is selected, its edits and navigation make no Home Assistant API requests. Failed Live connections show an error rather than substituting sandbox data.

- Use **Add Node** to create entities, devices, areas, automations or scripts. The shared inspector edits IDs, display names, descriptions and relevant properties. Entity nodes also have an editable `entity_id`, state and unit; devices have manufacturer/model fields. Use **Save changes** to apply edits.
- Drag from a source node's right handle to a target's left handle. Only the supported type pairs are accepted; automation-to-entity connections offer trigger, condition or control choices. Different relationship types between the same pair are supported; exact duplicates, self-links and missing targets are rejected.
- Select an edge to delete it, or remove connections from a node's inspector. Deleting a node removes its edges. Renaming a node updates references; changing type requires removing incompatible connections first.
- Drag nodes to arrange them. **Reset Layout** uses Dagre; **Fit view** adjusts the viewport. Edits preserve existing positions and viewport. Selecting a search result shows immediate neighbors, with one extra level available; **Show all** returns to the sandbox workspace. Rendering stays capped at 180 nodes, including imported datasets.
- **Sandbox tools** provides Reset Sandbox (deterministic starter graph), Clear / start empty, and JSON import/export. Reset and Clear replace the current sandbox; export first to retain a copy.
- Version 1 JSON has `version`, `nodes` and `edges`. Nodes use `id`, `kind`, `label`, optional `description`, and relevant properties; entities require `entityId`. Edges use `id`, `source`, `target`, `relationship`. Imports are validated before replacing anything and capped at 5 MB, 2,000 nodes and 10,000 edges.
- Edits persist in this browser's localStorage, including dragged node positions. Invalid/outdated saves show a notice and starter data; the old save remains untouched until the next edit/reset/import. Unavailable or full storage produces an export reminder. Data is per browser origin and is never sent to the server or Home Assistant.

Sandbox does not execute automations, scripts, schedules or device communication. State edits only update the graph and inspector.

## Home Assistant OS installation

Add `https://github.com/jacobthomasjohnson/entangle` under **Settings → Apps → App Store → ⋮ → Repositories**, then install Entangle, Start it and enable Show in sidebar. Supervisor builds the application from this directory, with no separate image publication. No options or manually created token are needed. Initial supported architecture: amd64. Access is through administrator-only Ingress with no host port exposed, and configuration is mounted read-only. Select **Live** to connect automatically. See [DOCS.md](DOCS.md) and the [repository README](../README.md) for exact installation steps and limitations.

## Coverage and behavior

- States and entity/device/area registries are fetched on first entering Live mode and manual refresh. The WebSocket closes after the snapshot; displayed states are not live.
- Read commands are allowlisted. Unsupported or unauthorized registry commands omit affected relationships and produce notices.
- Explicit registry ownership and direct/inherited area assignments are shown.
- Automations map to real entities only by an exact unique match between YAML `id` and state attribute `id`. Scripts map by YAML key to an existing script entity.
- Direct literal entity IDs, device IDs and area IDs in triggers, conditions, action targets and structural sequences are recognized. Device/area edges describe references to those objects, without guessing entity targets or service execution.
- Supports standard YAML includes, directory includes and packages. Secrets are ignored. Includes must stay within the mounted directory. Parsing is bounded; unreadable configuration omits all YAML relationships with a notice.
- Templates, blueprint expansion, arbitrary service data, UI-only scripts/automations and inferred names are omitted. Graphs are **not exhaustive**. At most 180 nodes render; search displays the first 150 matches, refined by typing.
- Backend returns only normalized metadata, never raw configuration, credentials or arbitrary state attributes. Bind localhost for local use; use HA Ingress for deployment.

## Validation

`npm test` exercises graph normalization, YAML includes, WebSocket authentication/command handling, ingress/assets/API routing, sandbox relationship validation, node editing/deletion and versioned persistence/import/export using synthetic test fixtures. `npm run build` validates the frontend bundle. Docker build and container HTTP startup are also checked locally. Browser interaction testing is unavailable when no browser is connected. A real HA connection, Supervisor authentication, registry permissions and HA OS Ingress installation still require testing against your running Home Assistant environment.

API references: [WebSocket API](https://developers.home-assistant.io/docs/api/websocket/), [Supervisor communication](https://developers.home-assistant.io/docs/apps/communication/), [App configuration](https://developers.home-assistant.io/docs/apps/configuration/). Registry command implementations: [entities](https://github.com/home-assistant/core/blob/dev/homeassistant/components/config/entity_registry.py), [devices](https://github.com/home-assistant/core/blob/dev/homeassistant/components/config/device_registry.py), [areas](https://github.com/home-assistant/core/blob/dev/homeassistant/components/config/area_registry.py).

## Graph layout and navigation

Live and Sandbox nodes can be dragged, with pan and zoom available in both modes. Live manipulation changes browser preferences only; it never edits Home Assistant. Positions are keyed by stable node IDs in separate Live/Sandbox storage. Drag completion saves positions, while selecting or expanding preserves existing positions. Missing nodes are ignored. **Reset Layout** clears positions for the visible graph and calculates a fresh Dagre layout. The Relationships view offers left-to-right and top-to-bottom layouts; saved positions remain pinned until reset. Areas uses compact device containers instead of a flow direction. Replacing a Sandbox clears its separate layout preferences.

Domain icons and restrained colors are shared by the graph, sidebar, inspector and domain filters. Available device classes refine sensor and binary sensor icons. Select multiple domains in the sidebar and combine them with name/ID search; counts include all matches, while the list still renders at most 150 rows. **Clear Filters** clears search and selected domains. Domain choices persist locally.

Selecting nodes highlights adjacent relationships and dims unrelated elements. Relationship colors and dash patterns distinguish ownership, triggers, conditions and actions; hover or select an edge for its label, and select it for complete source/target details. Technical entity IDs remain in the inspector.

### Diagnostic entities

**Hide diagnostic entities** is enabled by default beside the sidebar domain filters and saved as a browser preference. Only entity registry `entity_category: diagnostic` marks Live entities as diagnostic; configuration and uncategorized entities remain visible. The preference filters search results and graph nodes together, hiding their incident edges without changing source data or adding replacement relationships. Counts reflect visible search results and show how many matching diagnostics are hidden. Toggle it off to restore nodes, relationships and their existing coordinates without layout or API requests. Hidden selections clear while the explored graph remains open.

Sandbox entity editors offer Uncategorized, Diagnostic and Configuration categories. Optional `entity_category` survives JSON import/export and browser persistence; existing version 1 datasets remain compatible. Filtering never deletes Sandbox content.

### Hide entity types

Expand **Hide entity types** in the sidebar to hide entire entity domains (for example, updates or buttons), or a domain's device class (for example, battery sensors without hiding temperature sensors). Checked options hide matching entities across all devices in both views and modes, including search and incident relationships. Devices and areas remain visible. **Show all entity types** clears these choices; diagnostic hiding remains a separate preference. Choices persist in this browser. Filtering preserves source data, and hidden selections clear. Relationships preserves coordinates; Areas repacks visible entities to close gaps, while honoring positions manually saved in its new layout.

### Appearance

Open **Settings ? Appearance** to customize the palette (including node and relationship colors), font size, corner roundness, and spacing. Changes apply immediately to Live and Sandbox and persist in the current browser. Reset individual colors or restore the default appearance. These preferences are local to the browser, rather than shared through Home Assistant.

### Area and relationship views

The **View type** selector offers **Areas** (the default overview), **Relationships**, and **Automation flow**. Areas uses compact groups; Relationships offers left-to-right and top-to-bottom layouts. Live Areas opens an overview without requiring an entity selection; search includes areas, and selecting an area prioritizes its members.

Areas appear as labeled containers around their devices and entities. Explicit entity area assignments override the device area. Sandbox membership comes from `contains` and `assigned to`, with `provides` used to inherit a device's area. Conflicting explicit sandbox assignments remain outside until resolved. Unassigned nodes and automations/scripts without an area stay outside; selecting a node or group shows its other references, including cross-area references. **Show all connections** displays all non-ownership references. Ownership and membership edges remain in the underlying graph and Inspector, while containment replaces their chart lines.

The Areas layout places each device's visible entities inside a labeled device container, arranging device containers and other nodes in compact rows inside the area. Devices without an area use the same containers outside rooms. Entities with explicit assignments to a different room stay in that room; missing or ambiguous ownership does not create a device group. Entity visibility filters run before layout, so hidden entities leave no automatic empty slots. Selecting a device or area shows references for its nested entities.

Drag an area or device by its heading to move the whole group, or reposition entities within their device. Area positions save separately for each mode, with a new storage key that automatically replaces the old flowchart arrangement. Switching views preserves the relationship graph's positions. Views are limited to 180 source nodes and show a notice when truncated; focus an area or entity to explore further. In Sandbox, use Relationships to draw or inspect ownership connections; the Inspector still lists all visible source relationships in either view.

### Automation and script flows

Selecting an automation or script in search or on the chart opens **Automation flow**. The automation appears at the top, followed by alternative triggers, condition gates, and numbered actions in configured YAML order. Scripts start directly with their sequence. Device and area context appears beside target references instead of driving the action layout. Target buttons open their object in the explorer; **Show all** returns to Areas.

If/else and first-match `choose` branches are shown separately, parallel branches sit side by side, and repeats retain their before/after condition checks. Delays, waits, timeout behavior, condition actions, disabled steps, and stops remain explicit. Direct `script.name` calls can expand their sequence in place; recursive calls stop expansion and nested expansion is limited to four flow levels. `script.turn_on` is labeled as starting scripts without waiting. Multiple actions referring to the same entity remain separate steps.

Flows describe configuration, never a live execution trace or guaranteed runtime path. Only uniquely mapped, accessible YAML configurations produce an ordered flow. Blueprints, ambiguous mappings, and missing configuration show **References only** with unordered trigger/condition/action groups. Sandbox relationships also lack an executable sequence, so they use this fallback. Templates and arbitrary service data, notification contents, variable values, and secrets are not returned. Dynamic and unsupported steps remain as labeled placeholders; their behavior is not inferred.

Flow parsing is limited to 160 steps and 12 nested levels per configuration, 32 target references per step, and 180 context objects per requested view, with notices for omissions. Visibility filters hide target chips without removing configured steps or changing their order. Flow requires no additional Home Assistant commands, polling, or service execution. The implementation follows Home Assistant's [script building blocks](https://www.home-assistant.io/docs/scripts/) and [automation triggers](https://www.home-assistant.io/docs/automation/trigger/).

### App branding

The supplied Entangle SVG is used in the web UI and favicon, with PNG versions for the Home Assistant App Store and app details. The exact sidebar logo requires a custom frontend icon module; see [logo and sidebar setup](DOCS.md#entangle-logo-and-home-assistant-sidebar).
