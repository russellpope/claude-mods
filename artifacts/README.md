# artifacts

A pane for the designs, plans, diagrams and comparisons Claude posts while it works, and each project's history of them. Claude posts with its `show` tool, the pane opens on the post, and a week later `/artifacts-pane` in any worktree of the repo still lists it, every earlier version included. `/artifacts-pane` toggles the pane. Claude Code's own `/artifacts` is a different, built-in command, so the mod can't take that name.

```
artifacts · kintsugi                      12      ← list
 filter                                           Auth flow
● Auth flow                 diagram  v2  2m       diagram · v2 of 2 · 2m ago · artifacts
  Release plan              plan         1h       <the body, as markdown>
  Queue vs running          comparison   3d       v1  [v2]  open in zed  keep in repo
```

- **Posting**: Claude calls `mcp__artifacts__show` with a title, a markdown body and a kind (design, plan, diagram, comparison, summary, notes, exploration). It posts without being asked when that helps: a design, a plan, a flow or architecture diagram, a comparison of options, a map of what it built after a big change. It skips small edits and answers that fit in chat, and always posts when you ask. Diagrams use box-drawing characters and stay within 64 columns. A body holds at most 60,000 characters.
- **History**: one folder per repository in `~/.claude/artifacts/`, keyed by the main working tree, so every worktree and session of a repo shares it. Outside a repo, the session's project root keys it. Claude finds earlier posts with `mcp__artifacts__list`, and passing one's `id` to `show` adds a version instead of a near-copy.
- **The list**: newest update first, with `●` on the ones this session posted. The filter matches title, kind and id, ignoring case, and Enter opens the first match. In a narrow pane the kind goes first, then the version; the age stays. While the pane is open it rereads the folder every 5 seconds, so posts from other sessions of the repo show up.
- **The reader**: the title, then the kind, version, age and branch, then the body. Each version has a button, and the one shown is in brackets.
- **Errors**: a post that can't be written is refused with the reason, and the reason stays on a line under the list's header until a post succeeds.
- **Keep in repo**: copies the latest version to `docs/artifacts/<id>.md` in this session's checkout, and a toast gives the path. It never commits.
- **Opening**: each post opens the pane on it. Claude Code won't open a mod's pane unasked on a terminal narrower than 144 columns, so the first post in a narrow session shows a toast instead: `posted <title> · /artifacts-pane`. `/artifacts-pane` then opens the pane on that post. After you've opened `/artifacts-pane` once, later posts open the pane at 110 columns and up, unless you've closed the pane by hand since. Below 110 the pane sits under the transcript instead of beside it.
- **Width**: the pane asks the dock for half the terminal, at most 100 columns. `/artifacts-pane` measures the terminal itself. A post goes by the last width measured: the command's, or the pane's own estimate from its last draw. The first post in a session, before either, asks for nothing. A width you dragged the dock to wins, and Claude Code keeps it across sessions (`dockColumns` in `~/.claude.json`). Drag the dock to about 70 columns once, and diagrams fit.
- **Settings**: `editor` is the command the **open in** button runs, with the file's path added last. The default is `zed`, and `code -r` works too.

## How it stores artifacts

```
~/.claude/artifacts/
  kintsugi-1a2b3c4d/
    2026-10-15-auth-flow.md          the latest version
    2026-10-14-release-plan.md
    .versions/
      2026-10-15-auth-flow/
        v1.md                        earlier versions, never edited
```

The folder name is the repo's base name and the first 8 hex digits of the SHA-256 of its path, so two repos with the same name stay apart. An artifact's id is its file name: the date it was first posted and a slug of its title, then `-2`, `-3` if that name is taken. The id never changes, even when a later version retitles the artifact.

Each file opens with a header you can read:

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

A new version copies the current file to `.versions/<id>/v<N>.md` byte for byte, then writes the new one in its place. The history is plain files: edit or delete them by hand. A file without a header, or one that can't be read, is listed by its name with kind `?`. If two sessions add a version to one artifact at the same moment, one of the two may be lost; the mod doesn't lock.

Install it as in [Installing a mod](../README.md#installing-a-mod), with the folder `artifacts`.
