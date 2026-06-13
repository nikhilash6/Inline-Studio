import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { NodeProps } from '@xyflow/react'
import { NodeFrame } from './NodeFrame'
import { TextToolbar } from './TextToolbar'
import { useMoodboardStore } from '../../../store/moodboardStore'
import type { TextNodeData } from './nodeData'
import type { TextItemData } from '@shared/types'

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
  const ref = useRef<HTMLDivElement>(null)

  const style: CSSProperties = {
    fontSize: text.fontSize,
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
      <NodeFrame id={id} selected={!!selected} minHeight={32} transparent>
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
