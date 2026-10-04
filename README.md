# claude-mods

Mods for [Claude Code](https://claude.com/claude-code): panes, status entries and hooks that run inside the Claude Code terminal UI. Each mod is a folder at the top of this repo, with its own README.

> Mods use Claude Code's function-hooks plugin API, which is in early access and may change between releases. These were built and tested on Claude Code 2.1.288.

## Mods

| Mod | What it does |
| --- | --- |
| [outputs-pane](outputs-pane/) | Side pane listing the files Claude writes or edits, split into planning (markdown) and code. Click a file to open it in your editor. |

## Installing a mod

1. Clone the repo somewhere stable:

   ```sh
   git clone https://github.com/russellpope/claude-mods.git ~/claude-mods
   ```

2. Tell Claude Code where the mod is. Pick one:

   - **Every session (recommended):** add the mod folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`:

     ```json
     {
       "env": {
         "CLAUDE_CODE_PLUGIN_DIRS": "~/claude-mods/outputs-pane"
       }
     }
     ```

     To load more than one mod, separate the folders with `:` (`;` on Windows):
     `"~/claude-mods/outputs-pane:~/claude-mods/another-mod"`.

   - **One session:** `claude --plugin-dir ~/claude-mods/outputs-pane`

3. Start a new `claude` session. In an interactive session, Claude Code watches the folder, so a `git pull` takes effect without a restart.

To check that a mod loaded, start Claude with `claude --debug-file /tmp/claude.log`, then look for `hooks module <mod-name>@inline loaded` in the log.

### If a mod doesn't load

- **"hooks modules are turned off in this process"**: Claude Code caches a remote rollout switch for mods. Run any `claude` session with network access to refresh it. If the message keeps coming back, mods are turned off for your account.
- Settings from a project's `.claude/settings.json` are ignored for `CLAUDE_CODE_PLUGIN_DIRS`. It has to be in `~/.claude/settings.json` or the process environment.

## Mod layout

```
<mod-name>/
  .claude-plugin/plugin.json   manifest: name, version, settings (userConfig), types
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           the hooks module
  hooks/*.test.tsx             tests, run by `claude plugin test`
  types/index.d.ts             the mod's state contract
  README.md
```

## Developing

From a mod folder:

```sh
claude plugin validate .   # reads the manifest and module the way the engine will
claude plugin test .       # runs hooks/*.test.tsx against the engine
```

When Claude Code loads a mod it writes `.claude-plugin/types/` and `tsconfig.json` into the mod folder. Those are ignored by git. With them in place, `npx -p typescript tsc -p <mod-folder>` type-checks the mod.

## License

Apache-2.0. See [LICENSE](LICENSE).
