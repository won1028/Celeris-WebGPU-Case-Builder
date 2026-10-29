# Validation — 2026-10-29

## Automated

`python -m unittest -v`: 9 tests passed.
`node --check app.js` and `node --check worker.js`: passed.

Tests cover exact linear dispersion residuals, period/wavelength round trip, matrix shape and orientation, ZIP members and wave header/amplitude, all seven terrain functions, submerged/edge breakwaters, dry boundaries, outward waves, excessive wave amplitude and invalid input limits.

## Browser (Chrome, managed preview)

- Python 0.27.7 WebAssembly runtime loaded from jsDelivr in a worker.
- Default 160×100 sloping domain computed: mean wet depth 8.06 m, boundary depth 10 m, T=8 s, exact L≈70.90 m; separate solver approximation ≈74.59 m shown.
- Added a breakwater: raster and cross-section visibly changed; wet area decreased.
- Save button ran Python export; UI reported ZIP creation complete and initiated download.
- Entirely dry step case: dry boundary errors appeared and Save was disabled.
- Numeric input updates were corrected to use input events without recreating the focused field.
- Preview layout was inspected visually at desktop viewport size.

## Limits of verification

No full Celeris hydrodynamic run was performed. Browser-generated download bytes were not independently retrieved; the identical Python export function's ZIP contents were verified in automated tests. Mobile, Firefox, and maximum-size performance have not been tested. GitHub Pages publication requires repository Pages settings; the preview is not a public deployment.
