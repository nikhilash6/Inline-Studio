/**
 * Shots: the timeline's atomic unit. Each shot has an Input (an imported asset)
 * and a history of generated Takes; its hero take is the Output. For now all shots
 * live in a single auto-created default sequence (sequences aren't exposed in the UI yet).
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { existsSync, unlinkSync } from 'node:fs'
import type { Shot, Take, ShotInput, ShotKind, AssetKind } from '@shared/types'
import { getDb, getOpenProjectFolder } from '../db'
import { importViaDialog } from '../assets/store'

interface ShotRow {
  id: string
  sequence_id: string
  name: string
  kind: ShotKind
  position: number
  input_asset_id: string | null
  hero_take_id: string | null
  workflow_template_id: string | null
  comfy_workflow_name: string | null
  created_at: number
  updated_at: number
}

interface TakeRow {
  id: string
  shot_id: string
  file_path: string
  kind: AssetKind
  params: string
  comfy_prompt_id: string | null
  created_at: number
}

function rowToShot(row: ShotRow): Shot {
  return {
    id: row.id,
    sequenceId: row.sequence_id,
    name: row.name,
    kind: row.kind,
    position: row.position,
    inputAssetId: row.input_asset_id,
    heroTakeId: row.hero_take_id,
    workflowTemplateId: row.workflow_template_id,
    comfyWorkflowName: row.comfy_workflow_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToTake(row: TakeRow): Take {
  return {
    id: row.id,
    shotId: row.shot_id,
    filePath: row.file_path,
    kind: row.kind,
    params: JSON.parse(row.params) as Record<string, unknown>,
    comfyPromptId: row.comfy_prompt_id,
    createdAt: row.created_at,
  }
}

interface ShotInputRow {
  id: string
  shot_id: string
  asset_id: string
  position: number
}

function rowToShotInput(row: ShotInputRow): ShotInput {
  return { id: row.id, shotId: row.shot_id, assetId: row.asset_id, position: row.position }
}

function projectId(): string {
  const row = getDb().prepare('SELECT id FROM project LIMIT 1').get() as { id: string } | undefined
  if (!row) throw new Error('No project is open.')
  return row.id
}

/** The single default sequence shots are created in; created on first use. */
function defaultSequenceId(): string {
  const db = getDb()
  const existing = db.prepare('SELECT id FROM sequences ORDER BY position LIMIT 1').get() as
    | { id: string }
    | undefined
  if (existing) return existing.id
  const id = randomUUID()
  db.prepare('INSERT INTO sequences (id, project_id, name, position) VALUES (?, ?, ?, ?)').run(
    id,
    projectId(),
    'Main',
    0,
  )
  return id
}

function getShot(id: string): Shot {
  const row = getDb().prepare('SELECT * FROM shots WHERE id = ?').get(id) as ShotRow | undefined
  if (!row) throw new Error('Shot not found.')
  return rowToShot(row)
}

export function listShots(): Shot[] {
  const seqId = defaultSequenceId()
  const rows = getDb()
    .prepare('SELECT * FROM shots WHERE sequence_id = ? ORDER BY position')
    .all(seqId) as ShotRow[]
  return rows.map(rowToShot)
}

function createShot(asset: { id: string; kind: AssetKind }): Shot {
  if (asset.kind === 'audio') throw new Error('A shot must be an image or video, not audio.')
  const db = getDb()
  const seqId = defaultSequenceId()
  const count = (
    db.prepare('SELECT COUNT(*) AS n FROM shots WHERE sequence_id = ?').get(seqId) as { n: number }
  ).n
  const now = Date.now()
  const shot: Shot = {
    id: randomUUID(),
    sequenceId: seqId,
    name: String(count + 1),
    kind: asset.kind,
    position: count,
    inputAssetId: asset.id,
    heroTakeId: null,
    workflowTemplateId: null,
    comfyWorkflowName: null,
    createdAt: now,
    updatedAt: now,
  }
  db.prepare(
    `INSERT INTO shots
       (id, sequence_id, name, kind, position, input_asset_id, hero_take_id, workflow_template_id, comfy_workflow_name, created_at, updated_at)
     VALUES (@id, @sequenceId, @name, @kind, @position, @inputAssetId, @heroTakeId, @workflowTemplateId, @comfyWorkflowName, @createdAt, @updatedAt)`,
  ).run(shot)
  // Every shot starts with exactly one input (the asset it was created from).
  db.prepare('INSERT INTO shot_inputs (id, shot_id, asset_id, position) VALUES (?, ?, ?, 0)').run(
    randomUUID(),
    shot.id,
    asset.id,
  )
  return shot
}

function assetById(id: string): { id: string; kind: AssetKind } {
  const row = getDb().prepare('SELECT id, kind FROM assets WHERE id = ?').get(id) as
    | { id: string; kind: AssetKind }
    | undefined
  if (!row) throw new Error('Asset not found.')
  return row
}

export function addFromAsset(assetId: string): Shot {
  return createShot(assetById(assetId))
}

export async function importAsShots(): Promise<Shot[]> {
  const assets = await importViaDialog(null)
  return assets.filter((a) => a.kind !== 'audio').map((a) => createShot({ id: a.id, kind: a.kind }))
}

export function renameShot(id: string, name: string): Shot {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Shot name is required.')
  getShot(id)
  getDb()
    .prepare('UPDATE shots SET name = ?, updated_at = ? WHERE id = ?')
    .run(trimmed, Date.now(), id)
  return getShot(id)
}

export function reorderShots(orderedIds: string[]): void {
  const db = getDb()
  const now = Date.now()
  const stmt = db.prepare('UPDATE shots SET position = ?, updated_at = ? WHERE id = ?')
  const tx = db.transaction(() => {
    orderedIds.forEach((id, index) => stmt.run(index, now, id))
  })
  tx()
}

export function deleteShot(id: string): void {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM takes WHERE shot_id = ?').run(id)
    db.prepare('DELETE FROM shot_inputs WHERE shot_id = ?').run(id)
    db.prepare('DELETE FROM shots WHERE id = ?').run(id)
  })
  tx()
}

/** All shot inputs across the project (renderer groups by shotId). */
export function listInputs(): ShotInput[] {
  const rows = getDb()
    .prepare('SELECT * FROM shot_inputs ORDER BY shot_id, position')
    .all() as ShotInputRow[]
  return rows.map(rowToShotInput)
}

function shotInputRows(shotId: string): ShotInputRow[] {
  return getDb()
    .prepare('SELECT * FROM shot_inputs WHERE shot_id = ? ORDER BY position')
    .all(shotId) as ShotInputRow[]
}

export function addInput(shotId: string, assetId: string): ShotInput {
  getShot(shotId)
  const existing = shotInputRows(shotId)
  const dup = existing.find((r) => r.asset_id === assetId)
  if (dup) return rowToShotInput(dup)
  const input: ShotInput = {
    id: randomUUID(),
    shotId,
    assetId,
    position: existing.length,
  }
  getDb()
    .prepare('INSERT INTO shot_inputs (id, shot_id, asset_id, position) VALUES (?, ?, ?, ?)')
    .run(input.id, input.shotId, input.assetId, input.position)
  return input
}

export function removeInput(shotId: string, assetId: string): void {
  const rows = shotInputRows(shotId)
  if (rows.length <= 1) throw new Error('A shot must keep at least one input.')
  getDb().prepare('DELETE FROM shot_inputs WHERE shot_id = ? AND asset_id = ?').run(shotId, assetId)
}

export function reorderInputs(shotId: string, orderedAssetIds: string[]): void {
  const db = getDb()
  const stmt = db.prepare('UPDATE shot_inputs SET position = ? WHERE shot_id = ? AND asset_id = ?')
  const tx = db.transaction(() => {
    orderedAssetIds.forEach((assetId, index) => stmt.run(index, shotId, assetId))
  })
  tx()
}

/** Input filenames (basenames) of a shot, in order — used to seed the workflow Note. */
export function shotInputFileNames(shotId: string): string[] {
  const ids = shotInputRows(shotId).map((r) => r.asset_id)
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  const rows = getDb()
    .prepare(`SELECT id, file_path FROM assets WHERE id IN (${placeholders})`)
    .all(...ids) as Array<{ id: string; file_path: string }>
  const byId = new Map(rows.map((r) => [r.id, r.file_path.split('/').pop() ?? r.file_path]))
  return ids.map((id) => byId.get(id)).filter((n): n is string => !!n)
}

/** All takes across the project (renderer groups by shotId). */
export function listAllTakes(): Take[] {
  const rows = getDb()
    .prepare('SELECT * FROM takes ORDER BY shot_id, created_at DESC')
    .all() as TakeRow[]
  return rows.map(rowToTake)
}

export function deleteTake(takeId: string): void {
  const db = getDb()
  const take = db.prepare('SELECT * FROM takes WHERE id = ?').get(takeId) as TakeRow | undefined
  if (!take) return
  const folder = getOpenProjectFolder()
  const tx = db.transaction(() => {
    db.prepare('UPDATE shots SET hero_take_id = NULL WHERE hero_take_id = ?').run(takeId)
    db.prepare('DELETE FROM takes WHERE id = ?').run(takeId)
  })
  tx()
  // Best-effort: remove the generated file from disk.
  if (folder) {
    const abs = join(folder, take.file_path)
    if (existsSync(abs)) {
      try {
        unlinkSync(abs)
      } catch {
        // ignore
      }
    }
  }
}

export function setHero(id: string, takeId: string | null): Shot {
  getShot(id)
  getDb()
    .prepare('UPDATE shots SET hero_take_id = ?, updated_at = ? WHERE id = ?')
    .run(takeId, Date.now(), id)
  return getShot(id)
}

export function listTakes(shotId: string): Take[] {
  const rows = getDb()
    .prepare('SELECT * FROM takes WHERE shot_id = ? ORDER BY created_at DESC')
    .all(shotId) as TakeRow[]
  return rows.map(rowToTake)
}

/** The hero (Output) take of every shot that has one — one query for the timeline. */
export function heroTakes(): Take[] {
  const rows = getDb()
    .prepare('SELECT t.* FROM takes t JOIN shots s ON s.hero_take_id = t.id')
    .all() as TakeRow[]
  return rows.map(rowToTake)
}

/** Insert a generated take for a shot and make it the hero (Output). */
export function addTake(input: {
  shotId: string
  filePath: string
  kind: AssetKind
  comfyPromptId: string | null
  params: Record<string, unknown>
}): Take {
  getShot(input.shotId) // ensure exists
  const id = randomUUID()
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO takes (id, shot_id, file_path, kind, params, comfy_prompt_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.shotId,
      input.filePath,
      input.kind,
      JSON.stringify(input.params),
      input.comfyPromptId,
      now,
    )
  setHero(input.shotId, id)
  return {
    id,
    shotId: input.shotId,
    filePath: input.filePath,
    kind: input.kind,
    params: input.params,
    comfyPromptId: input.comfyPromptId,
    createdAt: now,
  }
}

/** Read a single shot (throws if missing). */
export function getShotById(id: string): Shot {
  return getShot(id)
}

/** Record the ComfyUI workflow this shot is linked to. */
export function linkWorkflow(shotId: string, name: string): Shot {
  getShot(shotId)
  getDb()
    .prepare('UPDATE shots SET comfy_workflow_name = ?, updated_at = ? WHERE id = ?')
    .run(name, Date.now(), shotId)
  return getShot(shotId)
}
