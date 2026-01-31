# NYC Waterways Visualization: Project Analysis & Description

This project visualizes the complex tidal currents of New York City's waterways using real-time and historical data. It combines geographic information systems (GIS), data science pipelines, and high-performance web graphics to create an interactive, animated map.

## 1. Geographic Data Processing (Shapefiles)

The foundation of the visualization is a custom topography map derived from US Census Bureau data. The process involves creating a unified geometry for the water bodies and land masses of the NYC harbor area.

*   **Source Data:** TIGER/Line Shapefiles (Area Hydrography and County Subdivisions) for New York (Kings, Queens, Bronx, New York, Richmond counties) and New Jersey (Hudson, Bergen counties).
*   **Preprocessing:**
    *   **Merging:** Regional water shapefiles were merged into a single dataset using `ogr2ogr`.
    *   **Clipping:** The map was geographically clipped to the specific bounding box of the NYC harbor area (approx. Longitude -74.05 to -73.78, Latitude 40.54 to 40.88).
    *   **Cleaning:** QGIS was used to manually remove irrelevant water bodies (e.g., small inland creeks, NJ rivers outside the harbor) to focus on the Hudson River, East River, and NY Harbor.
*   **Optimization:**
    *   The cleaned Shapefiles (`.shp`) were converted to GeoJSON.
    *   Finally, they were compiled into **TopoJSON** format. TopoJSON encodes topology (shared boundaries), significantly reducing file size compared to GeoJSON, which is crucial for web performance.

## 2. NOAA Data Pipeline: Scraping & Interpolation

The motion data driving the visualization comes from the National Oceanic and Atmospheric Administration (NOAA).

*   **Data Collection:**
    *   **Station Metadata:** Locations and tidal characteristics (Mean Flood Direction, Mean Ebb Direction) were aggregated for active current stations in the region.
    *   **Tidal Predictions:** The system scrapes or queries NOAA's predicted tidal events. These events are discrete points in time: **Slack** (0 knots), **Max Flood** (peak inward flow), and **Max Ebb** (peak outward flow).

*   **Time Series Generation (Python):**
    *   Since NOAA provides only the "peaks" and "zero-crossings," the intermediate current speeds must be derived.
    *   **Cosine Interpolation:** The scripts approximate the sinusoidal nature of tidal flows. Between a Slack event and a Max Current event, the speed is interpolated using a cosine function:
        $$ v(t) = \frac{v_{start} - v_{end}}{2} \cos(\pi \cdot t_{ratio}) + \frac{v_{start} + v_{end}}{2} $$
    *   **Directionality:** The direction of the current is assigned based on the phase (Ebb vs. Flood) and the station's specific mean direction values.
    *   **Partitioning:** To ensure fast loading times on the client, this continuous 15-minute interval data is partitioned into daily JSON files. Static station metadata is stripped out and stored separately (`stations.json`), reducing the daily payload size by over 80%.

## 3. Animation Mathematics: Multivariate Interpolation (MVI)

The client-side visualization renders thousands of particles moving across the map. Since we only have data at specific station points, we must mathematically estimate the current at every pixel of the screen to create a fluid animation.

*   **Vector Field Generation (Inverse Distance Weighting):**
    *   To calculate the vector (speed and direction) at any arbitrary point $(x, y)$ on the map, the application uses **Inverse Distance Weighting (IDW)**.
    *   The algorithm identifies the $k$ nearest NOAA stations to the pixel.
    *   It calculates a weighted average of their vectors, where the influence of a station diminishes with distance ($w = 1/d^2$).
    *   This creates a smooth, continuous vector field that blends the data between stations, allowing particles to flow seamlessly from the influence of one station to another.

*   **Heatmap Overlays (Thin Plate Spline):**
    *   For color-coded overlays (like Current Speed), the application uses **Thin Plate Spline (TPS)** interpolation.
    *   TPS constructs a smooth surface that passes through all control points (stations) while minimizing the "bending energy" (roughness). This results in naturally smooth gradients that look physically plausible, analogous to bending a thin sheet of metal to fit the data points.

*   **Particle System:**
    *   The animation loop manages thousands of particles. In each frame, a particle checks the interpolated vector at its current position and updates its coordinates accordingly.
    *   Particles have a limited "age," after which they fade out and respawn, preventing them from getting stuck in sinks or cluttering the screen.
