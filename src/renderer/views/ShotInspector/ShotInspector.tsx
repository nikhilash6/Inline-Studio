import { useState } from 'react'
import { mediaUrl } from '@shared/media'
import type { Asset, ShotInput, Take } from '@shared/types'
import { useShotStore } from '../../store/shotStore'
import { useAssetStore } from '../../store/assetStore'
import { useUiStore } from '../../store/uiStore'
import { ASSET_DND_TYPE, getAssetDragIds } from '../../lib/dnd'

/** Right-pane editor for the selected shot: all inputs + all outputs, plus actions. */
export function ShotInspector({ shotId }: { shotId: string }): React.JSX.Element | null {
  const shot = useShotStore((s) => s.shots.find((sh) => sh.id === shotId))
  const inputs = useShotStore((s) => s.inputsByShot[shotId] ?? [])
  const takes = useShotStore((s) => s.takesByShot[shotId] ?? [])
  const {
    addInputs,
    removeInput,
    reorderInputs,
    setHero,
    deleteTake,
    pullResult,
    linkShot,
    rename,
  } = useShotStore()
  const busy = useShotStore((s) => s.busyId === shotId)
  const select = useShotStore((s) => s.select)
  const assets = useAssetStore((s) => s.assets)
  const setMode = useUiStore((s) => s.setMode)
  const setLinkedWorkflow = useUiStore((s) => s.setLinkedWorkflow)
  const [over, setOver] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(shot?.name ?? '')

  if (!shot) return null

  const assetFor = (id: string): Asset | undefined => assets.find((a) => a.id === id)
  const linked = !!shot.comfyWorkflowName

  const onLink = async (): Promise<void> => {
    const result = await linkShot(shot.id)
    setLinkedWorkflow(result?.comfyWorkflowName ?? shot.comfyWorkflowName)
    setMode('generate')
  }

  const onDropInputs = (e: React.DragEvent): void => {
    setOver(false)
    const ids = getAssetDragIds(e.dataTransfer)
    if (ids.length > 0) {
      e.preventDefault()
      void addInputs(shot.id, ids)
    }
  }

  const move = (assetId: string, delta: number): void => {
    const order = inputs.map((i) => i.assetId)
    const from = order.indexOf(assetId)
    const to = from + delta
    if (from < 0 || to < 0 || to >= order.length) return
    order.splice(to, 0, order.splice(from, 1)[0])
    void reorderInputs(shot.id, order)
  }

  const commitName = (): void => {
    setEditingName(false)
    const trimmed = name.trim()
    if (trimmed && trimmed !== shot.name) void rename(shot.id, trimmed)
    else setName(shot.name)
  }

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {linked && <span title="Linked to a ComfyUI workflow">🔗</span>}
          {editingName ? (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName()
                if (e.key === 'Escape') {
                  setName(shot.name)
                  setEditingName(false)
                }
              }}
              onBlur={commitName}
              className="w-40 rounded border border-accent bg-surface px-1.5 py-0.5 text-sm text-zinc-100 outline-none"
            />
          ) : (
            <span
              onDoubleClick={() => setEditingName(true)}
              title="Double-click to rename"
              className="truncate text-sm font-semibold text-white"
            >
              Shot {shot.name}
            </span>
          )}
        </div>
        <button
          onClick={() => select(null)}
          className="shrink-0 rounded border border-border px-2 py-1 text-xs text-zinc-300 hover:bg-surface"
        >
          Close
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {/* Inputs */}
        <section>
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400">
            Inputs · {inputs.length}
          </h3>
          <div
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(ASSET_DND_TYPE)) {
                e.preventDefault()
                setOver(true)
              }
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDropInputs}
            className={`grid grid-cols-3 gap-2 rounded-md border border-dashed p-2 ${
              over ? 'border-accent bg-accent/5' : 'border-border'
            }`}
          >
            {inputs.map((input: ShotInput, idx) => {
              const asset = assetFor(input.assetId)
              return (
                <InputTile
                  key={input.id}
                  asset={asset}
                  canRemove={inputs.length > 1}
                  canMoveLeft={idx > 0}
                  canMoveRight={idx < inputs.length - 1}
                  onRemove={() => void removeInput(shot.id, input.assetId)}
                  onMoveLeft={() => move(input.assetId, -1)}
                  onMoveRight={() => move(input.assetId, 1)}
                />
              )
            })}
            <div className="col-span-3 pt-1 text-center text-[11px] text-zinc-600">
              Drag assets from the library to add inputs (⌘/Ctrl-click to multi-select).
            </div>
          </div>
        </section>

        {/* Outputs */}
        <section>
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400">
            Outputs · {takes.length}
          </h3>
          {takes.length === 0 ? (
            <p className="text-xs text-zinc-600">
              No outputs yet — Link a workflow, generate in ComfyUI, then Pull result.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {takes.map((take: Take) => (
                <OutputTile
                  key={take.id}
                  take={take}
                  isHero={take.id === shot.heroTakeId}
                  onSetHero={() => void setHero(shot.id, take.id)}
                  onDelete={() => void deleteTake(take.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="flex gap-1.5 border-t border-border p-2">
        <button
          disabled={busy}
          onClick={() => void onLink()}
          className="flex-1 rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          {busy ? '…' : linked ? 'Open Workflow' : 'Link'}
        </button>
        <button
          disabled={busy}
          onClick={() => void pullResult(shot.id)}
          className="flex-1 rounded-md border border-border px-2 py-1.5 text-xs text-zinc-300 hover:bg-surface disabled:opacity-40"
        >
          {busy ? '…' : 'Pull result'}
        </button>
      </div>
    </div>
  )
}

function InputTile({
  asset,
  canRemove,
  canMoveLeft,
  canMoveRight,
  onRemove,
  onMoveLeft,
  onMoveRight,
}: {
  asset: Asset | undefined
  canRemove: boolean
  canMoveLeft: boolean
  canMoveRight: boolean
  onRemove: () => void
  onMoveLeft: () => void
  onMoveRight: () => void
}): React.JSX.Element {
  return (
    <div className="group relative">
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded border border-border bg-black/40">
        {asset?.kind === 'image' && (
          <img src={mediaUrl(asset.filePath)} alt="" className="h-full w-full object-cover" />
        )}
        {asset?.kind === 'video' && (
          <video
            src={mediaUrl(asset.filePath)}
            muted
            preload="metadata"
            className="h-full w-full object-cover"
          />
        )}
        {asset?.kind === 'audio' && <span className="text-lg">🎵</span>}
        {!asset && <span className="text-[10px] text-zinc-600">missing</span>}
      </div>
      <div className="absolute inset-x-0 bottom-0 hidden items-center justify-between bg-black/70 px-1 py-0.5 group-hover:flex">
        <button
          onClick={onMoveLeft}
          disabled={!canMoveLeft}
          className="text-[10px] text-zinc-300 disabled:opacity-30"
        >
          ◀
        </button>
        <button
          onClick={onRemove}
          disabled={!canRemove}
          title={canRemove ? 'Remove input' : 'A shot needs at least one input'}
          className="text-[10px] text-zinc-300 hover:text-red-400 disabled:opacity-30"
        >
          ✕
        </button>
        <button
          onClick={onMoveRight}
          disabled={!canMoveRight}
          className="text-[10px] text-zinc-300 disabled:opacity-30"
        >
          ▶
        </button>
      </div>
    </div>
  )
}

function OutputTile({
  take,
  isHero,
  onSetHero,
  onDelete,
}: {
  take: Take
  isHero: boolean
  onSetHero: () => void
  onDelete: () => void
}): React.JSX.Element {
  return (
    <div className="group relative">
      <div
        className={`flex aspect-square items-center justify-center overflow-hidden rounded border bg-black/40 ${
          isHero ? 'border-accent ring-1 ring-accent' : 'border-border'
        }`}
      >
        {take.kind === 'video' ? (
          <video
            src={mediaUrl(take.filePath)}
            muted
            preload="metadata"
            className="h-full w-full object-cover"
          />
        ) : (
          <img src={mediaUrl(take.filePath)} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <button
        onClick={onSetHero}
        title={isHero ? 'Hero (used for export)' : 'Set as hero'}
        className={`absolute left-1 top-1 rounded px-1 text-[10px] ${
          isHero ? 'bg-accent text-white' : 'bg-black/70 text-zinc-300 hover:text-white'
        }`}
      >
        ★
      </button>
      <button
        onClick={onDelete}
        title="Delete take"
        className="absolute right-1 top-1 hidden rounded bg-black/70 px-1 text-[10px] text-zinc-300 group-hover:block hover:text-red-400"
      >
        ✕
      </button>
    </div>
  )
}
