# NYC Waterways Visualization

## How Do?
### Getting the Maps

1. Select the Water layer from http://www.census.gov/cgi-bin/deo/shapefiles2013/main
2. Select New York from the Area Hydrography pulldown. Get the following counties:
* Kings
* Queens
* Bronx
* New York
* Richmond

Go back and select the state of New Jersey and get the following counties:
* Hudson
* Bergen

###Editing the maps
Merge all the regional water maps into a single .shp file:
ogr2ogr merge.shp tl_2013_34003_areawater.shp
ogr2ogr -update -append merge.shp tl_2013_34017_areawater.shp -nln merge
foreach f (tl_2013_360*.shp)
	ogr2ogr -update -append merge.shp $f -nln merge
end
ogr2ogr -clipdst -74.0565 40.5440 -73.7800 40.8840 water_merge_clipd.shp merge.shp

Now, use qgis to remove all those beautiful New Jersey rivers and small bodies of water. Then merge all of the NY Harbor, Hudson River, East River, and LI Sound.

Next, let's work on the land. Download the county/subdivision shapefiles for New York state.  Then select only the regions we want to keep.
ogr2ogr -where "NAME IN ('Bronx','Queens','Brooklyn','Manhattan')" tl_2013_36_cousub_nyc.shp tl_2013_36_cousub.shp
ogr2ogr -clipdst -74.0565 40.5440 -73.7800 40.8840 tl_2013_36_cousub_nyc_clipd.shp tl_2013_36_cousub_nyc.shp 

Convert .shp files to GeoJSON, then to topojson
ogr2ogr -f GeoJSON -s_srs EPSG:4269 -t_srs EPSG:4326 nyc_water.json water_merge_clipd.shp
ogr2ogr -f GeoJSON -s_srs EPSG:4269 -t_srs EPSG:4326 nyc_land.json tl_2013_36_cousub_nyc_clipd.shp

topojson --id-property FID -o nyc_water_topo.json nyc_water.json
topojson --id-property NAME -o nyc_land_topo.json nyc_land.json

If we wanted only the Newtown Creek and tributaries, use this command:
ogr2ogr -f GeoJSON -where "FULLNAME IN ('Newtown Creek', 'Dutch Kill', 'English Kill', 'Maspeth Crk')" -t_srs EPSG:4326 newtown_creek_4326.json merge.shp
topojson --id-property FULLNAME -o nc_topo.json newtown_creek_4326.json