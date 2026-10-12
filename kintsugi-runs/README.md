# kintsugi-runs

A pane for kintsugi users: the verification run of the repo this Claude session is in, with its stage pipeline, each stage's state, exit and time, and a timing bar. `/kintsugi-runs` toggles it.

- **Which run**: the newest run of this repo that is under way, else the newest queued one, else the newest finished one, so the last result stays in view. A run queued behind the shown one never hides it; the line under the header counts the queue (`started 1h ago · 1 queued behind it`). Ticket runs and operator gate runs (`kintsugi land`) both count. A session outside an enrolled repo shows every project's runs.
- **Pipeline**: `✓ fmt → ✓ check → ✓ lint → ⠧ test → ○ skip-gate`. In a narrow pane it wraps between whole stages.
- **Jobs table**: each stage's state, exit code and time. As the pane narrows, the exit column goes first, then the state word (its coloured glyph stays), then stage names shorten. The time always stays.
- **Timing**: while a long stage runs, finished stages share the left half at their true proportions, and the running stage fills the right half against its usual length (the median of that stage in this repo's passed runs of the same kind). Past it, the heading says by how much. A finished run is drawn at true scale. The section hides when the pane is too narrow.
- **Spinner**: turns while a stage runs. Set `motion` to `off` to keep it still.

## How it reads kintsugi

While the pane is open, it runs `kintsugi --config <config> --json run overview` every 2 seconds, one call at a time, and `project list` once to match this repo's main checkout to an enrolled project. `<config>` is `KINTSUGI_CONFIG`, else `~/.config/kintsugi/config.toml`. A session that never opens the pane runs nothing.

kintsugi must be on `PATH` and its runtime running. Errors show in the pane in kintsugi's own words. The mod's calls never have a terminal on stdin, so kintsugi never opens a Keychain dialog for them. If a newly installed build is not yet approved, the pane shows kintsugi's "run `kintsugi operator check`" message until you approve it.

Install it as in [Installing a mod](../README.md#installing-a-mod), with the folder `kintsugi-runs`.
