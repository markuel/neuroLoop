// Gray brain surface color (matches sulcal background)
export const BRAIN_GRAY_R = 0.42
export const BRAIN_GRAY_G = 0.42
export const BRAIN_GRAY_B = 0.42

/**
 * Build vertex colors matching the notebook's rendering approach:
 *
 * 1. Normalize raw activations to 0–1 using robust percentile bounds (vmin/vmax)
 * 2. Clip to [0, 1]
 * 3. Below threshold (0.6): blend toward gray brain surface (alpha fades out)
 * 4. Above threshold: fire colorscale at full opacity
 *
 * The alpha_cmap=(0, 0.2) in the notebook means:
 *   - At normalized value 0.0 → alpha = 0 (fully transparent / gray)
 *   - At normalized value 0.2 → alpha = 1 (fully opaque / fire color)
 *   - Combined with vmin=0.6, values below 0.6 are invisible,
 *     values 0.6–0.8 fade in, values above 0.8 are full color.
 *
 * Since WebGL vertex colors don't support true transparency on a single mesh,
 * we blend the fire color with gray proportionally.
 *
 * Writes directly into the provided output buffer to avoid per-frame allocations.
 *
 * @param {Float32Array} activations - raw activation values per vertex
 * @param {number} vmin - 1st percentile (maps to 0)
 * @param {number} vmax - 99th percentile (maps to 1)
 * @param {Float32Array} out - preallocated RGB output buffer, length n_vertices * 3
 * @param {number} threshold - normalized cutoff below which vertices are gray (default 0.6)
 * @param {number} fadeWidth - range over which alpha ramps from 0→1 above threshold (default 0.2)
 */
export function activationsToColors(activations, vmin, vmax, out, threshold = 0.6, fadeWidth = 0.2) {
  const n = activations.length
  const range = vmax - vmin || 1

  for (let i = 0; i < n; i++) {
    // Normalize to 0–1 and clip
    const t = Math.max(0, Math.min(1, (activations[i] - vmin) / range))
    const j = i * 3

    if (t < threshold) {
      // Below threshold: gray brain surface
      out[j] = BRAIN_GRAY_R
      out[j + 1] = BRAIN_GRAY_G
      out[j + 2] = BRAIN_GRAY_B
    } else {
      // Fire colorscale (inlined to avoid per-vertex array allocation)
      const fr = Math.min(1, t * 2)
      const fg = Math.max(0, Math.min(1, (t - 0.35) * 2.5))
      const fb = Math.max(0, Math.min(1, (t - 0.7) * 3.33))

      // Blend fire color with gray based on alpha ramp
      const alpha = Math.min(1, (t - threshold) / fadeWidth)
      const invAlpha = 1 - alpha
      out[j] = BRAIN_GRAY_R * invAlpha + fr * alpha
      out[j + 1] = BRAIN_GRAY_G * invAlpha + fg * alpha
      out[j + 2] = BRAIN_GRAY_B * invAlpha + fb * alpha
    }
  }
}
