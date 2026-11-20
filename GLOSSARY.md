# claude-mods

Mods that extend the Claude Code terminal UI: panes, the drawer above the prompt, and tools Claude can call. These are the words the mods and their specs use.

## Artifacts

**Artifact**:
A titled piece of work Claude posts for the owner to keep: a design, plan, diagram, comparison, summary, notes or exploration.
_Avoid_: output, document, note

**Output**:
A file Claude wrote, edited or made with a shell command in a session, as outputs-pane lists it. An artifact is posted on purpose; an output is any file written.
_Avoid_: artifact (for a written file)

**Version**:
One posted state of an artifact. A later version replaces it on screen; earlier versions are kept.
_Avoid_: revision, edit

**Project history**:
Every artifact posted for one repository, shared by all its worktrees and sessions.
_Avoid_: archive, log, artifact store

**Misc**:
An output that is neither planning text nor code: a deck, a PDF, a video, an archive, a binary.
_Avoid_: other, asset, artifact

**Ship state**:
What in a repository is not yet committed, pushed or cleaned up: the dirty count, ahead and behind, unpushed branches and merged worktrees.
_Avoid_: git status, sync state

## Agents

**Errored**:
A worker whose last turn ended on an API error and that is not working. Not a status of its own: the row keeps the status its multiplexer reports.
_Avoid_: failed, crashed, blocked

**Lead**:
The session that spawned a team's workers and answers for them.
_Avoid_: orchestrator, parent (a parent is any node's direct spawner)

## Exploring

**Frontier**:
The numbered questions a grilling message asks at once, each with a recommended answer.
_Avoid_: question list, batch, round (a round is one exchange that may hold a frontier)

**Exploration**:
A side conversation about one question, answered over the main conversation but never part of it.
_Avoid_: aside, btw, side thread, investigation

**Drawer**:
The area above the prompt that folds out to show explorations.
_Avoid_: band (the engine's word for the place it draws), panel, sidebar

**Take back**:
Putting an exploration's conclusion into the owner's draft reply, for them to edit and send.
_Avoid_: inject, send back, apply
