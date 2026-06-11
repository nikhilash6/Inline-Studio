/**
 * Shot timeline state: ordered shots, each with multiple inputs (library assets)
 * and multiple outputs (takes). The card shows compact stacks; the Shot Inspector
 * manages the full grids. Work happens in main via window.storyline.shots / .comfy.
 */
import { create } from 'zustand'
import type { Shot, Take, ShotInput } from '@shared/types'
import { ipcErrorMessage } from '../lib/ipcError'

interface ShotState {
  shots: Shot[]
  /** Inputs (library assets) per shot id, in order. */
  inputsByShot: Record<string, ShotInput[]>
  /** Takes (outputs) per shot id, newest first. */
  takesByShot: Record<string, Take[]>
  selectedId: string | null
  loading: boolean
  /** Shot id currently mid-action (link/pull), for in-card spinners. */
  busyId: string | null
  error: string | null
  /** Transient status message (e.g. export summary). */
  notice: string | null

  load: () => Promise<void>
  importAsShots: () => Promise<void>
  addFromAssets: (assetIds: string[]) => Promise<void>
  addInputs: (shotId: string, assetIds: string[]) => Promise<void>
  removeInput: (shotId: string, assetId: string) => Promise<void>
  reorderInputs: (shotId: string, orderedAssetIds: string[]) => Promise<void>
  setHero: (shotId: string, takeId: string | null) => Promise<void>
  deleteTake: (takeId: string) => Promise<void>
  rename: (id: string, name: string) => Promise<void>
  reorder: (orderedIds: string[]) => Promise<void>
  remove: (id: string) => Promise<void>
  linkShot: (id: string) => Promise<Shot | null>
  pullResult: (id: string) => Promise<void>
  exportShots: () => Promise<void>
  select: (id: string | null) => void
  reset: () => void
}

function groupByShot<T extends { shotId: string }>(items: T[]): Record<string, T[]> {
  const map: Record<string, T[]> = {}
  for (const item of items) (map[item.shotId] ??= []).push(item)
  return map
}

export const useShotStore = create<ShotState>((set, get) => ({
  shots: [],
  inputsByShot: {},
  takesByShot: {},
  selectedId: null,
  loading: false,
  busyId: null,
  error: null,
  notice: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const [shotsRes, inputsRes, takesRes] = await Promise.all([
        window.storyline.shots.list(),
        window.storyline.shots.listInputs(),
        window.storyline.shots.listAllTakes(),
      ])
      if (!shotsRes.ok) return set({ loading: false, error: shotsRes.error })
      if (!inputsRes.ok) return set({ loading: false, error: inputsRes.error })
      if (!takesRes.ok) return set({ loading: false, error: takesRes.error })
      set({
        shots: shotsRes.value,
        inputsByShot: groupByShot(inputsRes.value),
        takesByShot: groupByShot(takesRes.value),
        loading: false,
      })
    } catch (e) {
      set({ loading: false, error: ipcErrorMessage(e) })
    }
  },

  importAsShots: async () => {
    set({ loading: true, error: null })
    try {
      const res = await window.storyline.shots.importAsShots()
      if (!res.ok) return set({ loading: false, error: res.error })
      await get().load() // refresh shots + their inputs
    } catch (e) {
      set({ loading: false, error: ipcErrorMessage(e) })
    }
  },

  addFromAssets: async (assetIds) => {
    try {
      for (const assetId of assetIds) {
        const res = await window.storyline.shots.addFromAsset(assetId)
        if (!res.ok) return set({ error: res.error })
      }
      await get().load()
    } catch (e) {
      set({ error: ipcErrorMessage(e) })
    }
  },

  addInputs: async (shotId, assetIds) => {
    try {
      const added: ShotInput[] = []
      for (const assetId of assetIds) {
        const res = await window.storyline.shots.addInput(shotId, assetId)
        if (!res.ok) return set({ error: res.error })
        added.push(res.value)
      }
      set((s) => {
        const existing = s.inputsByShot[shotId] ?? []
        const ids = new Set(existing.map((i) => i.id))
        const merged = [...existing, ...added.filter((i) => !ids.has(i.id))]
        return { inputsByShot: { ...s.inputsByShot, [shotId]: merged } }
      })
    } catch (e) {
      set({ error: ipcErrorMessage(e) })
    }
  },

  removeInput: async (shotId, assetId) => {
    try {
      const res = await window.storyline.shots.removeInput(shotId, assetId)
      if (!res.ok) return set({ error: res.error })
      set((s) => ({
        inputsByShot: {
          ...s.inputsByShot,
          [shotId]: (s.inputsByShot[shotId] ?? []).filter((i) => i.assetId !== assetId),
        },
      }))
    } catch (e) {
      set({ error: ipcErrorMessage(e) })
    }
  },

  reorderInputs: async (shotId, orderedAssetIds) => {
    set((s) => {
      const byAsset = new Map((s.inputsByShot[shotId] ?? []).map((i) => [i.assetId, i]))
      const next = orderedAssetIds
        .map((assetId, position) => {
          const input = byAsset.get(assetId)
          return input ? { ...input, position } : null
        })
        .filter((x): x is ShotInput => x !== null)
      return { inputsByShot: { ...s.inputsByShot, [shotId]: next } }
    })
    try {
      const res = await window.storyline.shots.reorderInputs(shotId, orderedAssetIds)
      if (!res.ok) set({ error: res.error })
    } catch (e) {
      set({ error: ipcErrorMessage(e) })
    }
  },

  setHero: async (shotId, takeId) => {
    set((s) => ({
      shots: s.shots.map((sh) => (sh.id === shotId ? { ...sh, heroTakeId: takeId } : sh)),
    }))
    try {
      const res = await window.storyline.shots.setHero(shotId, takeId)
      if (!res.ok) set({ error: res.error })
    } catch (e) {
      set({ error: ipcErrorMessage(e) })
    }
  },

  deleteTake: async (takeId) => {
    try {
      const res = await window.storyline.shots.deleteTake(takeId)
      if (!res.ok) return set({ error: res.error })
      set((s) => {
        const takesByShot: Record<string, Take[]> = {}
        for (const [shotId, takes] of Object.entries(s.takesByShot)) {
          takesByShot[shotId] = takes.filter((t) => t.id !== takeId)
        }
        return {
          takesByShot,
          shots: s.shots.map((sh) => (sh.heroTakeId === takeId ? { ...sh, heroTakeId: null } : sh)),
        }
      })
    } catch (e) {
      set({ error: ipcErrorMessage(e) })
    }
  },

  linkShot: async (id) => {
    set({ busyId: id, error: null })
    try {
      const res = await window.storyline.comfy.linkShot(id)
      if (!res.ok) {
        set({ error: res.error, busyId: null })
        return null
      }
      const shot = res.value
      set((s) => ({ shots: s.shots.map((sh) => (sh.id === id ? shot : sh)), busyId: null }))
      return shot
    } catch (e) {
      set({ error: ipcErrorMessage(e), busyId: null })
      return null
    }
  },

  pullResult: async (id) => {
    set({ busyId: id, error: null })
    try {
      const res = await window.storyline.comfy.pullLatest(id)
      if (!res.ok) return set({ error: res.error, busyId: null })
      const take = res.value
      set((s) => ({
        takesByShot: { ...s.takesByShot, [id]: [take, ...(s.takesByShot[id] ?? [])] },
        shots: s.shots.map((sh) => (sh.id === id ? { ...sh, heroTakeId: take.id } : sh)),
        busyId: null,
      }))
    } catch (e) {
      set({ error: ipcErrorMessage(e), busyId: null })
    }
  },

  rename: async (id, name) => {
    set((s) => ({ shots: s.shots.map((sh) => (sh.id === id ? { ...sh, name } : sh)) }))
    try {
      const res = await window.storyline.shots.rename(id, name)
      if (!res.ok) set({ error: res.error })
    } catch (e) {
      set({ error: ipcErrorMessage(e) })
    }
  },

  reorder: async (orderedIds) => {
    set((s) => {
      const byId = new Map(s.shots.map((sh) => [sh.id, sh]))
      const next = orderedIds
        .map((id, i) => {
          const sh = byId.get(id)
          return sh ? { ...sh, position: i } : null
        })
        .filter((x): x is Shot => x !== null)
      return { shots: next }
    })
    try {
      const res = await window.storyline.shots.reorder(orderedIds)
      if (!res.ok) set({ error: res.error })
    } catch (e) {
      set({ error: ipcErrorMessage(e) })
    }
  },

  remove: async (id) => {
    try {
      const res = await window.storyline.shots.delete(id)
      if (!res.ok) return set({ error: res.error })
      set((s) => {
        const inputsByShot = { ...s.inputsByShot }
        const takesByShot = { ...s.takesByShot }
        delete inputsByShot[id]
        delete takesByShot[id]
        return {
          shots: s.shots.filter((sh) => sh.id !== id),
          inputsByShot,
          takesByShot,
          selectedId: s.selectedId === id ? null : s.selectedId,
        }
      })
    } catch (e) {
      set({ error: ipcErrorMessage(e) })
    }
  },

  exportShots: async () => {
    set({ error: null, notice: null })
    try {
      const res = await window.storyline.export.exportShots()
      if (!res.ok) return set({ error: res.error })
      if (res.value === null) return // cancelled
      const { exported, skipped, dir } = res.value
      const skip = skipped.length > 0 ? `, ${skipped.length} skipped (no output)` : ''
      set({ notice: `Exported ${exported} shot${exported === 1 ? '' : 's'}${skip} → ${dir}` })
    } catch (e) {
      set({ error: ipcErrorMessage(e) })
    }
  },

  select: (id) => set({ selectedId: id }),
  reset: () =>
    set({
      shots: [],
      inputsByShot: {},
      takesByShot: {},
      selectedId: null,
      busyId: null,
      error: null,
      notice: null,
    }),
}))
