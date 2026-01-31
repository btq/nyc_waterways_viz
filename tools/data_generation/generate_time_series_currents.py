import pandas as pd
import json
from datetime import datetime, timedelta
import math

def parse_direction(dir_str):
    """
    Extracts the numerical direction from a string like '352° (T)'.
    """
    if isinstance(dir_str, str) and '°' in dir_str:
        return float(dir_str.split('°')[0])
    return 0.0

def get_event_properties(event, station_dim):
    """
    Determines the speed and direction for a given tidal event record.
    """
    event_type = event['event']
    
    if event_type == 'slack':
        # Slack tide has zero speed and undefined direction (we use 0).
        speed = 0.0
        direction = 0.0
    elif event_type == 'ebb':
        # Ebb tide flows outwards. Speed is absolute, direction is from station dimension.
        speed = abs(float(event['speed_knots'])) if event['speed_knots'] != '-' else 0.0
        direction = station_dim['mean_ebb_dir_val']
    elif event_type == 'flood':
        # Flood tide flows inwards. Speed is absolute, direction is from station dimension.
        speed = abs(float(event['speed_knots'])) if event['speed_knots'] != '-' else 0.0
        direction = station_dim['mean_flood_dir_val']
    else:
        speed = 0.0
        direction = 0.0

    return speed, direction

def interpolate_single_timestamp(target_dt, dims_df, facts_df, sorted_station_ids):
    """
    Performs current interpolation for a single given timestamp.
    Returns a list of [direction, speed] corresponding to the sorted_station_ids.
    """
    output_samples = []

    # Pre-filter facts for efficiency? For now, keep it simple but ensure order.
    # Grouping by station_id is efficient enough for this scale.
    grouped_facts = dict(list(facts_df.groupby('station_id')))

    for station_id in sorted_station_ids:
        if station_id not in grouped_facts:
            # If no data for this station, append a null/zero vector
            output_samples.append([0, 0.0])
            continue

        station_facts = grouped_facts[station_id].sort_values('datetime')
        before_events = station_facts[station_facts['datetime'] <= target_dt]
        after_events = station_facts[station_facts['datetime'] > target_dt]

        if before_events.empty or after_events.empty:
             output_samples.append([0, 0.0])
             continue

        event_before = before_events.iloc[-1]
        event_after = after_events.iloc[0]

        station_dim_rows = dims_df[dims_df['id'] == station_id]
        if station_dim_rows.empty:
             output_samples.append([0, 0.0])
             continue
        station_dim = station_dim_rows.iloc[0]

        t1 = event_before['datetime']
        t2 = event_after['datetime']
        speed1, dir1 = get_event_properties(event_before, station_dim)
        speed2, dir2 = get_event_properties(event_after, station_dim)

        time_diff_total = (t2 - t1).total_seconds()
        if time_diff_total == 0:
            interp_speed = speed1
            interp_dir = dir1
        else:
            time_ratio = (target_dt - t1).total_seconds() / time_diff_total
            interp_speed = (speed1 - speed2) / 2 * math.cos(time_ratio * math.pi) + (speed1 + speed2) / 2
            
            type1 = event_before['event']
            type2 = event_after['event']

            if type1 == 'ebb' or type2 == 'ebb':
                interp_dir = station_dim['mean_ebb_dir_val']
            elif type1 == 'flood' or type2 == 'flood':
                interp_dir = station_dim['mean_flood_dir_val']
            else:
                interp_dir = 0.0

        output_samples.append([int(round(interp_dir)), round(interp_speed, 2)])

    return {
        'date': target_dt.strftime('%Y-%m-%d %H:%M:%S'),
        'samples': output_samples
    }

def generate_time_series_currents():
    """
    Generates partitioned JSON files with interpolated current data, grouped by day.
    """
    print("Loading and preparing data...")
    try:
        dims_df = pd.read_csv('stations_dim.csv', dtype={'id': str})
        facts_df = pd.read_csv('currents_fact.csv', dtype={'station_id': str})
    except FileNotFoundError as e:
        print(f"Error loading data: {e}. Please run the scraper first.")
        return

    facts_df['datetime'] = pd.to_datetime(facts_df['date'] + ' ' + facts_df['time'], errors='coerce')
    facts_df.dropna(subset=['datetime'], inplace=True)
    dims_df['mean_ebb_dir_val'] = dims_df['mean_ebb_dir'].apply(parse_direction)
    dims_df['mean_flood_dir_val'] = dims_df['mean_flood_dir'].apply(parse_direction)
    
    import os
    output_dir = '../../public/data/currents/partitioned'
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    # 1. Generate Station Metadata (Static)
    print("Generating station metadata...")
    sorted_stations = dims_df.sort_values('id')
    sorted_station_ids = sorted_stations['id'].tolist()
    
    stations_metadata = []
    for _, row in sorted_stations.iterrows():
        stations_metadata.append({
            'stationId': str(row['id']),
            'coordinates': [float(row['longitude']), float(row['latitude'])]
        })
        
    with open(os.path.join(output_dir, 'stations.json'), 'w') as f:
        json.dump(stations_metadata, f, indent=None)
    print(f"Saved stations.json with {len(stations_metadata)} stations.")

    # 2. Generate Time Series Data (Dynamic)
    start_dt = datetime(2026, 1, 30, 12, 0)
    end_dt = datetime(2026, 12, 31, 23, 59) # ~2 months of data
    
    print(f"Generating partitioned data from {start_dt} to {end_dt}...")
    
    current_dt = start_dt
    current_day_data = []
    current_day_str = start_dt.strftime('%Y-%m-%d')
    data_index = {}

    while current_dt <= end_dt:
        day_str = current_dt.strftime('%Y-%m-%d')
        
        if day_str != current_day_str:
            filename = f"{current_day_str}.json"
            filepath = os.path.join(output_dir, filename)
            with open(filepath, 'w') as f:
                json.dump(current_day_data, f, indent=None)
            print(f"Saved {filename} with {len(current_day_data)} records.")
            data_index[current_day_str] = filename
            
            current_day_str = day_str
            current_day_data = []

        # Pass sorted_station_ids to ensure order matches stations.json
        json_obj = interpolate_single_timestamp(current_dt, dims_df, facts_df, sorted_station_ids)
        current_day_data.append(json_obj)
        current_dt += timedelta(minutes=15)

    if current_day_data:
        filename = f"{current_day_str}.json"
        filepath = os.path.join(output_dir, filename)
        with open(filepath, 'w') as f:
            json.dump(current_day_data, f, indent=None)
        print(f"Saved {filename} with {len(current_day_data)} records.")
        data_index[current_day_str] = filename

    with open(os.path.join(output_dir, 'index.json'), 'w') as f:
        json.dump(data_index, f, indent=None)
    print("Finished generating partitioned data and index.json")


if __name__ == '__main__':
    import logging
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    generate_time_series_currents()
