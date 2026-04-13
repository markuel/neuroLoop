import { useState } from 'react'
import UploadModal from './UploadModal'

export default function TopBar() {
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('file')

  return (
    <>
      <div className="h-12 bg-gray-950 border-b border-gray-800 flex items-center justify-between px-4">
        <span className="text-lg font-bold text-red-500">neuroLoop</span>
        <div className="flex gap-2">
          <button
            onClick={() => { setModalMode('file'); setModalOpen(true) }}
            className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded-md transition"
          >
            Upload Video
          </button>
          <button
            onClick={() => { setModalMode('text'); setModalOpen(true) }}
            className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded-md transition"
          >
            Paste Text
          </button>
        </div>
      </div>
      {modalOpen && (
        <UploadModal mode={modalMode} onClose={() => setModalOpen(false)} />
      )}
    </>
  )
}
