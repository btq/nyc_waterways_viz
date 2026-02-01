/**
 * currents - a project to visualize tidal currents for NYC.
 *
 * Copyright (c) 2014 Brian T. Quinn
 * The MIT License - http://opensource.org/licenses/MIT
 *
 * https://github.com/btq/nyc_waterways_viz
 */
(function() {
    "use strict";

    var τ = 2 * Math.PI;
    var MAX_TASK_TIME = 100;  // amount of time before a task yields control (milliseconds)
    var MIN_SLEEP_TIME = 25;  // amount of time a task waits before resuming (milliseconds)
    var INVISIBLE = -1;  // an invisible vector
    var NIL = -2;       // non-existent vector
    var PARTICLE_LINE_WIDTH = 1.0;  // line width of a drawn particle

    // special document elements
    var MAP_SVG_ID = "#map-svg";
    var FIELD_CANVAS_ID = "#field-canvas";
    var OVERLAY_CANVAS_ID = "#overlay-canvas";
    var FOREGROUND_SVG_ID = "#foreground";
    var DISPLAY_ID = "#display";
    var LOCATION_ID = "#location";
    var SAMPLE_LABEL_ID = "#sample-label";
    var STATUS_ID = "#status";
    var POINT_DETAILS_ID = "#point-details";
    var PREVIOUS_DAY_ID = "#previous-day";
    var PREVIOUS_HOUR_ID = "#previous-hour";
    var NEXT_HOUR_ID = "#next-hour";
    var NEXT_DAY_ID = "#next-day";
    var CURRENT_CONDITIONS_ID = "#current-conditions";
    var SHOW_LOCATION_ID = "#show-location";
    var CLEAR_POINTS_ID = "#clear-points";
    var POSITION_ID = "#position";

    // metadata about each type of overlay
    var OVERLAY_TYPES = {
        "tcspd":   {min: -6,     max: 6,    scale: "line",  precision: 1, label: "Tidal Current Speed", unit: " knots"},
    };

    // Global state for time navigation
    var allData = [];
    var stationsData = null; // Store static station data
    var currentIndex = 0;
    var currentField = null; // The active vector field used by the animation
    var globalSettings = null; // To store settings for re-interpolation
    var globalMasks = null;    // To store masks for re-interpolation
    
    // Data Loading State
    var dataIndex = null;
    var loadedFiles = {};
    var baseDataPath = "data/currents/partitioned/";

    // extract parameters sent to us by the server
    var displayData = {
        topography: d3.select(DISPLAY_ID).attr("data-topography"),
        samples: d3.select(DISPLAY_ID).attr("data-samples"),
        type: d3.select(DISPLAY_ID).attr("data-type"),
        date: d3.select(DISPLAY_ID).attr("data-date")
    };
    var overlayType = OVERLAY_TYPES[displayData.type];

    // ... (createSettings, log, view, helper functions remain unchanged) ...

    function loadDataForDate(dateStr) {
        if (!dataIndex) return Promise.reject("Index not loaded");
        if (!stationsData) return Promise.reject("Stations data not loaded");
        
        // Simple date formatting to match index keys (YYYY-MM-DD)
        var dateKey = dateStr.split(" ")[0].split("T")[0];
        
        if (!dataIndex[dateKey]) {
            console.warn("No data found for date:", dateKey);
            return Promise.resolve([]); 
        }
        
        if (loadedFiles[dateKey]) {
            return Promise.resolve(null); // Already loaded
        }
        
        var fileName = dataIndex[dateKey];
        return loadJson(baseDataPath + fileName).then(function(newData) {
            loadedFiles[dateKey] = true;
            // Reconstruct full objects from simplified data
            return newData.map(function(timeSlice) {
                 var samples = timeSlice.samples.map(function(values, i) {
                     var station = stationsData[i];
                     // Handle case where station count mismatches or values are missing
                     if (!station) return null;
                     return {
                         stationId: station.stationId,
                         coordinates: station.coordinates,
                         current: values // [dir, speed]
                     };
                 }).filter(function(s) { return s !== null; });
                 
                 return {
                     date: timeSlice.date,
                     samples: samples
                 };
            });
        });
    }

    function updateTime(offsetMinutes) {
        if (!allData || allData.length === 0) return;

        clearPoints();

        var currentData = allData[currentIndex];
        var currentDate = new Date(currentData.date);
        var targetTime = currentDate.getTime() + offsetMinutes * 60000;
        var targetDate = new Date(targetTime);
        
        // Use local time components to construct the date string, matching the "wall time" 
        // in the data file and the file naming convention, ignoring browser timezone shifts.
        var year = targetDate.getFullYear();
        var month = (targetDate.getMonth() + 1).toString().padStart(2, '0');
        var day = targetDate.getDate().toString().padStart(2, '0');
        var targetDateStr = year + "-" + month + "-" + day;

        // Check if we need to load new data
        var needsLoad = false;
        if (!loadedFiles[targetDateStr] && dataIndex && dataIndex[targetDateStr]) {
            needsLoad = true;
        }

        var processUpdate = function() {
             // Find closest index in (potentially updated) allData
            var closestIndex = 0;
            var minDiff = Infinity;

            for (var i = 0; i < allData.length; i++) {
                var d = new Date(allData[i].date).getTime();
                var diff = Math.abs(d - targetTime);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestIndex = i;
                }
            }
            
            // Allow a bit of slop, but if we are too far, maybe we shouldn't update?
            // For now, jump to closest.

            if (closestIndex !== currentIndex || needsLoad) {
                currentIndex = closestIndex;
                var newData = allData[currentIndex];
                console.log("Updating time to: " + newData.date);
                updateDisplayTime(newData.date);

                if (globalSettings && globalMasks) {
                     interpolateField([newData], globalSettings, globalMasks).then(function(newField) {
                         currentField = newField;
                     });
                }
            } else {
                 console.log("No new data found for target time.");
            }
        };

        if (needsLoad) {
            displayStatus("Loading data...");
            loadDataForDate(targetDateStr).then(function(newData) {
                if (newData && newData.length > 0) {
                    // Merge and Sort
                    allData = allData.concat(newData);
                    allData.sort(function(a, b) {
                        return new Date(a.date) - new Date(b.date);
                    });
                }
                processUpdate();
            }).catch(function(err) {
                console.error("Failed to load data", err);
                processUpdate(); // Try to update with what we have
            });
        } else {
            processUpdate();
        }
    }

    // ... (rest of functions) ...

    var topoTask         = loadJson(displayData.topography);
    var stationsTask     = loadJson(baseDataPath + "stations.json").then(function(data) {
        stationsData = data;
        return data;
    });
    
    // Modified dataTask to load index and initial data
    var dataTask         = Promise.all([loadJson(displayData.samples), stationsTask]).then(function(results) {
        var index = results[0];
        dataIndex = index;
        // Determine start date
        var startDateStr = displayData.date;
        
        if (!startDateStr || startDateStr === "") {
             // Default to "today"
             var now = new Date();
             var year = now.getFullYear();
             var month = (now.getMonth() + 1).toString().padStart(2, '0');
             var day = now.getDate().toString().padStart(2, '0');
             var todayStr = year + "-" + month + "-" + day;
             
             if (index[todayStr]) {
                 startDateStr = todayStr;
             } else if (Object.keys(index).length > 0) {
                 // Fallback to first available if today is missing
                 startDateStr = Object.keys(index).sort()[0];
             } else {
                 // Final fallback just to have a string
                 startDateStr = todayStr; 
             }
        }
        
        return loadDataForDate(startDateStr).then(function(data) {
             if (!data) throw "Initial data load failed or empty";
             allData = data;

             // Find closest index to "now"
             var now = Date.now();
             var closestIndex = 0;
             var minDiff = Infinity;
             for (var i = 0; i < allData.length; i++) {
                 var d = new Date(allData[i].date).getTime();
                 var diff = Math.abs(d - now);
                 if (diff < minDiff) {
                     minDiff = diff;
                     closestIndex = i;
                 }
             }
             currentIndex = closestIndex;

             // Set the initial date on display if it wasn't there
             updateDisplayTime(allData[currentIndex].date);
             return [allData[currentIndex]];
        });
    });
    function createSettings(topo) {
        var isFF = /firefox/i.test(navigator.userAgent);
        var projection = createAlbersProjection(topo.bbox[0], topo.bbox[1], topo.bbox[2], topo.bbox[3], view);
        var bounds = createDisplayBounds(topo.bbox[0], topo.bbox[1], topo.bbox[2], topo.bbox[3], projection);
        var styles = [];
        var maxIntensity = 8;  // velocity at which particle color intensity is maximum
        var settings = {
            projection: projection,
            displayBounds: bounds,
            particleCount: Math.round(bounds.height / 0.14),
            maxParticleAge: 30,  // max number of frames a particle is drawn before regeneration
            velocityScale: +(bounds.height / 700).toFixed(3),  // particle speed as number of pixels per unit vector
            fieldMaskWidth: isFF ? 2 : Math.ceil(bounds.height * 0.06),  // Wide strokes on FF are very slow
            fadeFillStyle: isFF ? "rgba(0, 0, 0, 0.95)" : "rgba(0, 0, 0, 0.97)",  // FF Mac alpha behaves differently
            frameRate: 40,  // desired milliseconds per frame
            animate: true,
            maxIntensity: maxIntensity,  // used for intensity-based color scaling
            styles: styles,
            styleIndex: function(m) {  // map current speed to a style based on intensity
                return Math.floor(Math.min(m, maxIntensity) / maxIntensity * (styles.length - 1));
            }
        };
        
        for (var j = 85; j <= 255; j += 5) {
            styles.push(asColorStyle(j, j, j, 1));
        }
        globalSettings = settings;
        return settings;
    }

    /**
     * An object to perform logging when the browser supports it.
     */
    var log = {
        debug:   function(s) { if (console && console.log) console.log(s); },
        info:    function(s) { if (console && console.info) console.info(s); },
        error:   function(e) { if (console && console.error) console.error(e.stack ? e + "\n" + e.stack : e); },
        time:    function(s) { if (console && console.time) console.time(s); },
        timeEnd: function(s) { if (console && console.timeEnd) console.timeEnd(s); }
    };

    /**
     * An object {width:, height:} that describes the extent of the browser's view in pixels.
     */
    var view = {
        width: 1232,
        height: 2000
    };

    function asColorStyle(r, g, b, a) {
        return "rgba(" + r + ", " + g + ", " + b + ", " + a + ")";
    }

    function asRainbowColorStyle(hue, a) {
        var rad = hue * τ * 5/6;
        rad *= 0.75; 

        var s = Math.sin(rad);
        var c = Math.cos(rad);
        var r = Math.floor(Math.max(0, -c) * 255);
        var g = Math.floor(Math.max(s, 0) * 255);
        var b = Math.floor(Math.max(c, 0, -s) * 255);
        return asColorStyle(r, g, b, a);
    }

    function init() {
        if ("ontouchstart" in document.documentElement) {
            document.addEventListener("touchstart", function() {}, false); 
        }
        else {
            document.documentElement.className += " no-touch"; 
        }

        d3.select(MAP_SVG_ID).attr("width", view.width).attr("height", view.height);
        d3.select(FIELD_CANVAS_ID).attr("width", view.width).attr("height", view.height);
        d3.select(OVERLAY_CANVAS_ID).attr("width", view.width).attr("height", view.height);
        d3.select(FOREGROUND_SVG_ID).attr("width", view.width).attr("height", view.height);

        if (overlayType) {
            d3.select(SAMPLE_LABEL_ID).attr("style", "display: inline").node().textContent = "+ " + overlayType.label;
        }

        // Initialize Time Control Buttons
        d3.select("#sub-week").on("click", function() { updateTime(-7 * 24 * 60); });
        d3.select("#add-week").on("click", function() { updateTime(7 * 24 * 60); });
        d3.select("#sub-day").on("click", function() { updateTime(-24 * 60); });
        d3.select("#add-day").on("click", function() { updateTime(24 * 60); });
        d3.select("#sub-hour").on("click", function() { updateTime(-60); });
        d3.select("#add-hour").on("click", function() { updateTime(60); });
        d3.select("#sub-15").on("click", function() { updateTime(-15); });
        d3.select("#add-15").on("click", function() { updateTime(15); });

        // Add event handlers for the overlay navigation buttons.
        function addNavToSampleType(type) {
            d3.select("#" + type).on("click", function() {
                window.location.href = displayData.samples.replace("/data/" + displayData.type, "/map/" + type);
            });
        }
        for (var type in OVERLAY_TYPES) {
            if (OVERLAY_TYPES.hasOwnProperty(type)) {
                addNavToSampleType(type);
            }
        }
        addNavToSampleType("current");  // add the "None" overlay
    }

    function createAlbersProjection(lng0, lat0, lng1, lat1, view) {
        var projection = d3.geoAlbers()
            .rotate([-((lng0 + lng1) / 2), 0])
            .center([0, (lat0 + lat1) / 2])
            .scale(1)
            .translate([0, 0]);

        var p0 = projection([lng0, lat0]);
        var p1 = projection([lng1, lat1]);
        var s = 1 / Math.max((p1[0] - p0[0]) / view.width, (p0[1] - p1[1]) / view.height) * 0.95;
        var t = [view.width / 2, view.height / 2];
		
        return projection.scale(s).translate(t);
    }

    function createDisplayBounds(lng0, lat0, lng1, lat1, projection) {
        var upperLeft = projection([lng0, lat1]).map(Math.floor);
        var lowerRight = projection([lng1, lat0]).map(Math.ceil);
        return {
            x: upperLeft[0],
            y: upperLeft[1],
            width: lowerRight[0] - upperLeft[0] + 1,
            height: lowerRight[1] - upperLeft[1] + 1
        }
    }

    function loadJson(resource) {
        console.log("Loading json: " + resource);
        return d3.json(resource).catch(function(error) {
            throw {error: error.status || -1, message: error.statusText || "Cannot load resource: " + resource, resource: resource};
        });
    }

    function apply(f) {
        return function(args) {
            return f.apply(null, args);
        }
    }

    function nap(value) {
        return new Promise(function(resolve) {
            setTimeout(function() { resolve(value); }, MIN_SLEEP_TIME);
        });
    }

    function rand(min, max) {
        return min + Math.random() * (max - min);
    }

    var bad = false;
    function displayStatus(status, error) {
        if (error) {
            bad = true;
            d3.select(STATUS_ID).node().textContent = "⁂ " + error;
        }
        else if (!bad) {
            d3.select(STATUS_ID).node().textContent = "⁂ " + status;
        }
    }

    function updateDisplayTime(dateStr) {
        d3.select(DISPLAY_ID).attr("data-date", dateStr);
        d3.select("#current-display-time").text(dateStr);
        displayStatus(dateStr);
    }

    function clearPoints() {
        d3.select(FOREGROUND_SVG_ID).selectAll(".user-point").remove();
        d3.select(POINT_DETAILS_ID).node().innerHTML = "";
        d3.select(LOCATION_ID).node().innerHTML = "&nbsp;";
    }

    function buildMeshes(topo, settings) {
        displayStatus("building meshes...");
        log.time("building meshes");
        var path = d3.geoPath().projection(settings.projection);
        var outerBoundary = topojson.mesh(topo, topo.objects.main, function(a, b) { return a === b; });
        var divisionBoundaries = topojson.mesh(topo, topo.objects.main, function (a, b) { return a !== b; });
        log.timeEnd("building meshes");
        return {
            path: path,
            outerBoundary: outerBoundary,
            divisionBoundaries: divisionBoundaries
        };
    }

    function renderMap(mesh) {
        displayStatus("Rendering map...");
        log.time("rendering map");
        var mapSvg = d3.select(MAP_SVG_ID);
        mapSvg.attr("width", view.width).attr("height", view.height);
        
        mapSvg.append("path").datum(mesh.outerBoundary).attr("class", "out-boundary").attr("d", mesh.path);
        mapSvg.append("path").datum(mesh.divisionBoundaries).attr("class", "in-boundary").attr("d", mesh.path);
        log.timeEnd("rendering map");
    }

    function renderMasks(mesh, settings) {
        displayStatus("Rendering masks...");
        log.time("render masks");

        var canvas = document.createElement("canvas");
        d3.select(canvas).attr("width", view.width).attr("height", view.height);
        var g = canvas.getContext("2d");
        var path = d3.geoPath().projection(settings.projection).context(g);

        path(mesh.outerBoundary);
        g.strokeStyle = asColorStyle(255, 0, 0, 1);
        g.lineWidth = settings.fieldMaskWidth;
        g.stroke();

        g.fillStyle = asColorStyle(255, 255, 0, 1);
        g.fill();

        g.strokeStyle = asColorStyle(255, 0, 0, 1);
        g.lineWidth = 0.5;
        g.stroke();

        var width = canvas.width;
        var data = g.getImageData(0, 0, canvas.width, canvas.height).data;

        log.timeEnd("render masks");
        
        var masks = {
            fieldMask: function(x, y) {
                var i = (y * width + x) * 4;
                return data[i] > 0;
            },
            displayMask: function(x, y) {
                var i = (y * width + x) * 4 + 1;
                return data[i] > 0;
            }
        };
        globalMasks = masks;
        return masks;
    }

    function render(settings, mesh) {
        return Promise.resolve(renderMap(mesh))
            .then(nap)
            .then(renderMasks.bind(null, mesh, settings));
    }

    function isValidSample(current) {
        return current[0] == +current[0] && current[1] == +current[1];
    }

    function plotStations(data, mesh) {
        var features = [];
        data[0].samples.forEach(function(e) {
            if (isValidSample(e.current)) {
                features.push({
                    type: "Features",
                    properties: {name: e.stationId.toString()},
                    geometry: {type: "Point", coordinates: e.coordinates}});
            }
        });
        mesh.path.pointRadius(2);
        d3.select(MAP_SVG_ID).append("path")
            .datum({type: "FeatureCollection", features: features})
            .attr("class", "station")
            .attr("d", mesh.path);
    }

    function plotCurrentPosition(projection) {
        if (navigator.geolocation && projection && !d3.select(POSITION_ID).node()) {
            log.debug("requesting location...");
            navigator.geolocation.getCurrentPosition(
                function(position) {
                    log.debug("position available");
                    var p = projection([position.coords.longitude, position.coords.latitude]);
                    var x = Math.round(p[0]);
                    var y = Math.round(p[1]);
                    if (0 <= x && x < view.width && 0 <= y && y < view.height) {
                        var id = POSITION_ID.substr(1);
                        d3.select(MAP_SVG_ID).append("circle").attr("id", id).attr("cx", x).attr("cy", y).attr("r", 5);
                    }
                },
                log.error,
                {enableHighAccuracy: true});
        }
    }

    function componentize(current) {
        var φ = current[0] / 360 * τ;
        var m = current[1];
        var u = m * Math.sin(φ);
        var v = m * Math.cos(φ);
        return [u, -v];
    }

    function formatCoordinates(lng, lat) {
        return Math.abs(lat).toFixed(6) + "º " + (lat >= 0 ? "N" : "S") + ", " +
            Math.abs(lng).toFixed(6) + "º " + (lng >= 0 ? "E" : "W");
    }

    function formatVector(x, y) {
        var d = Math.atan2(-x, y) / τ * 360 +180;
        var wd = Math.round((d + 360) % 360 / 5) * 5;
        var m = Math.sqrt(x * x + y * y);
        return d.toFixed(0) + "º @ " + m.toFixed(1) + " knots";
    }

    function formatOverlayValue(v) {
        v = Math.min(v, overlayType.max);
        v = Math.max(v, Math.min(overlayType.min, 0));
        if (overlayType.multiplier) {
            v *= overlayType.multiplier;
        }
        return v.toFixed(overlayType.precision) + overlayType.unit;
    }

    function buildPointsFromSamples(samples, projection, transform) {
        var points = [];
        samples.forEach(function(sample) {
            var point = projection(sample.coordinates);
            var value = transform(sample);
            if (value !== null) {
                points.push([point[0], point[1], value]);
            }
        });
        return points;
    }

    function binarySearch(a, v) {
        var low = 0, high = a.length - 1;
        while (low <= high) {
            var mid = low + ((high - low) >> 1), p = a[mid];
            if (p < v) {
                low = mid + 1;
            }
            else if (p === v) {
                return mid;
            }
            else {
                high = mid - 1;
            }
        }
        return -(low + 1);
    }

    function createField(columns) {
        var nilVector = [NaN, NaN, NIL];
        var field = function(x, y) {
            var column = columns[Math.round(x)];
            if (column) {
                var v = column[Math.round(y) - column[0]];
                if (v) {
                    return v;
                }
            }
            return nilVector;
        }

        field.randomize = function() {
            var w = [0];
            for (var i = 1; i <= columns.length; i++) {
                var column = columns[i - 1];
                w[i] = w[i - 1] + (column ? column.length - 1 : 0);
            }
            var pointCount = w[w.length - 1];

            return function(o) {
                var p = Math.floor(rand(0, pointCount));
                var x = binarySearch(w, p);
                x = x < 0 ? -x - 2 : x;
                while (!columns[o.x = x]) {
                    x++;
                }
                o.y = p - w[x] + 1 + columns[x][0];
                return o;
            }
        }();

        return field;
    }

    function interpolateField(data, settings, masks) {
        log.time("interpolating field");
        return new Promise(function(resolve, reject) {
            if (data.length === 0) {
                return reject("No Data in Response");
            }

            var points = buildPointsFromSamples(data[0].samples, settings.projection, function(sample) {
                return isValidSample(sample.current) ? componentize(sample.current) : null;
            });

            if (points.length < 5) {
                return reject("NOAA station adjusting the data");
            }

            var checkLandPenalty = function(x0, y0, x1, y1) {
                var dx = x1 - x0;
                var dy = y1 - y0;
                var dist = Math.sqrt(dx * dx + dy * dy);
                var stepSize = 8; // Optimization: sample every 8 pixels instead of every pixel

                if (dist < stepSize) return 1.0;

                var steps = Math.floor(dist / stepSize);
                var sx = dx / steps;
                var sy = dy / steps;

                var cx = x0;
                var cy = y0;

                for (var i = 1; i < steps; i++) {
                    cx += sx;
                    cy += sy;
                    if (!masks.fieldMask(Math.round(cx), Math.round(cy))) {
                        return 50.0;
                    }
                }
                return 1.0;
            };

            // Reduced neighbor count to 5 for maximum performance
            var interpolate = mvi.inverseDistanceWeighting(points, 5, checkLandPenalty);

            var columns = [];
            var bounds = settings.displayBounds;
            var displayMask = masks.displayMask;
            var fieldMask = masks.fieldMask;
        var xBound = bounds.x + bounds.width;
        var yBound = bounds.y + bounds.height;
        var x = bounds.x;

        function interpolateColumn(x) {
            var yMin, yMax;
            for (yMin = 0; yMin < yBound && !fieldMask(x, yMin); yMin++) {
            }
            for (yMax = yBound - 1; yMax > yMin && !fieldMask(x, yMax); yMax--) {
            }

            if (yMin <= yMax) {
                var column = [];
                var offset = column[0] = yMin - 1;
                for (var y = yMin; y <= yMax; y++) {
                    var v = null;
                    if (fieldMask(x, y)) {
                        v = [0, 0, 0];
                        v = interpolate(x, y, v);
                        v[2] = displayMask(x, y) ? Math.sqrt(v[0] * v[0] + v[1] * v[1]) : INVISIBLE;
                        v = mvi.scaleVector(v, settings.velocityScale);
                    }
                    column[y - offset] = v;
                }
                return column;
            }
            else {
                return null;
            }
        }

        (function batchInterpolate() {
            try {
                var start = +new Date;
                while (x < xBound) {
                    columns[x] = interpolateColumn(x);
                    x += 1;
                    if ((+new Date - start) > MAX_TASK_TIME) {
                        displayStatus("Interpolating: " + x + "/" + xBound);
                        setTimeout(batchInterpolate, MIN_SLEEP_TIME);
                        return;
                    }
                }
                var date = data[0].date.replace(":00-05:00", "");
                updateDisplayTime(date);
                resolve(createField(columns));
                log.timeEnd("interpolating field");
            }
            catch (e) {
                reject(e);
            }
        })();
        });
    }

    function animate(settings, field) {
        currentField = field; // Set initial field
        var bounds = settings.displayBounds;
        var buckets = settings.styles.map(function() { return []; });
        var particles = [];
        for (var i = 0; i < settings.particleCount; i++) {
            particles.push(field.randomize({age: rand(0, settings.maxParticleAge)}));
        }

        function evolve() {
            var field = currentField; // Use current global field
            buckets.forEach(function(bucket) { bucket.length = 0; });
            particles.forEach(function(particle) {
                if (particle.age > settings.maxParticleAge) {
                    field.randomize(particle).age = 0;
                }
                var x = particle.x;
                var y = particle.y;
                var v = field(x, y);
                var m = v[2];
                if (m === NIL) {
                    particle.age = settings.maxParticleAge;
                }
                else {
                    var xt = x + v[0];
                    var yt = y + v[1];
                    if (m > INVISIBLE && field(xt, yt)[2] > INVISIBLE) {
                        particle.xt = xt;
                        particle.yt = yt;
                        buckets[settings.styleIndex(m)].push(particle);
                    }
                    else {
                        particle.x = xt;
                        particle.y = yt;
                    }
                }
                particle.age += 1;
            });
        }

        var g = d3.select(FIELD_CANVAS_ID).node().getContext("2d");
        g.lineWidth = PARTICLE_LINE_WIDTH;
        g.fillStyle = settings.fadeFillStyle;

        function draw() {
            var prev = g.globalCompositeOperation;
            g.globalCompositeOperation = "destination-in";
            g.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
            g.globalCompositeOperation = prev;

            buckets.forEach(function(bucket, i) {
                if (bucket.length > 0) {
                    g.beginPath();
                    g.strokeStyle = settings.styles[i];
                    bucket.forEach(function(particle) {
                        g.moveTo(particle.x, particle.y);
                        g.lineTo(particle.xt, particle.yt);
                        particle.x = particle.xt;
                        particle.y = particle.yt;
                    });
                    g.stroke();
                }
            });
        }

        (function frame() {
            try {
                if (settings.animate) {
                    evolve();
                    draw();
                    setTimeout(frame, settings.frameRate);
                }
            }
            catch (e) {
                report(e);
            }
        })();
    }

    function drawOverlay(data, settings, masks) {
        if (!overlayType) {
            return Promise.resolve(null);
        }

        log.time("drawing overlay");
        return new Promise(function(resolve, reject) {
            if (data.length === 0) {
                return reject("No Data in Response");
            }

            var points = buildPointsFromSamples(data[0].samples, settings.projection, function(sample) {
                var datum = sample[displayData.type];
                return datum == +datum ? datum : null;
            });

            if (points.length < 3) {
                return reject("Need at least 3 samples to interpolate");
            }

        var min = overlayType.min;
        var max = overlayType.max;
        var range = max - min;
        var rigidity = range * 0.05;

        var interpolate = mvi.thinPlateSpline(points, rigidity);

        var g = d3.select(OVERLAY_CANVAS_ID).node().getContext("2d");
        var isLogarithmic = (overlayType.scale === "log");
        var LN101 = Math.log(101);
        var bounds = settings.displayBounds;
        var displayMask = masks.displayMask;
        var xBound = bounds.x + bounds.width;
        var yBound = bounds.y + bounds.height;
        var x = bounds.x;

        var n = view.width / 5;
        for (var i = n; i >= 0; i--) {
            g.fillStyle = asRainbowColorStyle((1 - (i / n)), 0.9);
            g.fillRect(view.width - 10 - i, view.height - 20, 1, 10);
        }

        function drawColumn(x) {
            for (var y = bounds.y; y < yBound; y += 2) {
                if (displayMask(x, y)) {
                    var z = Math.min(Math.max(interpolate(x, y), min), max);
                    z = (z - min) / range;
                    if (isLogarithmic) {
                        z = Math.log(z * 100 + 1) / LN101;
                    }
                    g.fillStyle = asRainbowColorStyle(z, 0.6);
                    g.fillRect(x, y, 2, 2);
                }
            }
        }

        (function batchDraw() {
            try {
                var start = +new Date;
                while (x < xBound) {
                    drawColumn(x);
                    x += 2;
                    if ((+new Date - start) > MAX_TASK_TIME) {
                        setTimeout(batchDraw, MIN_SLEEP_TIME);
                        return;
                    }
                }
                resolve(interpolate);
                log.timeEnd("drawing overlay");
            }
            catch (e) {
                reject(e);
            }
        })();
        });
    }

    function postInit(settings, field, overlay, topo) {
        d3.select(SHOW_LOCATION_ID).on("click", function() {
            plotCurrentPosition(settings.projection);
        });

        d3.select(CLEAR_POINTS_ID).on("click", function(event) {
            console.log("Clear points clicked!");
            event.stopPropagation();
            clearPoints();
        });

        d3.select(DISPLAY_ID).on("click", function(event) {
            var p = d3.pointer(event, this);
            var c = settings.projection.invert(p);
            var v = currentField(p[0], p[1]); // Use current global field
            if (v[2] >= INVISIBLE) {
                d3.select(LOCATION_ID).node().textContent = " " + formatCoordinates(c[0], c[1]);
                var pointDetails = " " + formatVector(v[0]/settings.velocityScale, v[1]/settings.velocityScale);
                if (overlay) {
                    pointDetails += " | " + formatOverlayValue(overlay(p[0], p[1]));
                }
                d3.select(POINT_DETAILS_ID).node().innerHTML = pointDetails;

                d3.select(FOREGROUND_SVG_ID).append("circle")
                    .attr("class", "user-point")
                    .attr("cx", p[0])
                    .attr("cy", p[1])
                    .attr("r", 4)
                    .style("fill", "none")
                    .style("stroke", "#0000ff")
                    .style("stroke-width", "2px");
                d3.select(FOREGROUND_SVG_ID).append("text")
                    .attr("class", "user-point")
                    .attr("x", p[0] + 8)
                    .attr("y", p[1] + 4)
                    .text(pointDetails.trim())
                    .style("fill", "#0000ff")
                    .style("font-weight", "bold")
                    .style("text-shadow", "1px 1px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff");
            }
        });
    }

    var topoTask         = loadJson(displayData.topography);
    


    var initTask         = Promise.all([true                                 ]).then(apply(init));
    var settingsTask     = Promise.all([topoTask                             ]).then(apply(createSettings));
    var meshTask         = Promise.all([topoTask, settingsTask               ]).then(apply(buildMeshes));
    var renderTask       = Promise.all([settingsTask, meshTask               ]).then(apply(render));
    var plotStationsTask = Promise.all([dataTask, meshTask                   ]).then(apply(plotStations));
    var overlayTask      = Promise.all([dataTask, settingsTask, renderTask   ]).then(apply(drawOverlay));
    var fieldTask        = Promise.all([dataTask, settingsTask, renderTask   ]).then(apply(interpolateField));
    var animateTask      = Promise.all([settingsTask, fieldTask              ]).then(apply(animate));
    var postInitTask     = Promise.all([settingsTask, fieldTask, overlayTask, topoTask ]).then(apply(postInit));
	
    Promise.all([
        topoTask,
        dataTask,
        initTask,
        settingsTask,
        meshTask,
        renderTask,
        plotStationsTask,
        overlayTask,
        fieldTask,
        animateTask,
        postInitTask
    ]).catch(report);
    
    // Helper to report errors since 'report' was referenced but not defined in the snippet I saw, 
    // though it might be global or I should define a simple one.
    function report(e) { console.error(e); }

})();