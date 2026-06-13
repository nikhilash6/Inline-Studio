import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { NodeProps } from '@xyflow/react'
import { NodeFrame } from './NodeFrame'
import type { ResizeSize } from './NodeFrame'
import { TextToolbar } from './TextToolbar'
import { useMoodboardStore } from '../../../store/moodboardStore'
import type { TextNodeData } from './nodeData'
import type { TextItemData } from '@shared/types'

const MIN_FONT = 8
const MAX_FONT = 96
const clampFont = (n: number): number => Math.min(MAX_FONT, Math.max(MIN_FONT, Math.round(n)))

/**
 * Editable text item — floats bare on the canvas (no surface box), light-grey by
 * default. Double-click to edit; blur persists. Selecting it reveals a formatting
 * toolbar (colour / size / style / align / link). A linked, non-editing node opens
 * its URL in the browser on click.
 */
export function TextNode({ id, data, selected }: NodeProps): React.JSX.Element {
  const { text } = data as TextNodeData
  const updateItem = useMoodboardStore((s) => s.updateItem)
  const [editing, setEditing] = useState(false)
  // Live font size shown while dragging the resize handle; null = use persisted size.
  const [liveFont, setLiveFont] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  // Captured at resize start so font scales proportionally to the height change.
  const resizeStart = useRef<{ height: number; fontSize: number } | null>(null)

  const fontAtHeight = (height: number): number => {
    const s = resizeStart.current
    if (!s || s.height <= 0) return text.fontSize
    return clampFont(s.fontSize * (height / s.height))
  }

  const onResizeStart = (size: ResizeSize): void => {
    resizeStart.current = { height: size.height, fontSize: text.fontSize }
  }
  const onResize = (size: ResizeSize): void => setLiveFont(fontAtHeight(size.height))
  const onResizeEnd = (size: ResizeSize): void => {
    const fontSize = fontAtHeight(size.height)
    resizeStart.current = null
    setLiveFont(null)
    void updateItem(id, { ...size, data: { text: { ...text, fontSize } } })
  }

  const style: CSSProperties = {
    fontSize: liveFont ?? text.fontSize,
    color: text.color,
    textAlign: text.align,
    fontWeight: text.bold ? 700 : 400,
    fontStyle: text.italic ? 'italic' : 'normal',
    textDecoration: text.underline || (text.link && !editing) ? 'underline' : 'none',
    cursor: text.link && !editing ? 'pointer' : undefined,
  }

  const commit = (): void => {
    setEditing(false)
    const next = ref.current?.innerText ?? text.text
    if (next !== text.text) void updateItem(id, { data: { text: { ...text, text: next } } })
  }

  const applyPatch = (patch: Partial<TextItemData>): void =>
    void updateItem(id, { data: { text: { ...text, ...patch } } })

  const openLink = (): void => {
    if (text.link && !editing) void window.storyline.shell.openExternal(text.link)
  }

  return (
    <>
      {/* Sibling of the frame (not a child) so it escapes the node's overflow-hidden box. */}
      {selected && !editing && <TextToolbar text={text} onChange={applyPatch} />}
      <NodeFrame
        id={id}
        selected={!!selected}
        minHeight={32}
        transparent
        onResizeStart={onResizeStart}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      >
        <div
          ref={ref}
          style={style}
          className={`h-full w-full whitespace-pre-wrap break-words px-1 outline-none ${
            editing ? 'nodrag cursor-text' : 'cursor-grab'
          }`}
          contentEditable={editing}
          suppressContentEditableWarning
          onDoubleClick={() => setEditing(true)}
          onClick={openLink}
          onBlur={commit}
        >
          {text.text}
        </div>
      </NodeFrame>
    </>
  )
}
