import { getProjectHighlightStyle, type ProjectHighlightBand } from './project-highlight-bands'

/** Painted behind the virtual rows so one band spans a project's header, cards and row gaps. */
export function renderProjectHighlightBands(
  bands: readonly ProjectHighlightBand[]
): React.ReactNode {
  return bands.map((band) => (
    <div
      key={band.key}
      aria-hidden
      data-project-highlight-band
      className="worktree-project-highlight pointer-events-none absolute left-0 right-0 rounded-md"
      style={{ ...getProjectHighlightStyle(band.color), top: band.top, height: band.height }}
    />
  ))
}
