# agent-tree: design

Date: 2026-10-08. Status: approved in brainstorming, pending spec review.

## Goal

A Claude Code mod that shows, from any Claude session running in herdr, the tree of agents that session spawned: its team leads, their workers, and so on down, across harnesses. A toggle switches to a global view of every herdr agent. It replaces the third-party `savvy-progress` mod, whose `/agents-info` panel only sees Agent-tool subagents inside one process and is tied to the savvy-flow skill.

Success: the owner opens `/agent-tree` in, say, the kintsugi session, and sees the lead it launched plus that lead's implementers, reviewers and fixers, each with status, model, context fill and estimated cost, without switching panes. Clicking a row jumps to that pane.

## Decisions

| Topic | Decision |
| --- | --- |
| Mod name, command | `agent-tree/` in this repo; `/agent-tree` toggles the pane. No `/agents-info`. |
| Scope of the default view | The tree rooted at this session's herdr pane (`$HERDR_PANE_ID`), any depth. |
| Global view | Toggle `[Tree \| All]`: every agent `herdr agent list` reports, grouped by repo. |
| Lineage source | An append-only ledger written at spawn time. herdr records no parent link, and its pane metadata tokens are write-only (probed 2026-10-08: `report-metadata` exits 0, the token appears in neither `pane get`, `agent list` nor `api snapshot`). |
| Ledger writers | v1: this mod only, in every Claude session. No edits to the deepthought team skills. Non-Claude lineage comes later from a separate collector writing the same format. |
| Row extras | Model + effort, context %, tokens, estimated cost (Claude rows). Ticket + role from the issue ledger and Kintsugi: included, first to prune if rows get busy. No last-output line. |
| Actions | Click a row name: `herdr agent focus <pane>`. Otherwise read-only. |
| Outside the pane | A status-line entry while the tree has live members. No band above the prompt. |
| Auto-open | Once per session, the first time this session spawns a worker. |
| Crabs | Kept. Half-block pixel art in the terminal; savvy's SVG sprites on desktop. |
| Outside herdr | No tree (no pane id). The pane shows in-process subagents only; All is unavailable. cmux lineage is out of scope for v1. |

## Lineage ledger

Path: `~/.local/state/agent-tree/edges.jsonl`. One JSON object per line, appended, never rewritten:

```json
{"v":1,"parent":"w9:p1A","parentSession":"1c8369b7-…","child":"wCK:p1","name":"udci-lead","via":"claude-mod","at":1791486939969}
```

- `parent`: the spawning session's `$HERDR_PANE_ID`. `parentSession`: its Claude session id.
- `child`: the new pane id. `name`: the herdr agent name when given (`--name`), else empty.
- `via`: the writer. `claude-mod` for this mod; a future collector uses its own value. Readers ignore lines whose `v` they do not know.
- `at`: epoch ms when the edge was written.

**Writer.** A `tool.call` hook on `Bash` awaits `next(e)`. If the command invokes `herdr agent start`, `herdr workspace create` or `herdr pane split` as a command (not inside a quoted string or an `echo`), the hook reads the new pane id(s) from the call's JSON output and appends one edge per new pane. When the output carries no pane id, the hook writes nothing. Exact output shapes are captured as test fixtures from the owner's herdr before implementation.

**Reused pane ids.** herdr reuses a pane id after its pane closes. An edge binds to the first `agent_session` the reader observes for that child pane at or after `at`; the binding is kept in `$.store`. A later, different session in the same pane is not adopted. A `/clear` or resume inside the same agent pane shows up as a new session id: it is accepted when the pane never closed in between (same `terminal_id`).

**Tree.** Start at this session's pane, follow edges whose `parent` is a node already in the tree, depth unlimited, cycles ignored.

## Live data

Collected every 2 s while the pane is open. While it is closed, the status line refreshes every 10 s, and only in a session that has recorded at least one edge. A session that never spawned a worker polls nothing.

- **herdr:** one `herdr agent list` per tick, via `$.process.run`. Fields used: `pane_id`, `name`, `agent`, `agent_status`, `title` (`DONE:` / `BLOCKED:`), `terminal_title_stripped`, `cwd`, `workspace_id`, `agent_session.value`, `terminal_id`.
- **Claude rows:** the session transcript `~/.claude/projects/*/<session>.jsonl`, located once by listing and then cached. Each tick reads only what was appended since the last read (cached by size). The latest assistant `usage` gives model and context tokens; a running sum gives tokens and estimated cost. Effort comes from the transcript when it records one, and is blank otherwise. The price table and context windows carry over from savvy-progress.
- **Ticket and role (prunable):** a worker's `cwd` is matched against `workspace:` in the frontmatter of `docs/issues/*.md` in the repo that owns that worktree. A match gives the ticket id and `batch:`. All tickets whose `batch:` starts with that stamp give the header bar's counts (fixed / in-progress / blocked / total). Role comes from `kintsugi --json dispatch overview` when it answers.
- **In-process subagents:** savvy-progress's `agent.spawn` / `turn.step` / `turn.complete` tracking, carried over, shown as a collapsed bottom section.

## The pane

```
agent-tree · kintsugi (w9:pR)          [Tree | All]
 ▄▀▀▄▄▀▀▄   ≈$14.20 · 3.1M tok · 1:42:10
 █▄██▄█▄█   batch 2026-10-08-hne7  ████████░░░░ 5/8 fixed · 2 in-progress · 1 blocked
 ▀▀▀▀▀▀▀▀

● kintsugi-vhvf-lead   claude Opus 5.5·high  ctx 41% ▓▓▓░░ ≈$6.10 1:40:02
├ ● i369-impl          claude Sonnet 5.5     ctx 22% ▓░░░░ ≈$1.20   18:31  I369 impl
├ ! i370-impl          claude Opus 5.5       ctx 67% ▓▓▓░░ ≈$2.40   31:07  BLOCKED: needs owner call
└ ● i369-review        codex                                        04:12  I369 review
▸ Finished · 4
▸ In-process · 2
```

(The crab above is a placeholder; the sprite is drawn in implementation.)

- **Status glyphs:** `●` working, `◌` idle, `!` blocked (herdr `blocked` or a `BLOCKED:` title), `✓` done (a `DONE:` title; herdr's `done` only means a turn ended and shows as idle, per the final review on 2026-10-08), `✗` pane gone. A gone pane keeps its last known numbers.
- **Finished** (done or gone) is collapsed by default. A lead with live descendants stays in place in the tree.
- **Totals** sum the tree, Claude rows only; cost is an estimate, not a bill. In All, totals are labelled as Claude-only.
- **All view:** one line per agent, grouped by repo. `~/worktrees/<repo>-*` folds into `<repo>`.
- **Compact variant:** used automatically when the pane body is under 60 columns, or by a toggle. The hero crab shrinks to one line, and each agent becomes a one-line chip of status, name and context %.
- **Status line:** `tree 3● 1!` while the tree has live members, cleared when it has none.

## Crabs

- **Terminal:** half-block pixel art (`▀`/`▄` with separate foreground and background truecolor), two pixels per cell. It does not rely on the kitty graphics protocol, which herdr is not expected to pass through.
- **Hero crab** in the header, about 14 columns × 5 rows. Its mood follows the tree:
  - typing: claws alternate on a keyboard, 2–3 frames at about 4 fps;
  - magnifier: only reviewers are working;
  - sweating `!`: something is blocked;
  - asleep `z`: everything is idle;
  - party: the batch reached all-fixed.
- **Animation** runs only while the pane is open and an agent is working. The option `motion: off` stops it.
- **Role costumes** come from savvy-progress's sprite set, chosen by role: implementer = keyboard typist (new sprite), reviewer = detective, fixer = engineer, lead = chef, Explore = pirate, anything else = plain crab. In terminal rows they show as a coloured 2-cell mini glyph.
- **Desktop:** rows use savvy-progress's SVG sprites and CSS animation, mapped by the same role table.

Attribution: the sprites derive from savvy-progress (MIT, johnnyvizz), which credits DockCrab. The mod's README keeps that credit.

## Errors

None of these throws, blanks the pane, or blocks a tool call:

- herdr unreachable or no `$HERDR_PANE_ID`: the pane says so and shows in-process subagents only.
- Ledger missing, unreadable, or a bad line: the bad line is skipped and the rest is used.
- Ledger append fails: the spawn proceeds and a toast says the edge was not recorded.
- Transcript missing: that row shows no model or cost.
- `docs/issues` missing or Kintsugi down: no ticket or role field, and no batch bar.

## Testing

`claude plugin test agent-tree` covers:

1. The ledger writer, on herdr output fixtures for `agent start`, `workspace create` and `pane split`: the right edges get written.
2. **Negative control:** a Bash command that only mentions `herdr agent start` (inside `echo`, or in a quoted string) writes no edge.
3. Tree building: depth, cycles, and rejecting a reused pane id held by a different session.
4. Transcript parsing: model, context tokens, running sums, cost; incremental reads.
5. Ticket matching by `workspace:`, and batch counts.
6. All-view grouping, worktree folding included.
7. The switch to compact mode by width.
8. Hero crab mood selection from tree state.

Live check before calling it done: launch a real herdr worker from this session, see the edge in the ledger, see the worker in the tree, and click its row to focus it.

## Out of scope (v1)

- Lineage for agents spawned by non-Claude leads (a later collector).
- cmux.
- Interrupting or prompting workers from the pane.
- Removing savvy-progress. That's the owner's call, once agent-tree is in use.
