# Folk Music Funtimes

This repo is the first JS prototype for an ABC chord interpolator aimed at The Session tune corpus.

The current baseline is intentionally inspectable rather than black-box. It now does six practical things:

1. Reads `tunes.csv` rows from `adactio/TheSession-data`.
2. Parses ABC melody plus inline chord annotations into beat-level slices.
3. Tracks pickups as measure `0`, normalizes part structure, and aligns first/second endings to the same part-local measure slot.
4. Normalizes chords into Nashville-like degree tokens relative to the tune key and mode.
5. Learns chord-onset tendencies separately from chord identity, then decodes a full chord path with Viterbi.
6. Injects predicted chord changes back into ABC.

## Why this approach

The older Python project was a strong clue: chord placement and chord identity are related, but they are not the same task.

This baseline now combines:

- key-relative chord normalization instead of absolute chord names
- structural parsing for pickups, parts, and repeated endings
- canonical part fingerprints so repeated-pass spellings collapse to the same structural tune shape
- consensus-weighted training across multiple settings of the same tune
- cross-setting consensus weighting that rewards agreement on chord onsets as well as chord labels
- consensus slot maps across repeated passes instead of letting the last written pass win
- slot-level beat parsing so strong-beat onsets matter more than weak-note motion
- per-type decoder profiles for reels, jigs, polkas, waltzes, and related families
- full-part onset-shape hints and fuzzy part-family retrieval so A/B-scale phrasing can influence chord placement
- learned bar-level onset patterns plus exact/fuzzy variant onset hints
- a soft onset-path decoder that predicts `change` vs `stay` before feeding that bias into the chord path search
- fuzzy tune-level melody retrieval for placement hints from near-duplicate settings
- phrase-end templates and role-specific final-onset priors for first-part vs final-part cadences
- melody compatibility scoring instead of contextless labels
- explicit chord change modeling instead of relying only on token transitions
- full-sequence decoding instead of per-beat independent guesses

That gives us a better middle ground between blind ML and a hand-authored harmonizer.

## Current scope

This pass is optimized for single-voice The Session style melody bodies, not every edge case in full ABC notation. It deliberately skips or rejects:

- multivoice tunes (`V:`)
- inline key changes (`K:` inside the body)
- very unusual chord symbols that do not start with a note name

For this corpus-focused pass, the parser assumes an eighth-note default unit length for body-only ABC strings. That matches The Session material better than generic ABC fallback rules.

## Current held-out baseline

On `2026-04-19`, using:

- `node src/cli.js evaluate --csv data/tunes.csv --limit 10000 --holdout-every 5 --holdout-by tune`

the joint decoder reached:

- Tune holdout: `54.48%` exact beat, `55.23%` root-only, `79.56%` change placement
- On chord onsets only: `50.01%` exact, `50.73%` root-only

Using the stricter placement-first split:

- `node src/cli.js evaluate --csv data/tunes.csv --limit 10000 --holdout-every 5 --holdout-by tune --placement-first`

the onset-first decoder currently reaches:

- Tune holdout: `46.03%` exact beat, `46.87%` root-only
- Placement: `81.08%` change placement, `81.10%` onset-path placement
- Softer musician-friendly placement: `85.76%`

The CLI also supports The Session's separate `tune_popularity.csv` dataset via `--popularity-csv`.
On a smaller `2000`-row tune holdout, that nudged placement from about `81.30%` to `81.35%`, but on the stricter `10000`-row run it did not beat the default baseline, so it remains opt-in instead of on by default.

The repo also now includes an experimental pulse-template placement path:

- add `--pulse-templates` to `evaluate`, `predict`, or `compare`
- the pulse-template family model is implemented, but it has not yet beaten the plain placement-first baseline on the strict tune split

This matters because tune holdout is stricter than row holdout and gives a better read on generalization to unseen tunes, not just nearby settings.

## Commands

Download The Session tunes dump:

```powershell
node src/cli.js download --out data/tunes.csv
```

Train a model:

```powershell
node src/cli.js train --csv data/tunes.csv --model artifacts/the-session-model.json --limit 50000
node src/cli.js train --csv data/tunes.csv --popularity-csv data/tune_popularity.csv --model artifacts/the-session-model.json --limit 50000
```

Evaluate on held-out chorded tunes:

```powershell
node src/cli.js evaluate --csv data/tunes.csv --limit 10000 --holdout-every 5 --holdout-by row
```

Evaluate with stricter grouping:

```powershell
node src/cli.js evaluate --csv data/tunes.csv --limit 10000 --holdout-every 5 --holdout-by tune
node src/cli.js evaluate --csv data/tunes.csv --limit 10000 --holdout-every 5 --holdout-by melody
node src/cli.js evaluate --csv data/tunes.csv --limit 10000 --holdout-every 5 --holdout-by tune --placement-first
node src/cli.js evaluate --csv data/tunes.csv --limit 10000 --holdout-every 5 --holdout-by tune --placement-first --pulse-templates
node src/cli.js evaluate --csv data/tunes.csv --popularity-csv data/tune_popularity.csv --limit 10000 --holdout-every 5 --holdout-by tune --placement-first
```

Train or evaluate by tune type:

```powershell
node src/cli.js train --csv data/tunes.csv --model artifacts/reels-model.json --types reel
node src/cli.js evaluate --csv data/tunes.csv --limit 10000 --holdout-every 5 --holdout-by tune --types jig,reel,polka
```

Predict chords for a tune body:

```powershell
node src/cli.js predict --model artifacts/the-session-model.json --abc examples/input-no-chords.abc --meter 2/4 --mode Adorian --type polka --write-abc artifacts/input-with-chords.abc
```

Export a Power BI-friendly beat-slot table:

```powershell
node src/cli.js export-features --csv data/tunes.csv --popularity-csv data/tune_popularity.csv --out artifacts/powerbi/chorded_beat_slots.csv --chorded-only --standard-only
```

`--standard-only` excludes structural outliers such as suite-like multi-section settings, overlong measures, and settings with inline structural directives. The export also includes tune-level structural flags so raw and cleaned exports can be compared in Power BI.

The export now separates musician-facing bar positions from parser pulses:
- `beat_in_bar` / `beat_end_in_bar` / `beat_span_in_bar` use the written meter count, so a `6/8` jig pulse lands on `1-3` or `4-6`
- `metrical_beat_in_bar` keeps the compound-meter pulse count (`1-2` in `6/8`)
- `pulse_index_in_bar` keeps the broader placement-family pulse grouping used by the model

Run tests:

```powershell
node test/run-tests.js
```

## Next logical improvements

- add fuzzy melody retrieval instead of exact fingerprint matching only
- learn phrase-level priors across fuller 8-bar A/B cadence shapes
- improve chord spelling and slash-chord handling
- broaden ABC coverage for more ornaments, ties, and unusual tuplets
- add evaluation broken out by meter and mode in addition to tune type
