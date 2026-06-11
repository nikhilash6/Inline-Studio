/** Drag-and-drop helpers used within the renderer. */

/** Carries one or more asset ids when dragging from the Library. */
export const ASSET_DND_TYPE = 'application/x-storyline-asset'

/** Encode the dragged asset ids onto a drag event's dataTransfer. */
export function setAssetDragPayload(dt: DataTransfer, assetIds: string[]): void {
  dt.setData(ASSET_DND_TYPE, JSON.stringify(assetIds))
  dt.effectAllowed = 'copy'
}

/** Decode dragged asset ids (tolerates a legacy single-id string payload). */
export function getAssetDragIds(dt: DataTransfer): string[] {
  const raw = dt.getData(ASSET_DND_TYPE)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return [raw]
  }
  return []
}
