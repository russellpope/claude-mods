# outputs-pane

A side pane in Claude Code that lists every file Claude writes or edits in the session, including files its shell commands make. Markdown and text files go in a **planning** section, source and config in **code**, built things such as decks, PDFs and videos in **misc**, and files whose names match your scratch patterns (`msg-*` by default) in a folded **scratch** section. A line under the title says whether the repository is committed and pushed. Type in the filter at the top to narrow the list, and click a file name to open it in your editor, or a misc file in its own app.

```
󰉋  outputs                    3   2
 main ↑2 · 1 dirty · 1 unpushed
 filter
▾  planning 2
     design.md             docs/specs/  14:02
     notes.md                       14:10
▾  code 3
     main.rs                    src/  14:05
     Cargo.toml                       14:06
     util.ts                  web/lib/  14:11
▾  misc 1
     deck.pptx                  out/  14:12
  scratch 12
 click a name for zed · misc in open
```

## What it does

- **Tracks** every successful `Write` (green `+`, new file) and `Edit` (yellow `~`, changed file). Newest first, one row per file. A file Claude created stays marked new after later edits. Failed or denied writes are left out.
- **Files made by shell commands:** after each successful `Bash` call, the pane lists files created (`+`) or changed (`~`) during the call, so a deck a script built, a video from `ffmpeg` or a file copied out of the scratchpad shows up too. See [Files made by Bash](#files-made-by-bash).
- **Pops open** on every successful `Write`, and when a `Bash` call makes a misc file, so a closed pane comes back when there's something new. Edits and other files made by `Bash` are listed without reopening it.
- **Sections:** planning, code, misc, scratch, in that order, one rule for every file however it was made. A file whose name matches a scratch pattern goes under scratch, whatever its extension. Otherwise `.md`, `.mdx`, `.markdown` and `.txt` go under planning; code files (listed [below](#what-counts-as-code)) under code; and everything else under misc: office files, PDFs, images, audio, video, archives, fonts, binaries and data dumps. Misc and scratch only appear once something lands in them; misc starts unfolded and scratch folded. Click a section header to fold or unfold it.
- **Ship state:** a line under the title, when the working directory is in a git repository. See [Ship state](#ship-state).
- **Scroll:** every file is listed. Scroll the pane with the mouse wheel, or with the arrow keys once it has focus.
- **Filter:** type in the field at the top to list only paths containing that text, ignoring case. It matches the path as shown, so `i343`, `gate-logs` and `sdd/` all work. The header shows how many files match, sections with no match are hidden, and Enter opens the first match.
- **Icons:** Nerd Font file-type icons with colors in the style of [eza](https://github.com/eza-community/eza) `--icons`.
- **Hover:** the row under the pointer is highlighted and the file name is underlined.
- **Open:** clicking a file name runs your editor command with the file's path. A misc file runs your `miscOpener` command instead, by default `open` on macOS and `xdg-open` on Linux, so a deck opens in Keynote or PowerPoint and a video in your player. The choice goes by the file's kind, so a misc file in scratch opens the same way. A toast confirms it or shows the error.
- **Rex on another machine:** when Claude runs in [Rex](#rex) and you click from a Rex app on a different machine, the file opens in a viewer split to the right of Claude instead, so it shows up where you are. Markdown and text files open in `glow`, other code files in `bat`. Press `q` to close it. Clicking another file replaces the split. A terminal viewer can't show a misc file, so clicking one only shows a toast with its name, saying it opens only on the machine Claude runs on.
- **`/outputs`** opens the pane by hand.

The list lives in the session's state, so it survives the mod reloading but starts empty in each new session.

## Requirements

- Claude Code with function-hooks mods enabled. Built and tested on 2.1.288.
- A terminal font with [Nerd Font](https://www.nerdfonts.com/) glyphs. Ghostty and kitty have them built in. Without one the icons show as boxes.
- An editor that opens a file from the command line: `zed`, `code`, `subl`, `nvim` in a GUI wrapper, and so on.
- macOS or Linux for files made by `Bash` (`find` and `stat`) and the misc opener; `git` on `PATH` for the ship line.

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
| `scratch` | `msg-*` | File names that go in the scratch section: globs separated by commas, with `*` and `?` as wildcards (`msg-*, *.log`). Only the name is matched, not the folder. Leave it blank for no scratch section. |
| `editor` | `zed` | Command that opens a clicked file. The path is added as the last argument, so `code -r` runs `code -r <file>`. The first word is found on `PATH`; use an absolute path (`/usr/local/bin/zed`) if Claude Code doesn't see your shell's `PATH`. |
| `markdownViewer` | `glow -p` | In Rex on another machine, the command that shows a clicked planning file in a split. The path is added as the last argument. |
| `codeViewer` | `bat --paging=always` | The same for every other file, for example `nvim -R`. Markdown and text files use `markdownViewer`, even in scratch. |
| `miscOpener` | blank | Command that opens a clicked misc file, with the path added as the last argument, for example `qlmanage -p` for Quick Look. Blank runs `open` on macOS and `xdg-open` on Linux. |
| `ignore` | blank | Folders the listing after a `Bash` call skips, on top of the built-in ones: names as comma-separated globs, the same syntax as `scratch` (`vendor, out*`). A matching folder is skipped wherever it sits. |
| `shipIgnore` | blank | Branches the ship line leaves out: comma-separated globs (`vendor-*, spike-*`). A matching branch drops out of the unpushed count, and its worktree out of the merged count. For branches you keep local on purpose. |

Change it from Claude Code's config menu, or in `~/.claude/settings.json`:

```json
{
  "pluginConfigs": {
    "outputs-pane": {
      "options": {
        "editor": "code -r",
        "scratch": "msg-*, *.log"
      }
    }
  }
}
```

## Using it

- **Clicks** reach the pane in Claude Code's fullscreen mode, where the terminal reports mouse clicks. Elsewhere, focus the pane with ctrl+x tab and press Enter on a row.
- **Filter** typing reaches the pane only once it has focus: click the field in fullscreen mode, or press ctrl+x tab. The field scrolls with the list, so scroll to the top to reach it.
- **Close** the pane with its `×`. It reopens on the next new file, or with `/outputs`.
- **Docked or inline:** in fullscreen mode the pane docks beside the transcript; otherwise it sits above the prompt.
- **Width:** the mod asks for 36 columns. If you have ever dragged a pane's edge, Claude Code keeps that width (`pluginPanes.dockColumns` in `~/.claude.json`), and it wins over what the mod asks for.

## Files made by Bash

When a `Bash` call starts, the pane notes the time. It lets the call run, never holding it up or refusing it, and once the call has returned it looks for files modified since then:

- under the session's working directory, with one `find` command (`TZ=UTC find <cwd> ( -name .git -o -name node_modules … ) -prune -o -type f -newermt '<YYYY-MM-DD HH:MM:SS>' -print`). It skips `.git`, `node_modules`, `target`, `dist`, `build`, `.venv`, `__pycache__`, `.codegraph` and any folder matching the `ignore` setting;
- plus every absolute or `~` path the command names, if it is a file modified since the call began. That covers the scratchpad and other places outside the working directory, as in `cp deck.pptx ~/Desktop/deck.pptx`.

`find` was chosen because it is on every macOS and Linux machine, and that spelling of `-newermt` is the one both BSD find (macOS) and GNU find read the same way. A file born during the call is new (`+`); one that already existed is changed (`~`). Birth times come from `stat -f %B` on macOS and `stat -c %W` on Linux. Where the file system keeps no birth time, a file the pane doesn't list yet counts as new.

The listing is bounded. It gets 2 seconds; a slower one lists nothing. If more than 50 files changed in one call, it's treated as a build and none of them are listed, though paths the command names still are. A failed `Bash` call, a failed listing and a timeout list nothing and show no error. A file the pane already lists isn't listed twice: it moves to the top and keeps its mark.

## What counts as code

A file is code when its name is a known extensionless one or a dotfile, or when its extension is in this list:

- **Source:** `rs ts tsx mts cts js jsx mjs cjs py pyi go rb java kt kts scala swift m mm c h cc cpp cxx hpp hh cs fs php pl pm lua r jl dart ex exs erl hs ml mli clj cljs elm nim zig vue svelte astro d`
- **Shell:** `sh bash zsh fish ps1 bat cmd nu awk sed`
- **Config:** `json jsonc json5 jsonl toml yaml yml ini cfg conf properties env plist lock tf hcl nix gradle cmake mk kdl proto graphql gql sql prisma`
- **Markup:** `html htm xml xsl css scss sass less tex rst adoc org`
- **Changes and notebooks:** `diff patch ipynb`
- **Names:** `Makefile GNUmakefile Dockerfile Containerfile Justfile Rakefile Gemfile Procfile Vagrantfile Brewfile Podfile Jenkinsfile Caddyfile LICENSE LICENCE COPYING README CODEOWNERS OWNERS NOTICE AUTHORS`, matched ignoring case, also with a suffix after `-` or `_` (`README-old`). A name with a dot is judged by its extension, so `Dockerfile.dev` is misc
- **Dotfiles:** any name starting with `.` (`.env`, `.gitignore`, `.zshrc`)

Everything else is misc. That includes `.svg`, `.csv` and `.log` (made to be looked at, not edited), and binaries with no extension.

## Ship state

When the working directory is in a git repository, a line under the pane's title answers "are we all committed and pushed?":

```
 main ↑2 ↓1 · 3 dirty · 1 unpushed · 2 merged worktrees
```

- the current branch (or `detached HEAD`, or `main, no commits`), with commits ahead `↑` and behind `↓` its upstream;
- **dirty:** files `git status` lists as changed, staged or untracked;
- **unpushed:** local branches ahead of their upstream, or with no upstream (or a deleted one) and not merged into the default branch. A local branch already merged into the default branch has nothing that exists only there, so it doesn't count;
- **merged worktrees:** worktrees, not counting the main checkout, whose branch is already merged into the default branch: ones you can probably remove.

Counts of zero are left out. When nothing is unshipped the line reads, for example, `main · committed and pushed`. Click the line to list the unpushed branches and the merged worktrees with their paths; click it again to fold them.

While something is unshipped, Claude Code's status line shows the same in short form. It clears when nothing is.

The pane rereads git at session start, after a `Bash` call whose command names `git`, after a successful `Write` or `Edit`, and every 30 seconds while the pane is open. Each read is local: `git status`, `git for-each-ref`, `git symbolic-ref` and `git worktree list`, run with optional locks off, so even `status` doesn't write the index, and each gets 3 seconds. The pane never runs `git fetch` or anything else that touches the network or changes the repository, so **behind** counts only what the last fetch saw. The default branch is the one `origin/HEAD` names, else `main`, else `master`. Outside a git repository, or when git fails, there's no line and no error.

The pane only reports. It doesn't clean up branches or worktrees, and it doesn't commit or push.

## Rex

Inside a Rex session, each click checks where you are. Rex records which Rex app owns Claude's pane, which is the one you last typed in. If that app's label matches this Mac's computer name (`scutil --get ComputerName`), the click runs your editor as usual. If it's another machine, for example a laptop looking in remotely, the click runs `rex split` to open the file in a viewer to the right of Claude's pane. The check runs on every click, so you can start on one laptop and pick up on the other.

If Rex can't say who owns the pane, the click opens your editor.

## Limitations

- Files from `Write`, `Edit` and `Bash` calls are tracked. Notebook edits, and files changed outside a call (by you, or by a `Bash` command still running in the background after the call returned), don't show up.
- If another agent or program writes in the same directory while a `Bash` call runs, its files are listed too: the listing sees what changed, not who changed it.
- A `Bash` call's listing finds files under the working directory and paths the command names in full. A file a command writes to a relative folder outside the working directory (`cd /tmp && ./build`), or into a named folder rather than a named file (`cp a.pdf ~/Desktop/`), is missed.
- On Linux, GNU find compares times more finely than BSD find, so a file changed up to a second before a `Bash` call can be listed with it.
- A worktree just created from the default branch, with no commits of its own yet, counts as merged until its first commit: git can't tell it from one that was merged.
- Files are sorted into sections by name alone, so an extensionless script (`bin/deploy`) goes under misc, and clicking it runs `miscOpener`, not your editor.
- Colors are fixed hex values tuned for dark themes.

## Development

```sh
claude plugin validate .
claude plugin test .
```

Tests are in `hooks/*.test.ts(x)`. `register.test.tsx` covers tracking, sections and scratch patterns, folding, the full list, the filter, the pop-up, the editor setting and the click-to-open path. `bash-ship.test.tsx` covers files made by `Bash`, the misc section and opener, and the ship line, status entry and refreshes. `scan.test.ts` and `ship.test.ts` cover the listing command and the git parsers.
