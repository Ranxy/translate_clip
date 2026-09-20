import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

import { cn } from '../../utils/cn'

function controlClasses(className?: string): string {
  return cn(
    'w-full rounded-lg border border-border bg-surface-sunken px-2.5 py-1.5 text-[13px] text-text',
    'placeholder:text-faint transition-colors duration-150',
    'focus:border-accent focus:outline-none',
    'disabled:opacity-45',
    className
  )
}

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  options: SelectOption[]
  onValueChange: (value: string) => void
}

export function Select({ options, onValueChange, className, ...rest }: SelectProps) {
  return (
    <select
      className={cn(controlClasses(className), 'cursor-pointer appearance-none pr-7')}
      onChange={(event) => onValueChange(event.target.value)}
      {...rest}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={controlClasses(className)} {...rest} />
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlClasses(className), 'resize-y font-mono leading-relaxed')} {...rest} />
}

/** Read-only block for showing generated content such as a rendered prompt. */
export function CodeBlock({ children, className }: { children: string; className?: string }) {
  return (
    <pre
      className={cn(
        'selectable max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-sunken p-2.5',
        'font-mono text-[11.5px] leading-relaxed text-muted',
        className
      )}
    >
      {children}
    </pre>
  )
}
