# -*- coding: utf-8 -*-
"""
Created on Wed Feb 17 15:34:44 2016

@author: btq
"""
import logging
import requests
import csv
from urllib.parse import urljoin
from bs4 import BeautifulSoup
import re

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

logging.info("Parsing NOAA current station links...")
LON = [-74.056, -73.781]
LAT = [40.544, 40.8840]
logging.info(f'Bounding box: LON {LON}, LAT {LAT}')

# Use NOAA Current Predictions Page for NYC area
url = 'https://tidesandcurrents.noaa.gov/noaacurrents/stations.html?g=458'

try:
    logging.info(f"Requesting URL: {url}")
    resp = requests.get(url)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, 'html.parser')

    stations = {}
    # Find the main table (usually contains 'Bin' in headers)
    table = None
    for t in soup.find_all('table'):
        if 'PREDICTIONS' in t.text:
            table = t
            logging.info("Found target table with 'PREDICTIONS' in headers.")
            break

    if table:
        logging.info("Parsing table...")
        # Iterate rows, skip header
        for row in table.find_all('tr')[1:]:
            logging.debug(f"Processing row: {row}")
            cols = row.find_all('td')
            if len(cols) >= 5:
                try:
                    name = cols[0].text.strip()
                    link_tag = cols[0].find('a')
                    link = urljoin(url, link_tag['href']) if link_tag else ''

                    sid = cols[1].text.strip()
                    bin_val = cols[2].text.strip()
                    lat_str = cols[3].text.strip()
                    lon_str = cols[4].text.strip()

                    bin_num = int(bin_val) if bin_val.isdigit() else 0

                    lat = float(re.findall(r"[\d\.]+", lat_str)[0])
                    if 'S' in lat_str: lat = -lat

                    lon = float(re.findall(r"[\d\.]+", lon_str)[0])
                    if 'W' in lon_str: lon = -lon

                    st = {'name': name, 'id': sid, 'bin': bin_num, 'lat': lat, 'lng': lon, 'link': link}

                    # If station exists, keep the one with higher bin
                    if sid not in stations or bin_num > stations[sid]['bin']:
                        stations[sid] = st
                except (ValueError, IndexError) as e:
                    logging.debug(f"Error parsing row: {e}")
                    continue

    logging.info(f'Found {len(stations)} stations in total.')

    with open('stations.csv', 'w', newline='', encoding='utf-8') as csvfile, \
         open('station_links.txt', 'w', encoding='utf-8') as linkfile:
        
        writer = csv.writer(csvfile)
        writer.writerow(['name', 'station_id', 'longitude', 'latitude'])

        for st in stations.values():
            lat = st['lat']
            lon = st['lng']
            logging.debug(f"Processing station {st['name']} at ({lat}, {lon})")
            if LAT[0] < lat < LAT[1] and LON[0] < lon < LON[1]:
                writer.writerow([st['name'], st['id'], st['lng'], st['lat']])
                linkfile.write(f"{st['link']}\n")
                logging.info(f"Saved {st['name']}")
            else:
                logging.debug(f"Skipping {st['name']} (out of bounds)")
except Exception as e:
    logging.error(f"Error fetching stations: {e}", exc_info=True)