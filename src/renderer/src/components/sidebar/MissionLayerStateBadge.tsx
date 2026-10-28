import React from 'react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { MissionRestackLayer } from '../../../../shared/mission-layer-state'

type BadgeVariant = React.ComponentProps<typeof Badge>['variant']

function getStateBadge(
  state: MissionRestackLayer['state']
): { label: string; variant: BadgeVariant } | null {
  switch (state) {
    case 'current':
      return {
        label: translate('auto.components.sidebar.MissionLayerStateBadge.55243cad04', 'Current'),
        variant: 'ghost'
      }
    case 'stale':
      return {
        label: translate('auto.components.sidebar.MissionLayerStateBadge.c487f09511', 'Stale'),
        variant: 'secondary'
      }
    case 'blocked':
      return {
        label: translate('auto.components.sidebar.MissionLayerStateBadge.1fdc238b72', 'Blocked'),
        variant: 'dot'
      }
    case 'conflict':
      return {
        label: translate('auto.components.sidebar.MissionLayerStateBadge.2f054d9d41', 'Conflict'),
        variant: 'destructive'
      }
    case 'needs-push':
      return {
        label: translate('auto.components.sidebar.MissionLayerStateBadge.72e9110ad5', 'Needs push'),
        variant: 'secondary'
      }
    // Why: merged needs PR hydration, which the sidebar does not wire yet.
    case 'merged':
      return null
  }
}

/** A stack layer's state; Blocked and Conflict explain their reason on hover. */
export function MissionLayerStateBadge({
  layer
}: {
  layer: MissionRestackLayer | undefined
}): React.JSX.Element | null {
  const badge = layer ? getStateBadge(layer.state) : null
  if (!layer || !badge) {
    return null
  }
  const hasReasonTooltip =
    Boolean(layer.reason) && (layer.state === 'blocked' || layer.state === 'conflict')
  const element = (
    <Badge
      variant={badge.variant}
      data-mission-layer-state={layer.state}
      tabIndex={hasReasonTooltip ? 0 : undefined}
    >
      {badge.label}
    </Badge>
  )
  if (!hasReasonTooltip) {
    return element
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{element}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {layer.reason}
      </TooltipContent>
    </Tooltip>
  )
}
