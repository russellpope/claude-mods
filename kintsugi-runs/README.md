# kintsugi-runs

A pane for kintsugi users: the verification run of the repo this Claude session is in, with its stage pipeline, each stage's state, exit and time, and a timing bar. `/kintsugi-runs` toggles it.

- **Which run**: the newest run of this repo that is under way, else the newest queued one, else the newest finished one, so the last result stays in view. A run queued behind the shown one never hides it; the line under the header counts the queue (`started 1h ago · 1 queued behind it`). Ticket runs and operator gate runs (`kintsugi land`) both count. A session outside an enrolled repo shows every project's runs.
- **Pipeline**: `✓ fmt → ✓ check → ✓ lint → ⠧ test → ○ skip-gate`. In a narrow pane it wraps between whole stages.
- **Jobs table**: each stage's state, exit code and time. As the pane narrows, the exit column goes first, then the state word (its coloured glyph stays), then stage names shorten. The time always stays.
- **Tests**: once a gate run's `test` stage starts, the tests run so far against the total of the last passed run like it (`2,609 of ~3,560 run`), the passed, failed and ignored counts, and up to three failed tests by name. It counts the per-test result lines of `cargo test` and Python `unittest`. When the log has none, or is over 4 MiB, the section stays hidden rather than show a wrong count. Ticket runs have no Tests section.
- **Timing**: while a long stage runs, finished stages share the left half at their true proportions, and the running stage fills the right half against its usual length (the median of that stage in this repo's passed runs of the same kind). Past it, the heading says by how much. A finished run is drawn at true scale. The section hides when the pane is too narrow.
- **Spinner**: turns while a stage runs. Set `motion` to `off` to keep it still.

## How it reads kintsugi

While the pane is open, it runs `kintsugi --config <config> --json run overview` every 2 seconds, one call at a time, and `project list` once to match this repo's main checkout to an enrolled project. `<config>` is `KINTSUGI_CONFIG`, else `~/.config/kintsugi/config.toml`. A session that never opens the pane runs nothing.

While the shown gate run's `test` stage runs, it also reads `kintsugi --config <config> run logs --operation-id <run> --stage test` every 5 seconds. kintsugi has no JSON or partial read for that log, so each call returns the whole log (about 12 ms for 380 KB). The last passed run's log is read once for the total, and a finished stage once for its final count.

kintsugi must be on `PATH` and its runtime running. Errors show in the pane in kintsugi's own words. The mod's calls never have a terminal on stdin, so kintsugi never opens a Keychain dialog for them. If a newly installed build is not yet approved, the pane shows kintsugi's "run `kintsugi operator check`" message until you approve it.

Install it as in [Installing a mod](../README.md#installing-a-mod), with the folder `kintsugi-runs`.
