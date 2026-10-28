import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type {
  HulyMissionEvent,
  HulyStatusRule
} from '../../../../shared/huly/huly-project-settings'
import type { HulyStatus, HulyStatusCategory } from '../../../../shared/huly/huly-types'
import { HulyMultiSelect } from './HulyMultiSelect'

// Radix Select reserves the empty string, so "Don't change" needs its own value.
const NO_CHANGE_VALUE = '__huly_no_change__'

const MISSION_EVENTS: readonly HulyMissionEvent[] = [
  'layer-created',
  'stack-pr-created',
  'stack-merged'
]

function getEventLabel(event: HulyMissionEvent): string {
  switch (event) {
    case 'layer-created':
      return translate(
        'auto.components.settings.HulyStatusRuleEditor.layerCreated',
        'Task layer created'
      )
    case 'stack-pr-created':
      return translate(
        'auto.components.settings.HulyStatusRuleEditor.stackPrCreated',
        'Stacked pull request created'
      )
    case 'stack-merged':
      return translate(
        'auto.components.settings.HulyStatusRuleEditor.stackMerged',
        'Stack merged into the default branch'
      )
  }
}

function getCategoryOptions(): { value: HulyStatusCategory; label: string }[] {
  return [
    {
      value: 'UnStarted',
      label: translate('auto.components.settings.HulyStatusRuleEditor.categoryBacklog', 'Backlog')
    },
    {
      value: 'ToDo',
      label: translate('auto.components.settings.HulyStatusRuleEditor.categoryToDo', 'To do')
    },
    {
      value: 'Active',
      label: translate(
        'auto.components.settings.HulyStatusRuleEditor.categoryActive',
        'In progress'
      )
    },
    {
      value: 'Won',
      label: translate('auto.components.settings.HulyStatusRuleEditor.categoryWon', 'Done')
    },
    {
      value: 'Lost',
      label: translate('auto.components.settings.HulyStatusRuleEditor.categoryLost', 'Canceled')
    }
  ]
}

function isHulyStatusCategory(value: string): value is HulyStatusCategory {
  return getCategoryOptions().some((option) => option.value === value)
}

type HulyStatusRuleEditorProps = {
  statuses: readonly HulyStatus[]
  rules: Record<HulyMissionEvent, HulyStatusRule>
  onChange: (rules: Record<HulyMissionEvent, HulyStatusRule>) => void
}

/** One row per Mission event: the status to move to, and the statuses it may move from. */
export function HulyStatusRuleEditor({
  statuses,
  rules,
  onChange
}: HulyStatusRuleEditorProps): React.JSX.Element {
  const statusOptions = statuses.map((status) => ({ value: status.name, label: status.name }))
  const categoryOptions = getCategoryOptions()
  const updateRule = (event: HulyMissionEvent, patch: Partial<HulyStatusRule>): void => {
    onChange({ ...rules, [event]: { ...rules[event], ...patch } })
  }

  return (
    <div className="space-y-3">
      {MISSION_EVENTS.map((event) => {
        const rule = rules[event]
        const eventLabel = getEventLabel(event)
        const targetIsListed = rule.target === null || statuses.some((s) => s.name === rule.target)
        return (
          <div key={event} className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">{eventLabel}</p>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
              <span className="text-xs text-muted-foreground">
                {translate('auto.components.settings.HulyStatusRuleEditor.moveTo', 'Move to')}
              </span>
              <Select
                value={rule.target ?? NO_CHANGE_VALUE}
                onValueChange={(value) =>
                  updateRule(event, { target: value === NO_CHANGE_VALUE ? null : value })
                }
              >
                <SelectTrigger
                  size="sm"
                  density="compact"
                  className="w-full"
                  aria-label={translate(
                    'auto.components.settings.HulyStatusRuleEditor.targetLabel',
                    'Status after: {{event}}',
                    { event: eventLabel }
                  )}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CHANGE_VALUE}>
                    {translate(
                      'auto.components.settings.HulyStatusRuleEditor.noChange',
                      "Don't change"
                    )}
                  </SelectItem>
                  {statusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                  {!targetIsListed && rule.target ? (
                    <SelectItem value={rule.target}>{rule.target}</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                {translate('auto.components.settings.HulyStatusRuleEditor.onlyFrom', 'Only from')}
              </span>
              <div className="grid min-w-0 grid-cols-2 gap-2">
                <HulyMultiSelect
                  options={statusOptions}
                  selected={rule.fromStatusNames}
                  onChange={(fromStatusNames) => updateRule(event, { fromStatusNames })}
                  placeholder={translate(
                    'auto.components.settings.HulyStatusRuleEditor.noStatuses',
                    'No statuses'
                  )}
                  ariaLabel={translate(
                    'auto.components.settings.HulyStatusRuleEditor.fromStatusesLabel',
                    'Statuses to move from: {{event}}',
                    { event: eventLabel }
                  )}
                />
                <HulyMultiSelect
                  options={categoryOptions}
                  selected={rule.fromCategories}
                  onChange={(next) =>
                    updateRule(event, { fromCategories: next.filter(isHulyStatusCategory) })
                  }
                  placeholder={translate(
                    'auto.components.settings.HulyStatusRuleEditor.noCategories',
                    'No categories'
                  )}
                  ariaLabel={translate(
                    'auto.components.settings.HulyStatusRuleEditor.fromCategoriesLabel',
                    'Categories to move from: {{event}}',
                    { event: eventLabel }
                  )}
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
