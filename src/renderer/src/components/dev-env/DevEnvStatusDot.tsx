import { cn } from '@/lib/utils'
import { DEV_ENV_TONE_DOT, type DevEnvTone } from './dev-env-labels'

export function DevEnvStatusDot({
  tone,
  className
}: {
  tone: DevEnvTone
  className?: string
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full', DEV_ENV_TONE_DOT[tone], className)}
    />
  )
}
