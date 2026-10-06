import { describe, expect, it, vi } from 'vitest'
import { clearLspMarkerLayers, publishLspSessionMarkers } from './lsp-marker-layers'

function host() {
  return {
    editor: { setModelMarkers: vi.fn() },
    model: { uri: { toString: () => 'file:///a.ts' } }
  }
}

describe('publishLspSessionMarkers', () => {
  it('unions markers from two servers and replaces only the publishing session', () => {
    const { editor, model } = host()
    const typescript = [
      {
        message: 'type',
        severity: 8,
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 2
      }
    ]
    const eslint = [
      {
        message: 'lint',
        severity: 4,
        startLineNumber: 2,
        startColumn: 1,
        endLineNumber: 2,
        endColumn: 2
      }
    ]
    publishLspSessionMarkers({ editor }, model, 'ts', typescript)
    publishLspSessionMarkers({ editor }, model, 'eslint', eslint)
    publishLspSessionMarkers({ editor }, model, 'eslint', [])
    const last = editor.setModelMarkers.mock.calls.at(-1)
    expect(last?.[2]).toEqual(typescript)
    clearLspMarkerLayers({ editor }, model)
  })
})
