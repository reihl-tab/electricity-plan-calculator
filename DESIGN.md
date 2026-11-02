# Design: electricity-plan-calculator

## Goal
Analyze an Israel Electric Corporation (IEC) hourly / 15-minute consumption export
(CSV) and rank the electricity plans available in Israel (regulated flat tariff,
regulated time-of-use "Taoz", and private supplier discount plans) by the
household's **actual** interval-level usage, with annual NIS cost estimates.

## Non-goals
- No switching, sign-ups, or any account actions. Read-only analysis.
- No storage or transmission of user files. All processing is local.
- User's real export files are never committed (see Privacy).

## Inputs
- IEC CSV export: UTF-8 (BOM), Hebrew metadata header (customer name, address,
  contract number, meter number), then interval rows:
  `meter-code, "צריכה", dd/MM/yyyy, HH:mm, kwh, feed-in kwh`.
- Optional weather overlay: Open-Meteo archive API (daily temperatures).

## Architecture (stdlib only for runtime)
- `iec_calc.parser` — tolerant CSV reader: BOM, quoted fields, metadata block,
  both 15-minute and hourly resolutions; yields `Interval(start, kwh, feed_kwh)`.
- `iec_calc.tariffs` — loads `data/tariffs.json`; plan model:
  - `FlatTariff` (single regulated rate),
  - `TaozTariff` (season {summer, winter, transition} x tier {peak, off-peak},
    peak windows by season and day type: weekdays Sun-Thu, Fri/holiday-eve,
    Sat/holiday),
  - `SupplierPlan` (percent discount on the regulated rate inside a
    day/hour window; window may wrap midnight; eligibility notes).
- `iec_calc.analysis` — totals, daily/hourly profile, base load, peak interval,
  night/day split, weekday vs Fri-Sat split, anomalies (mean + 2*std days).
- `iec_calc.cost` — interval-exact cost per plan; annualization `cost * 365/days`;
  ranking + recommended plan.
- `iec_calc.weather` — Open-Meteo fetch (urllib), Pearson correlation and OLS of
  daily kWh vs mean temperature with a weekend covariate. Network is isolated
  behind one function for testability; all math is pure stdlib.
- `iec_calc.report` — text report (Hebrew-friendly), ranking table, recommended
  plan first.
- `iec_calc.cli` — argparse CLI: `analyze`, `plans`, `report`; `--debug`.

## Logging
Python `logging` to stderr. Default level WARNING (silent on success).
`--debug` sets DEBUG: parsed record counts, date range, per-plan intermediate
costs, API URLs. Never logs customer metadata (name/address/contract/meter).

## Tariff data
`data/tariffs.json` holds every rate/discount with `source` URL and
`verified`/`retrieved` dates, so a tariff update is a one-file data edit.

## Privacy
- `.gitignore` excludes `*.csv` except `data/sample_consumption.csv`.
- Sample data is fully synthetic (fictional name/address/contract/meter).
- Parser output used by report/CLI never prints customer metadata.
- CI runs a privacy scan (grep for meter/contract patterns) on the tree.

## Testing / CI
- pytest + pytest-cov, coverage gate >= 80%.
- ruff lint, pip-audit for dependency vulnerabilities.
- GitHub Actions on PRs to main. Runtime is stdlib-only; dev deps pinned.

## Known limitations
- Annualization assumes the measured window represents the year; a short or
  single-season export skews the estimate (reported as a caveat in output).
- Israeli holidays are approximated as Fri/Sat unless supplied in
  `data/tariffs.json` (`holidays` list).
