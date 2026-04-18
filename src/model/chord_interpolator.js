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
      transitions: {},
      styleTransitions: {},
      positions: {},
      partPositions: {},
      signatures: {},
      measureSignatures: {},
      measurePatterns: {},
      onsetStyles: {},
      onsetPositions: {},
      onsetPartPositions: {},
      onsetSignatures: {},
      onsetMeasureSignatures: {},
      onsetStyleChordTotals: {},
      onsetPositionChordTotals: {},
      onsetSignatureChordTotals: {},
      onsetMeasureSignatureChordTotals: {},
      emissions: {},
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

function buildSignatureKey(slice, parsedTune) {
  var pcs = Object.keys(slice.noteWeights).sort(function (left, right) {
    var weightDiff = slice.noteWeights[right] - slice.noteWeights[left];
    if (weightDiff !== 0) {
      return weightDiff;
    }
    return parseInt(left, 10) - parseInt(right, 10);
  }).slice(0, 3);

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

function trainOnParsedTune(model, parsedTune) {
  var usableLabels = 0;
  var previousToken = "__START__";
  var previousObservedToken = null;
  var styleKey = buildStyleKey(parsedTune);
  var measurePatterns = {};
  var i;

  for (i = 0; i < parsedTune.beatSlices.length; i += 1) {
    var slice = parsedTune.beatSlices[i];
    var normalized = slice.chord ? theory.normalizeChord(slice.chord.raw, parsedTune.modeInfo) : null;
    var truthChange = previousObservedToken === null || normalized && normalized.token !== previousObservedToken;
    var onsetKey = onsetLabel(truthChange);

    if (!normalized) {
      continue;
    }

    usableLabels += 1;
    incrementCount(model.counts.chordTotals, normalized.token, 1);
    incrementCount(ensureNestedMap(model.counts.modeChordTotals, parsedTune.modeInfo.modeFamily), normalized.token, 1);
    incrementCount(ensureNestedMap(model.counts.styleChordTotals, styleKey), normalized.token, 1);
    incrementCount(ensureNestedMap(model.counts.transitions, previousToken), normalized.token, 1);
    incrementCount(ensureNestedMap(ensureNestedMap(model.counts.styleTransitions, styleKey), previousToken), normalized.token, 1);
    incrementCount(ensureNestedMap(model.counts.positions, buildPositionKey(slice, parsedTune)), normalized.token, 1);
    incrementCount(ensureNestedMap(model.counts.partPositions, buildPartPositionKey(slice, parsedTune)), normalized.token, 1);
    incrementCount(ensureNestedMap(model.counts.signatures, buildSignatureKey(slice, parsedTune)), normalized.token, 1);
    incrementCount(ensureNestedMap(model.counts.measureSignatures, buildMeasureSignatureKey(slice, parsedTune)), normalized.token, 1);
    incrementCount(model.counts.tuneTypes, parsedTune.type || "unknown", 1);
    incrementCount(ensureNestedMap(model.counts.onsetStyles, styleKey), onsetKey, 1);
    incrementCount(ensureNestedMap(model.counts.onsetPositions, buildPositionKey(slice, parsedTune)), onsetKey, 1);
    incrementCount(ensureNestedMap(model.counts.onsetPartPositions, buildPartPositionKey(slice, parsedTune)), onsetKey, 1);
    incrementCount(ensureNestedMap(model.counts.onsetSignatures, buildSignatureKey(slice, parsedTune)), onsetKey, 1);
    incrementCount(ensureNestedMap(model.counts.onsetMeasureSignatures, buildMeasureSignatureKey(slice, parsedTune)), onsetKey, 1);

    if (truthChange) {
      incrementCount(ensureNestedMap(model.counts.onsetStyleChordTotals, styleKey), normalized.token, 1);
      incrementCount(ensureNestedMap(model.counts.onsetPositionChordTotals, buildPartPositionKey(slice, parsedTune)), normalized.token, 1);
      incrementCount(ensureNestedMap(model.counts.onsetSignatureChordTotals, buildSignatureKey(slice, parsedTune)), normalized.token, 1);
      incrementCount(ensureNestedMap(model.counts.onsetMeasureSignatureChordTotals, buildMeasureSignatureKey(slice, parsedTune)), normalized.token, 1);
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
    }

    var emissionBucket = ensureNestedMap(model.counts.emissions, normalized.token);
    var totalWeight = 0;
    var pcs = Object.keys(slice.noteWeights);
    var j;

    for (j = 0; j < pcs.length; j += 1) {
      var relativePc = pcs[j];
      var weight = slice.noteWeights[relativePc];
      incrementCount(emissionBucket, relativePc, weight);
      totalWeight += weight;
    }

    incrementCount(model.counts.emissionTotals, normalized.token, totalWeight);
    previousToken = normalized.token;
    previousObservedToken = normalized.token;
  }

  Object.keys(measurePatterns).forEach(function (id) {
    var pattern = measurePatterns[id];
    incrementCount(ensureNestedMap(model.counts.measurePatterns, pattern.key), pattern.beats.join("/"), 1);
  });

  if (usableLabels > 0) {
    model.metadata.trainedTunes += 1;
    model.metadata.labeledBeats += usableLabels;
  } else {
    model.metadata.skippedTunes += 1;
  }
}

function trainOnRow(model, row) {
  if (!row || !row.abc || row.abc.indexOf("\"") === -1) {
    return false;
  }

  var parsedTune = abcParser.parseAbcTune({
    abc: row.abc,
    meter: row.meter,
    mode: row.mode,
    type: row.type
  });

  trainOnParsedTune(model, parsedTune);
  return true;
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

function scoreEmission(model, token, slice, modeInfo) {
  var pcs = Object.keys(slice.noteWeights);
  if (pcs.length === 0) {
    return 0;
  }

  var learnedBucket = model.counts.emissions[token] || {};
  var learnedFallback = model.counts.chordTotals;
  var scalePitchClasses = {};
  var chordTones = theory.chordTonesForToken(token, modeInfo);
  var i;

  for (i = 0; i < modeInfo.scaleSemitones.length; i += 1) {
    scalePitchClasses[modeInfo.scaleSemitones[i]] = true;
  }

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
  var positionKey = buildPositionKey(slice, parsedTune);
  var partPositionKey = buildPartPositionKey(slice, parsedTune);
  var signatureKey = buildSignatureKey(slice, parsedTune);
  var measureSignatureKey = buildMeasureSignatureKey(slice, parsedTune);

  mergeCandidateBucket(output, model.counts.onsetMeasureSignatureChordTotals[measureSignatureKey], 10);
  mergeCandidateBucket(output, model.counts.onsetSignatureChordTotals[signatureKey], 10);
  mergeCandidateBucket(output, model.counts.onsetPositionChordTotals[partPositionKey], 10);
  mergeCandidateBucket(output, model.counts.onsetStyleChordTotals[styleKey], 10);
  mergeCandidateBucket(output, model.counts.measureSignatures[measureSignatureKey], 10);
  mergeCandidateBucket(output, model.counts.signatures[signatureKey], 10);
  mergeCandidateBucket(output, model.counts.partPositions[partPositionKey], 10);
  mergeCandidateBucket(output, model.counts.positions[positionKey], 10);
  mergeCandidateBucket(output, model.counts.styleChordTotals[styleKey], 12);
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
  var positionBucket = model.counts.positions[buildPositionKey(slice, parsedTune)] || {};
  var partBucket = model.counts.partPositions[buildPartPositionKey(slice, parsedTune)] || {};
  var signatureBucket = model.counts.signatures[buildSignatureKey(slice, parsedTune)] || {};
  var measureSignatureBucket = model.counts.measureSignatures[buildMeasureSignatureKey(slice, parsedTune)] || {};
  var styleBucket = model.counts.styleChordTotals[styleKey] || {};
  var globalBucket = model.counts.chordTotals;

  return (
    (1.25 * logProbability(measureSignatureBucket, token, 0.8, signatureBucket)) +
    (1.10 * logProbability(signatureBucket, token, 0.8, styleBucket)) +
    (0.75 * logProbability(partBucket, token, 0.8, positionBucket)) +
    (0.60 * logProbability(positionBucket, token, 0.8, styleBucket)) +
    (0.55 * logProbability(styleBucket, token, 0.8, globalBucket))
  );
}

function scoreChangePreference(model, parsedTune, slice) {
  var styleBucket = model.counts.onsetStyles[buildStyleKey(parsedTune)] || {};
  var positionBucket = model.counts.onsetPositions[buildPositionKey(slice, parsedTune)] || {};
  var partBucket = model.counts.onsetPartPositions[buildPartPositionKey(slice, parsedTune)] || {};
  var signatureBucket = model.counts.onsetSignatures[buildSignatureKey(slice, parsedTune)] || {};
  var measureSignatureBucket = model.counts.onsetMeasureSignatures[buildMeasureSignatureKey(slice, parsedTune)] || {};

  var changeScore = (
    (0.55 * logDecisionProbability(styleBucket, "change", 1.1)) +
    (0.70 * logDecisionProbability(positionBucket, "change", 1.1)) +
    (0.85 * logDecisionProbability(partBucket, "change", 1.1)) +
    (1.10 * logDecisionProbability(signatureBucket, "change", 1.1)) +
    (1.30 * logDecisionProbability(measureSignatureBucket, "change", 1.1))
  );

  var stayScore = (
    (0.55 * logDecisionProbability(styleBucket, "stay", 1.1)) +
    (0.70 * logDecisionProbability(positionBucket, "stay", 1.1)) +
    (0.85 * logDecisionProbability(partBucket, "stay", 1.1)) +
    (1.10 * logDecisionProbability(signatureBucket, "stay", 1.1)) +
    (1.30 * logDecisionProbability(measureSignatureBucket, "stay", 1.1))
  );

  return clamp(changeScore - stayScore, -2.4, 2.4);
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

function getTransitionBucket(model, styleKey, previousToken) {
  var styleTransitions = model.counts.styleTransitions[styleKey] || {};
  return styleTransitions[previousToken] || model.counts.transitions[previousToken];
}

function getCandidateTokens(model, modeInfo) {
  var modeBucket = model.counts.modeChordTotals[modeInfo.modeFamily] || {};
  var ranked = Object.keys(modeBucket).sort(function (left, right) {
    return modeBucket[right] - modeBucket[left];
  });
  var output = ranked.slice(0, 14);
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
  var globalCandidates = getCandidateTokens(model, parsedTune.modeInfo);
  var layers = [];
  var styleKey = buildStyleKey(parsedTune);
  var measurePatternHints = buildMeasurePatternHints(model, parsedTune);
  var i;
  var j;

  for (i = 0; i < parsedTune.beatSlices.length; i += 1) {
    var slice = parsedTune.beatSlices[i];
    var candidates = getCandidateTokensForSlice(model, parsedTune, slice);
    var measureHintToken = (measurePatternHints[slice.rawBarIndex] || {})[String(slice.beatInBar)];
    var changePreference = i === 0 ? 2.4 : scoreChangePreference(model, parsedTune, slice);

    if (measureHintToken && candidates.indexOf(measureHintToken) === -1) {
      candidates.unshift(measureHintToken);
    }

    if (candidates.length === 0) {
      candidates = globalCandidates;
    }
    var currentLayer = {};

    for (j = 0; j < candidates.length; j += 1) {
      var token = candidates[j];
      var emissionScore = scoreEmission(model, token, slice, parsedTune.modeInfo);
      var sliceContextScore = scoreSliceContext(model, token, parsedTune, slice);
      var measurePatternBonus = 0;
      var hintedToken = measureHintToken;

      if (hintedToken && hintedToken === token) {
        measurePatternBonus = 1.55;
      }

      if (i === 0) {
        var startTransition = logProbability(getTransitionBucket(model, styleKey, "__START__"), token, 0.8, model.counts.chordTotals);
        currentLayer[token] = {
          score: (0.85 * emissionScore) + sliceContextScore + (1.05 * startTransition) + measurePatternBonus,
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
        var stayBonus = previousToken === token ? 0.05 : 0;
        var changeBonus = previousToken === token ? (-0.90 * changePreference) : (0.90 * changePreference);
        var candidateScore = previousLayer[previousToken].score + (0.85 * emissionScore) + sliceContextScore + (1.05 * transitionScore) + stayBonus + measurePatternBonus + changeBonus;

        if (i === parsedTune.beatSlices.length - 1 && token.indexOf("1:") === 0) {
          candidateScore += 0.45;
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
  trainOnRow: trainOnRow
};
