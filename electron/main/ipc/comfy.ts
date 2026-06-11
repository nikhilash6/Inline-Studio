/** IPC handlers for the ComfyUI bridge. */
import { IpcChannels } from '@shared/ipc'
import type { Take, ComfyStatus, Shot, ComfyRun, ComfyOutput } from '@shared/types'
import { handle } from './handler'
import { ping, linkShotWorkflow, pullLatestToShot, latestRun, captureOutput } from '../comfy/client'

function str(v: unknown, label: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`Invalid ${label}.`)
  return v
}

function asOutput(v: unknown): ComfyOutput {
  if (typeof v !== 'object' || v === null || typeof (v as ComfyOutput).filename !== 'string') {
    throw new Error('Invalid output.')
  }
  return v as ComfyOutput
}

export function registerComfyHandlers(): void {
  handle<[], ComfyStatus>(IpcChannels.comfy.status, () => ping())
  handle<[string], Shot>(IpcChannels.comfy.linkShot, (shotId) =>
    linkShotWorkflow(str(shotId, 'shot id')),
  )
  handle<[string], Take>(IpcChannels.comfy.pullLatest, (shotId) =>
    pullLatestToShot(str(shotId, 'shot id')),
  )
  handle<[], ComfyRun | null>(IpcChannels.comfy.latestRun, () => latestRun())
  handle<[string, ComfyOutput], Take>(IpcChannels.comfy.captureOutput, (shotId, output) =>
    captureOutput(str(shotId, 'shot id'), asOutput(output)),
  )
}
