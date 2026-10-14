import type { FeatureInteractionId } from '../../../../shared/feature-interaction-catalog'
import type { StatusBarItem } from '../../../../shared/ui-chrome-types'

export function recordStatusBarToggleInteraction(
  id: StatusBarItem,
  recordFeatureInteraction: (feature: FeatureInteractionId) => void
): void {
  if (id === 'resource-usage') {
    recordFeatureInteraction('resource-manager')
  } else if (id === 'ports') {
    recordFeatureInteraction('ports')
  } else if (id === 'ssh') {
    recordFeatureInteraction('ssh')
  } else if (
    id === 'claude' ||
    id === 'codex' ||
    id === 'gemini' ||
    id === 'opencode-go' ||
    id === 'kimi' ||
    id === 'antigravity' ||
    id === 'minimax' ||
    id === 'grok' ||
    id === 'cursor'
  ) {
    recordFeatureInteraction('usage-tracking')
  }
}
