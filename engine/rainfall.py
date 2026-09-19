import requests

def get_scripted_scenario(intensity="heavy", events=None):
    """
    Returns a scenario dictionary with standard scripted rain presets[cite: 1, 8].
    """
    events = events or []
    
    if intensity == "normal":
        # Constant light/normal rain
        return {
            "name": "Normal Rain", 
            "rain": {"shape": "constant", "peak_mm_hr": 8.0, "duration_h": 3.0}, 
            "events": events
        }
    elif intensity == "heavy":
        # Triangular storm peaking at 60 mm/hr
        return {
            "name": "Heavy Rain", 
            "rain": {"shape": "triangular", "peak_mm_hr": 60.0, "duration_h": 3.0}, 
            "events": events
        }
    elif intensity == "extreme":
        # Triangular storm peaking at 100 mm/hr
        return {
            "name": "Extreme Rain", 
            "rain": {"shape": "triangular", "peak_mm_hr": 100.0, "duration_h": 3.0}, 
            "events": events
        }
    else:
        raise ValueError("Intensity must be 'normal', 'heavy', or 'extreme'")


def fetch_live_scenario(lat=12.9716, lon=77.5946, name="Live Forecast"):
    """
    Fetches the next 168 hours of precipitation from Open-Meteo (free, no key)[cite: 1].
    Defaults to Bengaluru coordinates.
    """
    url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly=precipitation"
    
    print(f"Fetching live weather data for Lat: {lat}, Lon: {lon}...")
    response = requests.get(url)
    response.raise_for_status()
    data = response.json()
    
    return {
        "name": name,
        "rain": {
            "shape": "series", 
            "mm_hr": data["hourly"]["precipitation"]
        },
        "events": []
    }