# NYC Waterways Visualization

A high-performance visualization of tidal currents in New York City's waterways using real-time and historical NOAA data. This project combines GIS processing, data science pipelines, and HTML5 Canvas animation to create an interactive map of tidal flows.

![Project Status](https://img.shields.io/badge/status-active-brightgreen.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Project Overview

This visualization creates a fluid, animated map where thousands of particles represent the speed and direction of tidal currents. Unlike simple vector fields, this project implements geographically-aware interpolation that respects land masses, ensuring currents flow around islands and peninsulas rather than through them.

### Key Features

*   **Real-time Animation:** HTML5 Canvas-based particle system rendering thousands of moving elements.
*   **Geographic Accuracy:** Custom TopoJSON map derived from US Census Bureau shapefiles, clipped and optimized for the NYC Harbor.
*   **Physics-Based Interpolation:** Custom Inverse Distance Weighting (IDW) algorithm with "line-of-sight" land avoidance, preventing data bleed across land masses.
*   **Interactive Controls:** Time travel controls to view past or future tidal conditions, and click-to-inspect functionality for specific location data.
*   **Data Pipeline:** Python-based ETL pipeline that scrapes NOAA tidal predictions and interpolates continuous flow data from discrete tidal events.

## Technical Architecture

### 1. Geographic Data Processing (Shapefiles)

The foundation of the visualization is a custom topography map derived from US Census Bureau data.

*   **Source Data:** TIGER/Line Shapefiles (Area Hydrography and County Subdivisions).
*   **Preprocessing:** Merged and clipped using `ogr2ogr` and QGIS to focus on the NYC harbor (approx. -74.05, 40.54 to -73.78, 40.88).
*   **Optimization:** Converted to **TopoJSON** format to significantly reduce file size and encode topology.

### 2. NOAA Data Pipeline

Motion data is derived from the National Oceanic and Atmospheric Administration (NOAA).

*   **Data Collection:** Scrapes NOAA predicted tidal events (Slack, Max Flood, Max Ebb) and station metadata.
*   **Time Series Generation:** Uses cosine interpolation to approximate sinusoidal tidal flows between discrete events:
    $$ v(t) = \frac{v_{start} - v_{end}}{2} \cos(\pi \cdot t_{ratio}) + \frac{v_{start} + v_{end}}{2} $$
*   **Partitioning:** Data is partitioned into daily JSON files to optimize client-side loading performance.

### 3. Animation Mathematics (MVI)

*   **Vector Field Generation:** Uses **Inverse Distance Weighting (IDW)** to estimate current vectors at every screen pixel based on the nearest $k$ stations.
*   **Land Mass Avoidance:** Implements a **Line-of-Sight penalty**. The algorithm samples the path between a pixel and a station using the water mask. If land is detected (sampled every 8 pixels for performance), a significant distance penalty is applied, effectively "blocking" the station's influence.
*   **Heatmap Overlays:** Uses **Thin Plate Spline (TPS)** interpolation for smooth color-coded overlays of current speeds.

## Installation & Usage

### Prerequisites

*   A standard web server (Apache, Nginx, Python `http.server`, etc.) to serve the static files.
*   (Optional) Python 3.x for running the data generation tools.

### Running the Visualization

1.  Clone the repository:
    ```bash
    git clone https://github.com/btq/nyc_waterways_viz.git
    ```
2.  Navigate to the public directory:
    ```bash
    cd nyc_waterways_viz/public
    ```
3.  Start a local web server. For example, using Python:
    ```bash
    python3 -m http.server 8000
    ```
4.  Open your browser and navigate to `http://localhost:8000`.

### Data Updates

To generate new data files (e.g., for upcoming years):

1.  Navigate to the tools directory:
    ```bash
    cd tools/data_generation
    ```
2.  Install dependencies (create a venv recommended):
    ```bash
    pip install -r requirements.txt
    ```
    *(Note: Ensure you have `beautifulsoup4`, `requests`, `pandas`, `numpy` installed)*
3.  Run the scraping and generation scripts (refer to individual script headers for usage).

## Directory Structure

*   `public/`: The web application (HTML, CSS, JS) and static data assets.
    *   `js/`: Core logic including `currents.js` (main app) and `mvi.js` (math library).
    *   `data/`: TopoJSON maps and partitioned current data.
*   `tools/`: Python scripts for data scraping and processing.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

*   **NOAA Tides & Currents** for the underlying data.
*   **US Census Bureau** for geographic shapefiles.
*   Inspired by the work of **Cameron Beccario** (earth.nullschool.net) and **Fernanda Viégas & Martin Wattenberg** (hint.fm/wind).
