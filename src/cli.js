var path = require("path");
var args = require("./lib/args");
var csv = require("./lib/csv");
var io = require("./lib/io");
var fs = require("fs");
var modelApi = require("./model/chord_interpolator");
var abcParser = require("./music/abc");
var theory = require("./music/theory");

var DEFAULT_TUNES_URL = "https://raw.githubusercontent.com/adactio/TheSession-data/main/csv/tunes.csv";
var DEFAULT_TUNE_POPULARITY_URL = "https://raw.githubusercontent.com/adactio/TheSession-data/main/csv/tune_popularity.csv";
var DEFAULT_MODEL_PATH = path.join("artifacts", "the-session-model.json");

function usage() {
  console.log("Usage:");
  console.log("  node src/cli.js download --out data/tunes.csv [--popularity-out data/tune_popularity.csv]");
  console.log("  node src/cli.js train --csv data/tunes.csv --model artifacts/model.json [--limit 50000] [--types jig,reel] [--popularity-csv data/tune_popularity.csv]");
  console.log("  node src/cli.js evaluate --csv data/tunes.csv [--limit 20000] [--holdout-every 5] [--holdout-by row|tune|melody] [--types jig,reel] [--popularity-csv data/tune_popularity.csv] [--placement-first] [--onset-context-identity] [--onset-learner] [--pulse-templates]");
  console.log("  node src/cli.js predict --model artifacts/model.json --abc examples/input-no-chords.abc --meter 2/4 --mode Adorian --type polka [--write-abc output.abc] [--placement-first] [--onset-context-identity] [--onset-learner] [--pulse-templates]");
  console.log("  node src/cli.js compare --csv data/tunes.csv --name \"Kesh, The\" [--setting-id 47264] [--model artifacts/the-session-model.json] [--popularity-csv data/tune_popularity.csv] [--placement-first] [--onset-context-identity] [--onset-learner] [--pulse-templates]");
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

function normalizeNameQuery(value) {
  var stopWords = {
    a: true,
    an: true,
    the: true,
    tune: true,
    jig: true,
    reel: true,
    hornpipe: true,
    polka: true,
    waltz: true,
    march: true,
    strathspey: true,
    slide: true,
    mazurka: true,
    barndance: true
  };

  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(function (piece) {
      return piece && !stopWords[piece];
    })
    .join(" ");
}

function rowNameMatches(rowName, query) {
  var normalizedRowName = normalizeNameQuery(rowName);
  var normalizedQuery = normalizeNameQuery(query);

  if (!normalizedQuery) {
    return false;
  }

  if (normalizedRowName === normalizedQuery) {
    return true;
  }

  return normalizedQuery.split(/\s+/).every(function (piece) {
    return normalizedRowName.indexOf(piece) !== -1;
  });
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

function usePlacementFirst(commandArgs) {
  return !!commandArgs["placement-first"];
}

function useOnsetContextIdentity(commandArgs) {
  return !!commandArgs["onset-context-identity"];
}

function useOnsetLearner(commandArgs) {
  return !!commandArgs["onset-learner"];
}

function usePulseTemplates(commandArgs) {
  return !!commandArgs["pulse-templates"];
}

function parseInteger(value) {
  var numeric = parseInt(String(value || "").trim(), 10);
  return isFinite(numeric) ? numeric : null;
}

function resolvePopularityCsvPath(commandArgs, csvPath) {
  var explicitPath = commandArgs["popularity-csv"];

  if (explicitPath) {
    return explicitPath;
  }

  return "";
}

function loadPopularityMap(popularityCsvPath) {
  var headers = null;
  var popularityByTuneId = {};

  if (!popularityCsvPath) {
    return Promise.resolve(popularityByTuneId);
  }

  return csv.parseCsvFile(popularityCsvPath, function (rowValues) {
    var row;
    var tuneId;
    var tunebooks;

    if (!headers) {
      headers = rowValues;
      return;
    }

    row = rowFromArray(headers, rowValues);
    tuneId = String(row.tune_id || "").trim();
    tunebooks = parseInteger(row.tunebooks);

    if (!tuneId || tunebooks === null) {
      return;
    }

    popularityByTuneId[tuneId] = {
      tunebooks: tunebooks,
      name: row.name || ""
    };
  }).then(function () {
    return popularityByTuneId;
  });
}

function decorateRowsWithPopularity(rows, popularityByTuneId) {
  (rows || []).forEach(function (row) {
    var popularityEntry = popularityByTuneId[String(row.tune_id || "").trim()];
    if (!popularityEntry) {
      return;
    }

    row.tune_popularity = String(popularityEntry.tunebooks);
    row.tunebooks = String(popularityEntry.tunebooks);
  });

  return rows;
}

function createStatsBucket() {
  return {
    evaluatedTunes: 0,
    skippedTunes: 0,
    labeledBeats: 0,
    exactHits: 0,
    softExactPoints: 0,
    rootHits: 0,
    changePlacementHits: 0,
    softChangePlacementPoints: 0,
    changeOpportunities: 0,
    onsetPathPlacementHits: 0,
    onsetPathSoftChangePlacementPoints: 0,
    onsetPathChangeOpportunities: 0,
    onsetExactHits: 0,
    onsetSoftExactPoints: 0,
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

function compatibilityScoreForTokens(predictionToken, truthToken, modeInfo) {
  var predicted;
  var truth;
  var majorRoot;
  var minorRoot;

  if (predictionToken === truthToken) {
    return 1;
  }

  predicted = theory.parseChordToken(predictionToken, modeInfo);
  truth = theory.parseChordToken(truthToken, modeInfo);

  if (predicted.quality === "maj" && truth.quality === "min") {
    majorRoot = predicted.relativeRoot;
    minorRoot = truth.relativeRoot;
  } else if (predicted.quality === "min" && truth.quality === "maj") {
    majorRoot = truth.relativeRoot;
    minorRoot = predicted.relativeRoot;
  } else {
    return 0;
  }

  return theory.mod12(majorRoot - minorRoot) === 3 ? 0.5 : 0;
}

function softChangePlacementScore(truthChanged, predChanged) {
  if (truthChanged === predChanged) {
    return 1;
  }

  if (!truthChanged && predChanged) {
    return 0.5;
  }

  return 0;
}

function updateBeatStats(bucket, predictionToken, truthToken, previousTruthToken, previousPredToken, modeInfo, predictionOnsetLabel) {
  var compatibilityScore;
  var truthChanged;
  var predChanged;
  var pathChanged;

  bucket.labeledBeats += 1;
  compatibilityScore = compatibilityScoreForTokens(predictionToken, truthToken, modeInfo);

  if (predictionToken === truthToken) {
    bucket.exactHits += 1;
  }

  bucket.softExactPoints += compatibilityScore;

  if (String(predictionToken).split(":")[0] === String(truthToken).split(":")[0]) {
    bucket.rootHits += 1;
  }

  truthChanged = previousTruthToken === null || truthToken !== previousTruthToken;
  predChanged = previousPredToken === null || predictionToken !== previousPredToken;
  pathChanged = predictionOnsetLabel === "change";

  if (truthChanged) {
    bucket.onsetCount += 1;

    if (predictionToken === truthToken) {
      bucket.onsetExactHits += 1;
    }

    bucket.onsetSoftExactPoints += compatibilityScore;

    if (String(predictionToken).split(":")[0] === String(truthToken).split(":")[0]) {
      bucket.onsetRootHits += 1;
    }
  }

  if (previousTruthToken !== null) {
    bucket.changeOpportunities += 1;
    if (truthChanged === predChanged) {
      bucket.changePlacementHits += 1;
    }
    bucket.softChangePlacementPoints += softChangePlacementScore(truthChanged, predChanged);

    if (predictionOnsetLabel) {
      bucket.onsetPathChangeOpportunities += 1;
      if (truthChanged === pathChanged) {
        bucket.onsetPathPlacementHits += 1;
      }
      bucket.onsetPathSoftChangePlacementPoints += softChangePlacementScore(truthChanged, pathChanged);
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

function chooseComparisonRow(rows, commandArgs) {
  var settingId = commandArgs["setting-id"] ? String(commandArgs["setting-id"]) : "";
  var typeFilter = commandArgs.type ? normalizeTypeName(commandArgs.type) : "";
  var modeFilter = String(commandArgs.mode || "").trim().toLowerCase();
  var filtered = rows.slice();

  if (settingId) {
    filtered = filtered.filter(function (row) {
      return String(row.setting_id) === settingId;
    });
  }

  if (typeFilter) {
    filtered = filtered.filter(function (row) {
      return normalizeTypeName(row.type) === typeFilter;
    });
  }

  if (modeFilter) {
    filtered = filtered.filter(function (row) {
      return String(row.mode || "").trim().toLowerCase() === modeFilter;
    });
  }

  if (!filtered.length) {
    return null;
  }

  filtered.sort(function (left, right) {
    var leftChorded = left.abc.indexOf("\"") !== -1 ? 1 : 0;
    var rightChorded = right.abc.indexOf("\"") !== -1 ? 1 : 0;
    var chordDiff = rightChorded - leftChorded;
    var popularityDiff;
    if (chordDiff !== 0) {
      return chordDiff;
    }

    popularityDiff = parseInteger(right.tune_popularity || right.tunebooks || "0") - parseInteger(left.tune_popularity || left.tunebooks || "0");
    if (popularityDiff !== 0) {
      return popularityDiff;
    }

    return parseInt(left.setting_id || "0", 10) - parseInt(right.setting_id || "0", 10);
  });

  return filtered[0];
}

function formatChangePointComparison(parsedTruth, predictions) {
  var lines = [
    "bar | beat | truth | predicted | status"
  ];
  var previousTruthToken = null;
  var previousPredToken = null;
  var i;

  for (i = 0; i < parsedTruth.beatSlices.length && i < predictions.length; i += 1) {
    var slice = parsedTruth.beatSlices[i];
    var truthChord = slice.chord ? theory.normalizeChord(slice.chord.raw, parsedTruth.modeInfo) : null;
    var truthChanged;
    var predChanged;
    var status;

    if (!truthChord) {
      continue;
    }

    truthChanged = previousTruthToken === null || truthChord.token !== previousTruthToken;
    predChanged = previousPredToken === null || predictions[i].token !== previousPredToken;

    if (!truthChanged && !predChanged) {
      previousTruthToken = truthChord.token;
      previousPredToken = predictions[i].token;
      continue;
    }

    status = predictions[i].token === truthChord.token ? "match" :
      (String(predictions[i].token).split(":")[0] === String(truthChord.token).split(":")[0] ? "root-only" : "miss");

    lines.push([
      slice.isPickup ? "0" : String(slice.measureNumber),
      slice.isPickup ? "pickup" : String((slice.beatInBar || 0) + 1),
      theory.chordTokenToDisplayName(truthChord.token, parsedTruth.modeInfo),
      predictions[i].displayChord,
      status
    ].join(" | "));

    previousTruthToken = truthChord.token;
    previousPredToken = predictions[i].token;
  }

  return lines.join("\n");
}

function runCompare(commandArgs) {
  var csvPath = commandArgs.csv;
  var queryName = commandArgs.name;
  var rows = [];
  var headers = null;
  var selectedRow;
  var modelPath = commandArgs.model || DEFAULT_MODEL_PATH;
  var popularityCsvPath = resolvePopularityCsvPath(commandArgs, csvPath);
  var placementFirst = usePlacementFirst(commandArgs);
  var onsetContextIdentity = useOnsetContextIdentity(commandArgs);
  var onsetLearner = useOnsetLearner(commandArgs);
  var pulseTemplates = usePulseTemplates(commandArgs);

  if (!csvPath || !queryName) {
    throw new Error("compare requires --csv and --name");
  }

  return csv.parseCsvFile(csvPath, function (rowValues) {
    if (!headers) {
      headers = rowValues;
      return;
    }

    var row = rowFromArray(headers, rowValues);
    if (!row.name || !row.abc) {
      return;
    }

    if (!rowNameMatches(row.name, queryName)) {
      return;
    }

    rows.push(row);
  }).then(function () {
    return loadPopularityMap(popularityCsvPath);
  }).then(function (popularityByTuneId) {
    decorateRowsWithPopularity(rows, popularityByTuneId);
    if (!rows.length) {
      throw new Error("No tunes matched --name " + queryName);
    }

    selectedRow = chooseComparisonRow(rows, commandArgs);
    if (!selectedRow) {
      throw new Error("No matching setting remained after filters.");
    }

    if (!fs.existsSync(modelPath)) {
      throw new Error("Model file not found: " + modelPath);
    }

    var model = io.readJson(modelPath);
    var melodyAbc = abcParser.stripChordAnnotations(selectedRow.abc);
    var parsedTruth = abcParser.parseAbcTune({
      abc: selectedRow.abc,
      meter: selectedRow.meter,
      mode: selectedRow.mode,
      type: selectedRow.type
    });
    var predictions = modelApi.predictForTune(model, {
      abc: melodyAbc,
      meter: selectedRow.meter,
      mode: selectedRow.mode,
      type: selectedRow.type,
      placementFirst: placementFirst,
      onsetContextIdentity: onsetContextIdentity,
      useOnsetLearner: onsetLearner,
      usePulseTemplates: pulseTemplates
    });
    var predictedAbc = abcParser.injectPredictedChords(melodyAbc, predictions);

    console.log("Comparison");
    console.log("  name: " + selectedRow.name);
    console.log("  tune_id: " + selectedRow.tune_id);
    console.log("  setting_id: " + selectedRow.setting_id);
    console.log("  type: " + selectedRow.type);
    console.log("  meter: " + selectedRow.meter);
    console.log("  mode: " + selectedRow.mode);
    console.log("  matched settings: " + rows.length);
    console.log("  model: " + modelPath);
    console.log("  decoder mode: " + (placementFirst ? "placement-first" : "joint"));
    if (placementFirst && onsetContextIdentity) {
      console.log("  identity stage: onset-context");
    }
    if (onsetLearner) {
      console.log("  onset learner: experimental");
    }
    if (pulseTemplates) {
      console.log("  pulse templates: experimental");
    }
    console.log("");
    console.log("Original Chorded ABC");
    console.log(selectedRow.abc);
    console.log("");
    console.log("Predicted Chorded ABC");
    console.log(predictedAbc);
    console.log("");
    console.log("Change-Point Comparison");
    console.log(formatChangePointComparison(parsedTruth, predictions));
  });
}

function runDownload(commandArgs) {
  var outPath = commandArgs.out || path.join("data", "tunes.csv");
  var popularityOutPath = commandArgs["popularity-out"] || path.join(path.dirname(outPath), "tune_popularity.csv");
  console.log("Downloading The Session tunes CSV to " + outPath);
  return io.downloadFile(DEFAULT_TUNES_URL, outPath).then(function () {
    console.log("Downloading The Session tune popularity CSV to " + popularityOutPath);
    return io.downloadFile(DEFAULT_TUNE_POPULARITY_URL, popularityOutPath);
  }).then(function () {
    console.log("Download complete.");
  });
}

function runTrain(commandArgs) {
  var csvPath = commandArgs.csv;
  var modelPath = commandArgs.model;
  var limit = commandArgs.limit ? parseInt(commandArgs.limit, 10) : null;
  var typeFilter = parseTypeFilter(commandArgs.types);
  var popularityCsvPath = resolvePopularityCsvPath(commandArgs, csvPath);

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
  if (popularityCsvPath) {
    console.log("Using tune popularity from " + popularityCsvPath);
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
    return loadPopularityMap(popularityCsvPath);
  }).then(function (popularityByTuneId) {
    decorateRowsWithPopularity(rowsToTrain, popularityByTuneId);
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
  console.log("  decoder mode: " + (stats.placementFirst ? "placement-first" : "joint"));
  if (stats.placementFirst && stats.onsetContextIdentity) {
    console.log("  identity stage: onset-context");
  }
  if (stats.onsetLearner) {
    console.log("  onset learner: experimental");
  }
  if (stats.pulseTemplates) {
    console.log("  pulse templates: experimental");
  }
  if (stats.typeFilterLabel) {
    console.log("  type filter: " + stats.typeFilterLabel);
  }
  console.log("  train rows: " + stats.trainRows);
  console.log("  holdout rows: " + stats.holdoutRows);
  console.log("  evaluated tunes: " + stats.evaluatedTunes);
  console.log("  skipped tunes: " + stats.skippedTunes);
  console.log("  labeled beats: " + stats.labeledBeats);
  console.log("  exact beat accuracy: " + ratio(stats.exactHits, stats.labeledBeats));
  console.log("  compatibility-weighted beat score: " + ratio(stats.softExactPoints, stats.labeledBeats));
  console.log("  root-only accuracy: " + ratio(stats.rootHits, stats.labeledBeats));
  console.log("  change placement accuracy: " + ratio(stats.changePlacementHits, stats.changeOpportunities));
  console.log("  soft change placement score: " + ratio(stats.softChangePlacementPoints, stats.changeOpportunities));
  console.log("  onset-path placement accuracy: " + ratio(stats.onsetPathPlacementHits, stats.onsetPathChangeOpportunities));
  console.log("  onset-path soft placement score: " + ratio(stats.onsetPathSoftChangePlacementPoints, stats.onsetPathChangeOpportunities));
  console.log("  onset exact accuracy: " + ratio(stats.onsetExactHits, stats.onsetCount));
  console.log("  compatibility-weighted onset score: " + ratio(stats.onsetSoftExactPoints, stats.onsetCount));
  console.log("  onset root-only accuracy: " + ratio(stats.onsetRootHits, stats.onsetCount));

  Object.keys(stats.byType || {}).sort().forEach(function (typeName) {
    var bucket = stats.byType[typeName];
    console.log("  type " + typeName + ": exact " + ratio(bucket.exactHits, bucket.labeledBeats) +
      ", root " + ratio(bucket.rootHits, bucket.labeledBeats) +
      ", change " + ratio(bucket.changePlacementHits, bucket.changeOpportunities) +
      ", onset-path " + ratio(bucket.onsetPathPlacementHits, bucket.onsetPathChangeOpportunities) +
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
  var popularityCsvPath = resolvePopularityCsvPath(commandArgs, csvPath);
  var placementFirst = usePlacementFirst(commandArgs);
  var onsetContextIdentity = useOnsetContextIdentity(commandArgs);
  var onsetLearner = useOnsetLearner(commandArgs);
  var pulseTemplates = usePulseTemplates(commandArgs);

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
  console.log("Decoder mode: " + (placementFirst ? "placement-first" : "joint") + ".");
  if (placementFirst && onsetContextIdentity) {
    console.log("Identity stage: onset-context.");
  }
  if (onsetLearner) {
    console.log("Onset learner: experimental.");
  }
  if (pulseTemplates) {
    console.log("Pulse templates: experimental.");
  }
  if (popularityCsvPath) {
    console.log("Using tune popularity from " + popularityCsvPath + ".");
  }

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
    return loadPopularityMap(popularityCsvPath);
  }).then(function (popularityByTuneId) {
    var groupedRows = {};
    var groupOrder = [];
    var model = modelApi.createEmptyModel();
    var trainRows = 0;
    var trainCandidateRows = [];
    var holdoutRows = [];

    eligibleRows.forEach(function (entry) {
      var popularityEntry = popularityByTuneId[String(entry.row.tune_id || "").trim()];
      if (popularityEntry) {
        entry.row.tune_popularity = String(popularityEntry.tunebooks);
        entry.row.tunebooks = String(popularityEntry.tunebooks);
      }
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
      placementFirst: placementFirst,
      onsetContextIdentity: onsetContextIdentity,
      onsetLearner: onsetLearner,
      pulseTemplates: pulseTemplates,
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
          type: row.type,
          placementFirst: placementFirst,
          onsetContextIdentity: onsetContextIdentity,
          useOnsetLearner: onsetLearner,
          usePulseTemplates: pulseTemplates
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
        updateBeatStats(overall, predictions[i].token, truthChord.token, previousTruthToken, previousPredToken, parsedTruth.modeInfo, predictions[i].onsetLabel);
        updateBeatStats(typeStats, predictions[i].token, truthChord.token, previousTruthToken, previousPredToken, parsedTruth.modeInfo, predictions[i].onsetLabel);

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
    type: commandArgs.type || "unknown",
    placementFirst: usePlacementFirst(commandArgs),
    onsetContextIdentity: useOnsetContextIdentity(commandArgs),
    useOnsetLearner: useOnsetLearner(commandArgs),
    usePulseTemplates: usePulseTemplates(commandArgs)
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
  } else if (command === "compare") {
    action = runCompare(parsed);
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
