from engine.run import run_scenario
from engine.city_generator import generate_advanced_city
from engine.rainfall import get_scripted_scenario, fetch_live_scenario

# 1. Generate the advanced spatial grid
print("Generating city...")
city = generate_advanced_city(N=200, M=200)

# 2. Select a rainfall scenario
# Option A: Use a scripted IMD preset
scenario = get_scripted_scenario("heavy")

# Option B: Uncomment below to fetch the live forecast instead
# scenario = fetch_live_scenario()

# 3. Run the engine
print(f"Running simulation: {scenario['name']}...")
result = run_scenario(city, scenario)

s = result["summary"]
peak_rain = max(result["rain_mmhr"]) # Extracts the highest mm/hr from the timeline[cite: 8]

print(f"\n--- Simulation Complete: {s['scenario']} ---")
print(f"Peak Rainfall:    {peak_rain:.1f} mm/hr")
print(f"Peak Depth:       {s['peak_depth_m']:.2f} m")
print(f"Critical Cells:   {s['critical_cells']}")
print(f"First Critical:   {s['first_critical_min'] if s['first_critical_min'] else 'Never'} mins") 
print(f"Peak Affected:    {s['peak_affected']:,.0f} people ({s['peak_affected_pct']:.1f}%)")
print(f"Mass Balance Err: {s['mass_err_rel']:.2e}")
