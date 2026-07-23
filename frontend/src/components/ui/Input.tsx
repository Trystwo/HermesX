import { forwardRef, InputHTMLAttributes } from 'react'
import { cn } from '@/utils/cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  prefix?: string
  suffix?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, prefix, suffix, className, id, ...props }, ref) => {
    const inputId = id || props.name
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-xs text-fg-muted mb-1.5">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {prefix && (
            <span className="absolute left-3 text-xs text-fg-subtle pointer-events-none">
              {prefix}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'w-full h-9 rounded-md bg-bg-elevated border border-border text-sm text-fg px-3',
              'placeholder:text-fg-subtle focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand',
              'transition-colors',
              prefix && 'pl-8',
              suffix && 'pr-10',
              error && 'border-up focus:border-up focus:ring-up',
              className,
            )}
            {...props}
          />
          {suffix && (
            <span className="absolute right-3 text-xs text-fg-subtle pointer-events-none">
              {suffix}
            </span>
          )}
        </div>
        {error && <p className="mt-1 text-xs text-up">{error}</p>}
      </div>
    )
  },
)
Input.displayName = 'Input'
