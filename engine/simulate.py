import numpy as np

MM_HR = 1 / 1000 / 3600          # converts mm/hr to m/s

def step(h, z, rain, D, f, k, dt, gain=None, return_out=False, capacity_left=None):
    """One time step. h, z in metres. rain, D, f in m/s. k in 1/s.
    gain: optional [4,N,M] multipliers on outflow (N,S,W,E). >1 = faster channel, 0 = blocked.
    return_out: if True, also returns out [4,N,M] directional cell outflows.
    capacity_left: optional [N,M] array or scalar of remaining soil capacity (in metres)."""
    h = h + rain * dt                                   # 1. rain

    # 2. active physical soil infiltration (f can be scalar or [N, M] array)
    if capacity_left is not None:
        infil = np.minimum(f * dt, np.minimum(h, np.maximum(0.0, capacity_left)))
    else:
        infil = np.minimum(f * dt, h)
    h = h - infil

    H = z + h                                           # 3. flow (water level = ground + depth)
    alpha = min(0.25, k * dt)                           #    stability limit
    Hp = np.pad(H, 1, mode="edge")                      #    closed border: no flow out of the city
    nbr = [Hp[:-2, 1:-1], Hp[2:, 1:-1], Hp[1:-1, :-2], Hp[1:-1, 2:]]   # N, S, W, E
    out = np.stack([alpha * np.maximum(0, H - Hn) for Hn in nbr])
    if gain is not None:
        out = out * gain                                #    channels speed water up, blockages stop it
    total = out.sum(axis=0)
    out *= np.minimum(1.0, h / np.maximum(total, 1e-12))   # never send more water than you have
    inflow = np.zeros_like(h)
    inflow[:-1, :] += out[0][1:, :]                     #    water sent north arrives one row up
    inflow[1:, :]  += out[1][:-1, :]                    #    south
    inflow[:, :-1] += out[2][:, 1:]                     #    west
    inflow[:, 1:]  += out[3][:, :-1]                    #    east
    h = h - out.sum(axis=0) + inflow

    drained = np.minimum(D * dt, h); h = h - drained   # 4. drainage
    h = np.clip(h, 0.0, None)                          # zero-floor depth clipping: eliminate rounding artifacts

    if return_out:
        return h, drained, infil, out
    return h, drained, infil




def simulate(z, D_mmhr, rain_mmhr, hours=3, dt=10.0, k=0.01, f_mmhr=0.0, save_every=30):
    D, f, rain = D_mmhr * MM_HR, f_mmhr * MM_HR, rain_mmhr * MM_HR
    h = np.zeros_like(z, dtype=float)
    frames, rain_in, drained_out, infil_out = [h.copy()], 0.0, 0.0, 0.0   # frame 0 = t=0
    for s in range(int(hours * 3600 / dt)):
        h, dr, inf = step(h, z, rain, D, f, k, dt)
        rain_in += rain * dt * z.size
        drained_out += dr.sum()
        infil_out += inf.sum()
        if (s + 1) % save_every == 0:             # save AFTER the step, so frame i is at t = i*save_every*dt
            frames.append(h.copy())
    mass_err = rain_in - drained_out - infil_out - h.sum()
    return {"h": np.array(frames), "h_final": h, "mass_err": mass_err,
            "minutes_per_frame": save_every * dt / 60}