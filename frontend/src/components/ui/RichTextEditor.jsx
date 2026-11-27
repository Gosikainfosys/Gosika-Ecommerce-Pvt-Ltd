import { useEffect, useRef } from 'react'
import { Bold, Italic, Link2, List, ListOrdered, Unlink } from 'lucide-react'
import { Field } from './Input'

const command = (name, value = null) => {
  document.execCommand(name, false, value)
}

export default function RichTextEditor({ label, value, onChange, error, hint, disabled, rows = 6 }) {
  const editorRef = useRef(null)

  useEffect(() => {
    const node = editorRef.current
    if (node && node.innerHTML !== (value || '')) {
      node.innerHTML = value || ''
    }
  }, [value])

  const runCommand = (name, commandValue) => {
    if (disabled) return
    editorRef.current?.focus()
    command(name, commandValue)
    onChange(editorRef.current?.innerHTML || '')
  }

  const addLink = () => {
    if (disabled) return
    const url = window.prompt('Enter the link URL (https://…)')
    if (!url) return
    if (!/^https?:\/\//i.test(url)) {
      window.alert('Links must start with http:// or https://.')
      return
    }
    runCommand('createLink', url)
  }

  return (
    <Field label={label} error={error} hint={hint}>
      <div className={`rich-editor${disabled ? ' is-disabled' : ''}`}>
        <div className="rich-editor-toolbar" role="toolbar" aria-label="Description formatting">
          <button type="button" title="Bold" aria-label="Bold" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('bold')}><Bold size={14} /></button>
          <button type="button" title="Italic" aria-label="Italic" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('italic')}><Italic size={14} /></button>
          <span className="rich-editor-divider" />
          <button type="button" title="Bulleted list" aria-label="Bulleted list" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('insertUnorderedList')}><List size={14} /></button>
          <button type="button" title="Numbered list" aria-label="Numbered list" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('insertOrderedList')}><ListOrdered size={14} /></button>
          <span className="rich-editor-divider" />
          <button type="button" title="Add link" aria-label="Add link" onMouseDown={(event) => event.preventDefault()} onClick={addLink}><Link2 size={14} /></button>
          <button type="button" title="Remove link" aria-label="Remove link" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('unlink')}><Unlink size={14} /></button>
        </div>
        <div
          ref={editorRef}
          className="rich-editor-content"
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={label || 'Rich text editor'}
          style={{ minHeight: rows * 24 }}
          onInput={(event) => onChange(event.currentTarget.innerHTML)}
          onBlur={(event) => onChange(event.currentTarget.innerHTML)}
        />
      </div>
    </Field>
  )
}
