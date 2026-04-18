var path = require("path");
var args = require("./lib/args");
var csv = require("./lib/csv");
var io = require("./lib/io");
var modelApi = require("./model/chord_interpolator");
var abcParser = require("./music/abc");
var theory = require("./music/theory");

var DEFAULT_TUNES_URL = "https://raw.githubusercontent.com/adactio/TheSession-data/main/csv/tunes.csv";

function usage() {
  console.log("Usage:");
  console.log("  node src/cli.js download --out data/tunes.csv");
  console.log("  node src/cli.js train --csv data/tunes.csv --model artifacts/model.json [--limit 50000]");
  console.log("  node src/cli.js evaluate --csv data/tunes.csv [--limit 20000] [--holdout-every 5]");
  console.log("  node src/cli.js predict --model artifacts/model.json --abc examples/input-no-chords.abc --meter 2/4 --mode Adorian --type polka [--write-abc output.abc]");
}

function rowFromArray(headers, values) {
  var out = {};
  var i;

  for (i = 0; i < headers.length; i += 1) {
    out[headers[i]] = values[i] || "";
  }

  return out;
}

function formatPredictions(predictions) {
  return predictions.map(function (prediction) {
    return [
      "bar " + (prediction.barIndex + 1),
      "beat " + (prediction.beatInBar + 1),
      prediction.displayChord
    ].join(" | ");
  }).join("\n");
}

function runDownload(commandArgs) {
  var outPath = commandArgs.out || path.join("data", "tunes.csv");
  console.log("Downloading The Session tunes CSV to " + outPath);
  return io.downloadFile(DEFAULT_TUNES_URL, outPath).then(function () {
    console.log("Download complete.");
  });
}

function runTrain(commandArgs) {
  var csvPath = commandArgs.csv;
  var modelPath = commandArgs.model;
  var limit = commandArgs.limit ? parseInt(commandArgs.limit, 10) : null;

  if (!csvPath || !modelPath) {
    throw new Error("train requires --csv and --model");
  }

  var model = modelApi.createEmptyModel();
  var headers = null;
  var processed = 0;
  var trained = 0;
  var skipped = 0;

  console.log("Training from " + csvPath);

  return csv.parseCsvFile(csvPath, function (rowValues) {
    if (!headers) {
      headers = rowValues;
      return;
    }

    if (limit && processed >= limit) {
      return;
    }

    processed += 1;

    try {
      var row = rowFromArray(headers, rowValues);
      var trainedThisRow = modelApi.trainOnRow(model, row);
      if (trainedThisRow) {
        trained += 1;
      }
    } catch (error) {
      skipped += 1;
    }

    if (processed % 5000 === 0) {
      console.log("Processed " + processed + " rows. Trained on " + trained + ". Skipped " + skipped + ".");
    }
  }).then(function () {
    model.metadata.processedRows = processed;
    model.metadata.skippedRows = skipped;
    io.writeJson(modelPath, model);
    console.log("Model written to " + modelPath);
    console.log("Processed rows: " + processed);
    console.log("Trained tunes: " + model.metadata.trainedTunes);
    console.log("Skipped tunes: " + model.metadata.skippedTunes);
    console.log("Labeled beats: " + model.metadata.labeledBeats);
  });
}

function summarizeEvaluation(stats) {
  function ratio(numerator, denominator) {
    if (!denominator) {
      return "0.00%";
    }

    return ((numerator / denominator) * 100).toFixed(2) + "%";
  }

  console.log("Evaluation summary");
  console.log("  train rows: " + stats.trainRows);
  console.log("  holdout rows: " + stats.holdoutRows);
  console.log("  evaluated tunes: " + stats.evaluatedTunes);
  console.log("  skipped tunes: " + stats.skippedTunes);
  console.log("  labeled beats: " + stats.labeledBeats);
  console.log("  exact beat accuracy: " + ratio(stats.exactHits, stats.labeledBeats));
  console.log("  root-only accuracy: " + ratio(stats.rootHits, stats.labeledBeats));
  console.log("  change placement accuracy: " + ratio(stats.changePlacementHits, stats.changeOpportunities));
  console.log("  onset exact accuracy: " + ratio(stats.onsetExactHits, stats.onsetCount));
  console.log("  onset root-only accuracy: " + ratio(stats.onsetRootHits, stats.onsetCount));
}

function runEvaluate(commandArgs) {
  var csvPath = commandArgs.csv;
  var limit = commandArgs.limit ? parseInt(commandArgs.limit, 10) : 20000;
  var holdoutEvery = commandArgs["holdout-every"] ? parseInt(commandArgs["holdout-every"], 10) : 5;

  if (!csvPath) {
    throw new Error("evaluate requires --csv");
  }

  if (!holdoutEvery || holdoutEvery < 2) {
    throw new Error("--holdout-every must be 2 or greater");
  }

  var model = modelApi.createEmptyModel();
  var headers = null;
  var chordedIndex = 0;
  var holdoutRows = [];
  var trainRows = 0;

  console.log("Preparing held-out evaluation from " + csvPath);

  return csv.parseCsvFile(csvPath, function (rowValues) {
    if (!headers) {
      headers = rowValues;
      return;
    }

    if (limit && chordedIndex >= limit) {
      return;
    }

    var row = rowFromArray(headers, rowValues);
    if (!row.abc || row.abc.indexOf("\"") === -1) {
      return;
    }

    chordedIndex += 1;

    if (chordedIndex % holdoutEvery === 0) {
      holdoutRows.push(row);
      return;
    }

    try {
      if (modelApi.trainOnRow(model, row)) {
        trainRows += 1;
      }
    } catch (error) {
      return;
    }
  }).then(function () {
    var stats = {
      trainRows: trainRows,
      holdoutRows: holdoutRows.length,
      evaluatedTunes: 0,
      skippedTunes: 0,
      labeledBeats: 0,
      exactHits: 0,
      rootHits: 0,
      changePlacementHits: 0,
      changeOpportunities: 0,
      onsetExactHits: 0,
      onsetRootHits: 0,
      onsetCount: 0
    };

    holdoutRows.forEach(function (row) {
      var parsedTruth;
      var predictions;

      try {
        parsedTruth = abcParser.parseAbcTune({
          abc: row.abc,
          meter: row.meter,
          mode: row.mode,
          type: row.type
        });

        predictions = modelApi.predictForTune(model, {
          abc: abcParser.stripChordAnnotations(row.abc),
          meter: row.meter,
          mode: row.mode,
          type: row.type
        });
      } catch (error) {
        stats.skippedTunes += 1;
        return;
      }

      var evaluatedThisTune = false;
      var previousTruthToken = null;
      var previousPredToken = null;
      var i;

      for (i = 0; i < parsedTruth.beatSlices.length && i < predictions.length; i += 1) {
        var slice = parsedTruth.beatSlices[i];
        var truthChord = slice.chord ? theory.normalizeChord(slice.chord.raw, parsedTruth.modeInfo) : null;
        if (!truthChord) {
          continue;
        }

        evaluatedThisTune = true;
        stats.labeledBeats += 1;

        if (predictions[i].token === truthChord.token) {
          stats.exactHits += 1;
        }

        if (String(predictions[i].token).split(":")[0] === String(truthChord.token).split(":")[0]) {
          stats.rootHits += 1;
        }

        var truthChanged = previousTruthToken === null || truthChord.token !== previousTruthToken;
        var predChanged = previousPredToken === null || predictions[i].token !== previousPredToken;

        if (truthChanged) {
          stats.onsetCount += 1;

          if (predictions[i].token === truthChord.token) {
            stats.onsetExactHits += 1;
          }

          if (String(predictions[i].token).split(":")[0] === String(truthChord.token).split(":")[0]) {
            stats.onsetRootHits += 1;
          }
        }

        if (previousTruthToken !== null) {
          stats.changeOpportunities += 1;
          if (truthChanged === predChanged) {
            stats.changePlacementHits += 1;
          }
        }

        previousTruthToken = truthChord.token;
        previousPredToken = predictions[i].token;
      }

      if (evaluatedThisTune) {
        stats.evaluatedTunes += 1;
      } else {
        stats.skippedTunes += 1;
      }
    });

    summarizeEvaluation(stats);
  });
}

function runPredict(commandArgs) {
  if (!commandArgs.model || !commandArgs.abc || !commandArgs.meter || !commandArgs.mode) {
    throw new Error("predict requires --model, --abc, --meter, and --mode");
  }

  var model = io.readJson(commandArgs.model);
  var abcBody = io.readText(commandArgs.abc);
  var options = {
    abc: abcBody,
    meter: commandArgs.meter,
    mode: commandArgs.mode,
    type: commandArgs.type || "unknown"
  };
  var predictions = modelApi.predictForTune(model, options);
  console.log(formatPredictions(predictions));

  if (commandArgs["write-abc"]) {
    var injected = abcParser.injectPredictedChords(abcBody, predictions);
    io.writeText(commandArgs["write-abc"], injected);
    console.log("");
    console.log("Chorded ABC written to " + commandArgs["write-abc"]);
  }
}

function main() {
  var parsed = args.parseArgs(process.argv.slice(2));
  var command = parsed._[0];

  if (!command) {
    usage();
    process.exitCode = 1;
    return;
  }

  var action;

  if (command === "download") {
    action = runDownload(parsed);
  } else if (command === "train") {
    action = runTrain(parsed);
  } else if (command === "evaluate") {
    action = runEvaluate(parsed);
  } else if (command === "predict") {
    action = Promise.resolve().then(function () {
      runPredict(parsed);
    });
  } else {
    usage();
    process.exitCode = 1;
    return;
  }

  action.catch(function (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

main();
