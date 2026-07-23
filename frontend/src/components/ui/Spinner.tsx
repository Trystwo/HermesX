import { cn } from '@/utils/cn'

export interface SpinnerProps {
  size?: number
  className?: string
}

export function Spinner({ size = 20, className }: SpinnerProps) {
  return (
    <svg
      className={cn('animate-spin text-brand', className)}
      style={{ width: size, height: size }}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}

export function LoadingBlock({ height = 200 }: { height?: number }) {
  return (
    <div className="flex items-center justify-center w-full" style={{ height }}>
      <Spinner />
    </div>
  )
}
