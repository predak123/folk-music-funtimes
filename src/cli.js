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
  console.log("  node src/cli.js train --csv data/tunes.csv --model artifacts/model.json [--limit 50000] [--types jig,reel]");
  console.log("  node src/cli.js evaluate --csv data/tunes.csv [--limit 20000] [--holdout-every 5] [--holdout-by row|tune|melody] [--types jig,reel]");
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

function normalizeTypeName(value) {
  var text = String(value || "unknown").trim().toLowerCase();
  return text || "unknown";
}

function parseTypeFilter(text) {
  if (!text) {
    return null;
  }

  var filter = {};
  String(text).split(",").forEach(function (piece) {
    var normalized = normalizeTypeName(piece);
    if (normalized) {
      filter[normalized] = true;
    }
  });

  return Object.keys(filter).length ? filter : null;
}

function matchesTypeFilter(row, typeFilter) {
  if (!typeFilter) {
    return true;
  }

  return !!typeFilter[normalizeTypeName(row.type)];
}

function parseHoldoutBy(value) {
  var holdoutBy = String(value || "row").toLowerCase();

  if (["row", "tune", "melody"].indexOf(holdoutBy) === -1) {
    throw new Error("--holdout-by must be row, tune, or melody");
  }

  return holdoutBy;
}

function createStatsBucket() {
  return {
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
}

function ensureTypeBucket(stats, typeName) {
  if (!stats.byType[typeName]) {
    stats.byType[typeName] = createStatsBucket();
  }

  return stats.byType[typeName];
}

function updateBeatStats(bucket, predictionToken, truthToken, previousTruthToken, previousPredToken) {
  bucket.labeledBeats += 1;

  if (predictionToken === truthToken) {
    bucket.exactHits += 1;
  }

  if (String(predictionToken).split(":")[0] === String(truthToken).split(":")[0]) {
    bucket.rootHits += 1;
  }

  var truthChanged = previousTruthToken === null || truthToken !== previousTruthToken;
  var predChanged = previousPredToken === null || predictionToken !== previousPredToken;

  if (truthChanged) {
    bucket.onsetCount += 1;

    if (predictionToken === truthToken) {
      bucket.onsetExactHits += 1;
    }

    if (String(predictionToken).split(":")[0] === String(truthToken).split(":")[0]) {
      bucket.onsetRootHits += 1;
    }
  }

  if (previousTruthToken !== null) {
    bucket.changeOpportunities += 1;
    if (truthChanged === predChanged) {
      bucket.changePlacementHits += 1;
    }
  }
}

function formatPredictions(predictions) {
  return predictions.map(function (prediction) {
    return [
      prediction.isPickup ? "bar 0" : "bar " + (prediction.barIndex + 1),
      prediction.isPickup ? "pickup" : "beat " + (prediction.beatInBar + 1),
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
  var typeFilter = parseTypeFilter(commandArgs.types);

  if (!csvPath || !modelPath) {
    throw new Error("train requires --csv and --model");
  }

  var model = modelApi.createEmptyModel();
  var headers = null;
  var processed = 0;
  var trained = 0;
  var skipped = 0;
  var rowsToTrain = [];

  console.log("Training from " + csvPath);
  if (typeFilter) {
    console.log("Filtering tune types to: " + Object.keys(typeFilter).sort().join(", "));
  }

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
      if (!matchesTypeFilter(row, typeFilter)) {
        return;
      }
      rowsToTrain.push(row);
    } catch (error) {
      skipped += 1;
    }

    if (processed % 5000 === 0) {
      console.log("Processed " + processed + " rows. Queued " + rowsToTrain.length + " training candidates. Skipped " + skipped + ".");
    }
  }).then(function () {
    var trainingSummary = modelApi.trainOnRows(model, rowsToTrain);
    trained = trainingSummary.trainedRows;
    skipped += trainingSummary.skippedRows;
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
  console.log("  holdout mode: " + stats.holdoutBy);
  if (stats.typeFilterLabel) {
    console.log("  type filter: " + stats.typeFilterLabel);
  }
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

  Object.keys(stats.byType || {}).sort().forEach(function (typeName) {
    var bucket = stats.byType[typeName];
    console.log("  type " + typeName + ": exact " + ratio(bucket.exactHits, bucket.labeledBeats) +
      ", root " + ratio(bucket.rootHits, bucket.labeledBeats) +
      ", change " + ratio(bucket.changePlacementHits, bucket.changeOpportunities) +
      ", onset " + ratio(bucket.onsetExactHits, bucket.onsetCount) +
      ", tunes " + bucket.evaluatedTunes);
  });
}

function buildHoldoutGroupKey(row, holdoutBy, parsedTune, rowIndex) {
  if (holdoutBy === "tune") {
    return "tune:" + String(row.tune_id || rowIndex);
  }

  if (holdoutBy === "melody") {
    return "melody:" + String(parsedTune.melodyFingerprint || rowIndex);
  }

  return "row:" + String(rowIndex);
}

function runEvaluate(commandArgs) {
  var csvPath = commandArgs.csv;
  var limit = commandArgs.limit ? parseInt(commandArgs.limit, 10) : 20000;
  var holdoutEvery = commandArgs["holdout-every"] ? parseInt(commandArgs["holdout-every"], 10) : 5;
  var holdoutBy = parseHoldoutBy(commandArgs["holdout-by"]);
  var typeFilter = parseTypeFilter(commandArgs.types);

  if (!csvPath) {
    throw new Error("evaluate requires --csv");
  }

  if (!holdoutEvery || holdoutEvery < 2) {
    throw new Error("--holdout-every must be 2 or greater");
  }

  var headers = null;
  var chordedIndex = 0;
  var eligibleRows = [];

  console.log("Preparing held-out evaluation from " + csvPath);
  if (typeFilter) {
    console.log("Filtering tune types to: " + Object.keys(typeFilter).sort().join(", "));
  }
  console.log("Grouping holdout by " + holdoutBy + ".");

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

    if (!matchesTypeFilter(row, typeFilter)) {
      return;
    }

    chordedIndex += 1;

    try {
      var parsedTune = null;
      if (holdoutBy === "melody") {
        parsedTune = abcParser.parseAbcTune({
          abc: row.abc,
          meter: row.meter,
          mode: row.mode,
          type: row.type
        });
      }

      eligibleRows.push({
        row: row,
        groupKey: buildHoldoutGroupKey(row, holdoutBy, parsedTune, chordedIndex)
      });
    } catch (error) {
      return;
    }
  }).then(function () {
    var groupedRows = {};
    var groupOrder = [];
    var model = modelApi.createEmptyModel();
    var trainRows = 0;
    var trainCandidateRows = [];
    var holdoutRows = [];

    eligibleRows.forEach(function (entry) {
      if (!groupedRows[entry.groupKey]) {
        groupedRows[entry.groupKey] = [];
        groupOrder.push(entry.groupKey);
      }

      groupedRows[entry.groupKey].push(entry.row);
    });

    groupOrder.forEach(function (groupKey, index) {
      var rows = groupedRows[groupKey];
      var isHoldout = ((index + 1) % holdoutEvery) === 0;

      if (isHoldout) {
        Array.prototype.push.apply(holdoutRows, rows);
        return;
      }

      rows.forEach(function (row) {
        trainCandidateRows.push(row);
      });
    });

    var trainingSummary = modelApi.trainOnRows(model, trainCandidateRows);
    trainRows = trainingSummary.trainedRows;

    var stats = {
      holdoutBy: holdoutBy,
      typeFilterLabel: typeFilter ? Object.keys(typeFilter).sort().join(", ") : "",
      trainRows: trainRows,
      holdoutRows: holdoutRows.length,
      byType: {}
    };
    var overall = createStatsBucket();

    holdoutRows.forEach(function (row) {
      var parsedTruth;
      var predictions;
      var typeName = normalizeTypeName(row.type);
      var typeStats = ensureTypeBucket(stats, typeName);

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
        overall.skippedTunes += 1;
        typeStats.skippedTunes += 1;
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
        updateBeatStats(overall, predictions[i].token, truthChord.token, previousTruthToken, previousPredToken);
        updateBeatStats(typeStats, predictions[i].token, truthChord.token, previousTruthToken, previousPredToken);

        previousTruthToken = truthChord.token;
        previousPredToken = predictions[i].token;
      }

      if (evaluatedThisTune) {
        overall.evaluatedTunes += 1;
        typeStats.evaluatedTunes += 1;
      } else {
        overall.skippedTunes += 1;
        typeStats.skippedTunes += 1;
      }
    });

    Object.keys(overall).forEach(function (key) {
      stats[key] = overall[key];
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
