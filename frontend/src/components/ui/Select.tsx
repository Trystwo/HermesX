import { forwardRef, SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/utils/cn'

export interface SelectOption {
  label: string
  value: string | number
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: SelectOption[]
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className, id, ...props }, ref) => {
    const selectId = id || props.name
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={selectId} className="block text-xs text-fg-muted mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={cn(
              'w-full h-9 rounded-md bg-bg-elevated border border-border text-sm text-fg px-3 pr-8',
              'appearance-none cursor-pointer focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand',
              'transition-colors',
              error && 'border-up',
              className,
            )}
            {...props}
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-bg-elevated text-fg">
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none"
          />
        </div>
        {error && <p className="mt-1 text-xs text-up">{error}</p>}
      </div>
    )
  },
)
Select.displayName = 'Select'
