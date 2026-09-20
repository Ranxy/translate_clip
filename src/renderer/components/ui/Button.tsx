import type { ButtonHTMLAttributes } from 'react'

import { cn } from '../../utils/cn'

type ButtonVariant = 'primary' | 'subtle' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'icon'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-contrast hover:bg-accent-hover',
  subtle: 'bg-surface-sunken text-text hover:bg-surface-hover',
  ghost: 'text-muted hover:bg-surface-hover hover:text-text',
  danger: 'text-danger bg-danger-soft hover:brightness-105'
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 rounded-md px-2.5 text-[12px]',
  md: 'h-9 gap-2 rounded-lg px-3.5 text-[13px]',
  icon: 'h-7 w-7 rounded-md'
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant = 'subtle', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex select-none items-center justify-center font-medium transition-colors duration-150',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...rest}
    />
  )
}
