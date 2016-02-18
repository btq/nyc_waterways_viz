# -*- coding: utf-8 -*-
"""
Created on Wed Feb 17 15:34:44 2016

@author: btq
"""
import requests
from bs4 import BeautifulSoup

state_pages = ['http://tidesandcurrents.noaa.gov/noaacurrents/Stations?g=458','http://tidesandcurrents.noaa.gov/noaacurrents/Stations?g=457']
req = requests.get(state_pages[0])
soup = BeautifulSoup(req.text)
rows = soup.find_all('tr')
for r in rows:
    if r.a:
        link = r.a['href']
        coords = r.a['onmouseover'].split(',')[1:]
        []

parties = partylist.find_all('div',attrs={'class': 'views-row'})
#for sp in state_pages:
#    req = requests.get(sp)