import { LSP_MARKER_OWNER, type MonacoMarkerShape } from './lsp-monaco-conversion'

type MarkerHost = {
  editor: {
    setModelMarkers: (
      model: { uri: { toString(): string } },
      owner: string,
      markers: MonacoMarkerShape[]
    ) => void
  }
}

const layersByModel = new Map<string, Map<string, MonacoMarkerShape[]>>()

/** Keep each language server's markers and paint the union. A later ESLint
 *  publish must not wipe TypeScript markers, or the reverse. */
export function publishLspSessionMarkers(
  monaco: MarkerHost,
  model: { uri: { toString(): string } },
  sessionId: string,
  markers: MonacoMarkerShape[]
): void {
  const modelKey = model.uri.toString()
  const layers = layersByModel.get(modelKey) ?? new Map<string, MonacoMarkerShape[]>()
  layers.set(sessionId, markers)
  layersByModel.set(modelKey, layers)
  monaco.editor.setModelMarkers(model, LSP_MARKER_OWNER, [...layers.values()].flat())
}

export function clearLspMarkerLayers(
  monaco: MarkerHost,
  model: { uri: { toString(): string } }
): void {
  layersByModel.delete(model.uri.toString())
  monaco.editor.setModelMarkers(model, LSP_MARKER_OWNER, [])
}
