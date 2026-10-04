export type OutputFile = { path: string; kind: 'new' | 'edit'; at: number }

declare module 'claude-code' {
  interface PluginState {
    'outputs-pane': { files: OutputFile[]; folded: ('planning' | 'code')[] }
  }
}
