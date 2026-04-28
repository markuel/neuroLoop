import useStore from '../stores/useStore'

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function Timeline() {
  const currentTime = useStore((s) => s.currentTime)
  const duration = useStore((s) => s.duration)
  const isPlaying = useStore((s) => s.isPlaying)
  const togglePlaying = useStore((s) => s.togglePlaying)
  const setCurrentTime = useStore((s) => s.setCurrentTime)
  const setScrubbing = useStore((s) => s.setScrubbing)

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const clampedTime = duration > 0 ? Math.min(currentTime, duration) : 0
  const seekTo = (e) => setCurrentTime(Number(e.currentTarget.value))

  return (
    <div className="h-10 bg-gray-950 border-t border-b border-gray-800 flex items-center gap-3 px-4">
      <button
        onClick={togglePlaying}
        className="text-white hover:text-red-400 transition text-sm w-6"
        aria-label={isPlaying ? 'Pause playback' : 'Play playback'}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>
      <span className="text-xs text-gray-500 w-10 text-right">{formatTime(currentTime)}</span>
      <input
        type="range"
        min="0"
        max={duration || 0}
        step="0.01"
        value={clampedTime}
        disabled={duration <= 0}
        onPointerDown={() => setScrubbing(true)}
        onPointerUp={(e) => {
          seekTo(e)
          setScrubbing(false)
        }}
        onPointerCancel={() => setScrubbing(false)}
        onBlur={() => setScrubbing(false)}
        onInput={seekTo}
        onChange={seekTo}
        aria-label="Seek playback"
        aria-valuetext={`${formatTime(clampedTime)} of ${formatTime(duration)}`}
        className="flex-1 h-1 rounded cursor-pointer accent-red-500 disabled:cursor-default"
        style={{
          background: `linear-gradient(90deg, #e94560 0%, #533483 ${progress}%, #1f2937 ${progress}%, #1f2937 100%)`,
        }}
      />
      <span className="text-xs text-gray-500 w-10">{formatTime(duration)}</span>
    </div>
  )
}
