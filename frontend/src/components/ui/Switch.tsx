import { cn } from '@/utils/cn'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  size?: 'sm' | 'md'
  className?: string
}

export function Switch({ checked, onChange, disabled, size = 'md', className }: SwitchProps) {
  const dims =
    size === 'sm'
      ? { w: 'w-8', h: 'h-4.5', knob: 'h-3.5 w-3.5', translate: 'translate-x-3.5' }
      : { w: 'w-10', h: 'h-5.5', knob: 'h-4 w-4', translate: 'translate-x-5' }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        'relative inline-flex items-center rounded-full transition-colors shrink-0',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        dims.w,
        dims.h,
        checked ? 'bg-brand' : 'bg-bg-hover',
        className,
      )}
      style={{ height: size === 'sm' ? '18px' : '22px' }}
    >
      <span
        className={cn(
          'inline-block transform rounded-full bg-white transition-transform',
          dims.knob,
          checked ? dims.translate : 'translate-x-0.5',
        )}
        style={{
          width: size === 'sm' ? 14 : 16,
          height: size === 'sm' ? 14 : 16,
        }}
      />
    </button>
  )
}
