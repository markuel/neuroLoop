import { useState, useEffect } from 'react'
import useStore from '../stores/useStore'

const COARSE_COLORS = {
  'Visual': '#e94560',
  'Somatomotor': '#3b82f6',
  'Dorsal Attention': '#10b981',
  'Ventral Attention': '#f59e0b',
  'Limbic': '#8b5cf6',
  'Frontoparietal': '#ec4899',
  'Default': '#6b7280',
}

// Human-readable descriptions for functional network groups
const GROUP_DESCRIPTIONS = {
  'Visual': 'Processing what you see',
  'Somatomotor': 'Movement and physical sensation',
  'Dorsal Attention': 'Focusing on something specific',
  'Ventral Attention': 'Noticing something unexpected',
  'Limbic': 'Emotion and memory',
  'Frontoparietal': 'Thinking and decision making',
  'Default': 'Mind wandering and self-reflection',
}

// Human-readable descriptions for fine-grained networks
const FINE_DESCRIPTIONS = {
  'Primary Visual': 'Basic image processing',
  'Early Visual': 'Detecting edges and shapes',
  'Dorsal Stream Visual': 'Tracking where things are',
  'Ventral Stream Visual': 'Recognizing what things are',
  'MT+ Complex and Neighboring Areas': 'Perceiving motion',
  'Somatosensory and Motor': 'Touch and movement control',
  'Paracentral Lobular and Mid-Cingulate': 'Leg and trunk movement',
  'Premotor': 'Planning movements and eye gaze',
  'Posterior Opercular': 'Secondary touch and balance',
  'Early Auditory': 'Basic sound processing',
  'Auditory Association': 'Understanding speech and complex sounds',
  'Insular and Frontal Opercular': 'Gut feelings and emotional awareness',
  'Medial Temporal': 'Forming new memories',
  'Lateral Temporal': 'Understanding meaning and language',
  'Temporo-Parieto-Occipital Junction': 'Multisensory integration and social awareness',
  'Superior Parietal': 'Guiding reach, grasp, and gaze',
  'Inferior Parietal': 'Language, attention, and meaning',
  'Posterior Cingulate': 'Memory retrieval and self-reflection',
  'Anterior Cingulate and Medial Prefrontal': 'Social thinking and error monitoring',
  'Orbital and Polar Frontal': 'Judging value and reward',
  'Inferior Frontal': 'Speech, grammar, and word meaning',
  'Dorsolateral Prefrontal': 'Working memory and planning',
}

export default function RegionPanel() {
  const regions = useStore((s) => s.regions)
  const fineGroups = useStore((s) => s.fineGroups)
  const coarseGroups = useStore((s) => s.coarseGroups)
  const timestep = useStore((s) => s.timestep)
  const globalVmax = useStore((s) => s.globalVmax)
  const isPlaying = useStore((s) => s.isPlaying)
  const selectedRegion = useStore((s) => s.selectedRegion)
  const setSelectedRegion = useStore((s) => s.setSelectedRegion)

  const scaleMax = globalVmax || 1

  // Throttle the sort to ~4 updates/sec during playback
  const [entries, setEntries] = useState([])
  useEffect(() => {
    if (!regions) { setEntries([]); return }
    const id = setTimeout(() => {
      setEntries(
        Object.entries(regions)
          .map(([name, values]) => ({ name, value: values[timestep] ?? 0 }))
          .sort((a, b) => b.value - a.value)
      )
    }, isPlaying ? 250 : 0)
    return () => clearTimeout(id)
  }, [regions, timestep, isPlaying])

  if (!regions) {
    return (
      <div className="h-full bg-gray-950 p-4 flex items-center justify-center text-gray-600 text-sm">
        Run a prediction to see region scores
      </div>
    )
  }

  const clickable = !isPlaying

  return (
    <div className="h-full bg-gray-950 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-5 pt-3 pb-2 flex items-center justify-between border-b border-gray-800/50">
        <span className="text-[11px] text-gray-400 font-semibold tracking-wide uppercase">
          Region Activity
        </span>
        {clickable && (
          <span className="text-[10px] text-gray-600">
            {selectedRegion ? `Focused: ${selectedRegion}` : 'Click to focus'}
          </span>
        )}
      </div>

      {/* Two-column scrollable grid */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {entries.map(({ name, value }, i) => {
            const coarse = coarseGroups?.[name] || ''
            const fine = fineGroups?.[name] || ''
            const color = COARSE_COLORS[coarse] || '#6b7280'
            const pct = Math.max(0, Math.min(100, (value / scaleMax) * 100))
            const fineDesc = FINE_DESCRIPTIONS[fine] || fine
            const isSelected = selectedRegion === name

            return (
              <div
                key={name}
                onClick={() => {
                  if (!clickable) return
                  setSelectedRegion(isSelected ? null : name)
                }}
                className={`flex items-center gap-2 px-2 py-1.5 rounded transition-colors ${
                  clickable ? 'cursor-pointer hover:bg-gray-800/60' : ''
                } ${isSelected ? 'bg-gray-800 ring-1 ring-red-500/40' : ''}`}
              >
                {/* Rank number */}
                <span className="text-[9px] text-gray-600 w-4 text-right font-mono shrink-0">
                  {i + 1}
                </span>

                {/* Color dot */}
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: color, opacity: Math.max(0.25, pct / 100) }}
                />

                {/* Label */}
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-gray-200 truncate leading-tight">{fineDesc}</div>
                  <div className="text-[9px] text-gray-500 truncate leading-tight">{name}</div>
                </div>

                {/* Bar + percentage */}
                <div className="w-16 shrink-0 flex items-center gap-1.5">
                  <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: color }}
                    />
                  </div>
                  <span className="text-[9px] text-gray-500 font-mono w-7 text-right">
                    {pct.toFixed(0)}%
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
