/** One hunk of a zero-context (`git diff -U0`) diff. */
export type ZeroContextHunk = {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  /** Body lines after the `@@` header, including `\ No newline at end of file` markers. */
  lines: string[]
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** Splits a single-file `-U0` diff into the header lines before its first hunk and its hunks. */
export function parseZeroContextDiff(diff: string): { header: string[]; hunks: ZeroContextHunk[] } {
  const lines = diff.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  const header: string[] = []
  const hunks: ZeroContextHunk[] = []
  for (const line of lines) {
    const match = HUNK_HEADER_RE.exec(line)
    if (match) {
      hunks.push({
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        lines: []
      })
    } else if (hunks.length > 0) {
      hunks.at(-1)?.lines.push(line)
    } else {
      header.push(line)
    }
  }
  return { header, hunks }
}

/**
 * Moves a preview hunk onto a lower layer's copy of the file, given the `-U0` diff from that
 * layer's tip (old side) to the preview HEAD (new side). Null when layers above changed the lines
 * the hunk touches, so its place in the lower layer is unknown.
 */
export function mapHunkOntoLayer(
  hunk: ZeroContextHunk,
  layerToPreview: readonly ZeroContextHunk[]
): ZeroContextHunk | null {
  const first = hunk.oldCount > 0 ? hunk.oldStart : hunk.oldStart + 0.5
  const last = hunk.oldCount > 0 ? hunk.oldStart + hunk.oldCount - 1 : first
  let shift = 0
  for (const change of layerToPreview) {
    // Why: a change with no new lines sits between preview lines newStart and newStart + 1.
    const changeFirst = change.newCount > 0 ? change.newStart : change.newStart + 0.5
    const changeLast = change.newCount > 0 ? change.newStart + change.newCount - 1 : changeFirst
    if (changeLast < first) {
      shift += change.newCount - change.oldCount
    } else if (changeFirst <= last) {
      return null
    }
  }
  return { ...hunk, oldStart: hunk.oldStart - shift }
}

/** Joins the file header and hunks into a `-U0` patch, renumbering the new side for this subset. */
export function buildZeroContextPatch(header: readonly string[], hunks: ZeroContextHunk[]): string {
  const ordered = [...hunks].sort((left, right) => left.oldStart - right.oldStart)
  const out = [...header]
  let delta = 0
  for (const hunk of ordered) {
    const firstNew = (hunk.oldCount === 0 ? hunk.oldStart + 1 : hunk.oldStart) + delta
    const newStart = hunk.newCount === 0 ? firstNew - 1 : firstNew
    out.push(
      `@@ -${hunk.oldStart},${hunk.oldCount} +${newStart},${hunk.newCount} @@`,
      ...hunk.lines
    )
    delta += hunk.newCount - hunk.oldCount
  }
  return `${out.join('\n')}\n`
}
