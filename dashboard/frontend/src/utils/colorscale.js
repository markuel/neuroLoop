/**
 * "Fire" colorscale matching the notebook's cmap="fire".
 * Maps 0–1 to black → red → orange → yellow → white.
 */
function fireColor(t) {
  t = Math.max(0, Math.min(1, t))
  const r = Math.min(1, t * 2)
  const g = Math.max(0, Math.min(1, (t - 0.35) * 2.5))
  const b = Math.max(0, Math.min(1, (t - 0.7) * 3.33))
  return [r, g, b]
}

// Gray brain surface color (matches sulcal background)
const BRAIN_GRAY = [0.42, 0.42, 0.42]

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
 * @param {Float32Array} activations - raw activation values per vertex
 * @param {number} vmin - 1st percentile (maps to 0)
 * @param {number} vmax - 99th percentile (maps to 1)
 * @param {number} threshold - normalized cutoff below which vertices are gray (default 0.6)
 * @param {number} fadeWidth - range over which alpha ramps from 0→1 above threshold (default 0.2)
 * @returns {Float32Array} - RGB colors, length n_vertices * 3
 */
export function activationsToColors(activations, vmin, vmax, threshold = 0.6, fadeWidth = 0.2) {
  const n = activations.length
  const colors = new Float32Array(n * 3)
  const range = vmax - vmin || 1

  for (let i = 0; i < n; i++) {
    // Step 1: normalize to 0–1 and clip
    const t = Math.max(0, Math.min(1, (activations[i] - vmin) / range))

    if (t < threshold) {
      // Below threshold: gray brain surface
      colors[i * 3] = BRAIN_GRAY[0]
      colors[i * 3 + 1] = BRAIN_GRAY[1]
      colors[i * 3 + 2] = BRAIN_GRAY[2]
    } else {
      // Above threshold: blend fire color with gray based on alpha ramp
      const alpha = Math.min(1, (t - threshold) / fadeWidth)
      const [fr, fg, fb] = fireColor(t)
      colors[i * 3] = BRAIN_GRAY[0] * (1 - alpha) + fr * alpha
      colors[i * 3 + 1] = BRAIN_GRAY[1] * (1 - alpha) + fg * alpha
      colors[i * 3 + 2] = BRAIN_GRAY[2] * (1 - alpha) + fb * alpha
    }
  }
  return colors
}
