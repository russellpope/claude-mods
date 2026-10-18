# agent-tree

A pane for herdr users: the agents this Claude session spawned, the agents those spawned, and so on, each with status, model, context, estimated cost and ticket. `/agent-tree` toggles it.

- **Tree view**: rooted at this session's herdr pane. `●` working, `◌` idle, `!` blocked (herdr status or a `BLOCKED:` title), `✓` done (a `DONE:` title; herdr's own `done` only means a turn ended, shown as idle), `✗` pane gone (last numbers kept). Click a name to focus that pane.
- **All view**: every herdr agent, grouped by repo; worktrees fold into their repo.
- **Batch bar**: when a worker's cwd is a ticket's `workspace:`, the header shows that ticket's batch: fixed / in-progress of total.
- **Crab**: types while workers work, holds a magnifier when only reviewers do, sweats when something is blocked, sleeps when all is idle, parties when the batch is all fixed. Set `motion` to `off` to keep it still.
- **Tokens**: the header's count adds every call's input, cache reads included, and its output. An agent sends its whole context again on every call, mostly from the prompt cache, so cache reads are nearly all of it. The line under the cost says how much, and how much the models wrote: `2.4B tok · 98% cache reads · 6.6M output`.
- **Codex workers**: model, effort, context and tokens come from the session's rollout file, found under any codex home named `~/.codex*` (`~/.codex`, or `~/.codex-alt` for a worker run with `CODEX_HOME=~/.codex-alt`). The percent is of the context window codex reports. Codex rows show no cost: codex bills against a ChatGPT plan, so the header's `≈$` counts Claude workers only.
- **Status line**: `tree 3● 1!` while the tree has live members.

## How it knows the tree

herdr does not record which pane spawned which. Every Claude session running this mod writes one small file per `herdr agent start` it runs to `~/.local/state/agent-tree/edges/` (`{"v":1,"parent","parentSession","child","name","via","at"}`). Agents started by a non-Claude lead (codex, opencode, pi) are not linked yet. A collector for those can write the same files with its own `via`.

Cost is an estimate from token counts and a price table (`hooks/usage.ts`), not a bill.

## Credits

The SVG crab sprites and costumes come from [savvy-progress](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-progress) by johnnyvizz (MIT), which credits DockCrab.
