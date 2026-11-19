export type OutputFile = { path: string; kind: 'new' | 'edit'; at: number }
export type Section = 'planning' | 'code' | 'misc' | 'scratch'

// A local branch with work nowhere else: ahead of its upstream, or with none (or a gone one) and not merged.
export type UnpushedBranch = { name: string; ahead: number; why: 'ahead' | 'none' | 'gone' }
// A worktree, not the main checkout, whose branch is already merged into the default branch.
export type MergedWorktree = { branch: string; path: string }
// The working directory's repository as local git reads see it ("behind" as of the last fetch).
export type Ship = {
  branch: string
  isDetached: boolean
  isInitial: boolean
  ahead: number
  behind: number
  dirty: number
  unpushed: UnpushedBranch[]
  merged: MergedWorktree[]
}

declare module 'claude-code' {
  interface PluginState {
    'outputs-pane': {
      files: OutputFile[]
      folded: Section[]
      query: string
      viewer: string
      ship: Ship | null
      shipOpen: boolean
    }
  }
}
