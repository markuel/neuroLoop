// Gray brain surface color (matches sulcal background)
export const BRAIN_GRAY_R = 0.42
export const BRAIN_GRAY_G = 0.42
export const BRAIN_GRAY_B = 0.42

/**
 * Build vertex colors for the interactive brain surface:
 *
 * 1. Normalize raw activations to 0-1 using robust percentile bounds (vmin/vmax)
 * 2. Clip to [0, 1]
 * 3. Below threshold (0.3): blend toward gray brain surface
 * 4. Above threshold: red/orange/yellow heatmap at full opacity
 *
 * Since WebGL vertex colors do not support true transparency on a single mesh,
 * we blend the fire color with gray proportionally.
 *
 * Writes directly into the provided output buffer to avoid per-frame allocations.
 *
 * @param {Float32Array} activations - raw activation values per vertex
 * @param {number} vmin - 1st percentile (maps to 0)
 * @param {number} vmax - 99th percentile (maps to 1)
 * @param {Float32Array} out - preallocated RGB output buffer, length n_vertices * 3
 * @param {number} threshold - normalized cutoff below which vertices are gray
 * @param {number} fadeWidth - range over which alpha ramps from 0 to 1 above threshold
 */
export function activationsToColors(activations, vmin, vmax, out, threshold = 0.3, fadeWidth = 0.25) {
  const n = activations.length
  const range = vmax - vmin || 1

  for (let i = 0; i < n; i++) {
    const t = Math.max(0, Math.min(1, (activations[i] - vmin) / range))
    const j = i * 3

    if (t < threshold) {
      out[j] = BRAIN_GRAY_R
      out[j + 1] = BRAIN_GRAY_G
      out[j + 2] = BRAIN_GRAY_B
    } else {
      // Capped heatmap: visible activation without washing the surface white.
      const heat = Math.max(0, Math.min(1, (t - threshold) / (1 - threshold)))
      const fr = 0.82 + 0.18 * heat
      const fg = 0.12 + 0.68 * Math.max(0, Math.min(1, (heat - 0.25) / 0.75))
      const fb = 0.04 + 0.12 * Math.max(0, Math.min(1, (heat - 0.65) / 0.35))

      const alpha = Math.min(1, (t - threshold) / fadeWidth)
      const invAlpha = 1 - alpha
      out[j] = BRAIN_GRAY_R * invAlpha + fr * alpha
      out[j + 1] = BRAIN_GRAY_G * invAlpha + fg * alpha
      out[j + 2] = BRAIN_GRAY_B * invAlpha + fb * alpha
    }
  }
}
