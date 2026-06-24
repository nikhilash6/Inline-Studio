/**
 * Resolves a director node's *derived* timeline from the connections wired into it — the
 * video layer (vin-* handles) and the user audio layer L2 (ain-* handles), in slot order.
 * Each input is resolved to a file (a frame's hero take or a library asset), probed for
 * duration, and laid out sequentially. Video clips' embedded audio is layer L1; their
 * waveforms are generated on demand. Returns both a display model (for the node UI) and a
 * ResolvedClip[] the compose engine renders.
 */
import { join, basename, extname } from 'node:path'
import { existsSync } from 'node:fs'
import type {
  DirectorTimeline,
  DirectorClip,
  AssetKind,
  MoodboardItem,
  MoodboardConnector,
} from '@shared/types'
import { audioPeaksPath } from '@shared/media'
import { getOpenProjectFolder } from '../db'
import { listBoard, getMoodboardItem } from '../moodboard/store'
import { resolveFrameOutput, getFrameById } from '../frames/store'
import { assetFile } from '../assets/store'
import { ffmpegAvailable, probeMedia, generatePeaks, generateFilmstrip } from '../media/ffmpeg'
import type { ResolvedClip } from '../export/compose'

const STILL_SECONDS = 4
const FILMSTRIP_FRAMES = 8
const VIDEO_PREFIX = 'vin-'
const AUDIO_PREFIX = 'ain-'

export interface ResolvedTimeline {
  timeline: DirectorTimeline
  clips: ResolvedClip[]
}

interface SourceRef {
  /** Stable id (frame/asset) for the clip key. */
  sourceId: string
  /** Source frame id (for the "Frame X" tag + navigation), or null for asset sources. */
  frameId: string | null
  /** Project-relative media path. */
  filePath: string
  kind: AssetKind
  label: string
}

function slotIndex(handle: string | undefined, prefix: string): number | null {
  if (typeof handle !== 'string' || !handle.startsWith(prefix)) return null
  const n = Number(handle.slice(prefix.length))
  return Number.isFinite(n) ? n : null
}

/** A connector's source item → a media ref (frame hero take / preview's frame / asset). */
function resolveSourceRef(
  fromItem: MoodboardItem | undefined,
  items: MoodboardItem[],
  connectors: MoodboardConnector[],
): SourceRef | null {
  if (!fromItem) return null
  if (fromItem.type === 'frame' && fromItem.frameId) {
    const out = resolveFrameOutput(fromItem.frameId)
    if (!out) return null
    const label = safeFrameName(fromItem.frameId)
    return {
      sourceId: fromItem.frameId,
      frameId: fromItem.frameId,
      filePath: out.filePath,
      kind: out.kind,
      label,
    }
  }
  if (fromItem.type === 'preview') {
    const feed = connectors.find((k) => k.toItemId === fromItem.id)
    const feedFrame = feed ? items.find((it) => it.id === feed.fromItemId) : undefined
    if (feedFrame?.type === 'frame' && feedFrame.frameId) {
      const out = resolveFrameOutput(feedFrame.frameId)
      if (!out) return null
      return {
        sourceId: feedFrame.frameId,
        frameId: feedFrame.frameId,
        filePath: out.filePath,
        kind: out.kind,
        label: safeFrameName(feedFrame.frameId),
      }
    }
    return null
  }
  if (fromItem.type === 'asset' && fromItem.assetId) {
    const a = assetFile(fromItem.assetId)
    if (!a) return null
    return {
      sourceId: fromItem.assetId,
      frameId: null,
      filePath: a.filePath,
      kind: a.kind,
      label: a.name,
    }
  }
  return null
}

function safeFrameName(frameId: string): string {
  try {
    return getFrameById(frameId).name
  } catch {
    return 'frame'
  }
}

/** Peaks key derived from the media filename (unique per take/asset file → auto-refreshes). */
function fileKey(filePath: string): string {
  return basename(filePath, extname(filePath))
}

export async function resolveTimeline(ownerItemId: string): Promise<ResolvedTimeline> {
  const folder = getOpenProjectFolder()
  if (!folder) throw new Error('No project is open.')
  const director = getMoodboardItem(ownerItemId)
  const l1Volume = director.data.l1Volume ?? 1
  const l2Volume = director.data.l2Volume ?? 1

  const { items, connectors } = listBoard()
  const incoming = connectors.filter((c) => c.toItemId === ownerItemId)

  const pick = (prefix: string): MoodboardConnector[] =>
    incoming
      .map((c) => ({ c, slot: slotIndex(c.data?.targetHandle as string | undefined, prefix) }))
      .filter((x) => x.slot !== null)
      .sort((a, b) => (a.slot as number) - (b.slot as number))
      .map((x) => x.c)

  const display: DirectorTimeline = { video: [], l2: [], l1Volume, l2Volume }
  const resolved: ResolvedClip[] = []

  const layout = async (
    conns: MoodboardConnector[],
    track: number,
    volume: number,
  ): Promise<void> => {
    let cursor = 0
    for (const conn of conns) {
      const fromItem = items.find((it) => it.id === conn.fromItemId)
      const ref = resolveSourceRef(fromItem, items, connectors)
      if (!ref) continue
      const absPath = join(folder, ref.filePath)
      if (!existsSync(absPath)) continue

      const probe =
        ref.kind === 'image'
          ? { durationSec: STILL_SECONDS, hasAudio: false }
          : ffmpegAvailable()
            ? await probeMedia(absPath)
            : { durationSec: STILL_SECONDS, hasAudio: ref.kind === 'audio' }
      const duration = probe.durationSec > 0 ? probe.durationSec : STILL_SECONDS

      // A waveform for the clip's audio (video L1, or the L2 audio itself).
      let audioPeaks: string | null = null
      const wantsPeaks = (track === 0 && ref.kind === 'video' && probe.hasAudio) || track === 1
      if (wantsPeaks && ffmpegAvailable()) {
        const peaksRel = audioPeaksPath(fileKey(ref.filePath))
        if (!existsSync(join(folder, peaksRel))) {
          await generatePeaks(absPath, join(folder, peaksRel)).catch(() => false)
        }
        if (existsSync(join(folder, peaksRel))) audioPeaks = peaksRel
      }

      // A thumbnail: a filmstrip PNG for video clips, the still itself for image clips.
      let thumbnail: string | null = null
      if (ref.kind === 'video' && ffmpegAvailable()) {
        const stripRel = `thumbs/strip-${fileKey(ref.filePath)}.png`
        if (!existsSync(join(folder, stripRel))) {
          await generateFilmstrip(
            absPath,
            join(folder, stripRel),
            FILMSTRIP_FRAMES,
            duration,
          ).catch(() => false)
        }
        if (existsSync(join(folder, stripRel))) thumbnail = stripRel
      } else if (ref.kind === 'image') {
        thumbnail = ref.filePath
      }

      const clip: DirectorClip = {
        key: ref.sourceId,
        frameId: ref.frameId,
        label: ref.label,
        kind: ref.kind,
        startTime: cursor,
        duration,
        audioPeaks,
        thumbnail,
      }
      if (track === 0) display.video.push(clip)
      else display.l2.push(clip)

      resolved.push({
        kind: ref.kind,
        absPath,
        track,
        startTime: cursor,
        inPoint: 0,
        outPoint: duration,
        hasAudio: probe.hasAudio,
        volume,
      })
      cursor += duration
    }
  }

  await layout(pick(VIDEO_PREFIX), 0, l1Volume)
  await layout(pick(AUDIO_PREFIX), 1, l2Volume)

  return { timeline: display, clips: resolved }
}
