import { Environment } from '@/types'
import { Badge, BadgeVariant } from '@/components/ui/Badge'
import { Shield, AlertTriangle } from 'lucide-react'

export interface EnvironmentBadgeProps {
  environment: Environment
  size?: 'sm' | 'md'
}

export function EnvironmentBadge({ environment, size = 'md' }: EnvironmentBadgeProps) {
  if (environment === 'LIVE') {
    return (
      <Badge variant="danger" className={size === 'sm' ? 'text-[10px]' : ''}>
        <AlertTriangle size={size === 'sm' ? 10 : 12} />
        实盘
      </Badge>
    )
  }
  return (
    <Badge variant="success" className={size === 'sm' ? 'text-[10px]' : ''}>
      <Shield size={size === 'sm' ? 10 : 12} />
      模拟盘
    </Badge>
  )
}

export const environmentVariant: Record<Environment, BadgeVariant> = {
  TESTNET: 'success',
  LIVE: 'danger',
}
