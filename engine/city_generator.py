import numpy as np
from scipy.ndimage import gaussian_filter

def generate_advanced_city(N=400, M=400, seed=42, total_pop=500_000, grid_size=4):
    """
    Generates realistic synthetic city arrays scaled to NxM (default 400x400).
    Features:
    - High-density population centers ('Downtown Sector' & 'Residential Basin') directly on/adjacent to the river.
    - Topographical bowl/depression in terrain (z) under dense population centers to induce natural pooling.
    - Meandering channel (channel_mask) running north-to-south.
    - Region mapping (Wards 0..15).
    """
    rng = np.random.default_rng(seed)
    
    # 1. Terrain (z) using Fractal Noise
    noise_base = gaussian_filter(rng.random((N, M)), sigma=max(3, int(30 * N / 400))) * 10.0
    noise_detail = gaussian_filter(rng.random((N, M)), sigma=max(1, int(6 * N / 400))) * 2.0
    z = noise_base + noise_detail
    
    yy, xx = np.mgrid[0:N, 0:M]
    slope = (xx * (0.02 * 400 / M)) + (yy * (0.03 * 400 / N))
    z -= slope
    z = (z - z.min()) / (z.max() - z.min()) * 15.0

    # 2. Meandering Channel (channel_mask)
    channel_mask = np.zeros((N, M), dtype=bool)
    for y in range(N):
        x_center = int(M / 2 + np.sin(y / (N * 0.10)) * (M / 6))
        width = max(2, int(4 * M / 400.0) + int(y / (N / 4)))
        x_start = max(0, x_center - width)
        x_end = min(M, x_center + width)
        channel_mask[y, x_start:x_end] = True

    # 3. Topography Tweak: Carve depression bowl under the high-density population centers
    # Downtown Sector depression (y~0.45, x~0.40) and Residential Basin (y~0.62, x~0.52)
    bowl_downtown = 4.0 * np.exp(-(((yy / N - 0.45) ** 2 + (xx / M - 0.40) ** 2) / (2 * 0.12 ** 2)))
    bowl_basin = 3.0 * np.exp(-(((yy / N - 0.62) ** 2 + (xx / M - 0.52) ** 2) / (2 * 0.10 ** 2)))
    z -= (bowl_downtown + bowl_basin)

    # Deepen river channel relative to surrounding floodplain
    z[channel_mask] -= 2.0 
    z = np.clip(z - z.min() + 0.5, 0.5, None)

    # 4. Population Distribution (pop)
    # Force two major high-density population centers directly on / adjacent to the meandering river
    pop = np.zeros((N, M))
    urban_centers = [
        # (cy, cx, sigma, weight)
        (0.45, 0.40, 0.10, 3.5),  # 1. Downtown Sector (directly overlaps river corridor)
        (0.62, 0.52, 0.09, 2.5),  # 2. Residential Basin (adjacent to river bend)
        (0.25, 0.75, 0.09, 0.9),  # 3. Eastern Suburban Heights
        (0.20, 0.25, 0.08, 0.7),  # 4. North-West District
        (0.82, 0.25, 0.08, 0.5),  # 5. South-West Outskirts
    ]
    
    for cy, cx, s, weight in urban_centers:
        pop += weight * np.exp(-(((yy / N - cy) ** 2 + (xx / M - cx) ** 2) / (2 * s ** 2)))
    
    # Waterfront population: deep river channel holds minimal pop, while immediate riverbanks are dense
    pop[channel_mask] *= 0.10
    pop = pop / pop.sum() * total_pop

    # 5. Drainage Capacity (D)
    D = np.full((N, M), 15.0)
    D += (pop / pop.max()) * 25.0 
    D[channel_mask] = 200.0
    D[-max(1, int(10 * N / 400)):, :] = np.where(channel_mask[-max(1, int(10 * N / 400)):, :], 500.0, D[-max(1, int(10 * N / 400)):, :])

    # 6. Region Mapping (16-Ward Division)
    region_map = np.zeros((N, M), dtype=int)
    row_step, col_step = N // grid_size, M // grid_size
    
    region_id = 0
    for r in range(grid_size):
        for c in range(grid_size):
            region_map[r*row_step:(r+1)*row_step, c*col_step:(c+1)*col_step] = region_id
            region_id += 1

    return {
        "z": z, "D": D, "channel_mask": channel_mask, "pop": pop,
        "region_map": region_map, "n_regions": region_id
    }

if __name__ == "__main__":
    city = generate_advanced_city(N=400, M=400)
    print(f"Terrain range: {city['z'].min():.2f}m to {city['z'].max():.2f}m")
    print(f"Total Population: {city['pop'].sum():,.0f}")
    print(f"Max Drainage: {city['D'].max():.1f} mm/hr")
    print(f"Total Regions (Wards): {city['n_regions']}")
    print("Shapes:", {k: v.shape if hasattr(v, 'shape') else type(v) for k, v in city.items()})