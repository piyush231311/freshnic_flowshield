"""Stand-in city so the engine can be tested before Person B's generator exists.
Same keys as the real one:  z, D, channel_mask, pop  (all [N, M])."""
import numpy as np
from scipy.ndimage import gaussian_filter

def make_toy_city(n=50, seed=42, total_pop=500_000):
    rng = np.random.default_rng(seed)
    noise = gaussian_filter(rng.random((n, n)), 3)
    noise = (noise - noise.min()) / (noise.max() - noise.min())
    line = np.linspace(8.0, 0.0, n)[:, None] * np.ones((1, n))      # city slopes down toward the bottom edge
    z = line + 2.0 * noise                                          # banks are 0-2 m above the slope line

    channel = np.zeros((n, n), bool); channel[:, n // 2] = True     # a channel down the middle
    z[channel] = line[channel] - 0.5                                # carved below the banks

    D = np.full((n, n), 20.0)                                       # mm/hr, typical storm-drain design capacity...
    D[channel] = 30.0                                               # ...better along the channel
    D[-3:, n // 2 - 1 : n // 2 + 2] = 400.0                         # outlet/pump station at the channel's end

    yy, xx = np.mgrid[0:n, 0:n]
    pop = np.zeros((n, n))
    for cy, cx, s, w in [(0.75, 0.5, 0.12, 1.0), (0.3, 0.25, 0.09, 0.5), (0.4, 0.75, 0.10, 0.6)]:
        pop += w * np.exp(-(((yy / n - cy) ** 2 + (xx / n - cx) ** 2) / (2 * s ** 2)))
    pop *= 1 + 0.5 * (1 - (z - z.min()) / (z.max() - z.min()))      # slightly denser at low elevation
    pop *= total_pop / pop.sum()
    return {"z": z, "D": D, "channel_mask": channel, "pop": pop}