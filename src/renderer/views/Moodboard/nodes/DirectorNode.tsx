import { useEffect, useMemo, useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { mediaUrl } from '@shared/media'
import type { DirectorClip } from '@shared/types'
import { NodeFrame } from './NodeFrame'
import { Waveform } from '../../../components/Waveform'
import { useMoodboardStore } from '../../../store/moodboardStore'
import { useTimelineStore } from '../../../store/timelineStore'
import type { DirectorNodeData } from './nodeData'

const VIDEO_PREFIX = 'vin-'
const AUDIO_PREFIX = 'ain-'
const MIN_VIDEO_INPUTS = 5
const MIN_AUDIO_INPUTS = 2
const REBUILD_DEBOUNCE_MS = 800

const slot = (handle: string | undefined, prefix: string): number | null => {
  if (typeof handle !== 'string' || !handle.startsWith(prefix)) return null
  const n = Number(handle.slice(prefix.length))
  return Number.isFinite(n) ? n : null
}

/**
 * A connection dot living inside one of the node's side gutters (not on the border): an
 * inline React Flow Handle + a tiny label. `position` drives the edge approach direction.
 */
function GutterDot({
  handleId,
  type,
  position,
  label,
  dotClass,
}: {
  handleId: string
  type: 'target' | 'source'
  position: Position
  label: string
  dotClass: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-px" title={label}>
      <Handle
        type={type}
        position={position}
        id={handleId}
        style={{ position: 'relative', left: 0, top: 0, transform: 'none' }}
        className={`!h-3.5 !w-3.5 !min-h-0 !min-w-0 !border-2 !border-surface ${dotClass}`}
      />
      <span className="text-[11px] font-medium leading-none text-zinc-300">{label}</span>
    </div>
  )
}

/**
 * A self-contained video-director node: a mini-NLE on the canvas. Video clips and the L1
 * audio layer are derived from the videos wired into the `vin-*` inputs; the L2 layer is
 * the user's audio wired into the `ain-*` inputs. Inputs grow as they fill. The proxy
 * preview auto-rebuilds (debounced) as connections/volumes change.
 */
export function DirectorNode({ id, data, selected }: NodeProps): React.JSX.Element {
  const { name, previewUrl } = data as DirectorNodeData
  const connectors = useMoodboardStore((s) => s.connectors)
  const reloadBoard = useMoodboardStore((s) => s.load)
  const timeline = useTimelineStore((s) => s.timelineByOwner[id])
  const progress = useTimelineStore((s) => s.progressByOwner[id])
  const resolve = useTimelineStore((s) => s.resolve)
  const setVolumes = useTimelineStore((s) => s.setVolumes)
  const buildPreview = useTimelineStore((s) => s.buildPreview)
  const exportTimeline = useTimelineStore((s) => s.exportTimeline)

  const incoming = useMemo(() => connectors.filter((c) => c.toItemId === id), [connectors, id])
  // A signature of the wired inputs — drives re-resolve and rebuild.
  const connSig = useMemo(
    () =>
      incoming
        .map((c) => `${c.fromItemId}:${String(c.data?.targetHandle ?? '')}`)
        .sort()
        .join('|'),
    [incoming],
  )

  const usedVideo = new Set(
    incoming
      .map((c) => slot(c.data?.targetHandle as string, VIDEO_PREFIX))
      .filter((n) => n !== null),
  )
  const usedAudio = new Set(
    incoming
      .map((c) => slot(c.data?.targetHandle as string, AUDIO_PREFIX))
      .filter((n) => n !== null),
  )
  const videoHandles = Math.max(MIN_VIDEO_INPUTS, usedVideo.size + 1)
  const audioHandles = Math.max(MIN_AUDIO_INPUTS, usedAudio.size + 1)

  const l1 = timeline?.l1Volume ?? 1
  const l2 = timeline?.l2Volume ?? 1
  const video = timeline?.video ?? []
  const l2clips = timeline?.l2 ?? []
  const total = Math.max(layerEnd(video), layerEnd(l2clips), 0.001)

  // Re-resolve the derived timeline whenever the wired inputs change.
  useEffect(() => {
    void resolve(id)
  }, [id, connSig, resolve])

  // Debounced proxy rebuild when inputs or volumes change (only if a video is wired).
  const hasVideoInput = incoming.some((c) =>
    String(c.data?.targetHandle ?? '').startsWith(VIDEO_PREFIX),
  )
  useEffect(() => {
    if (!hasVideoInput) return
    const h = setTimeout(async () => {
      const ok = await buildPreview(id)
      if (ok) await reloadBoard()
    }, REBUILD_DEBOUNCE_MS)
    return () => clearTimeout(h)
  }, [id, connSig, l1, l2, hasVideoInput, buildPreview, reloadBoard])

  const rendering = progress !== null && progress !== undefined

  // Preview playhead synced to the proxy player.
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playhead, setPlayhead] = useState(0)

  return (
    <NodeFrame id={id} selected={!!selected} minWidth={360} minHeight={320} padded={false}>
      <div className="flex h-full w-full text-zinc-300">
        {/* Left gutter — a dedicated side panel for the input dots (not on the border). */}
        <div className="flex w-11 shrink-0 flex-col items-center gap-1.5 overflow-y-auto border-r border-border bg-panel py-1">
          {Array.from({ length: videoHandles }).map((_, i) => (
            <GutterDot
              key={`vin-${i}`}
              handleId={`${VIDEO_PREFIX}${i}`}
              type="target"
              position={Position.Left}
              label={`V${i + 1}`}
              dotClass="!bg-indigo-400"
            />
          ))}
          {Array.from({ length: audioHandles }).map((_, i) => (
            <GutterDot
              key={`ain-${i}`}
              handleId={`${AUDIO_PREFIX}${i}`}
              type="target"
              position={Position.Left}
              label={`A${i + 1}`}
              dotClass="!bg-emerald-400"
            />
          ))}
        </div>

        {/* Center column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <div className="flex shrink-0 items-center gap-1 border-b border-border bg-panel px-2 py-1">
            <span className="text-[10px] text-amber-400">🎬</span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
              {name || 'Director'}
            </span>
            {rendering && (
              <span className="text-[10px] text-amber-400">
                {Math.round((progress ?? 0) * 100)}%
              </span>
            )}
            <button
              onClick={() => void exportTimeline(id)}
              disabled={rendering || video.length === 0}
              className="nodrag rounded bg-accent px-1.5 py-0.5 text-[10px] text-panel hover:brightness-110 disabled:opacity-40"
            >
              Export
            </button>
            {/* Output link, after the Export button. */}
            <span
              className="flex items-center gap-1 text-[11px] font-medium text-zinc-300"
              title="Video output"
            >
              Out
              <Handle
                type="source"
                position={Position.Right}
                id="out"
                style={{ position: 'relative', left: 0, top: 0, transform: 'none' }}
                className="!h-3.5 !w-3.5 !min-h-0 !min-w-0 !border-2 !border-surface !bg-amber-400"
              />
            </span>
          </div>

          {/* Preview — sized to the 16:9 proxy so the video fills it (no black bars). */}
          <div className="relative aspect-video w-full shrink-0 bg-black">
            {previewUrl ? (
              <video
                ref={videoRef}
                src={mediaUrl(previewUrl)}
                controls
                onTimeUpdate={() => {
                  const v = videoRef.current
                  if (v && v.duration > 0) setPlayhead(v.currentTime / v.duration)
                }}
                className="nodrag absolute inset-0 h-full w-full object-contain"
              />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] text-zinc-500">
                {video.length === 0
                  ? 'Wire video frames into the V inputs on the left'
                  : rendering
                    ? 'Rendering preview…'
                    : 'Building preview…'}
              </span>
            )}
          </div>

          {/* Tracks */}
          <div className="nodrag relative flex-1 overflow-auto py-1.5">
            {/* Shared playhead across the tracks (aligned to the track lanes' inner width). */}
            {video.length > 0 && (
              <div
                className="pointer-events-none absolute inset-y-0 z-10 w-px bg-red-500"
                style={{ left: `${(playhead * 100).toFixed(2)}%` }}
              />
            )}

            <TrackRow label="VIDEO">
              {video.map((c) => (
                <ClipBlock key={c.key} clip={c} total={total} kind="video" />
              ))}
            </TrackRow>

            <TrackRow
              label="AUDIO L1"
              control={<VolumeSlider value={l1} onChange={(v) => void setVolumes(id, v, l2)} />}
            >
              {video.map((c) => (
                <ClipBlock key={c.key} clip={c} total={total} kind="audio" />
              ))}
            </TrackRow>

            <TrackRow
              label="AUDIO L2"
              control={<VolumeSlider value={l2} onChange={(v) => void setVolumes(id, l1, v)} />}
            >
              {l2clips.length === 0 ? (
                <span className="px-1 text-[9px] text-zinc-600">Wire audio into a green input</span>
              ) : (
                l2clips.map((c) => <ClipBlock key={c.key} clip={c} total={total} kind="audio" />)
              )}
            </TrackRow>
          </div>
        </div>
      </div>
    </NodeFrame>
  )
}

function layerEnd(clips: DirectorClip[]): number {
  return clips.reduce((m, c) => Math.max(m, c.startTime + c.duration), 0)
}

function TrackRow({
  label,
  control,
  children,
}: {
  label: string
  control?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-1.5">
      <div className="mb-0.5 flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-wide text-zinc-500">{label}</span>
        {control}
      </div>
      <div className="flex h-8 w-full overflow-hidden rounded bg-black/30">{children}</div>
    </div>
  )
}

function ClipBlock({
  clip,
  total,
  kind,
}: {
  clip: DirectorClip
  total: number
  kind: 'video' | 'audio'
}): React.JSX.Element {
  const width = `${(clip.duration / total) * 100}%`
  if (kind === 'audio') {
    return (
      <div
        style={{ width }}
        className="flex h-full items-center border-r border-black/40 bg-emerald-500/10 px-0.5"
        title={`${clip.label} (${clip.duration.toFixed(1)}s)`}
      >
        <Waveform
          url={clip.audioPeaks ? mediaUrl(clip.audioPeaks) : null}
          className="h-2/3 w-full text-emerald-400"
        />
      </div>
    )
  }
  return (
    <div
      style={{ width }}
      className="flex h-full items-center justify-center border-r border-black/40 bg-indigo-500/30 px-0.5"
      title={`${clip.label} (${clip.duration.toFixed(1)}s)`}
    >
      <span className="truncate text-[9px] text-indigo-100">{clip.label}</span>
    </div>
  )
}

function VolumeSlider({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-1" title={`Volume ${Math.round(value * 100)}%`}>
      <span className="text-[9px] text-zinc-500">🔊</span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="nodrag h-1 w-16 accent-emerald-400"
      />
    </label>
  )
}
