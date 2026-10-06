export type OutputFile = { path: string; kind: 'new' | 'edit'; at: number }
export type Section = 'planning' | 'code' | 'scratch'

declare module 'claude-code' {
  interface PluginState {
    'outputs-pane': { files: OutputFile[]; folded: Section[]; query: string }
  }
}
