/** IPC for auto-update actions. The updater engine lives in ../updater. */
import { IpcChannels } from '@shared/ipc'
import { handle } from './handler'
import { checkForUpdates, quitAndInstall } from '../updater'

export function registerUpdateHandlers(): void {
  handle<[], void>(IpcChannels.updates.check, () => checkForUpdates())
  handle<[], void>(IpcChannels.updates.quitAndInstall, () => quitAndInstall())
}
