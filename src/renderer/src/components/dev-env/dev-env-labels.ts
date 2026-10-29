import { translate } from '@/i18n/i18n'
import {
  DEV_ENV_STEP_IDS,
  type DevEnv,
  type DevEnvBadge,
  type DevEnvDetail,
  type DevEnvInfraState,
  type DevEnvServiceStatus,
  type DevEnvStepId,
  type DevEnvStepStatus
} from '../../../../shared/dev-env/dev-env-types'

export type DevEnvTone = 'ok' | 'warn' | 'error' | 'muted' | 'info'

/** Dot classes per tone; color is reserved for state per the style guide. */
export const DEV_ENV_TONE_DOT: Record<DevEnvTone, string> = {
  ok: 'bg-status-success',
  warn: 'bg-status-warning',
  error: 'bg-destructive',
  muted: 'bg-muted-foreground/40',
  info: 'bg-workspace-status-progress'
}

export function getDevEnvServiceTone(status: DevEnvServiceStatus): DevEnvTone {
  switch (status) {
    case 'up':
      return 'ok'
    case 'starting':
    case 'moved':
      return 'warn'
    case 'crashed':
      return 'error'
    case 'stopped':
    case 'unbound':
      return 'muted'
  }
}

export function getDevEnvInfraTone(status: DevEnvInfraState['status']): DevEnvTone {
  if (status === 'running') {
    return 'ok'
  }
  return status === 'unhealthy' ? 'error' : 'muted'
}

export function getDevEnvBadgeLabel(badge: DevEnvBadge): { text: string; tone: DevEnvTone } {
  const label = getDevEnvStateLabel(badge)
  return badge.danger
    ? { text: `${translate('devEnv.badge.prod', 'prod')} · ${label.text}`, tone: 'error' }
    : label
}

function getDevEnvStateLabel(badge: DevEnvBadge): { text: string; tone: DevEnvTone } {
  switch (badge.state) {
    case 'running':
      return { text: `${badge.up}/${badge.total}`, tone: 'ok' }
    case 'partial':
      return { text: `${badge.up}/${badge.total}`, tone: 'warn' }
    case 'failed':
      return { text: translate('devEnv.badge.setup', 'setup'), tone: 'error' }
    case 'setting-up':
      return { text: translate('devEnv.badge.settingUp', 'setup…'), tone: 'info' }
    case 'stopped':
      return { text: translate('devEnv.badge.stopped', 'stopped'), tone: 'muted' }
  }
}

const STEP_LABELS: Record<DevEnvStepId, string> = {
  ports: 'Allocate ports',
  env: 'Render env',
  install: 'Install dependencies',
  infra: 'Ensure shared infra',
  data: 'Provision data',
  seed: 'Seed'
}

export type DevEnvSetupRow = {
  step: DevEnvStepId
  label: string
  status: DevEnvStepStatus
  detail?: string
  error?: string
  durationMs?: number
  canRerun: boolean
}

export function getDevEnvSetupRows(env: Pick<DevEnv, 'setup'>): DevEnvSetupRow[] {
  const running = Object.values(env.setup).some((step) => step?.status === 'running')
  return DEV_ENV_STEP_IDS.map((step, index) => {
    const state = env.setup[step]
    return {
      step,
      label: `${index + 1} · ${translate(`devEnv.step.${step}`, STEP_LABELS[step])}`,
      status: state?.status ?? 'pending',
      ...(state?.detail ? { detail: state.detail } : {}),
      ...(state?.error ? { error: state.error } : {}),
      ...(state?.startedAt && state.finishedAt
        ? { durationMs: state.finishedAt - state.startedAt }
        : {}),
      canRerun: !running
    }
  })
}

export function getDevEnvStepTone(status: DevEnvStepStatus): DevEnvTone {
  switch (status) {
    case 'done':
      return 'ok'
    case 'running':
      return 'info'
    case 'failed':
      return 'error'
    case 'pending':
    case 'skipped':
      return 'muted'
  }
}

export function formatDevEnvDuration(ms: number): string {
  if (ms < 1000) {
    return `${(ms / 1000).toFixed(1)} s`
  }
  const seconds = Math.round(ms / 1000)
  return seconds < 60
    ? `${seconds} s`
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function getDevEnvDependencyStateLabel(
  state: DevEnvDetail['dependencyStates'][string]
): string {
  switch (state) {
    case 'up':
      return translate('devEnv.deps.state.up', 'up')
    case 'down':
      return translate('devEnv.deps.state.down', 'down')
    case 'missing':
      return translate('devEnv.deps.state.missing', 'provider deleted')
    case 'unbound':
      return translate('devEnv.deps.state.unbound', 'not bound')
    case 'remote':
      return translate('devEnv.deps.state.remote', 'remote')
  }
}
