# Nepal administrative boundary import

This document covers the boundary-data layer, verified boundary API, and the hierarchical delivery coverage allow-list. It stores verified administrative polygons and exposes them to the admin coverage map; checkout validation uses the same central engine.

## Source datasets

Bundled files live in `database/data/geo-boundaries/`. `manifest.json` records provider, version, source URL, license, checksum, and known caveats for each dataset.

| Level | Provider dataset | Source | License | Expected master units |
| --- | --- | --- | --- | ---: |
| Province | geoBoundaries ADM1 (2020) | Survey Department of Nepal via HDX | CC BY 3.0 IGO | 7 |
| District | geoBoundaries ADM2 (2006) | Wikimedia Commons | Public Domain | 77 |
| Municipality | geoBoundaries ADM3 (2020) | Open Knowledge Nepal | CC BY 4.0 | 753 |

Full-resolution GeoJSON is used for validation and serviceability. The `*_simplified.geojson` files are stored as `display_geometry` for map rendering only.

**Ward (ADM4) boundaries are deliberately absent.** geoBoundaries does not publish ADM4 geometry for Nepal. The importer refuses to fabricate ward polygons. Ward coverage areas are drawn by an admin and are documented as admin-drawn polygons.

## Import commands

```sh
php artisan migrate
php artisan geo:import-boundaries --dry-run
php artisan geo:import-boundaries
```

Useful options:

```sh
php artisan geo:import-boundaries --level=province --level=district --dry-run
php artisan geo:import-boundaries --level=ward --dry-run
php artisan geo:import-boundaries --manifest=/path/to/custom/manifest.json
php artisan geo:import-boundaries --allow-incomplete
```

- `--dry-run` validates geometry, source checksums, name matching, and parent checks without writing rows.
- `--allow-incomplete` is required only when a source dataset is known to be partial and its matched ratio falls below 80%.
- `--level=ward` is a no-op with an explicit warning; no fake geometry is created.

## What the importer verifies

1. Manifest and GeoJSON files exist and parse.
2. SHA-256 checksums match the manifest.
3. Geometry is WGS84 `Polygon` or `MultiPolygon`, closed, finite, and non-self-intersecting.
4. Source names are normalized and mapped to master `provinces`, `districts`, and `municipalities` with auditable aliases.
5. Duplicate master matches are skipped and reported by name.
6. Municipality representative points are checked against parent district geometry where available. Mismatches are recorded as warnings because ADM2 and ADM3 come from different vintages.
7. Matched ratios are checked against the manifest's expected unit counts; a failed import is rolled back.

Each committed import writes a `geo_boundary_imports` audit row with provider, version, source, license, checksum, status, and a JSON summary that includes unmatched, ambiguous, duplicate, and parent-warning feature names.

## Current import result

Verified against the working database after the 2026-11-26 import:

| Level | Matched / expected | Notes |
| --- | ---: | --- |
| Province | 7 / 7 | Complete. |
| District | 72 / 77 | 1 unmatched legacy district (`Nawalparasi`, split into `Nawalpur` and `Parasi`); 2 duplicate-name features (`Bara`, `Saptari`). |
| Municipality | 730 / 753 | 35 unmatched features, mostly protected areas and renamed local levels; 12 duplicate names; 132 parent-geometry warnings from source-vintage differences. |

No geometry is marked verified unless it passed structural validation and matched exactly one master unit.

## Storage

- `geo_boundaries`: `geo_type`, `geo_id`, parent FKs, full `geometry`, optional `display_geometry`, bbox, provenance, `is_verified`, `validation_status`, `validation_errors`, `is_active`, soft deletes.
- `geo_boundary_imports`: immutable-ish audit record per committed level import.
- `wards`: administrative identifiers created when an admin configures a ward area; never geometry.
- `custom_coverage_polygons`: delivery areas and exceptional polygons with `is_coverage_area`, hierarchy, WGS84 geometry, bbox, source/provenance, verification status, expiry, and active flag.

`GeoBoundaryService` is the single read path for active, verified geometry and provides `containsPoint()`, `bbox()`, and parent-containment helpers. No client maintains a separate boundary definition.

## Admin boundary API and map

Admins with `deliveries.manage` can fetch the actual verified polygon through:

```text
GET /api/v1/admin/geo/boundaries/{province|district|municipality|ward}/{id-or-uuid}?display=1
```

- `display=1` (default) returns the simplified geometry stored with the verified dataset for map rendering.
- `display=0` returns the full-resolution authoritative geometry.
- Only active, verified boundaries are returned.
- `ward` always returns `422` with `reason: no_verified_dataset`; no approximate ward polygon is generated.

The admin page at `/admin/fulfillment/coverage` uses this API. Province, district, and municipality selectors are hierarchical and render the selected level's real GeoJSON boundary on an OpenStreetMap/Leaflet map. The ward selector stays disabled because there is no verified ADM4 dataset; drawn ward areas appear as map overlays instead.

## Hierarchical delivery coverage areas

Coverage is configured only from **Logistics → Shipping & Delivery** (`/admin/fulfillment/zones`). Staff select province → district → municipality → optional ward:

- Province, district, and municipality areas copy the verified imported boundary into `custom_coverage_polygons` with `is_coverage_area = true`. The browser never draws or guesses these shapes.
- Ward areas use a polygon the admin clicks out on the live Leaflet map, with a mandatory documented reason. Entering a new ward number creates only a `wards` identifier; it does not invent a ward boundary.
- The acting admin is recorded in `verified_by` / `verified_at`, so created areas are live immediately and remain auditable.

Admin endpoints (all require `deliveries.manage`):

```text
GET    /api/v1/admin/delivery-coverage/areas
POST   /api/v1/admin/delivery-coverage/areas
DELETE /api/v1/admin/delivery-coverage/areas/{uuid}
```

Existing ward identifiers are available through `GET /api/v1/platform/wards?municipality_id={id}` and are suggested in the form.

### Allow-list behavior

Once at least one active, verified coverage area exists, `DeliveryCoverageService` switches to allow-list mode:

1. The province → district → municipality → ward parent chain must be valid.
2. An active block rule, if one exists from legacy data, still denies delivery.
3. Coordinates are required; a point is serviceable only if it falls inside a created coverage area.
4. Every other point is denied with `outside_coverage_area`.

There is no need to create allow rules. The legacy `delivery_coverage_rules` engine remains in the backend for compatibility: its allow decisions are used only while no coverage areas exist, while block rules are still honored in allow-list mode. Deactivating an area does not re-enable legacy allowances; it stays an allow-list with that area unavailable. The rules UI has been removed.

## Exceptional custom polygons

`custom_coverage_polygons` also stores admin-drawn WGS84 `Polygon` / `MultiPolygon` geometry for exceptional pockets that an administrative boundary cannot represent. These records keep `is_coverage_area = false`.

Every record requires:

- a documented `reason` explaining why the verified boundary is insufficient,
- a hierarchical parent (province, and optionally district/municipality/ward),
- full-resolution validated geometry plus a computed bbox,
- `verification_status` of `pending`, `verified`, or `rejected`.

`CustomCoveragePolygonService` only returns polygons that are active, verified, and unexpired. Pending and rejected polygons cannot affect serviceability. Legacy custom-polygon management endpoints remain available, and the management UI is folded into Shipping & Delivery:

```text
GET    /api/v1/admin/delivery-coverage/custom-polygons
POST   /api/v1/admin/delivery-coverage/custom-polygons
GET    /api/v1/admin/delivery-coverage/custom-polygons/{uuid}
PUT    /api/v1/admin/delivery-coverage/custom-polygons/{uuid}
DELETE /api/v1/admin/delivery-coverage/custom-polygons/{uuid}
POST   /api/v1/admin/delivery-coverage/custom-polygons/{uuid}/verify
POST   /api/v1/admin/delivery-coverage/custom-polygons/{uuid}/reject
```

They never generate circles or rectangles.

## Delivery Coverage map

`GET /api/v1/admin/delivery-coverage/areas` returns every created coverage area and custom polygon with display geometry and status. The `/admin/fulfillment/coverage` page overlays all of them openly on the map, with a toggle and legend:

- green: delivery coverage areas,
- purple: exceptional custom polygons,
- dashed: pending or inactive polygons.

Selecting a province, district, or municipality still renders the authoritative verified boundary underneath. No separate coverage-rules or custom-polygon sidebar entries exist.

## Central coverage engine

`DeliveryCoverageService` is the single decision engine for admin checks, customer address validation, checkout, and future clients. Its order of evaluation is:

1. Valid hierarchy and any legacy `block` rule.
2. Created coverage areas (`is_coverage_area = true`, active, verified, unexpired).
3. Verified, active, unexpired custom polygons (legacy fallback before coverage areas exist).
4. Verified administrative boundaries plus legacy allow rules (fallback only when no coverage areas exist).

`validateAddress()` is the strict entry point: it requires coordinates and returns a structured `CoverageAssessment`. There is no separate customer/admin boundary definition.

### Customer and checkout enforcement

- `POST/PUT /api/v1/customer/addresses` validates every **shipping** address through `CustomerAddressCoverageValidator`. Missing coordinates, invalid hierarchy, an uncovered location, or a block rule returns HTTP 422. Billing-only addresses are not delivery locations.
- `CheckoutService::create()` re-checks the selected shipping address through the same engine immediately before creating a checkout session. A saved address cannot bypass a later coverage change.
- `GET|POST /api/v1/platform/delivery-coverage/check` is the public client helper. It accepts UUID or numeric geographic IDs (including `ward_id`) plus `lat`/`lng` (or `latitude`/`longitude`) and returns the same `CoverageAssessment` used by the customer API and checkout. Clients may send `ward_number` with `municipality_id` instead of `ward_id`; the backend resolves it to the same ward master record.

The web frontend uses this endpoint for the address form and checkout review badge, but the backend remains authoritative. Future mobile clients should call the same endpoint rather than maintaining separate boundaries or rules.

## Operating delivery coverage

Use this sequence when launching coverage in a new area:

1. **Prepare the data.** Run migrations, then run `php artisan geo:import-boundaries --dry-run`. Review unmatched features and parent warnings before committing the import with `php artisan geo:import-boundaries`.
2. **Inspect boundaries.** In the admin dashboard open **Logistics → Delivery Coverage** (`/admin/fulfillment/coverage`). Select the province, district, and municipality and confirm the polygon, source, and verification state. All existing coverage areas and custom polygons are overlaid there.
3. **Create the area.** Open **Logistics → Shipping & Delivery** (`/admin/fulfillment/zones`). Select the hierarchy. For province, district, or municipality the verified boundary is used automatically and rendered live. For a ward, choose or enter the ward number, click at least three map points, finish the shape, record the reason, and save.
4. **Confirm the allow-list.** Check representative points inside the new area and outside it with `GET|POST /api/v1/platform/delivery-coverage/check`. Inside returns `allowed_coverage_area`; outside returns `outside_coverage_area`.
5. **Test customer flows.** Save a shipping address inside the area and complete a checkout test. Then confirm an address outside the area is rejected with HTTP 422.
6. **Keep areas current.** Delete obsolete areas from Shipping & Delivery; delivery stops immediately after deletion. Re-run the boundary dry-run whenever source data changes. Saved addresses are rechecked at checkout, so coverage changes take effect for new orders without address re-entry.

The admin coverage screens require the `deliveries.manage` permission. A safe rollout creates only reviewed areas, then tests customer address and checkout flows before announcing service.

## Refreshing boundary data

1. Download the new GeoJSON files into `database/data/geo-boundaries/`.
2. Update `manifest.json` with the new version, source, license, expected units, and SHA-256 hashes.
3. Run `--dry-run` and review every unmatched, duplicate, and parent-warning name.
4. Run the committed import. Existing rows for the same `geo_type`, `geo_id`, and `dataset_version` are updated; old dataset versions remain until deliberately deactivated.
