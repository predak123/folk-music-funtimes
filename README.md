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

On `2026-04-18`, using:

- `node src/cli.js evaluate --csv data/tunes.csv --limit 10000 --holdout-every 5`

the model reached:

- `51.16%` exact beat accuracy
- `53.93%` root-only beat accuracy
- `78.69%` change placement accuracy
- `45.67%` onset exact accuracy
- `48.25%` onset root-only accuracy

That is still an early baseline, but it is meaningfully stronger than the earlier sub-50% runs.

## Commands

Download The Session tunes dump:

```powershell
node src/cli.js download --out data/tunes.csv
```

Train a model:

```powershell
node src/cli.js train --csv data/tunes.csv --model artifacts/the-session-model.json --limit 50000
```

Evaluate on held-out chorded tunes:

```powershell
node src/cli.js evaluate --csv data/tunes.csv --limit 10000 --holdout-every 5
```

Predict chords for a tune body:

```powershell
node src/cli.js predict --model artifacts/the-session-model.json --abc examples/input-no-chords.abc --meter 2/4 --mode Adorian --type polka --write-abc artifacts/input-with-chords.abc
```

Run tests:

```powershell
node test/run-tests.js
```

## Next logical improvements

- add true tune-family retrieval as a reranker or fallback
- learn phrase-level priors across 8-bar A/B part shapes
- improve chord spelling and slash-chord handling
- broaden ABC coverage for more ornaments, ties, and unusual tuplets
- add evaluation broken out by tune type, meter, and mode
