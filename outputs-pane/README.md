# outputs-pane

A side pane in Claude Code that lists every file Claude writes or edits in the session. Markdown and text files go in a **planning** section at the top, everything else in a **code** section below. Click a file name to open it in your editor.

```
󰉋  outputs                    3   2
▾  planning 2
     design.md             docs/specs/  14:02
     notes.md                       14:10
▾  code 3
     main.rs                    src/  14:05
     Cargo.toml                       14:06
     util.ts                  web/lib/  14:11
 click a name for zed
```

## What it does

- **Tracks** every successful `Write` (green `+`, new file) and `Edit` (yellow `~`, changed file). Newest first, one row per file. A file Claude created stays marked new after later edits. Failed or denied writes are left out.
- **Pops open** on every successful `Write`, so a closed pane comes back when there's something new. Edits are listed without reopening it.
- **Sections:** `.md`, `.mdx`, `.markdown` and `.txt` go under planning; everything else under code. Click a section header to fold or unfold it. Planning gets up to half the rows and code gets the rest. A folded section takes no rows.
- **Icons:** Nerd Font file-type icons with colors in the style of [eza](https://github.com/eza-community/eza) `--icons`.
- **Hover:** the row under the pointer is highlighted and the file name is underlined.
- **Open:** clicking a file name runs your editor command with the file's path. A toast confirms it or shows the error.
- **`/outputs`** opens the pane by hand.

The list lives in the session's state, so it survives the mod reloading but starts empty in each new session.

## Requirements

- Claude Code with function-hooks mods enabled. Built and tested on 2.1.288.
- A terminal font with [Nerd Font](https://www.nerdfonts.com/) glyphs. Ghostty and kitty have them built in. Without one the icons show as boxes.
- An editor that opens a file from the command line: `zed`, `code`, `subl`, `nvim` in a GUI wrapper, and so on.

## Install

```sh
git clone https://github.com/russellpope/claude-mods.git ~/claude-mods
```

Then add the folder to the `env` block of `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/claude-mods/outputs-pane"
  }
}
```

Start a new `claude` session. The pane opens at session start when the terminal is at least 144 columns wide; in a narrower window, type `/outputs`. See the [repo README](../README.md) for other ways to load it and what to do if it doesn't.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `editor` | `zed` | Command that opens a clicked file. The path is added as the last argument, so `code -r` runs `code -r <file>`. The first word is found on `PATH`; use an absolute path (`/usr/local/bin/zed`) if Claude Code doesn't see your shell's `PATH`. |

Change it from Claude Code's config menu, or in `~/.claude/settings.json`:

```json
{
  "pluginConfigs": {
    "outputs-pane": {
      "options": {
        "editor": "code -r"
      }
    }
  }
}
```

## Using it

- **Clicks** reach the pane in Claude Code's fullscreen mode, where the terminal reports mouse clicks. Elsewhere, focus the pane with ctrl+x tab and press Enter on a row.
- **Close** the pane with its `×`. It reopens on the next new file, or with `/outputs`.
- **Docked or inline:** in fullscreen mode the pane docks beside the transcript; otherwise it sits above the prompt.
- **Width:** the mod asks for 36 columns. If you have ever dragged a pane's edge, Claude Code keeps that width (`pluginPanes.dockColumns` in `~/.claude.json`), and it wins over what the mod asks for.

## Limitations

- Only files written through Claude's `Write` and `Edit` tools are tracked. Files created by shell commands (`Bash`) or notebooks don't show up.
- Files are sorted into sections by extension, so a `README` with no extension goes under code.
- Colors are fixed hex values tuned for dark themes.

## Development

```sh
claude plugin validate .
claude plugin test .
```

Tests are in `hooks/register.test.tsx`. They cover tracking, sections, the row split, folding, the pop-up, the editor setting and the click-to-open path.
