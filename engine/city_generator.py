import numpy as np
from scipy.ndimage import gaussian_filter

def generate_advanced_city(N=200, M=200, seed=42, total_pop=500_000):
    """
    Generates realistic synthetic city arrays mapping to the CONTRACT.md requirements.
    Returns: dict with z, D, channel_mask, pop (all shape [N, M])
    """
    rng = np.random.default_rng(seed)
    
    # 1. Terrain (z) using Fractal Noise
    # Layering multiple Gaussian filters mimics Perlin noise for natural topography
    noise_base = gaussian_filter(rng.random((N, M)), sigma=15) * 10.0
    noise_detail = gaussian_filter(rng.random((N, M)), sigma=3) * 2.0
    z = noise_base + noise_detail
    
    # Add a general slope (e.g., city slopes down towards the South-East)
    yy, xx = np.mgrid[0:N, 0:M]
    slope = (xx * 0.02) + (yy * 0.03)
    z -= slope
    
    # Normalize elevation to be strictly positive, spanning ~0 to 15 meters
    z = (z - z.min()) / (z.max() - z.min()) * 15.0

    # 2. Meandering Channel (channel_mask)
    channel_mask = np.zeros((N, M), dtype=bool)
    # Create a sine-wave river path flowing top to bottom
    for y in range(N):
        # River meanders horizontally; gets wider at the bottom
        x_center = int(M / 2 + np.sin(y / 20.0) * (M / 6))
        width = 2 + int(y / (N / 4)) 
        x_start = max(0, x_center - width)
        x_end = min(M, x_center + width)
        channel_mask[y, x_start:x_end] = True

    # Carve the channel into the terrain so water flows into it
    z[channel_mask] -= 2.0 

    # 3. Population Distribution (pop)
    # Use Gaussian blobs[cite: 1] for urban centers, avoiding the river
    pop = np.zeros((N, M))
    urban_centers = [(0.3, 0.3, 0.1), (0.7, 0.2, 0.08), (0.4, 0.8, 0.12), (0.8, 0.7, 0.09)] # (cy, cx, spread)
    
    for cy, cx, s in urban_centers:
        pop += np.exp(-(((yy / N - cy) ** 2 + (xx / M - cx) ** 2) / (2 * s ** 2)))
    
    # Push population out of the deep river channel
    pop[channel_mask] = 0.0 
    
    # Scale exactly to the target total population
    pop = pop / pop.sum() * total_pop

    # 4. Drainage Capacity (D) in mm/hr
    # Base capacity is 15 mm/hr, highly populated areas get upgraded to 40 mm/hr
    D = np.full((N, M), 15.0)
    D += (pop / pop.max()) * 25.0 
    
    # Channels naturally carry massive amounts of water
    D[channel_mask] = 200.0
    # Add an extreme pump station at the river's delta (bottom edge)
    D[-5:, :] = np.where(channel_mask[-5:, :], 500.0, D[-5:, :])

    return {
        "z": z,
        "D": D,
        "channel_mask": channel_mask,
        "pop": pop
    }

if __name__ == "__main__":
    # Quick smoke test to ensure shapes and values are correct
    city = generate_advanced_city(N=200, M=200)
    print(f"Terrain range: {city['z'].min():.2f}m to {city['z'].max():.2f}m")
    print(f"Total Population: {city['pop'].sum():,.0f}")
    print(f"Max Drainage: {city['D'].max():.1f} mm/hr")
    print("Shapes:", {k: v.shape for k, v in city.items()})