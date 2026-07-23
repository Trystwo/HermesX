import { cn } from '@/utils/cn'

export interface SliderProps {
  min: number
  max: number
  step?: number
  value: number
  onChange: (v: number) => void
  disabled?: boolean
  className?: string
  marks?: { value: number; label: string }[]
}

export function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
  disabled,
  className,
  marks,
}: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100

  return (
    <div className={cn('w-full', className)}>
      <div className="relative h-9 flex items-center">
        <div className="absolute left-0 right-0 h-1.5 rounded-full bg-bg-hover" />
        <div
          className="absolute h-1.5 rounded-full bg-brand"
          style={{ width: `${pct}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
        <div
          className="absolute h-4 w-4 rounded-full bg-white border-2 border-brand shadow pointer-events-none"
          style={{ left: `calc(${pct}% - 8px)` }}
        />
      </div>
      {marks && (
        <div className="relative h-4 -mt-1">
          {marks.map((m) => {
            const mp = ((m.value - min) / (max - min)) * 100
            return (
              <span
                key={m.value}
                className="absolute text-[10px] text-fg-subtle -translate-x-1/2"
                style={{ left: `${mp}%` }}
              >
                {m.label}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
