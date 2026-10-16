# artifacts: design

Date: 2026-10-15. Status: approved in brainstorming, pending spec review.

## Goal

Make artifacts part of the Claude Code CLI. Claude posts designs, plans, diagrams, comparisons and maps of what it built to a pane, and each project keeps a history the owner can browse later, without opening other tools.

Success: in a kintsugi session, after Claude designs something, the pane opens on a box-drawing diagram of it. A week later, `/artifacts` in any worktree of kintsugi lists that diagram along with everything else posted for the repo, and every earlier version can still be read.

## Decisions

| Topic | Decision |
| --- | --- |
| Mod name, command | `artifacts/` in this repo. `/artifacts` toggles the pane. |
| How Claude posts | Through two tools the mod registers (`$.tool.register`): `mcp__artifacts__show` and `mcp__artifacts__list`. |
| When Claude posts | Without being asked, when it helps: designs, plans, flow or architecture diagrams, comparisons of options, and a map of what was built after a substantial change. Never small edits, or answers that fit in chat. Always when the owner asks. This guidance lives in `show`'s description, which the model reads. |
| Content | Markdown, drawn by the engine's `Markdown` element as it draws a reply: tables, code fences, links. Diagrams use box-drawing characters and stay within 76 columns. |
| Where history lives | `~/.claude/artifacts/<project>/`, outside every repo. |
| Project | `$.session.repo().root`, which for a worktree is "the main working tree's", so every worktree and session of a repo shares one history. Outside a repo, `$.session.root()`. The folder name is the root's base name plus an 8-hex-digit hash of the whole path (`kintsugi-1a2b3c4d`), so two repos with the same name stay apart. |
| Versions | `show` with the `id` of an earlier artifact adds a version. The latest is the artifact's file; earlier versions are kept beside it. |
| Keep in repo | A reader button copies the latest version to `docs/artifacts/<id>.md` in the session's own checkout (`$.session.root()`). It never commits. |
| Opening | Every `show` opens the pane on the new artifact. The engine refuses a plugin's own open "below 144 terminal columns, 110 once they asked for that id". When it does, a toast says `posted <title> · /artifacts`. |
| Reading width | The reader asks the dock for 100 columns (`ui.open({ columns: 100 })`). A width the owner dragged the dock to wins. |
| Editor | An `editor` setting, as in outputs-pane: a command line with the path added last, default `zed`. |

## Storage

```
~/.claude/artifacts/
  kintsugi-1a2b3c4d/
    2026-10-15-auth-flow.md          the latest version
    2026-10-14-release-plan.md
    .versions/
      2026-10-15-auth-flow/
        v1.md                        earlier versions, never edited
```

- **id**: the file name without `.md`. It is the creation date, then a slug of the title (lowercase letters, digits and hyphens, at most 48 characters), then `-2`, `-3` and so on if that name is taken. The id never changes, even when a later version retitles the artifact.
- **New version**: the current file moves to `.versions/<id>/v<N>.md`, and the new version is written in its place. No version exists twice.
- **Header**: each file opens with frontmatter that the pane reads and a person can skim:

  ```
  ---
  title: Auth flow
  kind: diagram
  version: 2
  created: 2026-10-15T14:02:11.000Z
  updated: 2026-10-15T15:40:00.000Z
  branch: artifacts
  session: 09d67716-1af8-47d3-b919-799f795130b0
  ---
  ```

  `kind` is free text; the tool's description suggests design, plan, diagram, comparison, summary and notes. `branch` is the session checkout's current branch (`git branch --show-current`), empty when that fails or HEAD is detached.

## Tools

**`mcp__artifacts__show`**: `{ title, body, kind?, id? }`.

- Writes a new artifact, or with `id` a new version of that one, and opens the pane on it.
- The result is one line, so the transcript doesn't repeat the body: `posted 2026-10-15-auth-flow v2 · ~/.claude/artifacts/kintsugi-1a2b3c4d/2026-10-15-auth-flow.md`.
- It refuses, with a reason the model can act on:
  - an empty title or body;
  - a body over 60,000 characters (the pane draws at most 100,000 per drawing), asking for it to be split;
  - an `id` with no artifact in this project, pointing to `list`.

**`mcp__artifacts__list`**: `{ query?, limit? }`.

- This project's artifacts, newest update first: `id · kind · v<N> · updated · title`.
- The first line names the folder, so the model can `Read` any file in full.
- `query` matches the title, kind and id, ignoring case. `limit` defaults to 20.

Neither tool is deferred: both stay in the model's tool list.

## The pane

**List** (the pane's first view):

```
artifacts · kintsugi                      12
 filter
● Auth flow                 diagram  v2  2m
  Release plan              plan         1h
  Queue vs running          comparison   3d
```

- Newest update first. `●` marks artifacts this session posted.
- Narrow docks drop the kind word first, then the version. The age always stays.
- The filter works as outputs-pane's does: it matches the title, kind and id, ignoring case, and Enter opens the first match.
- Clicking a row opens the reader.

**Reader**:

```
← list
Auth flow
diagram · v2 of 2 · 2m ago · artifacts
<the body, as markdown>
 v1  v2 │ open │ keep in repo
```

- The version buttons show earlier versions; the current one is highlighted.
- **open** runs the editor on that version's file.
- **keep in repo** copies the latest version, and a toast confirms it with the path, or reports the error.

**Updates**: the pane reads the project folder when it opens, after each `show` in this session, and every 5 s while it is open, so posts from other sessions of the repo appear.

## Errors

- **A write fails** (permissions, disk full): the tool returns the error in the engine's words, and the pane shows it on a line under the header.
- **A file without frontmatter** (hand-written or edited): it is listed by its file name with kind `?`, and the reader shows its text as markdown.
- **Two sessions add a version to one artifact at once**: one of the two versions may be lost. That is unlikely enough to leave as documented, rather than lock.

## Testing

Test first with the mods test kit (`claude plugin test`), with `fs`, `process`, `clock` and `session` answered by test hooks:

- **Tools**:
  - `show` writes the file with its frontmatter and returns the line.
  - A second `show` with that `id` moves v1 under `.versions/` and writes v2.
  - An unknown `id`, an empty body and an oversized body are refused.
  - `list` orders, filters and limits.
- **Project**:
  - Two worktrees of one repo (the same `repo().root`) share a folder.
  - Two repos with one base name get different folders.
  - Outside a repo, the folder is keyed by `root()`.
- **Pane**:
  - List order, the session marker and the filter.
  - The reader's header and versions, with narrow docks dropping words in order.
  - Keep in repo writes `docs/artifacts/<id>.md` under `root()`.
  - A refused open shows a toast.
- A deliberate breakage of each guard, to prove a test fails without it.

Then a live check in a herdr test session: post a real diagram, read it in the pane at about 50, 100 and 160 terminal columns, add a version, and keep one in a scratch repo.

## Out of scope (v1)

- **Inline pictures:** `Image` draws PNGs only in kitty or Ghostty, and sessions here run inside herdr (`TERM=xterm-256color`). A later spike checks whether herdr passes them through.
- A browser view.
- A view across all projects.
- Deleting from the pane. The history is plain files.
- **The explore drawer** (a `/btw`-style side exploration of a question in the band above the prompt). It is a separate design, and may save an exploration here by calling `mcp__artifacts__show` through `$.tool.call`.
