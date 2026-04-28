import { useRef, useState } from 'react'
import UploadModal from './UploadModal'
import HistoryDrawer from './HistoryDrawer'

const WORKSPACES = [
  {
    id: 'analyze',
    label: 'Analyze Stimulus',
    description: 'Inspect predicted brain activity for media or text',
  },
  {
    id: 'generate',
    label: 'Generate Video',
    description: 'Run the agent loop toward a target brain state',
  },
]

export default function TopBar({ activeWorkspace, onWorkspaceChange, onLoadJob }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('file')
  const [historyOpen, setHistoryOpen] = useState(false)
  const fileButtonRef = useRef(null)
  const textButtonRef = useRef(null)
  const historyButtonRef = useRef(null)

  const restoreFocus = (ref) => {
    window.requestAnimationFrame(() => ref.current?.focus())
  }

  const closeModal = () => {
    setModalOpen(false)
    restoreFocus(modalMode === 'file' ? fileButtonRef : textButtonRef)
  }

  const closeHistory = () => {
    setHistoryOpen(false)
    restoreFocus(historyButtonRef)
  }

  return (
    <>
      <div className="h-14 bg-gray-950 border-b border-gray-800 flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-red-500">neuroLoop</span>
            <span className="text-[10px] uppercase tracking-[0.22em] text-gray-600">brain-state studio</span>
          </div>
          <div className="flex gap-1 rounded-lg border border-gray-800 bg-gray-900/60 p-1">
            {WORKSPACES.map((workspace) => (
              <button
                key={workspace.id}
                onClick={() => onWorkspaceChange(workspace.id)}
                className={`px-3 py-1.5 text-left rounded-md transition ${
                  activeWorkspace === workspace.id
                    ? 'bg-gray-800 text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
                title={workspace.description}
              >
                <span className="block text-xs font-medium leading-tight">{workspace.label}</span>
              </button>
            ))}
          </div>
        </div>

        {activeWorkspace === 'analyze' && (
          <div className="flex gap-2">
            <button
              ref={historyButtonRef}
              onClick={() => setHistoryOpen(true)}
              className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded-md transition"
              aria-label="Open analysis history"
              aria-haspopup="dialog"
              aria-expanded={historyOpen}
              title="History"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
            <button
              ref={fileButtonRef}
              onClick={() => { setModalMode('file'); setModalOpen(true) }}
              className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded-md transition"
              aria-haspopup="dialog"
              aria-expanded={modalOpen && modalMode === 'file'}
            >
              Upload Video
            </button>
            <button
              ref={textButtonRef}
              onClick={() => { setModalMode('text'); setModalOpen(true) }}
              className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded-md transition"
              aria-haspopup="dialog"
              aria-expanded={modalOpen && modalMode === 'text'}
            >
              Paste Text
            </button>
          </div>
        )}
      </div>

      {modalOpen && (
        <UploadModal mode={modalMode} onClose={closeModal} />
      )}
      {historyOpen && (
        <HistoryDrawer
          onClose={closeHistory}
          onSelect={(jobId) => { onLoadJob?.(jobId); closeHistory() }}
        />
      )}
    </>
  )
}
