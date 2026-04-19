var theory = require("../music/theory");
var abcParser = require("../music/abc");

function incrementCount(map, key, amount) {
  map[key] = (map[key] || 0) + (amount || 1);
}

function ensureNestedMap(root, key) {
  if (!root[key]) {
    root[key] = {};
  }
  return root[key];
}

function createEmptyModel() {
  return {
    version: 1,
    metadata: {
      trainedTunes: 0,
      skippedTunes: 0,
      labeledBeats: 0
    },
    counts: {
      chordTotals: {},
      modeChordTotals: {},
      styleChordTotals: {},
      typeMeterChordTotals: {},
      transitions: {},
      styleTransitions: {},
      typeMeterTransitions: {},
      positions: {},
      partPositions: {},
      signatures: {},
      measureSignatures: {},
      measurePatterns: {},
      onsetMeasurePatterns: {},
      endingTokenPatterns: {},
      endingOnsetPatterns: {},
      endingFinalOnsetTokens: {},
      onsetStyles: {},
      typeMeterOnsetStyles: {},
      onsetPositions: {},
      onsetPartPositions: {},
      onsetSignatures: {},
      onsetMeasureSignatures: {},
      onsetStyleChordTotals: {},
      onsetPositionChordTotals: {},
      onsetSignatureChordTotals: {},
      onsetMeasureSignatureChordTotals: {},
      exactMelodyPaths: {},
      fuzzyPartLibrary: [],
      fuzzyTuneLibrary: [],
      cadencePositions: {},
      emissions: {},
      slotEmissions: {},
      emissionTotals: {},
      tuneTypes: {}
    }
  };
}

function buildMeasureSlot(slice) {
  if (slice.isPickup) {
    return "pickup";
  }

  return String(slice.measureInPart);
}

function buildPositionKey(slice, parsedTune) {
  return [
    parsedTune.type || "unknown",
    parsedTune.meterInfo.raw,
    parsedTune.modeInfo.modeFamily,
    buildMeasureSlot(slice),
    slice.beatInBar
  ].join("|");
}

function buildPartPositionKey(slice, parsedTune) {
  return [
    parsedTune.type || "unknown",
    parsedTune.meterInfo.raw,
    parsedTune.modeInfo.modeFamily,
    slice.partIndex,
    buildMeasureSlot(slice),
    slice.beatInBar
  ].join("|");
}

function buildStyleKey(parsedTune) {
  return [
    parsedTune.type || "unknown",
    parsedTune.meterInfo.raw,
    parsedTune.modeInfo.modeFamily
  ].join("|");
}

function buildTypeMeterKey(parsedTune) {
  return [
    parsedTune.type || "unknown",
    parsedTune.meterInfo.raw
  ].join("|");
}

function buildSignaturePitchClasses(slice) {
  var pcs = [];
  var rankedPcs = Object.keys(slice.noteWeights).sort(function (left, right) {
    var weightDiff = slice.noteWeights[right] - slice.noteWeights[left];
    if (weightDiff !== 0) {
      return weightDiff;
    }
    return parseInt(left, 10) - parseInt(right, 10);
  });

  (slice.slotProfiles || []).forEach(function (slotProfile) {
    (slotProfile.startingPcs || []).forEach(function (pc) {
      var pcKey = String(pc);
      if (pcs.indexOf(pcKey) === -1) {
        pcs.push(pcKey);
      }
    });
  });

  rankedPcs.forEach(function (pc) {
    if (pcs.indexOf(pc) === -1) {
      pcs.push(pc);
    }
  });

  return pcs.slice(0, 3);
}

function buildSignatureKey(slice, parsedTune) {
  var pcs = buildSignaturePitchClasses(slice);

  return [
    buildStyleKey(parsedTune),
    slice.partIndex,
    buildMeasureSlot(slice),
    slice.beatInBar,
    pcs.join(".")
  ].join("|");
}

function buildMeasureSignatureKey(slice, parsedTune) {
  return [
    buildStyleKey(parsedTune),
    slice.partIndex,
    buildMeasureSlot(slice),
    slice.beatInBar,
    slice.measureSignature || ""
  ].join("|");
}

function buildMeasurePatternKey(slice, parsedTune) {
  return [
    buildStyleKey(parsedTune),
    slice.partIndex,
    buildMeasureSlot(slice),
    slice.measureSignature || ""
  ].join("|");
}

function buildCadenceKey(slice, parsedTune) {
  return [
    buildStyleKey(parsedTune),
    "part" + slice.partIndex,
    slice.measuresFromPartEnd === null ? "na" : Math.min(slice.measuresFromPartEnd, 2),
    slice.beatInBar
  ].join("|");
}

function buildEndingRole(parsedTune, partIndex) {
  var partCount = (parsedTune.partFingerprints && parsedTune.partFingerprints.length) || 1;

  if (partCount <= 1) {
    return "single";
  }

  if (partIndex === 0) {
    return "first";
  }

  if (partIndex === partCount - 1) {
    return "final";
  }

  return "middle";
}

function buildEndingPatternKey(slice, parsedTune) {
  return [
    buildStyleKey(parsedTune),
    buildEndingRole(parsedTune, slice.partIndex),
    Math.min(slice.partLength || 0, 16)
  ].join("|");
}

function buildEndingPatternSlotId(slice) {
  return [
    Math.min(slice.measuresFromPartEnd === null ? 9 : slice.measuresFromPartEnd, 1),
    slice.beatInBar
  ].join("|");
}

function buildEndingFinalOnsetKey(slice, parsedTune) {
  return [
    buildStyleKey(parsedTune),
    buildEndingRole(parsedTune, slice.partIndex),
    slice.beatInBar
  ].join("|");
}

function selectTopKey(bucket) {
  var bestKey = null;
  var bestCount = -Infinity;

  Object.keys(bucket || {}).forEach(function (key) {
    if (bucket[key] > bestCount) {
      bestCount = bucket[key];
      bestKey = key;
    }
  });

  return bestKey;
}

function clamp(value, min, max) {
  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
}

function onsetLabel(change) {
  return change ? "change" : "stay";
}

function buildPartSlotKey(partIndex, measureInPart, beatInBar) {
  return [
    partIndex,
    measureInPart,
    beatInBar
  ].join("|");
}

function scorePartFingerprintSimilarity(targetMeasures, candidateMeasures) {
  var left = targetMeasures || [];
  var right = candidateMeasures || [];
  var compareCount = Math.min(left.length, right.length);
  var exactMatches = 0;
  var prefixMatches = 0;
  var cadenceMatches = 0;
  var i;

  if (!left.length || !right.length) {
    return -Infinity;
  }

  for (i = 0; i < compareCount; i += 1) {
    if (left[i] !== right[i]) {
      break;
    }

    prefixMatches += 1;
  }

  for (i = 0; i < compareCount; i += 1) {
    if (left[i] === right[i]) {
      exactMatches += 1;
    }
  }

  for (i = 1; i <= Math.min(2, compareCount); i += 1) {
    if (left[left.length - i] === right[right.length - i]) {
      cadenceMatches += 1;
    }
  }

  return (
    (1.35 * prefixMatches) +
    (0.85 * exactMatches) +
    (1.10 * cadenceMatches) -
    (0.60 * Math.abs(left.length - right.length))
  );
}

function buildTuneMeasureSignatures(parsedTune) {
  return (parsedTune.measures || []).filter(function (measure) {
    return !measure.isPickup;
  }).map(function (measure) {
    return measure.signature;
  });
}

function buildTuneSlotMaps(parsedTune) {
  var tokens = {};
  var onsets = {};
  var previousToken = null;

  (parsedTune.beatSlices || []).forEach(function (slice) {
    var normalized = slice.chord ? theory.normalizeChord(slice.chord.raw, parsedTune.modeInfo) : null;
    if (!normalized || slice.isPickup || slice.beatInBar === null) {
      return;
    }

    var slotKey = buildPartSlotKey(slice.partIndex, slice.measureInPart, slice.beatInBar);
    var onsetKey = previousToken === null || previousToken !== normalized.token ? "change" : "stay";
    tokens[slotKey] = normalized.token;
    onsets[slotKey] = onsetKey;
    previousToken = normalized.token;
  });

  return {
    tokens: tokens,
    onsets: onsets
  };
}

function scoreTuneFingerprintSimilarity(targetSignatures, candidateSignatures) {
  var base = scorePartFingerprintSimilarity(targetSignatures, candidateSignatures);
  var targetLength = (targetSignatures || []).length;
  var candidateLength = (candidateSignatures || []).length;

  if (!isFinite(base)) {
    return base;
  }

  if (targetLength === candidateLength) {
    base += 0.75;
  } else {
    base -= 0.18 * Math.abs(targetLength - candidateLength);
  }

  return base;
}

function describeBucketLeader(bucket) {
  var sortedTokens = Object.keys(bucket || {}).sort(function (left, right) {
    if (bucket[right] !== bucket[left]) {
      return bucket[right] - bucket[left];
    }

    if (left === right) {
      return 0;
    }

    return left < right ? -1 : 1;
  });

  if (!sortedTokens.length) {
    return null;
  }

  var topToken = sortedTokens[0];
  var topCount = bucket[topToken] || 0;
  var secondCount = sortedTokens.length > 1 ? (bucket[sortedTokens[1]] || 0) : 0;

  return {
    token: topToken,
    confidence: topCount / Math.max(1, mapSum(bucket)),
    decisive: topCount > secondCount
  };
}

function buildParsedTrainingItem(row, rowIndex) {
  if (!row || !row.abc || row.abc.indexOf("\"") === -1) {
    return null;
  }

  var parsedTune = abcParser.parseAbcTune({
    abc: row.abc,
    meter: row.meter,
    mode: row.mode,
    type: row.type
  });
  var slotBuckets = {};
  var beatTokens = [];

  parsedTune.beatSlices.forEach(function (slice, index) {
    var normalized = slice.chord ? theory.normalizeChord(slice.chord.raw, parsedTune.modeInfo) : null;
    if (!normalized) {
      return;
    }

    beatTokens[index] = normalized.token;

    if (slice.isPickup || slice.beatInBar === null) {
      return;
    }

    incrementCount(
      ensureNestedMap(slotBuckets, buildPartSlotKey(slice.partIndex, slice.measureInPart, slice.beatInBar)),
      normalized.token,
      1
    );
  });

  var slotTokens = {};
  Object.keys(slotBuckets).forEach(function (slotKey) {
    slotTokens[slotKey] = selectTopKey(slotBuckets[slotKey]);
  });

  return {
    row: row,
    rowIndex: rowIndex,
    parsedTune: parsedTune,
    beatTokens: beatTokens,
    slotTokens: slotTokens
  };
}

function buildConsensusPlans(items) {
  var groups = {};
  var plans = items.map(function () {
    return {
      tuneWeight: 1,
      sliceWeights: {}
    };
  });

  items.forEach(function (item, index) {
    var groupKey = item.row && item.row.tune_id ? ("tune:" + item.row.tune_id) : ("row:" + item.rowIndex + ":" + index);
    if (!groups[groupKey]) {
      groups[groupKey] = [];
    }

    groups[groupKey].push({
      item: item,
      index: index
    });
  });

  Object.keys(groups).forEach(function (groupKey) {
    var groupItems = groups[groupKey];
    var slotBuckets = {};

    if (groupItems.length < 2) {
      return;
    }

    groupItems.forEach(function (groupItem) {
      Object.keys(groupItem.item.slotTokens).forEach(function (slotKey) {
        incrementCount(
          ensureNestedMap(slotBuckets, slotKey),
          groupItem.item.slotTokens[slotKey],
          1
        );
      });
    });

    groupItems.forEach(function (groupItem) {
      var sliceWeights = {};
      var matched = 0;
      var compared = 0;
      var confidenceSum = 0;

      groupItem.item.parsedTune.beatSlices.forEach(function (slice, sliceIndex) {
        var token = groupItem.item.beatTokens[sliceIndex];
        if (!token || slice.isPickup || slice.beatInBar === null) {
          return;
        }

        var leader = describeBucketLeader(slotBuckets[buildPartSlotKey(slice.partIndex, slice.measureInPart, slice.beatInBar)]);
        if (!leader || !leader.decisive) {
          return;
        }

        compared += 1;
        confidenceSum += leader.confidence;

        if (token === leader.token) {
          matched += 1;
          sliceWeights[sliceIndex] = clamp(0.95 + (0.35 * leader.confidence), 1.0, 1.30);
          return;
        }

        sliceWeights[sliceIndex] = clamp(0.95 - (0.45 * leader.confidence), 0.45, 0.85);
      });

      if (!compared) {
        return;
      }

      plans[groupItem.index] = {
        tuneWeight: clamp(
          0.55 + (0.50 * (matched / compared)) + (0.25 * (confidenceSum / compared)),
          0.70,
          1.30
        ),
        sliceWeights: sliceWeights
      };
    });
  });

  return plans;
}

function trainOnParsedTune(model, parsedTune, options) {
  var trainingOptions = options || {};
  var sliceWeights = trainingOptions.sliceWeights || {};
  var tuneWeight = trainingOptions.tuneWeight || 1;
  var usableLabels = 0;
  var previousToken = "__START__";
  var previousObservedToken = null;
  var styleKey = buildStyleKey(parsedTune);
  var typeMeterKey = buildTypeMeterKey(parsedTune);
  var measurePatterns = {};
  var onsetMeasurePatterns = {};
  var endingTokenPatterns = {};
  var endingOnsetPatterns = {};
  var pathTokens = [];
  var hasFullPath = true;
  var partLibraryEntries = {};
  var i;

  for (i = 0; i < parsedTune.beatSlices.length; i += 1) {
    var slice = parsedTune.beatSlices[i];
    var normalized = slice.chord ? theory.normalizeChord(slice.chord.raw, parsedTune.modeInfo) : null;
    var truthChange = previousObservedToken === null || normalized && normalized.token !== previousObservedToken;
    var onsetKey = onsetLabel(truthChange);
    var sliceWeight = clamp(tuneWeight * (sliceWeights[i] || 1), 0.35, 1.60);

    if (!normalized) {
      hasFullPath = false;
      continue;
    }

    pathTokens.push(normalized.token);
    usableLabels += 1;
    incrementCount(model.counts.chordTotals, normalized.token, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.modeChordTotals, parsedTune.modeInfo.modeFamily), normalized.token, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.styleChordTotals, styleKey), normalized.token, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.typeMeterChordTotals, typeMeterKey), normalized.token, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.transitions, previousToken), normalized.token, sliceWeight);
    incrementCount(ensureNestedMap(ensureNestedMap(model.counts.styleTransitions, styleKey), previousToken), normalized.token, sliceWeight);
    incrementCount(ensureNestedMap(ensureNestedMap(model.counts.typeMeterTransitions, typeMeterKey), previousToken), normalized.token, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.positions, buildPositionKey(slice, parsedTune)), normalized.token, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.partPositions, buildPartPositionKey(slice, parsedTune)), normalized.token, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.signatures, buildSignatureKey(slice, parsedTune)), normalized.token, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.measureSignatures, buildMeasureSignatureKey(slice, parsedTune)), normalized.token, sliceWeight);
    incrementCount(model.counts.tuneTypes, parsedTune.type || "unknown", 1);
    incrementCount(ensureNestedMap(model.counts.onsetStyles, styleKey), onsetKey, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.typeMeterOnsetStyles, typeMeterKey), onsetKey, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.onsetPositions, buildPositionKey(slice, parsedTune)), onsetKey, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.onsetPartPositions, buildPartPositionKey(slice, parsedTune)), onsetKey, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.onsetSignatures, buildSignatureKey(slice, parsedTune)), onsetKey, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.onsetMeasureSignatures, buildMeasureSignatureKey(slice, parsedTune)), onsetKey, sliceWeight);

    if (truthChange) {
      incrementCount(ensureNestedMap(model.counts.onsetStyleChordTotals, styleKey), normalized.token, sliceWeight);
      incrementCount(ensureNestedMap(model.counts.onsetPositionChordTotals, buildPartPositionKey(slice, parsedTune)), normalized.token, sliceWeight);
      incrementCount(ensureNestedMap(model.counts.onsetSignatureChordTotals, buildSignatureKey(slice, parsedTune)), normalized.token, sliceWeight);
      incrementCount(ensureNestedMap(model.counts.onsetMeasureSignatureChordTotals, buildMeasureSignatureKey(slice, parsedTune)), normalized.token, sliceWeight);

      if (!slice.isPickup && slice.measuresFromPartEnd === 0) {
        incrementCount(
          ensureNestedMap(model.counts.endingFinalOnsetTokens, buildEndingFinalOnsetKey(slice, parsedTune)),
          normalized.token,
          sliceWeight
        );
      }
    }

    if (!slice.isPickup && slice.measuresFromPartEnd !== null && slice.measuresFromPartEnd <= 2) {
      incrementCount(ensureNestedMap(model.counts.cadencePositions, buildCadenceKey(slice, parsedTune)), normalized.token, sliceWeight);
    }

    if (!slice.isPickup && slice.beatInBar !== null) {
      var measurePatternId = buildMeasurePatternKey(slice, parsedTune) + "|" + slice.rawBarIndex;
      if (!measurePatterns[measurePatternId]) {
        measurePatterns[measurePatternId] = {
          key: buildMeasurePatternKey(slice, parsedTune),
          beats: []
        };
      }
      measurePatterns[measurePatternId].beats.push(String(slice.beatInBar) + "=" + normalized.token);

      if (!onsetMeasurePatterns[measurePatternId]) {
        onsetMeasurePatterns[measurePatternId] = {
          key: buildMeasurePatternKey(slice, parsedTune),
          beats: []
        };
      }
      onsetMeasurePatterns[measurePatternId].beats.push(String(slice.beatInBar) + "=" + onsetKey);

      if (slice.measuresFromPartEnd !== null && slice.measuresFromPartEnd <= 1) {
        var endingPatternId = buildEndingPatternKey(slice, parsedTune) + "|" + slice.partIndex + "|" + slice.partPass;
        if (!endingTokenPatterns[endingPatternId]) {
          endingTokenPatterns[endingPatternId] = {
            key: buildEndingPatternKey(slice, parsedTune),
            beats: []
          };
        }
        if (!endingOnsetPatterns[endingPatternId]) {
          endingOnsetPatterns[endingPatternId] = {
            key: buildEndingPatternKey(slice, parsedTune),
            beats: []
          };
        }

        endingTokenPatterns[endingPatternId].beats.push(buildEndingPatternSlotId(slice) + "=" + normalized.token);
        endingOnsetPatterns[endingPatternId].beats.push(buildEndingPatternSlotId(slice) + "=" + onsetKey);
      }

      if (!partLibraryEntries[slice.partIndex]) {
        partLibraryEntries[slice.partIndex] = {
          partIndex: slice.partIndex,
          slots: {}
        };
      }

      partLibraryEntries[slice.partIndex].slots[buildPartSlotKey(slice.partIndex, slice.measureInPart, slice.beatInBar)] = normalized.token;
    }

    var emissionBucket = ensureNestedMap(model.counts.emissions, normalized.token);
    var slotEmissionBuckets = ensureNestedMap(model.counts.slotEmissions, normalized.token);
    var totalWeight = 0;
    var pcs = Object.keys(slice.noteWeights);
    var j;

    for (j = 0; j < pcs.length; j += 1) {
      var relativePc = pcs[j];
      var weight = slice.noteWeights[relativePc];
      incrementCount(emissionBucket, relativePc, weight * sliceWeight);
      totalWeight += weight;
    }

    incrementCount(model.counts.emissionTotals, normalized.token, totalWeight * sliceWeight);

    (slice.slotProfiles || []).forEach(function (slotProfile) {
      var slotBucket = ensureNestedMap(slotEmissionBuckets, slotProfile.label);

      Object.keys(slotProfile.noteWeights || {}).forEach(function (relativePc) {
        incrementCount(slotBucket, relativePc, slotProfile.noteWeights[relativePc] * sliceWeight);
      });
    });

    previousToken = normalized.token;
    previousObservedToken = normalized.token;
  }

  Object.keys(measurePatterns).forEach(function (id) {
    var pattern = measurePatterns[id];
    incrementCount(ensureNestedMap(model.counts.measurePatterns, pattern.key), pattern.beats.join("/"), tuneWeight);
  });

  Object.keys(onsetMeasurePatterns).forEach(function (id) {
    var onsetPattern = onsetMeasurePatterns[id];
    incrementCount(ensureNestedMap(model.counts.onsetMeasurePatterns, onsetPattern.key), onsetPattern.beats.join("/"), tuneWeight);
  });

  Object.keys(endingTokenPatterns).forEach(function (id) {
    var endingTokenPattern = endingTokenPatterns[id];
    incrementCount(ensureNestedMap(model.counts.endingTokenPatterns, endingTokenPattern.key), endingTokenPattern.beats.join("/"), tuneWeight);
  });

  Object.keys(endingOnsetPatterns).forEach(function (id) {
    var endingOnsetPattern = endingOnsetPatterns[id];
    incrementCount(ensureNestedMap(model.counts.endingOnsetPatterns, endingOnsetPattern.key), endingOnsetPattern.beats.join("/"), tuneWeight);
  });

  if (usableLabels > 0 && hasFullPath && pathTokens.length === parsedTune.beatSlices.length && parsedTune.melodyFingerprint) {
    incrementCount(ensureNestedMap(model.counts.exactMelodyPaths, parsedTune.melodyFingerprint), pathTokens.join("/"), tuneWeight);
  }

  if (usableLabels > 0 && parsedTune.partFingerprints && parsedTune.partFingerprints.length) {
    parsedTune.partFingerprints.forEach(function (partFingerprint) {
      var entry = partLibraryEntries[partFingerprint.partIndex];
      if (!entry) {
        return;
      }

      model.counts.fuzzyPartLibrary.push({
        styleKey: styleKey,
        typeMeterKey: typeMeterKey,
        modeFamily: parsedTune.modeInfo.modeFamily,
        partIndex: partFingerprint.partIndex,
        measureSignatures: partFingerprint.measureSignatures || [],
        slots: entry.slots,
        weight: tuneWeight
      });
    });
  }

  if (usableLabels > 0) {
    var tuneSlotMaps = buildTuneSlotMaps(parsedTune);
    model.counts.fuzzyTuneLibrary.push({
      styleKey: styleKey,
      typeMeterKey: typeMeterKey,
      modeFamily: parsedTune.modeInfo.modeFamily,
      measureSignatures: buildTuneMeasureSignatures(parsedTune),
      partCount: parsedTune.partFingerprints ? parsedTune.partFingerprints.length : 0,
      slots: tuneSlotMaps.tokens,
      onsets: tuneSlotMaps.onsets,
      weight: tuneWeight
    });
  }

  if (usableLabels > 0) {
    model.metadata.trainedTunes += 1;
    model.metadata.labeledBeats += usableLabels;
  } else {
    model.metadata.skippedTunes += 1;
  }
}

function trainOnRow(model, row) {
  var item = buildParsedTrainingItem(row, 0);
  if (!item) {
    return false;
  }

  trainOnParsedTune(model, item.parsedTune);
  return true;
}

function trainOnRows(model, rows) {
  var items = [];
  var trainedRows = 0;
  var skippedRows = 0;

  (rows || []).forEach(function (row, index) {
    try {
      var item = buildParsedTrainingItem(row, index);
      if (!item) {
        skippedRows += 1;
        return;
      }

      items.push(item);
    } catch (error) {
      skippedRows += 1;
    }
  });

  var consensusPlans = buildConsensusPlans(items);

  items.forEach(function (item, index) {
    trainOnParsedTune(model, item.parsedTune, consensusPlans[index]);
    trainedRows += 1;
  });

  return {
    trainedRows: trainedRows,
    skippedRows: skippedRows
  };
}

function mapSum(map) {
  return Object.keys(map || {}).reduce(function (sum, key) {
    return sum + map[key];
  }, 0);
}

function logProbability(bucket, token, smoothing, fallbackBucket) {
  var source = bucket || {};
  var baseCounts = fallbackBucket || {};
  var vocabulary = Object.keys(baseCounts).length || Object.keys(source).length || 1;
  var total = mapSum(source);
  var count = source[token] || 0;
  return Math.log((count + smoothing) / (total + (smoothing * vocabulary)));
}

function logDecisionProbability(bucket, label, smoothing) {
  return logProbability(bucket, label, smoothing || 1, {
    change: 1,
    stay: 1
  });
}

function buildScalePitchClassSet(modeInfo) {
  return modeInfo.scaleSemitones.reduce(function (acc, value) {
    acc[value] = true;
    return acc;
  }, {});
}

function scorePitchClassFit(relativePc, chordTones, scalePitchClasses, chordWeight, scaleWeight, clashPenalty) {
  if (chordTones.indexOf(relativePc) !== -1) {
    return chordWeight;
  }

  if (scalePitchClasses[relativePc]) {
    return scaleWeight;
  }

  return clashPenalty;
}

function isJigPulseTune(parsedTune) {
  var typeName = String(parsedTune.type || "").toLowerCase();

  return parsedTune.meterInfo.numerator === 6 &&
    parsedTune.meterInfo.denominator === 8 &&
    typeName === "jig";
}

function isSimpleMeterPulseTune(parsedTune) {
  if (isJigPulseTune(parsedTune)) {
    return false;
  }

  if (parsedTune.meterInfo.denominator === 8 &&
      parsedTune.meterInfo.numerator % 3 === 0 &&
      parsedTune.meterInfo.numerator > 3) {
    return false;
  }

  return parsedTune.meterInfo.denominator <= 4;
}

function copyMap(map) {
  return Object.keys(map || {}).reduce(function (acc, key) {
    acc[key] = map[key];
    return acc;
  }, {});
}

function buildDecoderProfile(parsedTune) {
  var typeName = String(parsedTune.type || "unknown").toLowerCase();
  var profile = {
    emissionWeight: 0.85,
    contextWeight: 1.0,
    transitionWeight: 1.05,
    startTransitionWeight: 1.05,
    changeWeight: 0.90,
    stayBonus: 0.05,
    measurePatternBonus: 1.55,
    exactHintBonus: 2.20,
    fuzzyHintWeight: 0.35,
    finalTonicBonus: 0.45,
    slotTheoryWeight: 0.72,
    slotLearnedWeight: 0.28,
    slotWeights: {
      onset: 1.00,
      off: 0.40,
      middle: 0.52,
      late: 0.78
    }
  };

  function applyOverrides(overrides) {
    Object.keys(overrides || {}).forEach(function (key) {
      if (key === "slotWeights") {
        profile.slotWeights = copyMap(profile.slotWeights);
        Object.keys(overrides.slotWeights || {}).forEach(function (slotKey) {
          profile.slotWeights[slotKey] = overrides.slotWeights[slotKey];
        });
        return;
      }

      profile[key] = overrides[key];
    });
  }

  if (["reel", "hornpipe", "strathspey", "march"].indexOf(typeName) !== -1) {
    applyOverrides({
      emissionWeight: 0.89,
      contextWeight: 1.01,
      transitionWeight: 1.08,
      changeWeight: 0.96,
      slotWeights: {
        onset: 1.24,
        off: 0.34
      }
    });
  } else if (["polka", "barndance"].indexOf(typeName) !== -1) {
    applyOverrides({
      emissionWeight: 0.90,
      transitionWeight: 1.03,
      changeWeight: 0.95,
      slotWeights: {
        onset: 1.16,
        off: 0.56
      }
    });
  } else if (["waltz", "mazurka"].indexOf(typeName) !== -1) {
    applyOverrides({
      emissionWeight: 0.88,
      transitionWeight: 1.02,
      changeWeight: 0.76,
      finalTonicBonus: 0.58,
      slotWeights: {
        onset: 1.34,
        off: 0.24
      }
    });
  } else if (["jig", "slip jig", "slide"].indexOf(typeName) !== -1) {
    applyOverrides({
      emissionWeight: 0.87,
      transitionWeight: 1.02,
      changeWeight: 0.84,
      slotWeights: {
        onset: 1.30,
        middle: 0.42,
        late: 0.86
      }
    });
  }

  return profile;
}

function beatStrength(slice, meterInfo) {
  if (slice.isPickup || slice.beatInBar === null) {
    return 0.9;
  }

  if (meterInfo.denominator === 8 && meterInfo.numerator % 3 === 0 && meterInfo.numerator > 3) {
    if (slice.beatInBar === 0) {
      return 1.4;
    }

    return meterInfo.beatsPerBar > 2 && slice.beatInBar === Math.floor(meterInfo.beatsPerBar / 2) ? 1.0 : 0.8;
  }

  if (meterInfo.beatsPerBar === 4) {
    if (slice.beatInBar === 0) {
      return 1.5;
    }

    if (slice.beatInBar === 2) {
      return 1.15;
    }

    return 0.8;
  }

  if (meterInfo.beatsPerBar === 3) {
    return slice.beatInBar === 0 ? 1.45 : 0.8;
  }

  if (meterInfo.beatsPerBar === 2) {
    return slice.beatInBar === 0 ? 1.45 : 1.0;
  }

  return slice.beatInBar === 0 ? 1.35 : 0.9;
}

function rhythmFamilyMultiplier(parsedTune, slice) {
  var typeName = String(parsedTune.type || "").toLowerCase();

  if (parsedTune.meterInfo.raw === "4/4" && ["reel", "hornpipe", "strathspey", "march"].indexOf(typeName) !== -1) {
    if (slice.beatInBar === 0) {
      return 1.25;
    }

    if (slice.beatInBar === 2) {
      return 1.15;
    }
  }

  if (parsedTune.meterInfo.raw === "2/4" && typeName === "polka") {
    return slice.beatInBar === 0 ? 1.20 : 1.05;
  }

  if (parsedTune.meterInfo.raw === "3/4" && typeName === "waltz") {
    return slice.beatInBar === 0 ? 1.25 : 0.95;
  }

  return 1;
}

function scoreStrongBeatOnsetFit(token, slice, parsedTune, modeInfo, chordTones, scalePitchClasses) {
  if (!slice.subPulsePcs || !slice.subPulsePcs.onset || !slice.subPulsePcs.onset.length) {
    return 0;
  }

  var onsetPcs = slice.subPulsePcs.onset;
  var strength = beatStrength(slice, parsedTune.meterInfo) * rhythmFamilyMultiplier(parsedTune, slice);
  var chordWeight = 1.15 * strength;
  var scaleWeight = 0.12 * strength;
  var clashPenalty = -1.55 * strength;
  var score = 0;
  var hasChordTone = false;
  var i;

  for (i = 0; i < onsetPcs.length; i += 1) {
    if (chordTones.indexOf(onsetPcs[i]) !== -1) {
      hasChordTone = true;
    }

    score += scorePitchClassFit(
      onsetPcs[i],
      chordTones,
      scalePitchClasses,
      chordWeight,
      scaleWeight,
      clashPenalty
    );
  }

  if (strength >= 1.35 && !hasChordTone) {
    score -= 0.70 * strength;
  }

  return score;
}

function scoreJigPulseFit(token, slice, parsedTune, modeInfo, chordTones, scalePitchClasses) {
  if (!isJigPulseTune(parsedTune) || !slice.subPulsePcs) {
    return 0;
  }

  var onsetPcs = slice.subPulsePcs.onset || [];
  var thirdPcs = slice.subPulsePcs.third || [];
  var isBarAccent = slice.beatInBar === 0;
  var onsetChordWeight = isBarAccent ? 2.35 : 1.75;
  var onsetScaleWeight = isBarAccent ? -0.05 : 0.10;
  var onsetClashPenalty = isBarAccent ? -2.70 : -2.00;
  var thirdChordWeight = isBarAccent ? 1.20 : 0.85;
  var thirdScaleWeight = 0.10;
  var thirdClashPenalty = isBarAccent ? -1.20 : -0.85;
  var score = 0;
  var onsetHasChordTone = false;
  var i;

  for (i = 0; i < onsetPcs.length; i += 1) {
    if (chordTones.indexOf(onsetPcs[i]) !== -1) {
      onsetHasChordTone = true;
    }

    score += scorePitchClassFit(
      onsetPcs[i],
      chordTones,
      scalePitchClasses,
      onsetChordWeight,
      onsetScaleWeight,
      onsetClashPenalty
    );
  }

  for (i = 0; i < thirdPcs.length; i += 1) {
    score += scorePitchClassFit(
      thirdPcs[i],
      chordTones,
      scalePitchClasses,
      thirdChordWeight,
      thirdScaleWeight,
      thirdClashPenalty
    );
  }

  if (isBarAccent && onsetPcs.length && !onsetHasChordTone) {
    score -= 0.90;
  }

  return score;
}

function scoreSimpleMeterPulseFit(token, slice, parsedTune, modeInfo, chordTones, scalePitchClasses) {
  if (!isSimpleMeterPulseTune(parsedTune) || !slice.subPulsePcs) {
    return 0;
  }

  var onsetPcs = slice.subPulsePcs.onset || [];
  var middlePcs = slice.subPulsePcs.middle || [];
  var strength = beatStrength(slice, parsedTune.meterInfo) * rhythmFamilyMultiplier(parsedTune, slice);
  var onsetChordWeight = 1.25 * strength;
  var onsetScaleWeight = 0.10 * strength;
  var onsetClashPenalty = -1.70 * strength;
  var middleChordWeight = 0.45 * strength;
  var middleScaleWeight = 0.18;
  var middleClashPenalty = -0.45 * Math.min(strength, 1.15);
  var onsetHasChordTone = false;
  var score = 0;
  var i;

  for (i = 0; i < onsetPcs.length; i += 1) {
    if (chordTones.indexOf(onsetPcs[i]) !== -1) {
      onsetHasChordTone = true;
    }

    score += scorePitchClassFit(
      onsetPcs[i],
      chordTones,
      scalePitchClasses,
      onsetChordWeight,
      onsetScaleWeight,
      onsetClashPenalty
    );
  }

  for (i = 0; i < middlePcs.length; i += 1) {
    score += scorePitchClassFit(
      middlePcs[i],
      chordTones,
      scalePitchClasses,
      middleChordWeight,
      middleScaleWeight,
      middleClashPenalty
    );
  }

  if (strength >= 1.30 && onsetPcs.length && !onsetHasChordTone) {
    score -= 0.55 * strength;
  }

  return score;
}

function scoreSlotProfileEmission(model, token, slice, chordTones, scalePitchClasses, decoderProfile) {
  var slotBuckets = model.counts.slotEmissions[token] || {};
  var learnedFallback = model.counts.emissions[token] || {};
  var score = 0;

  (slice.slotProfiles || []).forEach(function (slotProfile) {
    var slotWeight = decoderProfile.slotWeights[slotProfile.label];
    var learnedBucket = slotBuckets[slotProfile.label] || learnedFallback;

    if (!slotWeight) {
      return;
    }

    Object.keys(slotProfile.noteWeights || {}).forEach(function (pcKey) {
      var relativePc = parseInt(pcKey, 10);
      var noteWeight = slotProfile.noteWeights[pcKey];
      var theoryScore = scorePitchClassFit(relativePc, chordTones, scalePitchClasses, 1.15, 0.22, -0.95);
      var learnedScore = logProbability(learnedBucket, pcKey, 0.5, learnedFallback);

      score += slotWeight * noteWeight * (
        (decoderProfile.slotTheoryWeight * theoryScore) +
        (decoderProfile.slotLearnedWeight * learnedScore)
      );
    });
  });

  return score;
}

function scoreEmission(model, token, slice, modeInfo, parsedTune, decoderProfile) {
  var pcs = Object.keys(slice.noteWeights);
  if (pcs.length === 0) {
    return 0;
  }

  var learnedBucket = model.counts.emissions[token] || {};
  var learnedFallback = model.counts.chordTotals;
  var scalePitchClasses = buildScalePitchClassSet(modeInfo);
  var chordTones = theory.chordTonesForToken(token, modeInfo);
  var i;

  var score = 0;
  for (i = 0; i < pcs.length; i += 1) {
    var relativePc = parseInt(pcs[i], 10);
    var weight = slice.noteWeights[pcs[i]];
    var theoryScore = -0.75;

    if (chordTones.indexOf(relativePc) !== -1) {
      theoryScore = 1.3;
    } else if (scalePitchClasses[relativePc]) {
      theoryScore = 0.35;
    }

    score += weight * ((0.75 * theoryScore) + (0.25 * logProbability(learnedBucket, String(relativePc), 0.5, learnedFallback)));
  }

  score += scoreStrongBeatOnsetFit(token, slice, parsedTune, modeInfo, chordTones, scalePitchClasses);
  score += scoreJigPulseFit(token, slice, parsedTune, modeInfo, chordTones, scalePitchClasses);
  score += scoreSimpleMeterPulseFit(token, slice, parsedTune, modeInfo, chordTones, scalePitchClasses);
  score += scoreSlotProfileEmission(model, token, slice, chordTones, scalePitchClasses, decoderProfile || buildDecoderProfile(parsedTune));

  return score;
}

function mergeCandidateBucket(output, bucket, limit) {
  Object.keys(bucket || {}).sort(function (left, right) {
    return bucket[right] - bucket[left];
  }).slice(0, limit || 10).forEach(function (token) {
    if (output.indexOf(token) === -1) {
      output.push(token);
    }
  });
}

function getCandidateTokensForSlice(model, parsedTune, slice) {
  var output = [];
  var styleKey = buildStyleKey(parsedTune);
  var typeMeterKey = buildTypeMeterKey(parsedTune);
  var positionKey = buildPositionKey(slice, parsedTune);
  var partPositionKey = buildPartPositionKey(slice, parsedTune);
  var signatureKey = buildSignatureKey(slice, parsedTune);
  var measureSignatureKey = buildMeasureSignatureKey(slice, parsedTune);

  mergeCandidateBucket(output, model.counts.cadencePositions[buildCadenceKey(slice, parsedTune)], 8);
  mergeCandidateBucket(output, model.counts.endingFinalOnsetTokens[buildEndingFinalOnsetKey(slice, parsedTune)], 8);
  mergeCandidateBucket(output, model.counts.onsetMeasureSignatureChordTotals[measureSignatureKey], 10);
  mergeCandidateBucket(output, model.counts.onsetSignatureChordTotals[signatureKey], 10);
  mergeCandidateBucket(output, model.counts.onsetPositionChordTotals[partPositionKey], 10);
  mergeCandidateBucket(output, model.counts.onsetStyleChordTotals[styleKey], 10);
  mergeCandidateBucket(output, model.counts.measureSignatures[measureSignatureKey], 10);
  mergeCandidateBucket(output, model.counts.signatures[signatureKey], 10);
  mergeCandidateBucket(output, model.counts.partPositions[partPositionKey], 10);
  mergeCandidateBucket(output, model.counts.positions[positionKey], 10);
  mergeCandidateBucket(output, model.counts.styleChordTotals[styleKey], 12);
  mergeCandidateBucket(output, model.counts.typeMeterChordTotals[typeMeterKey], 12);
  mergeCandidateBucket(output, model.counts.modeChordTotals[parsedTune.modeInfo.modeFamily], 12);
  mergeCandidateBucket(output, model.counts.chordTotals, 12);
  mergeCandidateBucket(output, theory.buildDiatonicChordTokens(parsedTune.modeInfo).reduce(function (acc, token) {
    acc[token] = 1;
    return acc;
  }, {}), 12);

  return output;
}

function scoreSliceContext(model, token, parsedTune, slice) {
  var styleKey = buildStyleKey(parsedTune);
  var typeMeterBucket = model.counts.typeMeterChordTotals[buildTypeMeterKey(parsedTune)] || {};
  var positionBucket = model.counts.positions[buildPositionKey(slice, parsedTune)] || {};
  var partBucket = model.counts.partPositions[buildPartPositionKey(slice, parsedTune)] || {};
  var signatureBucket = model.counts.signatures[buildSignatureKey(slice, parsedTune)] || {};
  var measureSignatureBucket = model.counts.measureSignatures[buildMeasureSignatureKey(slice, parsedTune)] || {};
  var cadenceBucket = model.counts.cadencePositions[buildCadenceKey(slice, parsedTune)] || {};
  var styleBucket = model.counts.styleChordTotals[styleKey] || {};
  var globalBucket = model.counts.chordTotals;

  return (
    (slice.measuresFromPartEnd !== null && slice.measuresFromPartEnd <= 2 ? (1.10 * logProbability(cadenceBucket, token, 0.8, measureSignatureBucket)) : 0) +
    (1.25 * logProbability(measureSignatureBucket, token, 0.8, signatureBucket)) +
    (1.10 * logProbability(signatureBucket, token, 0.8, styleBucket)) +
    (0.75 * logProbability(styleBucket, token, 0.8, typeMeterBucket)) +
    (0.60 * logProbability(typeMeterBucket, token, 0.8, globalBucket)) +
    (0.75 * logProbability(partBucket, token, 0.8, positionBucket)) +
    (0.60 * logProbability(positionBucket, token, 0.8, styleBucket)) +
    (0.40 * logProbability(styleBucket, token, 0.8, globalBucket))
  );
}

function scoreEndingFinalOnset(model, token, parsedTune, slice) {
  if (slice.isPickup || slice.measuresFromPartEnd !== 0) {
    return 0;
  }

  var endingBucket = model.counts.endingFinalOnsetTokens[buildEndingFinalOnsetKey(slice, parsedTune)] || {};
  var fallbackBucket = model.counts.cadencePositions[buildCadenceKey(slice, parsedTune)] || model.counts.styleChordTotals[buildStyleKey(parsedTune)] || {};

  return 0.85 * logProbability(endingBucket, token, 0.7, fallbackBucket);
}

function scoreChangePreference(model, parsedTune, slice) {
  var styleBucket = model.counts.onsetStyles[buildStyleKey(parsedTune)] || {};
  var typeMeterBucket = model.counts.typeMeterOnsetStyles[buildTypeMeterKey(parsedTune)] || {};
  var positionBucket = model.counts.onsetPositions[buildPositionKey(slice, parsedTune)] || {};
  var partBucket = model.counts.onsetPartPositions[buildPartPositionKey(slice, parsedTune)] || {};
  var signatureBucket = model.counts.onsetSignatures[buildSignatureKey(slice, parsedTune)] || {};
  var measureSignatureBucket = model.counts.onsetMeasureSignatures[buildMeasureSignatureKey(slice, parsedTune)] || {};

  var changeScore = (
    (0.35 * logDecisionProbability(styleBucket, "change", 1.1)) +
    (0.45 * logDecisionProbability(typeMeterBucket, "change", 1.1)) +
    (0.70 * logDecisionProbability(positionBucket, "change", 1.1)) +
    (0.85 * logDecisionProbability(partBucket, "change", 1.1)) +
    (1.10 * logDecisionProbability(signatureBucket, "change", 1.1)) +
    (1.30 * logDecisionProbability(measureSignatureBucket, "change", 1.1))
  );

  var stayScore = (
    (0.35 * logDecisionProbability(styleBucket, "stay", 1.1)) +
    (0.45 * logDecisionProbability(typeMeterBucket, "stay", 1.1)) +
    (0.70 * logDecisionProbability(positionBucket, "stay", 1.1)) +
    (0.85 * logDecisionProbability(partBucket, "stay", 1.1)) +
    (1.10 * logDecisionProbability(signatureBucket, "stay", 1.1)) +
    (1.30 * logDecisionProbability(measureSignatureBucket, "stay", 1.1))
  );

  return clamp(changeScore - stayScore + ((beatStrength(slice, parsedTune.meterInfo) - 1) * 0.35), -2.4, 2.4);
}

function buildMeasurePatternHints(model, parsedTune) {
  var hints = {};

  parsedTune.beatSlices.forEach(function (slice) {
    if (slice.isPickup || slice.beatInBar === null || hints[slice.rawBarIndex]) {
      return;
    }

    var bucket = model.counts.measurePatterns[buildMeasurePatternKey(slice, parsedTune)] || {};
    var topPattern = selectTopKey(bucket);
    var hint = {};

    if (topPattern) {
      topPattern.split("/").forEach(function (piece) {
        var equalIndex = piece.indexOf("=");
        if (equalIndex === -1) {
          return;
        }

        hint[piece.slice(0, equalIndex)] = piece.slice(equalIndex + 1);
      });
    }

    hints[slice.rawBarIndex] = hint;
  });

  return hints;
}

function buildOnsetMeasurePatternHints(model, parsedTune) {
  var hints = {};

  parsedTune.beatSlices.forEach(function (slice) {
    if (slice.isPickup || slice.beatInBar === null || hints[slice.rawBarIndex]) {
      return;
    }

    var bucket = model.counts.onsetMeasurePatterns[buildMeasurePatternKey(slice, parsedTune)] || {};
    var topPattern = selectTopKey(bucket);
    var hint = {};

    if (topPattern) {
      topPattern.split("/").forEach(function (piece) {
        var equalIndex = piece.indexOf("=");
        if (equalIndex === -1) {
          return;
        }

        hint[piece.slice(0, equalIndex)] = piece.slice(equalIndex + 1);
      });
    }

    hints[slice.rawBarIndex] = hint;
  });

  return hints;
}

function buildEndingPatternHints(model, parsedTune, bucketName) {
  var output = {};
  var processedBlocks = {};

  parsedTune.beatSlices.forEach(function (slice) {
    if (slice.isPickup || slice.beatInBar === null || slice.measuresFromPartEnd === null || slice.measuresFromPartEnd > 1) {
      return;
    }

    var blockKey = slice.partIndex + "|" + slice.partPass;
    if (processedBlocks[blockKey]) {
      return;
    }
    processedBlocks[blockKey] = true;

    var bucket = model.counts[bucketName][buildEndingPatternKey(slice, parsedTune)] || {};
    var topPattern = selectTopKey(bucket);
    if (!topPattern) {
      return;
    }

    var hintMap = {};
    topPattern.split("/").forEach(function (piece) {
      var equalIndex = piece.indexOf("=");
      if (equalIndex === -1) {
        return;
      }

      hintMap[piece.slice(0, equalIndex)] = piece.slice(equalIndex + 1);
    });

    parsedTune.beatSlices.forEach(function (candidateSlice) {
      if (candidateSlice.partIndex !== slice.partIndex || candidateSlice.partPass !== slice.partPass) {
        return;
      }

      if (candidateSlice.isPickup || candidateSlice.beatInBar === null || candidateSlice.measuresFromPartEnd === null || candidateSlice.measuresFromPartEnd > 1) {
        return;
      }

      var slotKey = buildPartSlotKey(candidateSlice.partIndex, candidateSlice.measureInPart, candidateSlice.beatInBar);
      output[slotKey] = hintMap[buildEndingPatternSlotId(candidateSlice)] || null;
    });
  });

  return output;
}

function buildExactMelodyPathHints(model, parsedTune) {
  var bucket = model.counts.exactMelodyPaths[parsedTune.melodyFingerprint] || {};
  var topPath = selectTopKey(bucket);

  if (!topPath) {
    return {};
  }

  return topPath.split("/").reduce(function (acc, token, index) {
    acc[index] = token;
    return acc;
  }, {});
}

function buildFuzzyPartHints(model, parsedTune) {
  var output = {};
  var entries = model.counts.fuzzyPartLibrary || [];
  var topMatches = [];

  if (!parsedTune.partFingerprints || !parsedTune.partFingerprints.length || !entries.length) {
    return output;
  }

  parsedTune.partFingerprints.forEach(function (targetPart) {
    entries.forEach(function (entry) {
      if (entry.typeMeterKey !== buildTypeMeterKey(parsedTune)) {
        return;
      }

      var similarity = scorePartFingerprintSimilarity(targetPart.measureSignatures, entry.measureSignatures);
      if (!isFinite(similarity) || similarity <= 1.5) {
        return;
      }

      if (entry.modeFamily === parsedTune.modeInfo.modeFamily) {
        similarity += 0.8;
      }

      if (entry.partIndex === targetPart.partIndex) {
        similarity += 0.35;
      }

      topMatches.push({
        partIndex: targetPart.partIndex,
        similarity: similarity,
        slots: entry.slots,
        weight: entry.weight || 1
      });
    });
  });

  topMatches.sort(function (left, right) {
    return right.similarity - left.similarity;
  });

  topMatches.slice(0, 8).forEach(function (match) {
    Object.keys(match.slots || {}).forEach(function (slotKey) {
      var parts = slotKey.split("|");
      var targetSlotKey = buildPartSlotKey(match.partIndex, parseInt(parts[1], 10), parseInt(parts[2], 10));

      if (!output[targetSlotKey]) {
        output[targetSlotKey] = {};
      }

      incrementCount(output[targetSlotKey], match.slots[slotKey], match.similarity * (match.weight || 1));
    });
  });

  return output;
}

function buildFuzzyTuneHints(model, parsedTune) {
  var entries = model.counts.fuzzyTuneLibrary || [];
  var output = {
    tokens: {},
    onsets: {}
  };
  var targetSignatures = buildTuneMeasureSignatures(parsedTune);
  var rankedMatches = [];

  if (!entries.length || !targetSignatures.length) {
    return output;
  }

  entries.forEach(function (entry) {
    if (entry.typeMeterKey !== buildTypeMeterKey(parsedTune)) {
      return;
    }

    if (entry.measureSignatures.length < Math.max(2, targetSignatures.length - 4) ||
        entry.measureSignatures.length > targetSignatures.length + 4) {
      return;
    }

    var similarity = scoreTuneFingerprintSimilarity(targetSignatures, entry.measureSignatures);
    if (!isFinite(similarity) || similarity <= 4.0) {
      return;
    }

    if (entry.modeFamily === parsedTune.modeInfo.modeFamily) {
      similarity += 0.9;
    }

    if ((entry.partCount || 0) === ((parsedTune.partFingerprints || []).length || 0)) {
      similarity += 0.45;
    }

    rankedMatches.push({
      similarity: similarity,
      slots: entry.slots || {},
      onsets: entry.onsets || {},
      weight: entry.weight || 1
    });
  });

  rankedMatches.sort(function (left, right) {
    return right.similarity - left.similarity;
  });

  rankedMatches.slice(0, 6).forEach(function (match) {
    Object.keys(match.slots).forEach(function (slotKey) {
      if (!output.tokens[slotKey]) {
        output.tokens[slotKey] = {};
      }

      incrementCount(output.tokens[slotKey], match.slots[slotKey], match.similarity * match.weight);
    });

    Object.keys(match.onsets).forEach(function (slotKey) {
      if (!output.onsets[slotKey]) {
        output.onsets[slotKey] = {};
      }

      incrementCount(output.onsets[slotKey], match.onsets[slotKey], match.similarity * match.weight);
    });
  });

  return output;
}

function getTransitionBucket(model, styleKey, previousToken) {
  var styleParts = String(styleKey).split("|");
  var typeMeterKey = styleParts.slice(0, 2).join("|");
  var styleTransitions = model.counts.styleTransitions[styleKey] || {};
  var typeMeterTransitions = model.counts.typeMeterTransitions[typeMeterKey] || {};
  return styleTransitions[previousToken] || typeMeterTransitions[previousToken] || model.counts.transitions[previousToken];
}

function getCandidateTokens(model, parsedTune) {
  var modeInfo = parsedTune.modeInfo;
  var modeBucket = model.counts.modeChordTotals[modeInfo.modeFamily] || {};
  var typeMeterBucket = model.counts.typeMeterChordTotals[buildTypeMeterKey(parsedTune)] || {};
  var ranked = Object.keys(modeBucket).sort(function (left, right) {
    return modeBucket[right] - modeBucket[left];
  });
  var output = [];
  mergeCandidateBucket(output, typeMeterBucket, 14);
  Array.prototype.push.apply(output, ranked.slice(0, 14).filter(function (token) {
    return output.indexOf(token) === -1;
  }));
  var diatonic = theory.buildDiatonicChordTokens(modeInfo);
  var i;

  for (i = 0; i < diatonic.length; i += 1) {
    if (output.indexOf(diatonic[i]) === -1) {
      output.push(diatonic[i]);
    }
  }

  if (output.length === 0) {
    return diatonic;
  }

  return output;
}

function predictChordPath(model, parsedTune) {
  var decoderProfile = buildDecoderProfile(parsedTune);
  var globalCandidates = getCandidateTokens(model, parsedTune);
  var layers = [];
  var styleKey = buildStyleKey(parsedTune);
  var measurePatternHints = buildMeasurePatternHints(model, parsedTune);
  var onsetMeasurePatternHints = buildOnsetMeasurePatternHints(model, parsedTune);
  var endingTokenHints = buildEndingPatternHints(model, parsedTune, "endingTokenPatterns");
  var endingOnsetHints = buildEndingPatternHints(model, parsedTune, "endingOnsetPatterns");
  var exactMelodyPathHints = buildExactMelodyPathHints(model, parsedTune);
  var fuzzyPartHints = buildFuzzyPartHints(model, parsedTune);
  var fuzzyTuneHints = buildFuzzyTuneHints(model, parsedTune);
  var i;
  var j;

  for (i = 0; i < parsedTune.beatSlices.length; i += 1) {
    var slice = parsedTune.beatSlices[i];
    var candidates = getCandidateTokensForSlice(model, parsedTune, slice);
    var measureHintToken = (measurePatternHints[slice.rawBarIndex] || {})[String(slice.beatInBar)];
    var previousMeasureHintToken = null;
    var exactHintToken = exactMelodyPathHints[i] || null;
    var fuzzySlotKey = buildPartSlotKey(slice.partIndex, slice.measureInPart, slice.beatInBar);
    var fuzzyHintBucket = fuzzyPartHints[fuzzySlotKey] || {};
    var fuzzyHintToken = selectTopKey(fuzzyHintBucket);
    var fuzzyTuneOnsetBucket = fuzzyTuneHints.onsets[fuzzySlotKey] || {};
    var fuzzyTuneOnsetHint = selectTopKey(fuzzyTuneOnsetBucket);
    var endingTokenHint = endingTokenHints[fuzzySlotKey] || null;
    var endingOnsetHint = endingOnsetHints[fuzzySlotKey] || null;
    var previousFuzzyHintToken = null;
    var onsetMeasureHint = (onsetMeasurePatternHints[slice.rawBarIndex] || {})[String(slice.beatInBar)] || null;
    var previousExactHintToken = i > 0 ? (exactMelodyPathHints[i - 1] || null) : null;
    var exactOnsetHint = null;
    var fuzzyOnsetHint = null;
    var measureOnsetHint = null;
    var changePreference = i === 0 ? (2.4 * decoderProfile.changeWeight) : (decoderProfile.changeWeight * scoreChangePreference(model, parsedTune, slice));

    if (i > 0) {
      var previousSlice = parsedTune.beatSlices[i - 1];
      previousMeasureHintToken = (measurePatternHints[previousSlice.rawBarIndex] || {})[String(previousSlice.beatInBar)] || null;
      var previousFuzzySlotKey = buildPartSlotKey(previousSlice.partIndex, previousSlice.measureInPart, previousSlice.beatInBar);
      previousFuzzyHintToken = selectTopKey(fuzzyPartHints[previousFuzzySlotKey] || {});
    }

    if (exactHintToken && previousExactHintToken) {
      exactOnsetHint = exactHintToken === previousExactHintToken ? "stay" : "change";
    } else if (i === 0 && exactHintToken) {
      exactOnsetHint = "change";
    }

    if (fuzzyHintToken && previousFuzzyHintToken) {
      fuzzyOnsetHint = fuzzyHintToken === previousFuzzyHintToken ? "stay" : "change";
    } else if (i === 0 && fuzzyHintToken) {
      fuzzyOnsetHint = "change";
    }

    if (measureHintToken && previousMeasureHintToken) {
      measureOnsetHint = measureHintToken === previousMeasureHintToken ? "stay" : "change";
    } else if (i === 0 && measureHintToken) {
      measureOnsetHint = "change";
    }

    if (onsetMeasureHint === "change") {
      changePreference += 0.70;
    } else if (onsetMeasureHint === "stay") {
      changePreference -= 0.70;
    }

    if (exactOnsetHint === "change") {
      changePreference += 0.95;
    } else if (exactOnsetHint === "stay") {
      changePreference -= 0.95;
    }

    if (fuzzyOnsetHint === "change") {
      changePreference += 0.38;
    } else if (fuzzyOnsetHint === "stay") {
      changePreference -= 0.38;
    }

    if (fuzzyTuneOnsetHint === "change") {
      changePreference += 0.44;
    } else if (fuzzyTuneOnsetHint === "stay") {
      changePreference -= 0.44;
    }

    if (endingOnsetHint === "change") {
      changePreference += 0.46;
    } else if (endingOnsetHint === "stay") {
      changePreference -= 0.46;
    }

    if (measureOnsetHint === "change") {
      changePreference += 0.24;
    } else if (measureOnsetHint === "stay") {
      changePreference -= 0.24;
    }

    changePreference = clamp(changePreference, -3.1, 3.1);

    if (measureHintToken && candidates.indexOf(measureHintToken) === -1) {
      candidates.unshift(measureHintToken);
    }

    if (exactHintToken && candidates.indexOf(exactHintToken) === -1) {
      candidates.unshift(exactHintToken);
    }

    if (fuzzyHintToken && candidates.indexOf(fuzzyHintToken) === -1) {
      candidates.unshift(fuzzyHintToken);
    }

    if (endingTokenHint && candidates.indexOf(endingTokenHint) === -1) {
      candidates.unshift(endingTokenHint);
    }

    if (candidates.length === 0) {
      candidates = globalCandidates;
    }
    var currentLayer = {};

    for (j = 0; j < candidates.length; j += 1) {
      var token = candidates[j];
      var emissionScore = scoreEmission(model, token, slice, parsedTune.modeInfo, parsedTune, decoderProfile);
      var sliceContextScore = scoreSliceContext(model, token, parsedTune, slice);
      var endingFinalOnsetScore = scoreEndingFinalOnset(model, token, parsedTune, slice);
      var measurePatternBonus = 0;
      var exactMelodyBonus = 0;
      var fuzzyPartBonus = 0;
      var endingTokenBonus = 0;
      var hintedToken = measureHintToken;

      if (hintedToken && hintedToken === token) {
        measurePatternBonus = decoderProfile.measurePatternBonus;
      }

      if (exactHintToken && exactHintToken === token) {
        exactMelodyBonus = decoderProfile.exactHintBonus;
      }

      if (fuzzyHintToken && fuzzyHintToken === token) {
        fuzzyPartBonus = Math.min(2.0, decoderProfile.fuzzyHintWeight * (fuzzyHintBucket[token] || 0));
      }

      if (endingTokenHint && endingTokenHint === token) {
        endingTokenBonus = slice.measuresFromPartEnd === 0 ? 1.05 : 0.72;
      }

      if (i === 0) {
        var startTransition = logProbability(getTransitionBucket(model, styleKey, "__START__"), token, 0.8, model.counts.chordTotals);
        currentLayer[token] = {
          score: (decoderProfile.emissionWeight * emissionScore) + (decoderProfile.contextWeight * sliceContextScore) + endingFinalOnsetScore + (decoderProfile.startTransitionWeight * startTransition) + measurePatternBonus + exactMelodyBonus + fuzzyPartBonus + endingTokenBonus,
          previous: null
        };
        continue;
      }

      var bestPrevious = null;
      var bestScore = -Infinity;
      var previousLayer = layers[i - 1];
      var previousTokens = Object.keys(previousLayer);
      var k;

      for (k = 0; k < previousTokens.length; k += 1) {
        var previousToken = previousTokens[k];
        var transitionScore = logProbability(getTransitionBucket(model, styleKey, previousToken), token, 0.8, model.counts.chordTotals);
        var stayBonus = previousToken === token ? decoderProfile.stayBonus : 0;
        var changeBonus = previousToken === token ? (-1 * changePreference) : changePreference;
        var candidateScore = previousLayer[previousToken].score + (decoderProfile.emissionWeight * emissionScore) + (decoderProfile.contextWeight * sliceContextScore) + endingFinalOnsetScore + (decoderProfile.transitionWeight * transitionScore) + stayBonus + changeBonus + measurePatternBonus + exactMelodyBonus + fuzzyPartBonus + endingTokenBonus;

        if (i === parsedTune.beatSlices.length - 1 && token.indexOf("1:") === 0) {
          candidateScore += decoderProfile.finalTonicBonus;
        }

        if (candidateScore > bestScore) {
          bestScore = candidateScore;
          bestPrevious = previousToken;
        }
      }

      currentLayer[token] = {
        score: bestScore,
        previous: bestPrevious
      };
    }

    layers.push(currentLayer);
  }

  var path = [];
  var lastLayer = layers[layers.length - 1];
  var bestEndingToken = null;
  var bestEndingScore = -Infinity;
  var endingTokens = Object.keys(lastLayer);

  for (i = 0; i < endingTokens.length; i += 1) {
    var endingToken = endingTokens[i];
    if (lastLayer[endingToken].score > bestEndingScore) {
      bestEndingScore = lastLayer[endingToken].score;
      bestEndingToken = endingToken;
    }
  }

  for (i = layers.length - 1; i >= 0; i -= 1) {
    path.unshift(bestEndingToken);
    bestEndingToken = layers[i][bestEndingToken].previous;
  }

  return path;
}

function predictForTune(model, options) {
  var parsedTune = abcParser.parseAbcTune(options);
  var path = predictChordPath(model, parsedTune);

  return path.map(function (token, index) {
    return {
      beatNumber: index,
      barIndex: parsedTune.beatSlices[index].barIndex,
      measureNumber: parsedTune.beatSlices[index].measureNumber,
      beatInBar: parsedTune.beatSlices[index].beatInBar,
      isPickup: parsedTune.beatSlices[index].isPickup,
      token: token,
      displayChord: theory.chordTokenToDisplayName(token, parsedTune.modeInfo),
      anchorIndex: parsedTune.beatSlices[index].anchorIndex
    };
  });
}

module.exports = {
  createEmptyModel: createEmptyModel,
  predictForTune: predictForTune,
  trainOnRow: trainOnRow,
  trainOnRows: trainOnRows
};
