/** One artifact's header: the file's frontmatter, its id the file name without `.md`. */
export type ArtifactMeta = {
  id: string
  title: string
  /** design, plan, diagram, comparison, summary, notes, exploration, or `?` for a file without a header */
  kind: string
  version: number
  /** ISO 8601, UTC */
  created: string
  updated: string
  /** The posting session's branch; empty when unknown. */
  branch: string
  /** The posting session's id. */
  session: string
}

/** This session's project history, as the pane draws it. */
export type HistoryView = {
  /** The history folder, absolute; empty before the first read. */
  dir: string
  /** The project's name for the header: the root's base name. */
  project: string
  items: ArtifactMeta[]
  /** The last read's or post's failure, in words; empty when none. */
  error: string
}

/** Which view the pane shows. */
export type PaneView = { view: 'list' } | { view: 'reader'; id: string }

/** The artifact the reader shows: one version's header and body. */
export type Shown = { meta: ArtifactMeta; body: string; latest: number; path: string }

declare module 'claude-code' {
  interface PluginState {
    artifacts: {
      history: HistoryView
      pane: PaneView
      query: string
      /** ids this session posted, for the list's marker. */
      mine: string[]
      shown: Shown | null
    }
  }
}
