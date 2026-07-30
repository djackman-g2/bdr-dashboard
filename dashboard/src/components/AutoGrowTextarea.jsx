import { useEffect, useRef } from 'react'

// Inline-editable textarea that grows to fit its content. Single-line <input>s
// in the tracker tables clip long notes/hooks; this keeps every character in
// view. Enter commits (blur → the row's onBlur save), Shift+Enter for a newline.
export default function AutoGrowTextarea({ value, className = '', onKeyDown, ...props }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          e.currentTarget.blur()
        }
        onKeyDown?.(e)
      }}
      className={`block resize-none overflow-hidden ${className}`}
      {...props}
    />
  )
}
