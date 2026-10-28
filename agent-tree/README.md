# agent-tree

A pane for herdr and Rex users: the agents this Claude session spawned, the agents those spawned, and so on, each with status, model, context, estimated cost and ticket. `/agent-tree` toggles it.

- **Tree view**: rooted at this session's herdr pane. `●` working, `◌` idle, `!` blocked (herdr status or a `BLOCKED:` title), `✓` done (a `DONE:` title; herdr's own `done` only means a turn ended, shown as idle), `✗` pane gone (last numbers kept). Click a name to focus that pane; on the terminal the whole name cell, at least 12 columns wide, takes the click, here and in the other lists.
- **All view**: every herdr agent, grouped by repo; worktrees fold into their repo.
- **Batch bar**: when a worker's cwd is a ticket's `workspace:`, the header shows that ticket's batch: fixed / in-progress of total.
- **Crab**: types while workers work, holds a magnifier when only reviewers do, sweats when something is blocked, sleeps when all is idle, parties when the batch is all fixed. Set `motion` to `off` to keep it still.
- **Tokens**: the header's count adds every call's input, cache reads included, and its output. An agent sends its whole context again on every call, mostly from the prompt cache, so cache reads are nearly all of it. The line under the cost says how much, and how much the models wrote: `2.4B tok · 98% cache reads · 6.6M output`.
- **Codex workers**: status comes from herdr, as for every agent. Model, effort, context and tokens come from the session's rollout file, found under any codex home named `~/.codex*` (`~/.codex`, or `~/.codex-alt` for a worker run with `CODEX_HOME=~/.codex-alt`); a worker whose home is named otherwise keeps a blank row. The percent is the one codex's own bar shows. Tokens are the session's own: sub-agents codex spawns, such as its auto-reviewer, are not counted. Codex rows show no cost, since codex bills against a ChatGPT plan, and beside them the header's estimate reads `≈$… Claude only`.
- **Dings**: herdr plays a sound when an agent's turn ends in a background tab (`working` → `done`) or it starts asking for input (`blocked`). The Dings section lists the ones that need you, newest first, each with its age and the pane's title at the time: anyone asking, a session nobody spawned, a lead whose title reads `DONE:`, or a worker whose lead has stopped. This session's own turns are left out, and an agent herdr has no name for shows its tab's label. Each one puts a `!` on its tree row until it is acknowledged: by its `✓` (you stay put), by pressing its name (you go to its pane), by `ack all`, or by the agent working again. Acknowledged, collapsed below, keeps the newest 10, along with the dings that never needed you, dim with the reason: a worker finishing while its lead runs, or a lead ending a turn without `DONE:`. Dings are seen only while this mod is polling: every 2 s with the pane open, every 10 s otherwise in a session that has spawned workers.
- **Status line**: `tree 3● 1!` while the tree has live members, then `· 2 need you` while dings wait on you.

## In Rex

The same pane runs in a Rex terminal (`REX_BLOCK` set). When herdr runs inside Rex, herdr wins, since it is the nearer one.

- **Listing**: one `rex do` Lua script, each poll, reads every terminal block in every session on this server and on each host `rex hosts` lists. Status is what the program reports with OSC 7501: Claude Code and codex both report it, so `working`, `idle`, `blocked` and `done` mean what they mean in herdr. A program's `error` reads as blocked. opencode is listed by its process name with no status. A host that does not answer is skipped.
- **Spawns**: a Bash call that runs `rex run`, `rex split`, `rex new` or `rex window new` with claude, codex or opencode in it, or `rex send`s one, records an edge for the new block. The edge carries the child's Rex session and host as well as its block id.
- **Names and DONE:**: Rex has one label per block. The label set at spawn (`rex run --label demo-impl`) is the agent's name. A worker marks itself finished or stuck by renaming its block: `rex block rename "$REX_BLOCK" "DONE: <outcome>"` (or `BLOCKED:`). The tree keeps the spawn name.
- **Usage**: a Claude session is found from `~/.claude/sessions/<pid>.json`. A codex thread is found from codex's logs (`~/.codex*/logs_*.sqlite`), which keep about a day. So a codex worker that has been idle longer than that shows a blank row until it works again. Agents on another host show status but no usage, because their files are on that machine.
- **Focus**: pressing a name focuses the block in its session, then asks the Rex app that owns this session's block to show that session and tab.
- **Spawn detection**: any `rex run`, `split`, `new`, `window new` or `send` makes the mod compare the agent list before and after the call, so a launch from a variable or a script still counts. A block printed by the command but not yet running an agent is recorded only when the command names a harness. `rex send-key` never counts.
- **codex workers**: two things stop a codex worker from using `rex`. First, the codex TUI runs its shell commands through the shared codex app-server daemon, so they get the daemon's environment: no `REX_BLOCK` or `REX_SESSION`, and no `rex` on the PATH. Starting codex with `-c features.daemon_auto_start=false` and choosing "Run without daemon this time" gives the commands the pane's environment. Second, codex's sandbox blocks the Rex socket, so `rex block rename` fails unless the command is approved to run outside it.

## How it knows the tree

herdr does not record which pane spawned which. Every Claude session running this mod writes one small file per `herdr agent start` it runs to `~/.local/state/agent-tree/edges/` (`{"v":1,"parent","parentSession","child","name","via","at"}`). Agents started by a non-Claude lead (codex, opencode, pi) are not linked yet. A collector for those can write the same files with its own `via`.

Cost is an estimate from token counts and a price table (`hooks/usage.ts`), not a bill.

## Credits

The SVG crab sprites and costumes come from [savvy-progress](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-progress) by johnnyvizz (MIT), which credits DockCrab.
