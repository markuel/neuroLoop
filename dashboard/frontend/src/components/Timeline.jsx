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

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  function handleScrub(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    setCurrentTime(x * duration)
  }

  return (
    <div className="h-10 bg-gray-950 border-t border-b border-gray-800 flex items-center gap-3 px-4">
      <button
        onClick={togglePlaying}
        className="text-white hover:text-red-400 transition text-sm w-6"
      >
        {isPlaying ? '⏸' : '▶'}
      </button>
      <span className="text-xs text-gray-500 w-10 text-right">{formatTime(currentTime)}</span>
      <div
        className="flex-1 h-1 bg-gray-800 rounded cursor-pointer relative"
        onClick={handleScrub}
      >
        <div
          className="h-full rounded"
          style={{
            width: `${progress}%`,
            background: 'linear-gradient(90deg, #e94560, #533483)',
          }}
        />
      </div>
      <span className="text-xs text-gray-500 w-10">{formatTime(duration)}</span>
    </div>
  )
}
