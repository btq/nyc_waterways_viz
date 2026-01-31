# -*- coding: utf-8 -*-
"""
Created on Wed Feb 17 15:34:44 2016
Refactored on Jan 29 2026 to use NOAA API

@author: btq
"""
import logging
import requests
import csv
import itertools
import re

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Bounding box for NYC area
LON_BOUNDS = [-74.056, -73.781]
LAT_BOUNDS = [40.544, 40.8840]

# NOAA CO-OPS Metadata API for Current Prediction Stations
API_URL = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/current_geo_groups.json'

def get_stations():
    """Fetches the list of all current prediction stations from NOAA."""
    logging.info(f"Fetching stations from {API_URL}")
    # A User-Agent is required by the NOAA API.
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
    }
    try:
        response = requests.get(API_URL, timeout=15, headers=headers)
        response.raise_for_status()
        data = response.json()
        logging.info("Successfully retrieved station data from API.")
        logging.debug(f"API response data: {data}")
        stations = []
        if isinstance(data, list):
            for group in data:
                stations.extend(group.get('stations', []))
        elif isinstance(data, dict):
            stations = data.get('currPredGeoGroupList', [])
        return stations
    except requests.RequestException as e:
        logging.error(f"API request failed: {e}")
        return []
    except ValueError as e:
        logging.error(f"JSON parsing failed: {e}")
        return []

def filter_stations(stations):
    """Filters stations based on the defined bounding box and handles multiple bins."""
    
    # First, filter stations that are within the bounding box
    stations_in_box = []
    for st in stations:
        try:
            lat = float(st.get('lat', 0))
            lon = float(st.get('lon', 0))
            
            if LAT_BOUNDS[0] <= lat <= LAT_BOUNDS[1] and LON_BOUNDS[0] <= lon <= LON_BOUNDS[1]:
                stations_in_box.append(st)
        except (ValueError, TypeError):
            continue

    # Sort and group stations by stationID to handle duplicates
    stations_in_box.sort(key=lambda x: x.get('stationID'))
    
    final_stations = []
    for station_id, group in itertools.groupby(stations_in_box, key=lambda x: x.get('stationID')):
        station_list = list(group)
        
        if len(station_list) > 1:
            # Find station with the highest bin value
            station_to_use = max(station_list, key=lambda x: int(x.get('bin', 0)))
            link_id = f"{station_to_use.get('stationID')}_{station_to_use.get('bin')}"
        else:
            station_to_use = station_list[0]
            link_id = f"{station_to_use.get('stationID')}_{station_to_use.get('bin')}"

        final_stations.append({
            'id': station_to_use.get('stationID'),
            'name': station_to_use.get('stationName'),
            'lat': float(station_to_use.get('lat', 0)),
            'lon': float(station_to_use.get('lon', 0)),
            'bin': station_to_use.get('bin'),
            'data_link': f"https://api.tidesandcurrents.noaa.gov/dpapi/prod/webapi/currentPredictionsAnnualReport/?id={link_id}&year=2026&format=txt&time-zone=LST_LDT&units=1&date-timeUnits=24hr"
        })
        
    return final_stations

def download_and_parse_station_data(stations):
    """Downloads and parses the txt files for each station."""
    station_dims = []
    current_facts = []

    for station in stations:
        station_id = station['id']
        url = station['data_link']
        logging.info(f"Downloading data for station {station_id} from {url}")

        try:
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            response.encoding = 'utf-8'
            text_data = response.text
        except requests.RequestException as e:
            logging.error(f"Failed to download {url}: {e}")
            continue

        station_dim = {'id': station_id}
        lines = text_data.split('\n')
        
        header_pattern = re.compile(r'#\s*([^:]+):\s*(.*)')
        
        for line in lines:
            if line.startswith('#'):
                match = header_pattern.match(line)
                if match:
                    key = match.group(1).strip()
                    value = match.group(2).strip()
                    if key in ['Station ID', 'Depth', 'Station Name', 'Latitude', 'Longitude', 'Station Type', 'Ref Station', 'Ref Depth', 'Ref Station Name', 'Mean Flood Dir', 'Mean Ebb Dir']:
                        station_dim[key.lower().replace(' ', '_')] = value
            elif line.strip() and not line.startswith('Date'): # data lines
                parts = line.split()
                if len(parts) >= 4:
                    current_facts.append({
                        'station_id': station_id,
                        'date': parts[0],
                        'time': parts[1],
                        'event': parts[2],
                        'speed_knots': parts[3]
                    })

        station_dims.append(station_dim)

    return station_dims, current_facts

def save_station_dims(station_dims):
    """Saves the station dimension data to a CSV file."""
    output_filename = 'stations_dim.csv'
    if not station_dims:
        logging.warning("No station dimension data to save.")
        return
        
    try:
        with open(output_filename, 'w', newline='', encoding='utf-8') as csvfile:
            # Dynamically get fieldnames from the first record, ensuring 'id' is first.
            fieldnames = ['id'] + [k for k in station_dims[0].keys() if k != 'id']
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(station_dims)
        logging.info(f"Successfully saved {len(station_dims)} station dimensions to {output_filename}")
    except IOError as e:
        logging.error(f"Error writing to {output_filename}: {e}")
    except IndexError:
        logging.warning("Station dimensions list is empty, nothing to save.")

def save_currents_fact(current_facts):
    """Saves the current facts data to a CSV file."""
    output_filename = 'currents_fact.csv'
    if not current_facts:
        logging.warning("No current fact data to save.")
        return

    try:
        with open(output_filename, 'w', newline='', encoding='utf-8') as csvfile:
            fieldnames = ['station_id', 'date', 'time', 'event', 'speed_knots']
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(current_facts)
        logging.info(f"Successfully saved {len(current_facts)} current facts to {output_filename}")
    except IOError as e:
        logging.error(f"Error writing to {output_filename}: {e}")

def main():
    logging.info(f"Bounding box: LON {LON_BOUNDS}, LAT {LAT_BOUNDS}")
    
    stations = get_stations()
    logging.info(f"Retrieved {len(stations)} total stations from API.")
    
    nyc_stations = filter_stations(stations)
    logging.info(f"Found {len(nyc_stations)} stations within the bounding box.")
    
    if not nyc_stations:
        logging.warning("No stations found in the specified area.")
        return

    output_filename = 'stations_from_api.csv'
    try:
        with open(output_filename, 'w', newline='', encoding='utf-8') as csvfile:
            fieldnames = ['id', 'name', 'lat', 'lon', 'bin', 'data_link']
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(nyc_stations)
        logging.info(f"Successfully saved {len(nyc_stations)} stations to {output_filename}")
    except IOError as e:
        logging.error(f"Error writing to {output_filename}: {e}")

    # Download and parse text files
    station_dims, current_facts = download_and_parse_station_data(nyc_stations)
    
    # Save the parsed data
    save_station_dims(station_dims)
    save_currents_fact(current_facts)


if __name__ == '__main__':
    main()