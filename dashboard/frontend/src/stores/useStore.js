import { create } from 'zustand'

function revokeMediaUrl(url) {
  if (url?.startsWith('blob:')) {
    URL.revokeObjectURL(url)
  }
}

const useStore = create((set, get) => ({
  // Timeline
  currentTime: 0,        // seconds (float) - wall-clock time in the stimulus
  duration: 0,           // total duration in seconds
  isPlaying: false,
  isScrubbing: false,
  timestep: 0,           // integer index into predictions array (floor of exact)
  timestepFrac: 0,       // 0-1 fractional position between timestep and timestep+1

  // Backend timing metadata is kept for diagnostics; playback uses smooth media time.
  segmentTimes: null,    // array of { start, duration } from backend
  hemodynamicLag: 5.0,   // seconds - brain response lag reported by backend

  setCurrentTime: (t) => {
    const { duration, preds } = get()
    const clamped = Math.max(0, Math.min(t, duration))
    const maxStep = preds ? preds.length - 1 : 0
    let exact = 0

    if (preds && maxStep > 0) {
      exact = duration > 0 ? (clamped / duration) * maxStep : 0
    }

    const step = Math.min(Math.floor(exact), maxStep)
    const frac = Math.min(1, Math.max(0, exact - step))
    set({ currentTime: clamped, timestep: Math.max(0, step), timestepFrac: frac })
  },
  setDuration: (d) => set({ duration: d }),
  setPlaying: (p) => set((s) => ({
    isPlaying: p,
    selectedRegion: p ? null : s.selectedRegion,
  })),
  togglePlaying: () => set((s) => ({
    isPlaying: !s.isPlaying,
    selectedRegion: !s.isPlaying ? null : s.selectedRegion,
  })),
  setScrubbing: (isScrubbing) => set({ isScrubbing }),

  // Mesh (loaded once)
  mesh: null,
  setMesh: (m) => set({ mesh: m }),

  // Atlas - set once on app mount so the agent tab's brain heatmap can render
  // region-based activations without needing a prediction job to populate them.
  setAtlas: (atlas) => set({
    fineGroups: atlas?.fine_groups ?? null,
    coarseGroups: atlas?.coarse_groups ?? null,
    regionVertices: atlas?.region_vertices ?? null,
  }),

  // Predictions
  preds: null,           // Array of Float32Array, one per timestep
  regions: null,         // { regionName: [value_per_timestep] }
  fineGroups: null,      // { regionName: "Fine Group Name" }
  coarseGroups: null,    // { regionName: "Coarse Group Name" }
  regionVertices: null,  // { regionName: [vertex_idx, ...] }
  globalVmin: 0,         // global min across all timesteps (1st percentile)
  globalVmax: 1,         // global max across all timesteps (99th percentile)
  setPredictions: ({ preds, regions, fineGroups, coarseGroups, regionVertices, globalVmin, globalVmax, segmentTimes, hemodynamicLag }) =>
    set({
      preds, regions, fineGroups, coarseGroups,
      regionVertices: regionVertices ?? null,
      globalVmin: globalVmin ?? 0,
      globalVmax: globalVmax ?? 1,
      segmentTimes: segmentTimes ?? null,
      hemodynamicLag: hemodynamicLag ?? 5.0,
    }),

  // Region selection (for highlighting + camera focus)
  selectedRegion: null,  // region name or null
  setSelectedRegion: (name) => set({ selectedRegion: name }),

  // Job tracking
  jobId: null,
  jobStatus: null,       // "processing" | "done" | "error"
  jobProgress: 0,
  jobError: null,
  setJob: (j) => set(j),

  // Input
  inputType: null,       // "video" | "audio" | "text"
  mediaUrl: null,        // blob URL for video/audio, or null for text
  textContent: null,     // raw text for text input
  setInput: (inputType, mediaUrl, textContent) =>
    set((s) => {
      if (s.mediaUrl && s.mediaUrl !== mediaUrl) revokeMediaUrl(s.mediaUrl)
      return { inputType, mediaUrl: mediaUrl ?? null, textContent: textContent ?? null }
    }),

  // Reset for new prediction
  reset: () => set((s) => {
    revokeMediaUrl(s.mediaUrl)
    return {
      currentTime: 0, duration: 0, isPlaying: false, isScrubbing: false, timestep: 0, timestepFrac: 0,
      preds: null, regions: null, fineGroups: null, coarseGroups: null,
      regionVertices: null, selectedRegion: null,
      globalVmin: 0, globalVmax: 1, segmentTimes: null, hemodynamicLag: 5.0,
      jobId: null, jobStatus: null, jobProgress: 0, jobError: null,
      inputType: null, mediaUrl: null, textContent: null,
    }
  }),
}))

export default useStore
