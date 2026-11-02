# Celeris WebGPU Case Builder

Design idealized bathymetry, a computational grid, breakwaters, and a single regular wave in your browser, then download Celeris input files as a ZIP archive.
**Python runs through Pyodide in a Web Worker, without a Colab session or a computation server.** The initial runtime download requires internet access.

## Run and publish

In the GitHub repository, select **Settings → Pages → Build and deployment → Deploy from a branch → main / (root) → Save**. The Pages settings screen provides the published URL. For private repositories, check whether your GitHub plan supports Pages. This application does not change repository visibility.

For a local preview, run:

```sh
python -m http.server 8000
```

Open `http://localhost:8000`. Opening files directly with `file://` may block workers and file requests.

## Interface

- Left: grid, bathymetry, and multiple breakwaters. Center: colored bathymetry, grid, wave crests, and an x cross-section. Right: regular-wave settings and simulation configuration.
- Bathymetry is split into **02-1 Terrain type** and **02-2 Parameters**. Only parameters used by the selected terrain are displayed, with terrain-specific labels. Values are retained when switching terrain types.
- Parameter labels use compact symbols and names. Click the adjacent ⓘ button to open an English explanation of units, coordinates, and meaning in a modal popup. Close with ×, Escape, or a click outside the popup; keyboard focus returns to the button. Terrain help follows the selected shape.
- New cases default to **NLSW**; loading a saved case retains its solver selection.
- Interface and canvas text sizes are increased by 3 pt (4 CSS px).
- Terrain options: flat bed, uniform slope, single step, three-step terrace, Gaussian bar, Gaussian channel, and conical island.
- Breakwaters: enable/disable, zero-based center indices, length, thickness, orientation, and crest elevation. Negative crest elevations represent submerged structures.
- Wave inputs: one incident boundary, H/T or H/L, phase, and propagation direction. The linear dispersion relation converts between period and wavelength.
- Diagnostics: mean wet-cell depth, generation depth, relative-depth regime, and cells per wavelength. Model-applicability warnings (NLSW long-wave assumption, Boussinesq deep-water dispersion, and strong nonlinearity / linear-dispersion applicability) are omitted; these diagnostics remain available.
- Preview controls: zoom, pan, grid and wave visibility, animation pause, and cross-section selection by clicking a y position.
- All numeric settings use direct text entry with a numeric/decimal keyboard hint. There are no increment/decrement buttons; arrow keys and the mouse wheel do not change numeric values. Python still validates numeric ranges and integer indices. Empty or invalid entries block export.
- Preview and export share the Python geometry and validation engine.
- Dry or obstructed incident boundaries are disabled. Outward waves, invalid numbers, and structures outside the domain block export.
- Reload saved settings JSON. Up to 30 breakwaters. Grid dimensions must be integers of at least 16; there is no application-defined upper limit on nx, ny, or their product.

## Validation warnings

Warnings do not block export. They appear in the page and in `validation_report.json`.

| Warning text | Trigger |
|---|---|
| A breakwater is thinner than two cells. Terrain cleanup may alter its shape. | An enabled breakwater has thickness < 2 × max(dx, dy). |
| Depth variation in the generation zone exceeds 5%. Waves use a single base_depth. | Maximum depth − minimum depth in the outer five cell rows/columns exceeds 5% of the zone's mean depth. |
| There are fewer than 20 cells per wavelength. Check grid convergence. | L / max(dx, dy) < 20, using the wavelength at the generation-zone mean depth. |
| Oblique incidence from a single boundary may produce adjacent-boundary and corner effects. | abs(sin(angle) × cos(angle)) > 0.001, with the angle converted to radians. |

There is no grid-size warning or application-defined upper grid-size limit. NLSW long-wave, Boussinesq deep-water dispersion, and strong-nonlinearity applicability warnings are not emitted. Relative-depth and wave diagnostics are still displayed.

### Errors that block export

These are separate from the advisory warnings above.

| Error category | Trigger |
|---|---|
| Invalid inputs | Non-finite values, values outside allowed parameter ranges, non-integer cell counts or breakwater indices, unsupported options, or more than 30 breakwaters. nx and ny must each be at least 16. |
| Structure outside domain | Any part of a breakwater's rectangular footprint extends outside the domain. |
| Structure misses grid | An enabled breakwater intersects no cell centers. |
| Dry generation zone | Any cell in the outer five rows/columns at the incident boundary has depth ≤ 0.0001 m. |
| Obstructed generation zone | A breakwater overlaps the outer five rows/columns at the incident boundary, including submerged structures. |
| Outward or tangential waves | The inward component of the unit travel direction is ≤ 0.000001. |
| No wet cells | No domain cell has depth > 0.0001 m. |
| Wave trough reaches bed | H/2 ≥ the minimum depth in the generation zone. |

Invalid settings-file formats and runtime failures are also reported as errors.

## Source layout

| File | Responsibility |
|---|---|
| `index.html` | Page layout, static labels, and accessibility descriptions |
| `style.css` | Responsive dashboard and form styling |
| `app.js` | Controls, direct numeric entry, preview rendering, diagnostics, and downloads |
| `worker.js` | Pyodide startup and background Python requests |
| `engine.py` | Geometry, validation, dispersion calculations, and ZIP export; also a CLI |
| `test_engine.py` | Automated engine and output-format checks |
| `example_settings.json` | Example input for the browser or CLI |

## Coordinates and output conventions

Still water level is fixed at 0 m. Bed elevation z is positive upward; depth is h=max(0,-z).
Lx and Ly span the outer cell boundaries, with dx=Lx/nx and dy=Ly/ny. Bathymetry is sampled at cell centers. This differs by a half-cell origin shift from the i*dx coordinates displayed by Celeris.

Wave and structure angles increase counterclockwise from +x: 0° east, 90° north. Wave direction means the direction of travel, not the direction of origin.

| ZIP member | Contents |
|---|---|
| `bathy.txt` | ny rows × nx columns; first row south, first column west; bed elevation in meters |
| `waves.txt` | NumberOfWaves 1; amplitude H/2, period in seconds, propagation angle and phase in radians |
| `config.json` | Cartesian grid, NLSW/Boussinesq, friction, one generation boundary, and other boundary conditions |
| `case_settings.json` | All design settings, schema version 1; reloadable in the website |
| `validation_report.json` | Depth and wave diagnostics, warnings, and limitations |

`incident_wave_type=-1` selects the wave component from the file. For a sinusoidal wave, `significant_wave_height` is stored as H/sqrt(2).
`base_depth` is the mean depth of the protected generation zone. It can differ from the maximum depth; check the CFL condition and time step in the actual simulation.

## Upstream source inspection (2026-10-29)

The following public sources in `plynett/plynett.github.io` were inspected. This does not verify a separately modified solver or a complete hydrodynamic run.

- `js/File_Loader.js`, blob `5e03095a56b989b054c9b05892b3dbcd671ce0f3`: bathymetry row/column parsing and wave headers/components.
- `shaders/BoundaryPass.wgsl`, blob `a460c2475115db2c4da5936a5291a98aa9193a42`: amplitude, period, angle, phase, generation in the outer three cells, and approximate dispersion using base_depth.
- `js/constants_load_calc.js`, blob `5abbe9ec8905f9f43dea9ed1e1c7954cb44fe6c6`: Cartesian grid_type=1 and custom waves incident_wave_type=-1.

The loader flattens edge bathymetry using interior samples at index 4 or the corresponding opposite-edge index. The UI therefore checks the outer **five cells** conservatively. Celeris boundary and isolated-cell cleanup can change the bathymetry shown in this design preview.

## Physical and runtime limitations

- Animated crests illustrate the incident direction; they do not calculate diffraction, reflection, refraction, or breaking. Direction lines may overlap dry areas.
- Displayed L solves the exact linear dispersion relation. The inspected Celeris boundary uses an approximation, so the UI also displays its approximate L.
- Only one generation boundary is supported. Review adjacent-boundary and corner effects for oblique incidence.
- Breakwaters are impermeable raised terrain; porous transmission is not modeled.
- One mean-depth diagnostic cannot establish model accuracy over strongly varying terrain. Warnings do not replace convergence studies.
- Grid size is not capped by the application. Actual capacity and processing time depend on browser memory and device resources.
- Pyodide is pinned to version 0.27.7 and loaded from jsDelivr. Design inputs are not sent to an external computation server.

## Python CLI and tests

```sh
python engine.py case_settings.json -o celeris_case.zip
python -m unittest -v
```

Only the Python standard library is required. The browser and CLI use the same `engine.py`.
Ten automated tests cover dispersion, ZIP contents and matrix/header formats, all seven terrain types, terrain orientation, outward-wave rejection, submerged and boundary breakwaters, dry boundaries and excessive wave height, wavelength input, and invalid numbers, and grids exceeding the former total-cell and per-axis caps.
See `VALIDATION.md` for verification details.
