/** IPC handlers for shots + their takes. */
import { IpcChannels } from '@shared/ipc'
import type { Shot, Take, ShotInput } from '@shared/types'
import { handle } from './handler'
import {
  listShots,
  importAsShots,
  addFromAsset,
  renameShot,
  reorderShots,
  deleteShot,
  setHero,
  listTakes,
  heroTakes,
  listInputs,
  addInput,
  removeInput,
  reorderInputs,
  listAllTakes,
  deleteTake,
} from '../shots/store'

function str(v: unknown, label: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`Invalid ${label}.`)
  return v
}

export function registerShotHandlers(): void {
  handle<[], Shot[]>(IpcChannels.shots.list, () => listShots())
  handle<[], Shot[]>(IpcChannels.shots.importAsShots, () => importAsShots())
  handle<[string], Shot>(IpcChannels.shots.addFromAsset, (assetId) =>
    addFromAsset(str(assetId, 'asset id')),
  )
  handle<[string, string], Shot>(IpcChannels.shots.rename, (id, name) => {
    if (typeof name !== 'string') throw new Error('Invalid name.')
    return renameShot(str(id, 'shot id'), name)
  })
  handle<[string[]], void>(IpcChannels.shots.reorder, (orderedIds) => {
    if (!Array.isArray(orderedIds) || orderedIds.some((x) => typeof x !== 'string')) {
      throw new Error('Invalid ordering.')
    }
    reorderShots(orderedIds)
  })
  handle<[string], void>(IpcChannels.shots.delete, (id) => deleteShot(str(id, 'shot id')))
  handle<[string, string | null], Shot>(IpcChannels.shots.setHero, (id, takeId) => {
    if (takeId !== null && typeof takeId !== 'string') throw new Error('Invalid take id.')
    return setHero(str(id, 'shot id'), takeId)
  })
  handle<[string], Take[]>(IpcChannels.shots.listTakes, (shotId) =>
    listTakes(str(shotId, 'shot id')),
  )
  handle<[], Take[]>(IpcChannels.shots.heroTakes, () => heroTakes())
  handle<[], ShotInput[]>(IpcChannels.shots.listInputs, () => listInputs())
  handle<[string, string], ShotInput>(IpcChannels.shots.addInput, (shotId, assetId) =>
    addInput(str(shotId, 'shot id'), str(assetId, 'asset id')),
  )
  handle<[string, string], void>(IpcChannels.shots.removeInput, (shotId, assetId) =>
    removeInput(str(shotId, 'shot id'), str(assetId, 'asset id')),
  )
  handle<[string, string[]], void>(IpcChannels.shots.reorderInputs, (shotId, orderedAssetIds) => {
    if (!Array.isArray(orderedAssetIds) || orderedAssetIds.some((x) => typeof x !== 'string')) {
      throw new Error('Invalid input ordering.')
    }
    reorderInputs(str(shotId, 'shot id'), orderedAssetIds)
  })
  handle<[], Take[]>(IpcChannels.shots.listAllTakes, () => listAllTakes())
  handle<[string], void>(IpcChannels.shots.deleteTake, (takeId) =>
    deleteTake(str(takeId, 'take id')),
  )
}
