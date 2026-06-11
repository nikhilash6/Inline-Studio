import { useEffect, useRef, useState } from 'react'
import { mediaUrl } from '@shared/media'
import type { Shot } from '@shared/types'
import { useShotStore } from '../../store/shotStore'
import { useAssetStore } from '../../store/assetStore'
import { useUiStore } from '../../store/uiStore'
import { ASSET_DND_TYPE, getAssetDragIds } from '../../lib/dnd'

const STACK_MAX = 3

interface Thumb {
  key: string
  url: string
  kind: 'image' | 'video' | 'audio'
  hero?: boolean
}

/**
 * The shot-sequencer timeline. Each shot is a compact card with an input stack and
 * an output (takes) stack, both capped with a "+N" overflow. Drag library assets
 * onto a card to add inputs, or onto the background to create shots. Full management
 * (add/remove/reorder inputs, pick hero, delete takes, link/pull) lives in the Inspector.
 */
export function TimelinePanel(): React.JSX.Element {
  const { shots, selectedId, error, notice, load, importAsShots, reorder, select, exportShots } =
    useShotStore()
  const addFromAssets = useShotStore((s) => s.addFromAssets)
  const dragId = useRef<string | null>(null)
  const [dropActive, setDropActive] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  const onReorderDrop = (targetId: string): void => {
    const from = dragId.current
    dragId.current = null
    if (!from || from === targetId) return
    const ids = shots.map((s) => s.id).filter((id) => id !== from)
    const at = ids.indexOf(targetId)
    ids.splice(at, 0, from)
    void reorder(ids)
  }

  const onBackgroundDragOver = (e: React.DragEvent): void => {
    if (e.dataTransfer.types.includes(ASSET_DND_TYPE)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setDropActive(true)
    }
  }

  const onBackgroundDrop = (e: React.DragEvent): void => {
    setDropActive(false)
    const ids = getAssetDragIds(e.dataTransfer)
    if (ids.length > 0) {
      e.preventDefault()
      void addFromAssets(ids) // one shot per dropped asset
    }
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
          Shots Sequence{' '}
          {shots.length > 0 && <span className="text-zinc-600">· {shots.length}</span>}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => void exportShots()}
            disabled={shots.length === 0}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-zinc-300 hover:bg-panel disabled:opacity-40"
          >
            Export
          </button>
          <button
            onClick={() => void importAsShots()}
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white"
          >
            Import as shots
          </button>
        </div>
      </div>

      {error && <p className="px-3 py-1 text-xs text-red-400">{error}</p>}
      {notice && <p className="px-3 py-1 text-xs text-green-400">{notice}</p>}

      <div
        onDragOver={onBackgroundDragOver}
        onDragLeave={() => setDropActive(false)}
        onDrop={onBackgroundDrop}
        className={`min-h-0 flex-1 ${dropActive ? 'rounded ring-2 ring-inset ring-accent' : ''}`}
      >
        {shots.length === 0 ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm text-zinc-500">No shots yet</p>
            <p className="text-xs text-zinc-600">
              Drag assets here from the library, or import images/videos — each becomes a shot.
            </p>
          </div>
        ) : (
          <div className="flex h-full w-full items-start gap-2 overflow-x-auto p-3">
            {shots.map((shot) => (
              <ShotCard
                key={shot.id}
                shot={shot}
                selected={shot.id === selectedId}
                onSelect={() => select(shot.id)}
                onDragStart={() => (dragId.current = shot.id)}
                onReorderDrop={() => onReorderDrop(shot.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ShotCard({
  shot,
  selected,
  onSelect,
  onDragStart,
  onReorderDrop,
}: {
  shot: Shot
  selected: boolean
  onSelect: () => void
  onDragStart: () => void
  onReorderDrop: () => void
}): React.JSX.Element {
  const inputs = useShotStore((s) => s.inputsByShot[shot.id])
  const takes = useShotStore((s) => s.takesByShot[shot.id])
  const addInputs = useShotStore((s) => s.addInputs)
  const remove = useShotStore((s) => s.remove)
  const linkShot = useShotStore((s) => s.linkShot)
  const busy = useShotStore((s) => s.busyId === shot.id)
  const setMode = useUiStore((s) => s.setMode)
  const setLinkedWorkflow = useUiStore((s) => s.setLinkedWorkflow)
  const setActiveShot = useUiStore((s) => s.setActiveShot)
  const assets = useAssetStore((s) => s.assets)
  const [over, setOver] = useState(false)
  const linked = !!shot.comfyWorkflowName

  const onLink = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    const result = await linkShot(shot.id)
    setLinkedWorkflow(result?.comfyWorkflowName ?? shot.comfyWorkflowName)
    setActiveShot(shot.id)
    setMode('generate')
  }

  const inputThumbs: Thumb[] = (inputs ?? [])
    .map((i) => assets.find((a) => a.id === i.assetId))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .map((a) => ({ key: a.id, url: mediaUrl(a.filePath), kind: a.kind }))

  const outputThumbs: Thumb[] = (takes ?? []).map((t) => ({
    key: t.id,
    url: mediaUrl(t.filePath),
    kind: t.kind,
    hero: t.id === shot.heroTakeId,
  }))

  const onDrop = (e: React.DragEvent): void => {
    setOver(false)
    const ids = getAssetDragIds(e.dataTransfer)
    if (ids.length > 0) {
      e.preventDefault()
      e.stopPropagation() // a library asset → add as inputs, not a new shot / reorder
      void addInputs(shot.id, ids)
    } else {
      onReorderDrop()
    }
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(ASSET_DND_TYPE)) {
          e.preventDefault()
          setOver(true)
        } else {
          e.preventDefault()
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onClick={onSelect}
      className={`group flex w-56 shrink-0 cursor-pointer flex-col gap-1.5 rounded-lg border p-2 ${
        over ? 'border-accent ring-1 ring-accent' : selected ? 'border-accent' : 'border-border'
      } bg-panel`}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 truncate text-xs font-medium text-zinc-200">
          {shot.comfyWorkflowName && <span title="Linked to a ComfyUI workflow">🔗</span>}
          {shot.name}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            void remove(shot.id)
          }}
          title="Delete shot"
          className="hidden text-xs text-zinc-500 group-hover:block hover:text-red-400"
        >
          ✕
        </button>
      </div>

      <Section title="Inputs" thumbs={inputThumbs} />
      <div className="border-t border-border" />
      <Section title="Outputs" thumbs={outputThumbs} emptyText="no output yet" />

      <button
        onClick={(e) => void onLink(e)}
        disabled={busy}
        className="mt-auto rounded border border-border py-1 text-[10px] font-medium text-zinc-200 hover:bg-surface disabled:opacity-40"
      >
        {busy ? '…' : linked ? 'Open Workflow' : 'Link Workflow'}
      </button>
    </div>
  )
}

function Section({
  title,
  thumbs,
  emptyText,
}: {
  title: string
  thumbs: Thumb[]
  emptyText?: string
}): React.JSX.Element {
  const shown = thumbs.slice(0, STACK_MAX)
  const overflow = thumbs.length - shown.length
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] font-medium uppercase tracking-wide text-zinc-500">
        {title} {thumbs.length > 0 && <span className="text-zinc-600">· {thumbs.length}</span>}
      </span>
      {/* Fixed one-row height so every card is the same height regardless of count. */}
      <div className="flex h-12 items-center gap-1">
        {thumbs.length === 0 ? (
          <span className="text-[10px] text-zinc-600">{emptyText ?? 'empty'}</span>
        ) : (
          <>
            {shown.map((t) => (
              <Tile key={t.key} thumb={t} />
            ))}
            {overflow > 0 && (
              <span className="flex h-12 w-12 items-center justify-center rounded border border-border bg-surface text-[10px] text-zinc-400">
                +{overflow}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Tile({ thumb }: { thumb: Thumb }): React.JSX.Element {
  return (
    <div
      className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded border bg-black/40 ${
        thumb.hero ? 'border-accent ring-1 ring-accent' : 'border-border'
      }`}
    >
      {thumb.kind === 'image' && (
        <img src={thumb.url} alt="" className="h-full w-full object-cover" />
      )}
      {thumb.kind === 'video' && (
        <video src={thumb.url} muted preload="metadata" className="h-full w-full object-cover" />
      )}
      {thumb.kind === 'audio' && <span className="text-sm">🎵</span>}
    </div>
  )
}
