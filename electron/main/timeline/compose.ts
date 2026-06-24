/**
 * Orchestrates rendering a director node's derived timeline (see resolve.ts): build the
 * ffmpeg arg vector and run it. Two entry points: a fast low-res proxy for the in-node
 * preview, and a full-res export to a user-chosen file. Rapid auto-rebuilds are coalesced
 * by cancelling any in-flight preview render for the same node.
 */
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { BrowserWindow, dialog } from 'electron'
import { IpcChannels } from '@shared/ipc'
import type { DirectorItemData } from '@shared/types'
import { getOpenProjectFolder } from '../db'
import { getMoodboardItem, updateItem } from '../moodboard/store'
import { composeRender, ffmpegAvailable, type ComposeHandle } from '../media/ffmpeg'
import { buildComposeArgs, timelineDuration, type ComposeSettings } from '../export/compose'
import { resolveTimeline } from './resolve'

const DEFAULT_SETTINGS: DirectorItemData = { width: 1920, height: 1080, fps: 30 }

/** Read a director node's output settings (falling back to 1080p30). */
function directorSettings(ownerItemId: string): DirectorItemData {
  const item = getMoodboardItem(ownerItemId)
  return item.data.director ?? DEFAULT_SETTINGS
}

function notifyProgress(ownerItemId: string, fraction: number): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(IpcChannels.events.timelineProgress, { ownerItemId, fraction })
  }
}

/** Even integer ≥ 2 (libx264 + yuv420p needs even dimensions). */
const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

// In-flight preview renders per director node, so a new build cancels the previous one.
const inFlight = new Map<string, ComposeHandle>()

/**
 * Render a low-res proxy MP4 for the in-node preview. Stores its project-relative path on
 * the director item (data.directorPreview) and returns it. Null if nothing to render.
 */
export async function buildPreview(ownerItemId: string): Promise<string | null> {
  if (!ffmpegAvailable()) throw new Error('ffmpeg is not available.')
  const folder = getOpenProjectFolder()
  if (!folder) throw new Error('No project is open.')
  const { clips } = await resolveTimeline(ownerItemId)
  if (clips.length === 0) return null

  // Cancel a previous in-flight preview for this node (auto-rebuild coalescing).
  inFlight.get(ownerItemId)?.cancel()

  const s = directorSettings(ownerItemId)
  const width = 640
  const height = even((640 * s.height) / s.width)
  // Unique filename per build so the renderer's <video> sees a new src and reloads.
  const relPath = `thumbs/director-${ownerItemId}-${Date.now()}.preview.mp4`
  const settings: ComposeSettings = {
    width,
    height,
    fps: Math.min(s.fps, 30),
    preset: 'ultrafast',
    crf: 30,
    outPath: join(folder, relPath),
  }
  const total = timelineDuration(clips)
  const handle = composeRender(buildComposeArgs(clips, settings), total, (f) =>
    notifyProgress(ownerItemId, f),
  )
  inFlight.set(ownerItemId, handle)
  const ok = await handle.done
  if (inFlight.get(ownerItemId) === handle) inFlight.delete(ownerItemId)
  if (!ok) return null // cancelled (superseded) or failed — leave the previous preview in place

  // Persist the new preview path on the director node and remove the previous proxy file.
  const item = getMoodboardItem(ownerItemId)
  const prev = item.data.directorPreview
  updateItem(ownerItemId, { data: { ...item.data, directorPreview: relPath } })
  if (prev && prev !== relPath) {
    try {
      rmSync(join(folder, prev), { force: true })
    } catch {
      // ignore
    }
  }
  notifyProgress(ownerItemId, 1)
  return relPath
}

/**
 * Render the timeline at full resolution to a user-chosen MP4. Returns the absolute path
 * written, or null if cancelled / nothing to render.
 */
export async function exportTimeline(ownerItemId: string): Promise<string | null> {
  if (!ffmpegAvailable()) throw new Error('ffmpeg is not available.')
  const folder = getOpenProjectFolder()
  if (!folder) throw new Error('No project is open.')
  const { clips } = await resolveTimeline(ownerItemId)
  if (clips.length === 0) return null

  const result = await dialog.showSaveDialog({
    title: 'Export timeline',
    defaultPath: 'timeline.mp4',
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  })
  if (result.canceled || !result.filePath) return null

  const s = directorSettings(ownerItemId)
  const settings: ComposeSettings = {
    width: even(s.width),
    height: even(s.height),
    fps: s.fps,
    preset: 'veryfast',
    crf: 20,
    outPath: result.filePath,
  }
  const total = timelineDuration(clips)
  const handle = composeRender(buildComposeArgs(clips, settings), total, (f) =>
    notifyProgress(ownerItemId, f),
  )
  const ok = await handle.done
  notifyProgress(ownerItemId, 1)
  if (!ok) throw new Error('Export render failed.')
  return result.filePath
}
