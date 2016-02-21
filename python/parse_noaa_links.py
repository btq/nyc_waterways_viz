# -*- coding: utf-8 -*-
"""
Created on Wed Feb 17 15:34:44 2016

@author: btq
"""
import requests
from bs4 import BeautifulSoup
LON = [-74.0367, -73.9026]
LAT = [40.6823, 40.8840]
state_pages = ['http://tidesandcurrents.noaa.gov/noaacurrents/Stations?g=458','http://tidesandcurrents.noaa.gov/noaacurrents/Stations?g=457']
req = requests.get(state_pages[0])
soup = BeautifulSoup(req.text)
rows = soup.find_all('tr')
for r in rows:
    if r.a:
        link = r.a['href']
        latlon = [float(c.strip(' );')) for c in r.a['onmouseover'].split(',')[1:]]
        latlon[1] *= -1        
        if latlon[0] > LAT[0] and latlon[0] < LAT[1] and latlon[1] > LON[0] and latlon[1] < LON[1]:
            print latlon, r.a.text, link
            

#for sp in state_pages:
#    req = requests.get(sp)