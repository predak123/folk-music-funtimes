var theory = require("../music/theory");
var abcParser = require("../music/abc");
var identityExperimentFlags = null;

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
    learned: {
      onsetWeights: {},
      onsetLearnerEpochs: 0
    },
    counts: {
      chordTotals: {},
      modeChordTotals: {},
      styleChordTotals: {},
      typeMeterChordTotals: {},
      transitions: {},
      styleTransitions: {},
      typeMeterTransitions: {},
      onsetTransitions: {},
      styleOnsetTransitions: {},
      typeMeterOnsetTransitions: {},
      positions: {},
      partPositions: {},
      rolePositions: {},
      phrasePositions: {},
      signatures: {},
      measureSignatures: {},
      measurePatterns: {},
      onsetMeasurePatterns: {},
      partTokenPatterns: {},
      partOnsetPatterns: {},
      endingTokenPatterns: {},
      endingOnsetPatterns: {},
      endingFinalOnsetTokens: {},
      onsetStyles: {},
      typeMeterOnsetStyles: {},
      styleBeatOnsetStyles: {},
      typeMeterBeatOnsetStyles: {},
      roleBeatOnsetStyles: {},
      onsetPositions: {},
      onsetPartPositions: {},
      onsetRolePositions: {},
      onsetPhrasePositions: {},
      onsetSignatures: {},
      onsetMeasureSignatures: {},
      onsetStyleChordTotals: {},
      onsetPositionChordTotals: {},
      onsetRolePositionChordTotals: {},
      onsetPhraseChordTotals: {},
      onsetSignatureChordTotals: {},
      onsetMeasureSignatureChordTotals: {},
      pulseFamilyTemplates: {},
      pulseRolePositionTemplates: {},
      pulseMeasureSignatureTemplates: {},
      pulseTemplateTransitions: {},
      pulsePartPatterns: {},
      fuzzyPulsePartLibrary: [],
      fuzzyPulseTuneLibrary: [],
      typeModeOnsetChordTotals: {},
      typeModeFunctionTotals: {},
      modeFunctionTotals: {},
      modeFunctionTransitions: {},
      exactMelodyPaths: {},
      canonicalMelodyTokens: {},
      canonicalMelodyOnsets: {},
      fuzzyPartLibrary: [],
      fuzzyPartFamilyLibrary: [],
      fuzzyTuneLibrary: [],
      cadencePositions: {},
      cadenceOnsetPositions: {},
      cadenceOnsetChordTotals: {},
      cadenceFunctionTotals: {},
      cadenceFunctionTransitions: {},
      cadenceTokenTransitions: {},
      emissions: {},
      slotEmissions: {},
      emissionTotals: {},
      tuneTypes: {}
    }
  };
}

function ensureModelShape(model) {
  var defaults = createEmptyModel();

  if (!model.metadata) {
    model.metadata = {};
  }

  Object.keys(defaults.metadata).forEach(function (key) {
    if (model.metadata[key] === undefined) {
      model.metadata[key] = defaults.metadata[key];
    }
  });

  if (!model.counts) {
    model.counts = {};
  }

  if (!model.learned) {
    model.learned = {};
  }

  Object.keys(defaults.learned).forEach(function (key) {
    if (model.learned[key] === undefined) {
      model.learned[key] = Array.isArray(defaults.learned[key]) ? [] : {};
    }
  });

  Object.keys(defaults.counts).forEach(function (key) {
    if (model.counts[key] === undefined) {
      model.counts[key] = Array.isArray(defaults.counts[key]) ? [] : {};
    }
  });

  return model;
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

function buildRolePartPositionKey(slice, parsedTune) {
  return [
    parsedTune.type || "unknown",
    parsedTune.meterInfo.raw,
    parsedTune.modeInfo.modeFamily,
    buildEndingRole(parsedTune, slice.partIndex),
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

function buildStyleBeatKey(slice, parsedTune) {
  return [
    buildStyleKey(parsedTune),
    slice.beatInBar
  ].join("|");
}

function buildTypeMeterKey(parsedTune) {
  return [
    parsedTune.type || "unknown",
    parsedTune.meterInfo.raw
  ].join("|");
}

function buildTypeMeterBeatKey(slice, parsedTune) {
  return [
    buildTypeMeterKey(parsedTune),
    slice.beatInBar
  ].join("|");
}

function buildRoleBeatKey(slice, parsedTune) {
  return [
    buildStyleKey(parsedTune),
    buildEndingRole(parsedTune, slice.partIndex),
    slice.beatInBar
  ].join("|");
}

function getIdentityExperimentFlags() {
  if (identityExperimentFlags) {
    return identityExperimentFlags;
  }

  identityExperimentFlags = {};

  String(process.env.CHORD_IDENTITY_TARGETS || "").split(",").forEach(function (piece) {
    var normalized = String(piece || "").trim().toLowerCase();
    if (normalized) {
      identityExperimentFlags[normalized] = true;
    }
  });

  return identityExperimentFlags;
}

function hasIdentityExperimentFlag(flagName) {
  return !!getIdentityExperimentFlags()[flagName];
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

function buildCadenceOnsetKey(slice, parsedTune) {
  return [
    buildStyleKey(parsedTune),
    buildEndingRole(parsedTune, slice.partIndex),
    slice.isPickupComplement ? "pickup-complement" : "regular",
    slice.measuresFromPartEnd === null ? "na" : Math.min(slice.measuresFromPartEnd, 2),
    slice.beatInBar
  ].join("|");
}

function buildCadenceFunctionKey(slice, parsedTune) {
  return [
    parsedTune.modeInfo.modeFamily,
    buildEndingRole(parsedTune, slice.partIndex),
    slice.isPickupComplement ? "pickup-complement" : "regular",
    slice.measuresFromPartEnd === null ? "na" : Math.min(slice.measuresFromPartEnd, 1),
    slice.beatInBar
  ].join("|");
}

function buildTypeModeIdentityKey(slice, parsedTune) {
  return [
    parsedTune.type || "unknown",
    parsedTune.modeInfo.modeFamily,
    buildEndingRole(parsedTune, slice.partIndex),
    slice.measuresFromPartEnd === null ? "na" : Math.min(slice.measuresFromPartEnd, 3),
    slice.beatInBar
  ].join("|");
}

function buildPartLengthBucket(partLength) {
  if (!partLength || partLength <= 0) {
    return "unknown";
  }

  if (partLength <= 4) {
    return "short";
  }

  if (partLength <= 8) {
    return "regular";
  }

  if (partLength <= 12) {
    return "extended";
  }

  return "long";
}

function buildPhraseStage(slice) {
  var progress;

  if (slice.isPickup) {
    return "pickup";
  }

  if (slice.measuresFromPartEnd === 0) {
    return slice.isPickupComplement ? "final-short" : "final";
  }

  if (slice.measuresFromPartEnd === 1) {
    return "penultimate";
  }

  if (!slice.partLength || slice.partLength <= 1) {
    return "opening";
  }

  progress = (slice.measureInPart + 0.5) / slice.partLength;

  if (progress < 0.25) {
    return "opening";
  }

  if (progress < 0.50) {
    return "early";
  }

  if (progress < 0.75) {
    return "late";
  }

  return "approach";
}

function buildPhraseProgressBucket(slice) {
  var progress;
  var bucketIndex;

  if (slice.isPickup) {
    return "pickup";
  }

  if (!slice.partLength || slice.partLength <= 1) {
    return "p0";
  }

  progress = clamp(slice.measureInPart / Math.max(slice.partLength - 1, 1), 0, 1);
  bucketIndex = Math.round(progress * 5);
  return "p" + bucketIndex;
}

function buildPhraseContextKey(slice, parsedTune) {
  return [
    parsedTune.type || "unknown",
    parsedTune.meterInfo.raw,
    parsedTune.modeInfo.modeFamily,
    buildEndingRole(parsedTune, slice.partIndex),
    buildPartLengthBucket(slice.partLength),
    buildPhraseStage(slice),
    buildPhraseProgressBucket(slice),
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

function buildCadenceFunctionTransitionKey(parsedTune, slice, previousFunction) {
  return [
    parsedTune.modeInfo.modeFamily,
    buildEndingRole(parsedTune, slice.partIndex),
    slice.isPickupComplement ? "pickup-complement" : "regular",
    slice.measuresFromPartEnd === null ? "na" : Math.min(slice.measuresFromPartEnd, 1),
    slice.beatInBar,
    previousFunction || "__START__"
  ].join("|");
}

function buildCadenceTokenTransitionKey(parsedTune, slice, previousToken) {
  return [
    parsedTune.modeInfo.modeFamily,
    buildEndingRole(parsedTune, slice.partIndex),
    slice.isPickupComplement ? "pickup-complement" : "regular",
    slice.measuresFromPartEnd === null ? "na" : Math.min(slice.measuresFromPartEnd, 1),
    slice.beatInBar,
    previousToken || "__START__"
  ].join("|");
}

function buildEndingPatternSlotId(slice) {
  return [
    Math.min(slice.measuresFromPartEnd === null ? 9 : slice.measuresFromPartEnd, 1),
    slice.beatInBar
  ].join("|");
}

function buildPartPatternKey(parsedTune, partIndex, partLength) {
  return [
    buildStyleKey(parsedTune),
    buildEndingRole(parsedTune, partIndex),
    Math.min(partLength || 0, 16)
  ].join("|");
}

function buildEndingFinalOnsetKey(slice, parsedTune) {
  return [
    buildStyleKey(parsedTune),
    buildEndingRole(parsedTune, slice.partIndex),
    slice.beatInBar
  ].join("|");
}

function placementFamilyForTune(parsedTune) {
  var typeName = String(parsedTune.type || "unknown").toLowerCase();

  if (["reel", "hornpipe", "strathspey", "march"].indexOf(typeName) !== -1) {
    return "duple-strong2";
  }

  if (["jig", "slide"].indexOf(typeName) !== -1) {
    return "compound-duple";
  }

  if (typeName === "slip jig") {
    return "compound-triple";
  }

  if (["polka", "barndance"].indexOf(typeName) !== -1) {
    return "simple-duple";
  }

  if (["waltz", "mazurka", "three-two"].indexOf(typeName) !== -1) {
    return "simple-triple";
  }

  return typeName;
}

function buildPlacementFamilyKey(parsedTune) {
  return [
    placementFamilyForTune(parsedTune),
    parsedTune.meterInfo.raw,
    parsedTune.modeInfo.modeFamily
  ].join("|");
}

function buildPlacementStructuralKey(parsedTune) {
  return [
    placementFamilyForTune(parsedTune),
    parsedTune.meterInfo.raw
  ].join("|");
}

function buildPulsePartPatternKey(parsedTune, pulseBar) {
  return [
    buildPlacementFamilyKey(parsedTune),
    pulseBar.role,
    buildPartLengthBucket(pulseBar.partLength),
    pulseBar.pulseCount
  ].join("|");
}

function buildPulseRolePositionKey(parsedTune, pulseBar) {
  return [
    buildPlacementFamilyKey(parsedTune),
    pulseBar.role,
    buildMeasureSlot(pulseBar),
    buildPartLengthBucket(pulseBar.partLength),
    pulseBar.pulseCount,
    pulseBar.measuresFromPartEnd === null ? "na" : Math.min(pulseBar.measuresFromPartEnd, 3)
  ].join("|");
}

function buildPulseMeasureSignatureKey(parsedTune, pulseBar) {
  return [
    buildPlacementFamilyKey(parsedTune),
    pulseBar.role,
    pulseBar.measureSignature || "",
    pulseBar.pulseCount,
    pulseBar.measuresFromPartEnd === null ? "na" : Math.min(pulseBar.measuresFromPartEnd, 3)
  ].join("|");
}

function buildPulseTransitionKey(parsedTune, previousTemplate) {
  return [
    buildPlacementFamilyKey(parsedTune),
    previousTemplate || "__START__"
  ].join("|");
}

function buildPulseRepeatKey(pulseBar) {
  return [
    pulseBar.measureSignature || "",
    pulseBar.pulseCount,
    buildPartLengthBucket(pulseBar.partLength),
    pulseBar.role || "",
    buildMeasureSlot(pulseBar)
  ].join("|");
}

function parseNumericValue(value) {
  var numeric = parseFloat(String(value === undefined || value === null ? "" : value));
  return isFinite(numeric) ? numeric : null;
}

function estimateRowPopularityWeight(row, tuneSettingCount) {
  var explicit = parseNumericValue(row && (row.tune_popularity || row.setting_popularity || row.popularity));
  if (explicit !== null && explicit > 0) {
    return clamp(0.98 + (Math.log(1 + explicit) * 0.07), 0.98, 1.22);
  }

  return 1;
}

function buildPulseBars(parsedTune) {
  var barsByRawIndex = {};
  var order = [];
  var placementFamily = placementFamilyForTune(parsedTune);
  var pulseBars = [];

  parsedTune.beatSlices.forEach(function (slice, index) {
    var bar;
    if (slice.isPickup || slice.beatInBar === null) {
      return;
    }

    if (!barsByRawIndex[slice.rawBarIndex]) {
      barsByRawIndex[slice.rawBarIndex] = {
        rawBarIndex: slice.rawBarIndex,
        barIndex: slice.barIndex,
        measureNumber: slice.measureNumber,
        measureInPart: slice.measureInPart,
        partIndex: slice.partIndex,
        partPass: slice.partPass,
        partLength: slice.partLength,
        measuresFromPartEnd: slice.measuresFromPartEnd,
        endingNumber: slice.endingNumber,
        isPickupComplement: slice.isPickupComplement,
        isCadenceMeasure: slice.isCadenceMeasure,
        measureSignature: slice.measureSignature,
        role: buildEndingRole(parsedTune, slice.partIndex),
        slices: []
      };
      order.push(slice.rawBarIndex);
    }

    bar = barsByRawIndex[slice.rawBarIndex];
    bar.slices.push({
      index: index,
      beatInBar: slice.beatInBar,
      slice: slice
    });
  });

  order.forEach(function (rawBarIndex) {
    var bar = barsByRawIndex[rawBarIndex];
    var pulses = [];
    var groupedSlices;

    bar.slices.sort(function (left, right) {
      return left.beatInBar - right.beatInBar;
    });

    if (placementFamily === "duple-strong2" && parsedTune.meterInfo.raw === "4/4" && bar.slices.length >= 4) {
      groupedSlices = [
        bar.slices.slice(0, 2),
        bar.slices.slice(2, 4)
      ];
    } else {
      groupedSlices = bar.slices.map(function (entry) {
        return [entry];
      });
    }

    groupedSlices.forEach(function (group, pulseIndex) {
      var onsetPcs = [];
      group.forEach(function (entry) {
        var pcs = (entry.slice.subPulsePcs && entry.slice.subPulsePcs.onset) || [];
        pcs.forEach(function (pc) {
          if (onsetPcs.indexOf(pc) === -1) {
            onsetPcs.push(pc);
          }
        });
      });

      pulses.push({
        pulseIndex: pulseIndex,
        sliceIndexes: group.map(function (entry) { return entry.index; }),
        beatIndexes: group.map(function (entry) { return entry.beatInBar; }),
        onsetPcs: onsetPcs
      });
    });

    pulseBars.push({
      rawBarIndex: bar.rawBarIndex,
      barIndex: bar.barIndex,
      measureNumber: bar.measureNumber,
      measureInPart: bar.measureInPart,
      partIndex: bar.partIndex,
      partPass: bar.partPass,
      partLength: bar.partLength,
      measuresFromPartEnd: bar.measuresFromPartEnd,
      endingNumber: bar.endingNumber,
      isPickupComplement: bar.isPickupComplement,
      isCadenceMeasure: bar.isCadenceMeasure,
      measureSignature: bar.measureSignature,
      role: bar.role,
      pulseCount: pulses.length,
      pulses: pulses
    });
  });

  return pulseBars;
}

function encodePulseSymbolForGroup(onsetLabels, sliceIndexes) {
  var localChanges = sliceIndexes.map(function (sliceIndex) {
    return onsetLabels[sliceIndex] === "change";
  });

  if (sliceIndexes.length <= 1) {
    return localChanges[0] ? "1" : "0";
  }

  if (localChanges[0] && localChanges[1]) {
    return "3";
  }

  if (localChanges[0]) {
    return "1";
  }

  if (localChanges[1]) {
    return "2";
  }

  return "0";
}

function buildPulseTemplateFromOnsetLabels(pulseBar, onsetLabels) {
  return pulseBar.pulses.map(function (pulse) {
    return encodePulseSymbolForGroup(onsetLabels, pulse.sliceIndexes);
  }).join("");
}

function expandPulseTemplateToOnsets(pulseBar, template) {
  var output = {};

  pulseBar.pulses.forEach(function (pulse, pulseIndex) {
    var symbol = template[pulseIndex] || "0";
    if (pulse.sliceIndexes.length <= 1) {
      output[pulse.sliceIndexes[0]] = symbol === "1" ? "change" : "stay";
      return;
    }

    output[pulse.sliceIndexes[0]] = (symbol === "1" || symbol === "3") ? "change" : "stay";
    output[pulse.sliceIndexes[1]] = (symbol === "2" || symbol === "3") ? "change" : "stay";
  });

  return output;
}

function buildPulsePatternString(pulseBars, templates) {
  return (pulseBars || []).map(function (pulseBar) {
    var template = templates[pulseBar.measureInPart];
    if (template === undefined) {
      template = templates[pulseBar.rawBarIndex];
    }
    return pulseBar.measureInPart + "=" + (template || "");
  }).join("/");
}

function parsePulsePatternString(pattern) {
  return String(pattern || "").split("/").reduce(function (acc, piece) {
    var equalIndex = piece.indexOf("=");
    if (equalIndex === -1) {
      return acc;
    }

    acc[piece.slice(0, equalIndex)] = piece.slice(equalIndex + 1);
    return acc;
  }, {});
}

function sortedBucketEntries(bucket) {
  return Object.keys(bucket || {}).sort(function (left, right) {
    if (bucket[right] !== bucket[left]) {
      return bucket[right] - bucket[left];
    }

    if (left === right) {
      return 0;
    }

    return left < right ? -1 : 1;
  }).map(function (key) {
    return {
      key: key,
      count: bucket[key]
    };
  });
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

function buildLocalSlotKey(measureInPart, beatInBar) {
  return [
    measureInPart,
    beatInBar
  ].join("|");
}

function getPartFingerprints(parsedTune) {
  return parsedTune.partFingerprints || [];
}

function harmonicFunctionForToken(token, modeInfo) {
  var root = String(token || "").split(":")[0];
  var modeFamily = modeInfo.modeFamily;

  if (modeFamily === "major") {
    if (["1", "6", "3"].indexOf(root) !== -1) {
      return "tonic";
    }
    if (["2", "4"].indexOf(root) !== -1) {
      return "predominant";
    }
    if (["5", "7"].indexOf(root) !== -1) {
      return "dominant";
    }
    return "modal";
  }

  if (modeFamily === "minor") {
    if (["1", "6"].indexOf(root) !== -1) {
      return "tonic";
    }
    if (["2", "4"].indexOf(root) !== -1) {
      return "predominant";
    }
    if (["3", "5", "7"].indexOf(root) !== -1) {
      return "dominant";
    }
    return "modal";
  }

  if (modeFamily === "dorian") {
    if (["1", "6"].indexOf(root) !== -1) {
      return "tonic";
    }
    if (["2", "4"].indexOf(root) !== -1) {
      return "predominant";
    }
    if (["3", "5", "7"].indexOf(root) !== -1) {
      return "dominant";
    }
    return "modal";
  }

  if (modeFamily === "mixolydian") {
    if (["1", "6"].indexOf(root) !== -1) {
      return "tonic";
    }
    if (["2", "4"].indexOf(root) !== -1) {
      return "predominant";
    }
    if (["5", "7"].indexOf(root) !== -1) {
      return "dominant";
    }
    return "modal";
  }

  return "other";
}

function isTonicToken(token, modeInfo) {
  if (modeInfo.modeFamily === "minor" || modeInfo.modeFamily === "dorian") {
    return token === "1:min";
  }

  return token === "1:maj";
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
  if (parsedTune.canonicalTuneMeasureSignatures && parsedTune.canonicalTuneMeasureSignatures.length) {
    return parsedTune.canonicalTuneMeasureSignatures.slice();
  }

  return (parsedTune.measures || []).filter(function (measure) {
    return !measure.isPickup;
  }).map(function (measure) {
    return measure.signature;
  });
}

function buildTuneSlotMaps(parsedTune) {
  var tokenBuckets = {};
  var onsetBuckets = {};
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
    incrementCount(ensureNestedMap(tokenBuckets, slotKey), normalized.token, 1);
    incrementCount(ensureNestedMap(onsetBuckets, slotKey), onsetKey, 1);
    previousToken = normalized.token;
  });

  Object.keys(tokenBuckets).forEach(function (slotKey) {
    tokens[slotKey] = selectTopKey(tokenBuckets[slotKey]);
  });

  Object.keys(onsetBuckets).forEach(function (slotKey) {
    onsets[slotKey] = selectTopKey(onsetBuckets[slotKey]);
  });

  return {
    tokens: tokens,
    onsets: onsets
  };
}

function buildTruthOnsetLabels(parsedTune) {
  var onsetLabels = {};
  var previousToken = null;

  (parsedTune.beatSlices || []).forEach(function (slice, index) {
    var normalized = slice.chord ? theory.normalizeChord(slice.chord.raw, parsedTune.modeInfo) : null;
    if (!normalized) {
      return;
    }

    onsetLabels[index] = previousToken === null || previousToken !== normalized.token ? "change" : "stay";
    previousToken = normalized.token;
  });

  return onsetLabels;
}

function buildPulseTemplateMaps(parsedTune, onsetLabels) {
  var templateByBar = {};
  var templateByLocalMeasure = {};
  var pulseBars = buildPulseBars(parsedTune);

  pulseBars.forEach(function (pulseBar) {
    var template = buildPulseTemplateFromOnsetLabels(pulseBar, onsetLabels);
    templateByBar[pulseBar.rawBarIndex] = template;
    templateByLocalMeasure[pulseBar.measureInPart] = template;
  });

  return {
    pulseBars: pulseBars,
    byBar: templateByBar,
    byLocalMeasure: templateByLocalMeasure
  };
}

function sortSlotKeys(slotKeys) {
  return (slotKeys || []).slice().sort(function (left, right) {
    var leftParts = String(left).split("|");
    var rightParts = String(right).split("|");
    var leftMeasure = parseInt(leftParts[0], 10);
    var rightMeasure = parseInt(rightParts[0], 10);
    var leftBeat = parseInt(leftParts[1], 10);
    var rightBeat = parseInt(rightParts[1], 10);

    if (leftMeasure !== rightMeasure) {
      return leftMeasure - rightMeasure;
    }

    return leftBeat - rightBeat;
  });
}

function buildPatternString(slotMap) {
  return sortSlotKeys(Object.keys(slotMap || {})).map(function (slotKey) {
    return slotKey + "=" + slotMap[slotKey];
  }).join("/");
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
  var onsetBuckets = {};
  var beatTokens = [];
  var beatOnsets = [];
  var previousToken = null;

  parsedTune.beatSlices.forEach(function (slice, index) {
    var normalized = slice.chord ? theory.normalizeChord(slice.chord.raw, parsedTune.modeInfo) : null;
    if (!normalized) {
      return;
    }

    beatTokens[index] = normalized.token;
    beatOnsets[index] = previousToken === null || previousToken !== normalized.token ? "change" : "stay";
    previousToken = normalized.token;

    if (slice.isPickup || slice.beatInBar === null) {
      return;
    }

    incrementCount(
      ensureNestedMap(slotBuckets, buildPartSlotKey(slice.partIndex, slice.measureInPart, slice.beatInBar)),
      normalized.token,
      1
    );
    incrementCount(
      ensureNestedMap(onsetBuckets, buildPartSlotKey(slice.partIndex, slice.measureInPart, slice.beatInBar)),
      beatOnsets[index],
      1
    );
  });

  var slotTokens = {};
  var slotOnsets = {};
  Object.keys(slotBuckets).forEach(function (slotKey) {
    slotTokens[slotKey] = selectTopKey(slotBuckets[slotKey]);
  });
  Object.keys(onsetBuckets).forEach(function (slotKey) {
    slotOnsets[slotKey] = selectTopKey(onsetBuckets[slotKey]);
  });

  return {
    row: row,
    rowIndex: rowIndex,
    parsedTune: parsedTune,
    beatTokens: beatTokens,
    beatOnsets: beatOnsets,
    slotTokens: slotTokens,
    slotOnsets: slotOnsets
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
    var onsetBuckets = {};

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
      Object.keys(groupItem.item.slotOnsets).forEach(function (slotKey) {
        incrementCount(
          ensureNestedMap(onsetBuckets, slotKey),
          groupItem.item.slotOnsets[slotKey],
          1
        );
      });
    });

    groupItems.forEach(function (groupItem) {
      var sliceWeights = {};
      var matched = 0;
      var compared = 0;
      var confidenceSum = 0;
      var onsetMatched = 0;
      var onsetCompared = 0;
      var onsetConfidenceSum = 0;

      groupItem.item.parsedTune.beatSlices.forEach(function (slice, sliceIndex) {
        var token = groupItem.item.beatTokens[sliceIndex];
        var onset = groupItem.item.beatOnsets[sliceIndex];
        if (!token || slice.isPickup || slice.beatInBar === null) {
          return;
        }

        var slotKey = buildPartSlotKey(slice.partIndex, slice.measureInPart, slice.beatInBar);
        var leader = describeBucketLeader(slotBuckets[slotKey]);
        var onsetLeader = describeBucketLeader(onsetBuckets[slotKey]);
        if (!leader || !leader.decisive) {
          if (onsetLeader && onsetLeader.decisive && onset) {
            onsetCompared += 1;
            onsetConfidenceSum += onsetLeader.confidence;
            if (onset === onsetLeader.token) {
              onsetMatched += 1;
              sliceWeights[sliceIndex] = clamp(0.92 + (0.22 * onsetLeader.confidence), 0.95, 1.18);
            } else {
              sliceWeights[sliceIndex] = clamp(0.88 - (0.30 * onsetLeader.confidence), 0.55, 0.88);
            }
          }
          return;
        }

        compared += 1;
        confidenceSum += leader.confidence;

        if (token === leader.token) {
          matched += 1;
          sliceWeights[sliceIndex] = clamp(0.94 + (0.40 * leader.confidence), 1.0, 1.34);
        } else {
          sliceWeights[sliceIndex] = clamp(0.92 - (0.52 * leader.confidence), 0.35, 0.84);
        }

        if (onsetLeader && onsetLeader.decisive && onset) {
          onsetCompared += 1;
          onsetConfidenceSum += onsetLeader.confidence;
          if (onset === onsetLeader.token) {
            onsetMatched += 1;
            sliceWeights[sliceIndex] = clamp(sliceWeights[sliceIndex] + (0.08 + (0.10 * onsetLeader.confidence)), 0.35, 1.40);
          } else {
            sliceWeights[sliceIndex] = clamp(sliceWeights[sliceIndex] - (0.10 + (0.12 * onsetLeader.confidence)), 0.30, 1.40);
          }
        }
      });

      if (!compared && !onsetCompared) {
        return;
      }

      var tokenAgreement = compared ? (matched / compared) : 0.5;
      var onsetAgreement = onsetCompared ? (onsetMatched / onsetCompared) : 0.5;
      var tokenConfidence = compared ? (confidenceSum / compared) : 0.5;
      var onsetConfidence = onsetCompared ? (onsetConfidenceSum / onsetCompared) : 0.5;
      var groupSizeBonus = Math.min(groupItems.length, 5) * 0.06;

      plans[groupItem.index] = {
        tuneWeight: clamp(
          0.42 +
            (0.46 * tokenAgreement) +
            (0.22 * tokenConfidence) +
            (0.22 * onsetAgreement) +
            (0.14 * onsetConfidence) +
            groupSizeBonus,
          0.58,
          1.48
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
  var previousObservedFunction = "__START__";
  var previousOnsetKey = "__START__";
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
    var harmonicFunction = normalized ? harmonicFunctionForToken(normalized.token, parsedTune.modeInfo) : null;
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
    incrementCount(ensureNestedMap(model.counts.rolePositions, buildRolePartPositionKey(slice, parsedTune)), normalized.token, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.phrasePositions, buildPhraseContextKey(slice, parsedTune)), normalized.token, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.signatures, buildSignatureKey(slice, parsedTune)), normalized.token, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.measureSignatures, buildMeasureSignatureKey(slice, parsedTune)), normalized.token, sliceWeight);
    incrementCount(model.counts.tuneTypes, parsedTune.type || "unknown", 1);
    incrementCount(ensureNestedMap(model.counts.onsetStyles, styleKey), onsetKey, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.typeMeterOnsetStyles, typeMeterKey), onsetKey, sliceWeight);
    if (slice.beatInBar !== null) {
      incrementCount(ensureNestedMap(model.counts.styleBeatOnsetStyles, buildStyleBeatKey(slice, parsedTune)), onsetKey, sliceWeight);
      incrementCount(ensureNestedMap(model.counts.typeMeterBeatOnsetStyles, buildTypeMeterBeatKey(slice, parsedTune)), onsetKey, sliceWeight);
      incrementCount(ensureNestedMap(model.counts.roleBeatOnsetStyles, buildRoleBeatKey(slice, parsedTune)), onsetKey, sliceWeight);
    }
    incrementCount(ensureNestedMap(model.counts.onsetPositions, buildPositionKey(slice, parsedTune)), onsetKey, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.onsetPartPositions, buildPartPositionKey(slice, parsedTune)), onsetKey, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.onsetRolePositions, buildRolePartPositionKey(slice, parsedTune)), onsetKey, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.onsetPhrasePositions, buildPhraseContextKey(slice, parsedTune)), onsetKey, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.onsetSignatures, buildSignatureKey(slice, parsedTune)), onsetKey, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.onsetMeasureSignatures, buildMeasureSignatureKey(slice, parsedTune)), onsetKey, sliceWeight);
    incrementCount(ensureNestedMap(model.counts.onsetTransitions, previousOnsetKey), onsetKey, sliceWeight);
    incrementCount(ensureNestedMap(ensureNestedMap(model.counts.styleOnsetTransitions, styleKey), previousOnsetKey), onsetKey, sliceWeight);
    incrementCount(ensureNestedMap(ensureNestedMap(model.counts.typeMeterOnsetTransitions, typeMeterKey), previousOnsetKey), onsetKey, sliceWeight);

    if (truthChange) {
      incrementCount(ensureNestedMap(model.counts.typeModeOnsetChordTotals, buildTypeModeIdentityKey(slice, parsedTune)), normalized.token, sliceWeight);
      incrementCount(ensureNestedMap(model.counts.typeModeFunctionTotals, buildTypeModeIdentityKey(slice, parsedTune)), harmonicFunction, sliceWeight);
      incrementCount(ensureNestedMap(model.counts.modeFunctionTotals, parsedTune.modeInfo.modeFamily), harmonicFunction, sliceWeight);
      incrementCount(ensureNestedMap(ensureNestedMap(model.counts.modeFunctionTransitions, parsedTune.modeInfo.modeFamily), previousObservedFunction), harmonicFunction, sliceWeight);
      incrementCount(ensureNestedMap(model.counts.onsetStyleChordTotals, styleKey), normalized.token, sliceWeight);
      incrementCount(ensureNestedMap(model.counts.onsetPositionChordTotals, buildPartPositionKey(slice, parsedTune)), normalized.token, sliceWeight);
      incrementCount(ensureNestedMap(model.counts.onsetRolePositionChordTotals, buildRolePartPositionKey(slice, parsedTune)), normalized.token, sliceWeight);
      incrementCount(ensureNestedMap(model.counts.onsetPhraseChordTotals, buildPhraseContextKey(slice, parsedTune)), normalized.token, sliceWeight);
      incrementCount(ensureNestedMap(model.counts.onsetSignatureChordTotals, buildSignatureKey(slice, parsedTune)), normalized.token, sliceWeight);
      incrementCount(ensureNestedMap(model.counts.onsetMeasureSignatureChordTotals, buildMeasureSignatureKey(slice, parsedTune)), normalized.token, sliceWeight);

      if (!slice.isPickup && slice.measuresFromPartEnd === 0) {
        incrementCount(
          ensureNestedMap(model.counts.endingFinalOnsetTokens, buildEndingFinalOnsetKey(slice, parsedTune)),
          normalized.token,
          sliceWeight
        );
      }

      if (!slice.isPickup && slice.measuresFromPartEnd !== null && slice.measuresFromPartEnd <= 1) {
        incrementCount(
          ensureNestedMap(model.counts.cadenceOnsetChordTotals, buildCadenceOnsetKey(slice, parsedTune)),
          normalized.token,
          sliceWeight
        );
        incrementCount(
          ensureNestedMap(model.counts.cadenceFunctionTotals, buildCadenceFunctionKey(slice, parsedTune)),
          harmonicFunction,
          sliceWeight
        );
        incrementCount(
          ensureNestedMap(
            model.counts.cadenceFunctionTransitions,
            buildCadenceFunctionTransitionKey(parsedTune, slice, previousObservedFunction)
          ),
          harmonicFunction,
          sliceWeight
        );
        incrementCount(
          ensureNestedMap(
            model.counts.cadenceTokenTransitions,
            buildCadenceTokenTransitionKey(parsedTune, slice, previousObservedToken)
          ),
          normalized.token,
          sliceWeight
        );
      }
    }

    if (!slice.isPickup && slice.measuresFromPartEnd !== null && slice.measuresFromPartEnd <= 2) {
      incrementCount(ensureNestedMap(model.counts.cadencePositions, buildCadenceKey(slice, parsedTune)), normalized.token, sliceWeight);
      incrementCount(ensureNestedMap(model.counts.cadenceOnsetPositions, buildCadenceOnsetKey(slice, parsedTune)), onsetKey, sliceWeight);
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
          slotBuckets: {},
          onsetBuckets: {}
        };
      }

      incrementCount(
        ensureNestedMap(partLibraryEntries[slice.partIndex].slotBuckets, buildLocalSlotKey(slice.measureInPart, slice.beatInBar)),
        normalized.token,
        sliceWeight
      );

      incrementCount(
        ensureNestedMap(partLibraryEntries[slice.partIndex].onsetBuckets, buildLocalSlotKey(slice.measureInPart, slice.beatInBar)),
        onsetKey,
        sliceWeight
      );
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
    if (truthChange) {
      previousObservedFunction = harmonicFunction;
    }
    previousOnsetKey = onsetKey;
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

  if (usableLabels > 0 && getPartFingerprints(parsedTune).length) {
    getPartFingerprints(parsedTune).forEach(function (partFingerprint) {
      var entry = partLibraryEntries[partFingerprint.partIndex];
      if (!entry) {
        return;
      }

      var slots = {};
      var onsets = {};
      Object.keys(entry.slotBuckets || {}).forEach(function (slotKey) {
        slots[slotKey] = selectTopKey(entry.slotBuckets[slotKey]);
      });
      Object.keys(entry.onsetBuckets || {}).forEach(function (slotKey) {
        onsets[slotKey] = selectTopKey(entry.onsetBuckets[slotKey]);
      });

      incrementCount(
        ensureNestedMap(
          model.counts.partTokenPatterns,
          buildPartPatternKey(parsedTune, partFingerprint.partIndex, (partFingerprint.measureSignatures || []).length)
        ),
        buildPatternString(slots),
        tuneWeight
      );
      incrementCount(
        ensureNestedMap(
          model.counts.partOnsetPatterns,
          buildPartPatternKey(parsedTune, partFingerprint.partIndex, (partFingerprint.measureSignatures || []).length)
        ),
        buildPatternString(onsets),
        tuneWeight
      );

      model.counts.fuzzyPartLibrary.push({
        styleKey: styleKey,
        typeMeterKey: typeMeterKey,
        modeFamily: parsedTune.modeInfo.modeFamily,
        partIndex: partFingerprint.partIndex,
        measureSignatures: partFingerprint.measureSignatures || [],
        slots: slots,
        weight: tuneWeight
      });

      model.counts.fuzzyPartFamilyLibrary.push({
        styleKey: styleKey,
        typeMeterKey: typeMeterKey,
        modeFamily: parsedTune.modeInfo.modeFamily,
        endingRole: buildEndingRole(parsedTune, partFingerprint.partIndex),
        partIndex: partFingerprint.partIndex,
        partLength: (partFingerprint.measureSignatures || []).length,
        measureSignatures: partFingerprint.measureSignatures || [],
        slots: slots,
        onsets: onsets,
        weight: tuneWeight
      });
    });
  }

  if (usableLabels > 0) {
    var truthOnsetLabels = buildTruthOnsetLabels(parsedTune);
    var pulseTemplateMaps = buildPulseTemplateMaps(parsedTune, truthOnsetLabels);
    var previousPulseTemplate = "__START__";
    var pulsePartTemplates = {};

    pulseTemplateMaps.pulseBars.forEach(function (pulseBar) {
      var template = pulseTemplateMaps.byBar[pulseBar.rawBarIndex];
      if (!template) {
        return;
      }

      incrementCount(ensureNestedMap(model.counts.pulseFamilyTemplates, buildPlacementFamilyKey(parsedTune)), template, tuneWeight);
      incrementCount(ensureNestedMap(model.counts.pulseRolePositionTemplates, buildPulseRolePositionKey(parsedTune, pulseBar)), template, tuneWeight);
      incrementCount(ensureNestedMap(model.counts.pulseMeasureSignatureTemplates, buildPulseMeasureSignatureKey(parsedTune, pulseBar)), template, tuneWeight);
      incrementCount(
        ensureNestedMap(
          ensureNestedMap(model.counts.pulseTemplateTransitions, buildPlacementFamilyKey(parsedTune)),
          previousPulseTemplate
        ),
        template,
        tuneWeight
      );

      if (!pulsePartTemplates[pulseBar.partIndex]) {
        pulsePartTemplates[pulseBar.partIndex] = {};
      }
      pulsePartTemplates[pulseBar.partIndex][pulseBar.measureInPart] = template;
      previousPulseTemplate = template;
    });

    getPartFingerprints(parsedTune).forEach(function (partFingerprint) {
      var localTemplates = pulsePartTemplates[partFingerprint.partIndex] || {};
      if (!Object.keys(localTemplates).length) {
        return;
      }

      incrementCount(
        ensureNestedMap(
          model.counts.pulsePartPatterns,
          buildPulsePartPatternKey(parsedTune, {
            role: buildEndingRole(parsedTune, partFingerprint.partIndex),
            partLength: (partFingerprint.measureSignatures || []).length,
            pulseCount: (pulseTemplateMaps.pulseBars.find(function (pulseBar) {
              return pulseBar.partIndex === partFingerprint.partIndex;
            }) || { pulseCount: 0 }).pulseCount
          })
        ),
        buildPulsePatternString(
          pulseTemplateMaps.pulseBars.filter(function (pulseBar) {
            return pulseBar.partIndex === partFingerprint.partIndex;
          }),
          localTemplates
        ),
        tuneWeight
      );

      model.counts.fuzzyPulsePartLibrary.push({
        familyKey: buildPlacementFamilyKey(parsedTune),
        modeFamily: parsedTune.modeInfo.modeFamily,
        endingRole: buildEndingRole(parsedTune, partFingerprint.partIndex),
        partLength: (partFingerprint.measureSignatures || []).length,
        measureSignatures: partFingerprint.measureSignatures || [],
        templates: localTemplates,
        weight: tuneWeight
      });
    });

    var tuneSlotMaps = buildTuneSlotMaps(parsedTune);
    if (parsedTune.canonicalMelodyFingerprint) {
      Object.keys(tuneSlotMaps.tokens).forEach(function (slotKey) {
        incrementCount(
          ensureNestedMap(
            ensureNestedMap(model.counts.canonicalMelodyTokens, parsedTune.canonicalMelodyFingerprint),
            slotKey
          ),
          tuneSlotMaps.tokens[slotKey],
          tuneWeight
        );
      });

      Object.keys(tuneSlotMaps.onsets).forEach(function (slotKey) {
        incrementCount(
          ensureNestedMap(
            ensureNestedMap(model.counts.canonicalMelodyOnsets, parsedTune.canonicalMelodyFingerprint),
            slotKey
          ),
          tuneSlotMaps.onsets[slotKey],
          tuneWeight
        );
      });
    }

    model.counts.fuzzyTuneLibrary.push({
      styleKey: styleKey,
      typeMeterKey: typeMeterKey,
      modeFamily: parsedTune.modeInfo.modeFamily,
      measureSignatures: buildTuneMeasureSignatures(parsedTune),
      partCount: getPartFingerprints(parsedTune).length,
      slots: tuneSlotMaps.tokens,
      onsets: tuneSlotMaps.onsets,
      weight: tuneWeight
    });

    model.counts.fuzzyPulseTuneLibrary.push({
      familyKey: buildPlacementFamilyKey(parsedTune),
      modeFamily: parsedTune.modeInfo.modeFamily,
      measureSignatures: buildTuneMeasureSignatures(parsedTune),
      partCount: getPartFingerprints(parsedTune).length,
      templates: pulseTemplateMaps.pulseBars.reduce(function (acc, pulseBar) {
        acc[buildPartSlotKey(pulseBar.partIndex, pulseBar.measureInPart, 0)] = pulseTemplateMaps.byBar[pulseBar.rawBarIndex];
        return acc;
      }, {}),
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

  ensureModelShape(model);
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
  var tuneSettingCounts = {};

  ensureModelShape(model);

  items.forEach(function (item) {
    var tuneKey = item.row && item.row.tune_id ? String(item.row.tune_id) : ("row:" + item.rowIndex);
    tuneSettingCounts[tuneKey] = (tuneSettingCounts[tuneKey] || 0) + 1;
  });

  items.forEach(function (item, index) {
    var plan = consensusPlans[index] || {
      tuneWeight: 1,
      sliceWeights: {}
    };
    var tuneKey = item.row && item.row.tune_id ? String(item.row.tune_id) : ("row:" + item.rowIndex);
    plan.tuneWeight = clamp(plan.tuneWeight * estimateRowPopularityWeight(item.row, tuneSettingCounts[tuneKey]), 0.45, 1.75);
    consensusPlans[index] = plan;
    trainOnParsedTune(model, item.parsedTune, consensusPlans[index]);
    trainedRows += 1;
  });

  trainOnsetOnlyLearner(model, items, consensusPlans);

  return {
    trainedRows: trainedRows,
    skippedRows: skippedRows
  };
}

function trainOnsetOnlyLearner(model, items, consensusPlans) {
  var trainingItems = items || [];
  var plans = consensusPlans || [];
  var state;
  var epochs = 2;

  if (!trainingItems.length) {
    model.learned.onsetWeights = {};
    model.learned.onsetLearnerEpochs = 0;
    return;
  }

  state = {
    weights: {},
    totals: {},
    timestamps: {},
    step: 0
  };

  function applySequenceUpdate(truthPath, predictedPath, observations, plan) {
    var previousTruth = "__START__";
    var previousPredicted = "__START__";
    var index;

    for (index = 0; index < observations.length; index += 1) {
      var truthLabel = truthPath[index];
      var predictedLabel = predictedPath[index];
      var sliceScale = clamp(((plan.sliceWeights && plan.sliceWeights[index]) || 1) * (plan.tuneWeight || 1), 0.35, 1.75);

      if (!truthLabel || !predictedLabel) {
        previousTruth = truthLabel || previousTruth;
        previousPredicted = predictedLabel || previousPredicted;
        continue;
      }

      if (truthLabel !== predictedLabel || previousTruth !== previousPredicted) {
        state.step += 1;
        updateOnsetLearnerStateWeights(state, truthLabel, observations[index].features, sliceScale);
        updateOnsetLearnerStateWeights(state, predictedLabel, observations[index].features, -1 * sliceScale);
        updateOnsetLearnerTransitionWeight(state, previousTruth, truthLabel, sliceScale);
        updateOnsetLearnerTransitionWeight(state, previousPredicted, predictedLabel, -1 * sliceScale);
      }

      previousTruth = truthLabel;
      previousPredicted = predictedLabel;
    }
  }

  for (var epoch = 0; epoch < epochs; epoch += 1) {
    trainingItems.forEach(function (item, index) {
      var plan = plans[index] || {
        tuneWeight: 1,
        sliceWeights: {}
      };
      var decoderProfile = buildDecoderProfile(item.parsedTune, {
        placementFirst: true
      });
      decoderProfile.changeWeight *= 0.72;
      decoderProfile.partPatternOnsetWeight *= 0.30;
      decoderProfile.partFamilyOnsetWeight *= 0.30;
      decoderProfile.cadenceOnsetWeight *= 0.55;
      decoderProfile.onsetPathTransitionWeight *= 0.55;
      decoderProfile.onsetLearnerWeight = 0.01;
      decoderProfile.onsetConsensusWeight = 0;
      decoderProfile.onsetConsensusLockMargin = 0;
      decoderProfile.measureConsensusMinMargin = 0;
      var fullHintSources = buildPredictionHintSources(model, item.parsedTune);
      var hintSources = {
        measurePatternHints: fullHintSources.measurePatternHints,
        onsetMeasurePatternHints: fullHintSources.onsetMeasurePatternHints,
        partOnsetHints: fullHintSources.partOnsetHints,
        endingOnsetHints: fullHintSources.endingOnsetHints,
        exactMelodyPathHints: {},
        canonicalMelodyHints: {
          tokens: {},
          onsets: {}
        },
        fuzzyPartFamilyHints: {
          tokens: {},
          onsets: {}
        },
        fuzzyTuneHints: {
          tokens: {},
          onsets: {}
        }
      };
      var onsetResult = buildPredictedOnsetPath(model, item.parsedTune, decoderProfile, {
        measurePatternHints: hintSources.measurePatternHints,
        onsetMeasurePatternHints: hintSources.onsetMeasurePatternHints,
        partOnsetHints: hintSources.partOnsetHints,
        endingOnsetHints: hintSources.endingOnsetHints,
        exactMelodyPathHints: hintSources.exactMelodyPathHints,
        canonicalMelodyHints: hintSources.canonicalMelodyHints,
        fuzzyPartFamilyHints: hintSources.fuzzyPartFamilyHints,
        fuzzyTuneHints: hintSources.fuzzyTuneHints
      }, {
        includeObservations: true,
        onsetLearnerWeights: state.weights
      });
      var truthPath = [];
      var predictedPath = [];
      var observations = onsetResult.observations || [];
      var sliceCount = item.parsedTune.beatSlices.length;
      var sliceIndex;

      for (sliceIndex = 0; sliceIndex < sliceCount; sliceIndex += 1) {
        truthPath[sliceIndex] = item.beatOnsets[sliceIndex] || (sliceIndex === 0 ? "change" : "stay");
        predictedPath[sliceIndex] = (onsetResult.path || {})[sliceIndex] || (sliceIndex === 0 ? "change" : "stay");
      }

      applySequenceUpdate(truthPath, predictedPath, observations, plan);
    });
  }

  model.learned.onsetWeights = finalizeAveragedWeights(state);
  model.learned.onsetLearnerEpochs = epochs;
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

function addCategoricalFeature(features, key, value) {
  if (value === null || value === undefined || value === "") {
    return;
  }

  features[key + "=" + value] = 1;
}

function addNumericFeature(features, key, value) {
  if (!value) {
    return;
  }

  features[key] = value;
}

function scoreOnsetLearnerState(weights, label, features) {
  return Object.keys(features || {}).reduce(function (sum, featureKey) {
    return sum + ((weights["S|" + label + "|" + featureKey] || 0) * features[featureKey]);
  }, 0);
}

function scoreOnsetLearnerTransition(weights, previousLabel, label) {
  return weights["T|" + previousLabel + "|" + label] || 0;
}

function buildOnsetLearnerFeatures(parsedTune, slice, context) {
  var features = {
    bias: 1
  };
  var role = buildEndingRole(parsedTune, slice.partIndex);
  var phraseStage = buildPhraseStage(slice);
  var partLengthBucket = buildPartLengthBucket(slice.partLength);
  var signatureKey = buildSignaturePitchClasses(slice).join(".");
  var cadenceDistance = slice.measuresFromPartEnd === null ? "na" : Math.min(slice.measuresFromPartEnd, 3);
  var onsetPcs = (slice.subPulsePcs && slice.subPulsePcs.onset) || [];
  var thirdPcs = (slice.subPulsePcs && slice.subPulsePcs.third) || [];
  var i;

  addNumericFeature(features, "base_local_bias", context.localBias);
  addNumericFeature(features, "beat_strength", beatStrength(slice, parsedTune.meterInfo));
  addNumericFeature(features, "rhythm_prior", scoreRhythmChangePrior(parsedTune, slice));
  addNumericFeature(features, "change_pref", context.changePreference || context.localBias);
  addNumericFeature(features, "base_local_bias:role=" + role, context.localBias);
  addNumericFeature(features, "base_local_bias:beat=" + slice.beatInBar, context.localBias);
  addNumericFeature(features, "base_local_bias:type=" + (parsedTune.type || "unknown"), context.localBias);

  addCategoricalFeature(features, "type", parsedTune.type || "unknown");
  addCategoricalFeature(features, "meter", parsedTune.meterInfo.raw);
  addCategoricalFeature(features, "mode", parsedTune.modeInfo.modeFamily);
  addCategoricalFeature(features, "role", role);
  addCategoricalFeature(features, "beat", slice.beatInBar);
  addCategoricalFeature(features, "type_meter", buildTypeMeterKey(parsedTune));
  addCategoricalFeature(features, "type_meter_beat", buildTypeMeterBeatKey(slice, parsedTune));
  addCategoricalFeature(features, "style_beat", buildStyleBeatKey(slice, parsedTune));
  addCategoricalFeature(features, "role_beat", buildRoleBeatKey(slice, parsedTune));
  addCategoricalFeature(features, "measure_slot", buildMeasureSlot(slice));
  addCategoricalFeature(features, "phrase_stage", phraseStage);
  addCategoricalFeature(features, "part_length", partLengthBucket);
  addCategoricalFeature(features, "cadence_dist", cadenceDistance);
  addCategoricalFeature(features, "measure_signature", slice.measureSignature || "none");
  addCategoricalFeature(features, "signature", signatureKey || "none");

  if (slice.isPickup) {
    features.is_pickup = 1;
  }

  if (slice.isPickupComplement) {
    features.is_pickup_complement = 1;
  }

  if (slice.isCadenceMeasure) {
    features.is_cadence_measure = 1;
  }

  if (slice.measuresFromPartEnd !== null && slice.measuresFromPartEnd <= 1) {
    features.is_late_cadence = 1;
  }

  if (slice.beatInBar !== null && beatStrength(slice, parsedTune.meterInfo) >= 1.15) {
    features.is_strong_beat = 1;
  }

  if (context.onsetMeasureHint) {
    addCategoricalFeature(features, "hint_onset_measure", context.onsetMeasureHint);
  }

  if (context.partPatternOnsetHint) {
    addCategoricalFeature(features, "hint_part_pattern", context.partPatternOnsetHint);
  }

  if (context.measureOnsetHint) {
    addCategoricalFeature(features, "hint_measure_token", context.measureOnsetHint);
  }

  if (context.endingOnsetHint) {
    addCategoricalFeature(features, "hint_ending", context.endingOnsetHint);
  }

  for (i = 0; i < onsetPcs.length; i += 1) {
    addCategoricalFeature(features, "onset_pc", onsetPcs[i]);
  }

  for (i = 0; i < thirdPcs.length; i += 1) {
    addCategoricalFeature(features, "third_pc", thirdPcs[i]);
  }

  return features;
}

function updateAveragedWeight(state, key, delta) {
  var previousTimestamp = state.timestamps[key] || 0;
  state.totals[key] = (state.totals[key] || 0) + ((state.step - previousTimestamp) * (state.weights[key] || 0));
  state.timestamps[key] = state.step;
  state.weights[key] = (state.weights[key] || 0) + delta;
}

function updateOnsetLearnerStateWeights(state, label, features, scale) {
  Object.keys(features || {}).forEach(function (featureKey) {
    updateAveragedWeight(state, "S|" + label + "|" + featureKey, scale * features[featureKey]);
  });
}

function updateOnsetLearnerTransitionWeight(state, previousLabel, label, scale) {
  updateAveragedWeight(state, "T|" + previousLabel + "|" + label, scale);
}

function finalizeAveragedWeights(state) {
  var averaged = {};
  var keys = {};

  Object.keys(state.weights).forEach(function (key) {
    keys[key] = true;
  });
  Object.keys(state.totals).forEach(function (key) {
    keys[key] = true;
  });

  Object.keys(keys).forEach(function (key) {
    var previousTimestamp = state.timestamps[key] || 0;
    var total = (state.totals[key] || 0) + ((state.step - previousTimestamp) * (state.weights[key] || 0));
    var average = state.step ? ((state.weights[key] || 0) - (total / state.step)) : (state.weights[key] || 0);
    if (Math.abs(average) > 1e-9) {
      averaged[key] = average;
    }
  });

  return averaged;
}

function selectModeAwareMatches(matches, requireExactMode, limit) {
  var exactModeMatches = (matches || []).filter(function (match) {
    return match.modeMatch;
  });
  var selected = requireExactMode && exactModeMatches.length ? exactModeMatches : (matches || []);
  return selected.slice(0, limit || selected.length);
}

function buildDecoderProfile(parsedTune, predictionOptions) {
  predictionOptions = predictionOptions || {};
  var typeName = String(parsedTune.type || "unknown").toLowerCase();
  var modeFamily = parsedTune.modeInfo.modeFamily;
  var profile = {
    emissionWeight: 0.85,
    contextWeight: 1.0,
    transitionWeight: 1.05,
    startTransitionWeight: 1.05,
    changeWeight: 0.90,
    stayBonus: 0.05,
    measurePatternBonus: 1.55,
    exactHintBonus: 2.20,
    partPatternBonus: 0.82,
    partFamilyHintWeight: 0.11,
    partPatternOnsetWeight: 0.34,
    partFamilyOnsetWeight: 0.42,
    cadenceOnsetWeight: 0.42,
    cadenceFunctionWeight: 0.18,
    cadenceFunctionTransitionWeight: 0.22,
    cadenceTokenTransitionWeight: 0.16,
    onsetPathWeight: 0.22,
    onsetPathTransitionWeight: 0.52,
    onsetLearnerWeight: 0,
    phraseOnsetWeight: 0,
    placementRhythmWeight: 0,
    beatStrengthBiasWeight: 0.35,
    onsetConsensusWeight: 0,
    onsetConsensusLockMargin: 0,
    measureConsensusMinMargin: 0,
    lockPredictedStays: false,
    typeModeIdentityWeight: 0,
    harmonicFunctionWeight: 0,
    harmonicTransitionWeight: 0,
    minorPenultimateWeight: 0,
    cadenceTonicRerankWeight: 0.56,
    cadenceTonicRerankMargin: 0.48,
    fuzzyHintWeight: 0.35,
    finalTonicBonus: 0.45,
    slotTheoryWeight: 0.72,
    slotLearnedWeight: 0.28,
    pulseFamilyTemplateWeight: 0.26,
    pulseRoleTemplateWeight: 0.72,
    pulseMeasureTemplateWeight: 0.92,
    pulseTransitionWeight: 0.78,
    pulseEvidenceWeight: 0.64,
    pulsePartPatternWeight: 0.48,
    pulseFuzzyPartWeight: 0.34,
    pulseFuzzyTuneWeight: 0.28,
    pulseRepeatWeight: 0.22,
    pulseRepeatConsensusMinMargin: 2,
    pulseBaseTemplateBonus: 0.30,
    pulseSwitchMargin: 0.42,
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
      partPatternOnsetWeight: 0.42,
      partFamilyOnsetWeight: 0.50,
      onsetPathWeight: 0.26,
      pulseRoleTemplateWeight: 0.78,
      pulseMeasureTemplateWeight: 1.02,
      pulseEvidenceWeight: 0.70,
      pulsePartPatternWeight: 0.54,
      pulseFuzzyPartWeight: 0.38,
      pulseRepeatWeight: 0.28,
      pulseBaseTemplateBonus: 0.34,
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
      partPatternOnsetWeight: 0.38,
      onsetPathWeight: 0.24,
      pulseRoleTemplateWeight: 0.75,
      pulseMeasureTemplateWeight: 0.96,
      pulseEvidenceWeight: 0.68,
      pulsePartPatternWeight: 0.50,
      pulseBaseTemplateBonus: 0.32,
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
      partPatternBonus: 0.70,
      onsetPathWeight: 0.18,
      finalTonicBonus: 0.58,
      pulseMeasureTemplateWeight: 1.04,
      pulseEvidenceWeight: 0.62,
      pulsePartPatternWeight: 0.52,
      pulseBaseTemplateBonus: 0.34,
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
      partPatternBonus: 0.92,
      partPatternOnsetWeight: 0.46,
      partFamilyOnsetWeight: 0.55,
      cadenceOnsetWeight: 0.48,
      cadenceFunctionWeight: 0.22,
      cadenceFunctionTransitionWeight: 0.26,
      cadenceTokenTransitionWeight: 0.20,
      onsetPathWeight: 0.28,
      pulseRoleTemplateWeight: 0.84,
      pulseMeasureTemplateWeight: 1.06,
      pulseTransitionWeight: 0.82,
      pulseEvidenceWeight: 0.74,
      pulsePartPatternWeight: 0.58,
      pulseFuzzyPartWeight: 0.42,
      pulseFuzzyTuneWeight: 0.30,
      pulseBaseTemplateBonus: 0.28,
      slotWeights: {
        onset: 1.30,
        middle: 0.42,
        late: 0.86
      }
    });
  }

  if (["minor", "dorian"].indexOf(modeFamily) !== -1) {
    applyOverrides({
      finalTonicBonus: 0.26,
      partPatternOnsetWeight: profile.partPatternOnsetWeight + 0.04,
      partFamilyOnsetWeight: profile.partFamilyOnsetWeight + 0.05,
      cadenceOnsetWeight: profile.cadenceOnsetWeight + 0.08,
      cadenceFunctionWeight: profile.cadenceFunctionWeight + 0.10,
      cadenceFunctionTransitionWeight: profile.cadenceFunctionTransitionWeight + 0.08,
      cadenceTokenTransitionWeight: profile.cadenceTokenTransitionWeight + 0.06,
      minorPenultimateWeight: 0.44,
      cadenceTonicRerankWeight: 0.56,
      cadenceTonicRerankMargin: 0.48,
      pulseMeasureTemplateWeight: profile.pulseMeasureTemplateWeight + 0.06,
      pulsePartPatternWeight: profile.pulsePartPatternWeight + 0.04
    });
  } else if (modeFamily === "mixolydian") {
    applyOverrides({
      finalTonicBonus: Math.min(profile.finalTonicBonus, 0.36),
      cadenceOnsetWeight: profile.cadenceOnsetWeight + 0.04,
      cadenceFunctionWeight: profile.cadenceFunctionWeight + 0.04,
      pulseMeasureTemplateWeight: profile.pulseMeasureTemplateWeight + 0.04
    });
  } else if (modeFamily === "major") {
    applyOverrides({
      cadenceOnsetWeight: profile.cadenceOnsetWeight + 0.03,
      cadenceFunctionWeight: profile.cadenceFunctionWeight + 0.03,
      pulsePartPatternWeight: profile.pulsePartPatternWeight + 0.03
    });
  }

  if (hasIdentityExperimentFlag("type_mode_identity")) {
    applyOverrides({
      typeModeIdentityWeight: 0.52
    });
  }

  if (hasIdentityExperimentFlag("harmonic_function")) {
    applyOverrides({
      harmonicFunctionWeight: 0.34,
      harmonicTransitionWeight: 0.22
    });
  }

  if (hasIdentityExperimentFlag("minor_penultimate")) {
    applyOverrides({
      minorPenultimateWeight: 0.44
    });
  }

  if (hasIdentityExperimentFlag("cadence_tonic_rerank")) {
    applyOverrides({
      cadenceTonicRerankWeight: 0.56,
      cadenceTonicRerankMargin: 0.48
    });
  }

  if (predictionOptions.useOnsetLearner) {
    applyOverrides({
      onsetLearnerWeight: 0.002
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

    if (meterInfo.beatsPerBar === 2 && slice.beatInBar === 1) {
      return 1.18;
    }

    if (meterInfo.beatsPerBar === 3) {
      if (slice.beatInBar === 1) {
        return 1.08;
      }

      if (slice.beatInBar === 2) {
        return 1.00;
      }
    }

    return meterInfo.beatsPerBar > 2 && slice.beatInBar === Math.floor(meterInfo.beatsPerBar / 2) ? 1.0 : 0.82;
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

  if (parsedTune.meterInfo.raw === "6/8" && ["jig", "slide"].indexOf(typeName) !== -1) {
    if (slice.beatInBar === 0) {
      return 1.22;
    }

    if (slice.beatInBar === 1) {
      return 1.16;
    }
  }

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

function scoreRhythmChangePrior(parsedTune, slice) {
  var typeName = String(parsedTune.type || "").toLowerCase();

  if (slice.isPickup || slice.beatInBar === null) {
    return 0.12;
  }

  if (parsedTune.meterInfo.raw === "6/8" && ["jig", "slide"].indexOf(typeName) !== -1) {
    if (slice.beatInBar === 0) {
      return 0.72;
    }

    if (slice.beatInBar === 1) {
      return 0.58;
    }
  }

  if (parsedTune.meterInfo.raw === "9/8" && typeName === "slip jig") {
    if (slice.beatInBar === 0) {
      return 0.68;
    }

    if (slice.beatInBar === 1) {
      return 0.48;
    }

    if (slice.beatInBar === 2) {
      return 0.40;
    }
  }

  if (parsedTune.meterInfo.raw === "4/4" && ["reel", "hornpipe", "strathspey", "march"].indexOf(typeName) !== -1) {
    if (slice.beatInBar === 0) {
      return 0.78;
    }

    if (slice.beatInBar === 2) {
      return 0.42;
    }

    return -0.46;
  }

  if (parsedTune.meterInfo.raw === "2/4" && ["polka", "barndance"].indexOf(typeName) !== -1) {
    return slice.beatInBar === 0 ? 0.56 : 0.10;
  }

  if (parsedTune.meterInfo.raw === "3/4" && ["waltz", "mazurka"].indexOf(typeName) !== -1) {
    return slice.beatInBar === 0 ? 0.70 : -0.22;
  }

  return (beatStrength(slice, parsedTune.meterInfo) - 1) * 0.45;
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

  if (slice.measuresFromPartEnd === 1) {
    mergeCandidateBucket(output, model.counts.cadenceOnsetChordTotals[buildCadenceOnsetKey(slice, parsedTune)], 8);
  }
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
  var roleBucket = model.counts.rolePositions[buildRolePartPositionKey(slice, parsedTune)] || {};
  var phraseBucket = model.counts.phrasePositions[buildPhraseContextKey(slice, parsedTune)] || {};
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
    (0.00 * logProbability(phraseBucket, token, 0.8, roleBucket)) +
    (0.10 * logProbability(roleBucket, token, 0.8, partBucket)) +
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
  var fallbackBucket = model.counts.cadencePositions[buildCadenceKey(slice, parsedTune)] ||
    model.counts.styleChordTotals[buildStyleKey(parsedTune)] || {};
  return 0.85 * logProbability(endingBucket, token, 0.7, fallbackBucket);
}

function scoreTypeModeIdentity(model, token, parsedTune, slice, predictedOnsetLabel, decoderProfile) {
  var bucket;
  var fallbackBucket;
  var roleBucket;
  var score;

  if (predictedOnsetLabel !== "change" || !decoderProfile.typeModeIdentityWeight) {
    return 0;
  }

  bucket = model.counts.typeModeOnsetChordTotals[buildTypeModeIdentityKey(slice, parsedTune)] || {};
  roleBucket = model.counts.onsetRolePositionChordTotals[buildRolePartPositionKey(slice, parsedTune)] || {};
  fallbackBucket = model.counts.onsetPositionChordTotals[buildPartPositionKey(slice, parsedTune)] ||
    model.counts.onsetStyleChordTotals[buildStyleKey(parsedTune)] ||
    model.counts.modeChordTotals[parsedTune.modeInfo.modeFamily] || {};

  score = decoderProfile.typeModeIdentityWeight * logProbability(bucket, token, 0.8, fallbackBucket);
  score += 0.12 * logProbability(roleBucket, token, 0.8, fallbackBucket);

  return score;
}

function scoreHarmonicFunction(model, token, parsedTune, slice, predictedOnsetLabel, previousToken, decoderProfile) {
  var functionName;
  var functionBucket;
  var fallbackBucket;
  var transitionScore = 0;

  if (predictedOnsetLabel !== "change" || (!decoderProfile.harmonicFunctionWeight && !decoderProfile.harmonicTransitionWeight)) {
    return 0;
  }

  functionName = harmonicFunctionForToken(token, parsedTune.modeInfo);
  functionBucket = model.counts.typeModeFunctionTotals[buildTypeModeIdentityKey(slice, parsedTune)] || {};
  fallbackBucket = model.counts.modeFunctionTotals[parsedTune.modeInfo.modeFamily] || {};

  if (previousToken && previousToken !== "__START__" && decoderProfile.harmonicTransitionWeight) {
    transitionScore = decoderProfile.harmonicTransitionWeight * logProbability(
      (model.counts.modeFunctionTransitions[parsedTune.modeInfo.modeFamily] || {})[harmonicFunctionForToken(previousToken, parsedTune.modeInfo)] || {},
      functionName,
      0.8,
      fallbackBucket
    );
  }

  return (decoderProfile.harmonicFunctionWeight * logProbability(functionBucket, functionName, 0.8, fallbackBucket)) + transitionScore;
}

function scoreCadenceResolution(model, token, parsedTune, slice, predictedOnsetLabel, previousToken, decoderProfile) {
  var functionName;
  var functionBucket;
  var transitionBucket;
  var fallbackBucket;
  var previousFunction;
  var score = 0;

  if (predictedOnsetLabel !== "change" ||
      !decoderProfile.cadenceFunctionWeight ||
      slice.isPickup ||
      slice.measuresFromPartEnd === null ||
      slice.measuresFromPartEnd > 1) {
    return 0;
  }

  functionName = harmonicFunctionForToken(token, parsedTune.modeInfo);
  functionBucket = model.counts.cadenceFunctionTotals[buildCadenceFunctionKey(slice, parsedTune)] || {};
  fallbackBucket = model.counts.typeModeFunctionTotals[buildTypeModeIdentityKey(slice, parsedTune)] ||
    model.counts.modeFunctionTotals[parsedTune.modeInfo.modeFamily] || {};
  score += decoderProfile.cadenceFunctionWeight * logProbability(functionBucket, functionName, 0.8, fallbackBucket);

  if (!decoderProfile.cadenceFunctionTransitionWeight || !previousToken || previousToken === "__START__") {
    return score;
  }

  previousFunction = harmonicFunctionForToken(previousToken, parsedTune.modeInfo);
  transitionBucket = model.counts.cadenceFunctionTransitions[
    buildCadenceFunctionTransitionKey(parsedTune, slice, previousFunction)
  ] || {};
  score += decoderProfile.cadenceFunctionTransitionWeight * logProbability(transitionBucket, functionName, 0.8, functionBucket);

  return score;
}

function scoreCadenceTokenTransition(model, token, parsedTune, slice, predictedOnsetLabel, previousToken, decoderProfile) {
  var transitionBucket;
  var fallbackBucket;

  if (predictedOnsetLabel !== "change" ||
      !decoderProfile.cadenceTokenTransitionWeight ||
      !previousToken ||
      previousToken === "__START__" ||
      slice.isPickup ||
      slice.measuresFromPartEnd === null ||
      slice.measuresFromPartEnd > 1) {
    return 0;
  }

  transitionBucket = model.counts.cadenceTokenTransitions[
    buildCadenceTokenTransitionKey(parsedTune, slice, previousToken)
  ] || {};
  fallbackBucket = model.counts.cadenceOnsetChordTotals[buildCadenceOnsetKey(slice, parsedTune)] ||
    model.counts.typeModeOnsetChordTotals[buildTypeModeIdentityKey(slice, parsedTune)] ||
    model.counts.onsetPositionChordTotals[buildPartPositionKey(slice, parsedTune)] || {};

  return decoderProfile.cadenceTokenTransitionWeight * logProbability(transitionBucket, token, 0.8, fallbackBucket);
}

function scoreMinorPenultimateRerank(token, parsedTune, slice, predictedOnsetLabel, decoderProfile) {
  var modeFamily = parsedTune.modeInfo.modeFamily;

  if (!decoderProfile.minorPenultimateWeight ||
      predictedOnsetLabel !== "change" ||
      slice.measuresFromPartEnd !== 1 ||
      ["minor", "dorian"].indexOf(modeFamily) === -1) {
    return 0;
  }

  if (isTonicToken(token, parsedTune.modeInfo)) {
    return -1 * decoderProfile.minorPenultimateWeight;
  }

  if (harmonicFunctionForToken(token, parsedTune.modeInfo) === "dominant") {
    return 0.58 * decoderProfile.minorPenultimateWeight;
  }

  return 0;
}

function applyCadenceTonicRerank(model, currentLayer, slice, parsedTune, predictedOnsetLabel, decoderProfile) {
  var tonicToken;
  var orderedTokens;
  var bestToken;
  var bestNonTonicToken = null;
  var bestNonTonicScore = -Infinity;
  var cadenceOnsetBucket;
  var cadenceOrdered;
  var i;

  if (!decoderProfile.cadenceTonicRerankWeight ||
      predictedOnsetLabel !== "change" ||
      slice.measuresFromPartEnd === null ||
      slice.measuresFromPartEnd > 1) {
    return;
  }

  tonicToken = parsedTune.modeInfo.modeFamily === "minor" || parsedTune.modeInfo.modeFamily === "dorian" ? "1:min" : "1:maj";
  orderedTokens = Object.keys(currentLayer || {}).sort(function (left, right) {
    return currentLayer[right].score - currentLayer[left].score;
  });
  if (!orderedTokens.length) {
    return;
  }

  bestToken = orderedTokens[0];
  if (bestToken !== tonicToken) {
    return;
  }

  for (i = 0; i < orderedTokens.length; i += 1) {
    if (orderedTokens[i] === tonicToken) {
      continue;
    }

    if (currentLayer[orderedTokens[i]].score > bestNonTonicScore) {
      bestNonTonicScore = currentLayer[orderedTokens[i]].score;
      bestNonTonicToken = orderedTokens[i];
    }
  }

  if (!bestNonTonicToken) {
    return;
  }

  if (slice.measuresFromPartEnd === 1) {
    cadenceOnsetBucket = model.counts.cadenceOnsetChordTotals[buildCadenceOnsetKey(slice, parsedTune)] || {};
    cadenceOrdered = Object.keys(cadenceOnsetBucket).sort(function (left, right) {
      return cadenceOnsetBucket[right] - cadenceOnsetBucket[left];
    });

    for (i = 0; i < cadenceOrdered.length; i += 1) {
      if (cadenceOrdered[i] === tonicToken || !currentLayer[cadenceOrdered[i]]) {
        continue;
      }

      bestNonTonicToken = cadenceOrdered[i];
      bestNonTonicScore = currentLayer[bestNonTonicToken].score;
      break;
    }
  }

  if ((currentLayer[tonicToken].score - bestNonTonicScore) <= decoderProfile.cadenceTonicRerankMargin) {
    currentLayer[tonicToken].score -= decoderProfile.cadenceTonicRerankWeight;
    currentLayer[bestNonTonicToken].score += 0.55 * decoderProfile.cadenceTonicRerankWeight;
  }
}

function scoreChangePreference(model, parsedTune, slice, decoderProfile) {
  decoderProfile = decoderProfile || buildDecoderProfile(parsedTune);
  var styleBucket = model.counts.onsetStyles[buildStyleKey(parsedTune)] || {};
  var typeMeterBucket = model.counts.typeMeterOnsetStyles[buildTypeMeterKey(parsedTune)] || {};
  var styleBeatBucket = slice.beatInBar === null ? {} : (model.counts.styleBeatOnsetStyles[buildStyleBeatKey(slice, parsedTune)] || {});
  var typeMeterBeatBucket = slice.beatInBar === null ? {} : (model.counts.typeMeterBeatOnsetStyles[buildTypeMeterBeatKey(slice, parsedTune)] || {});
  var roleBeatBucket = slice.beatInBar === null ? {} : (model.counts.roleBeatOnsetStyles[buildRoleBeatKey(slice, parsedTune)] || {});
  var positionBucket = model.counts.onsetPositions[buildPositionKey(slice, parsedTune)] || {};
  var partBucket = model.counts.onsetPartPositions[buildPartPositionKey(slice, parsedTune)] || {};
  var roleBucket = model.counts.onsetRolePositions[buildRolePartPositionKey(slice, parsedTune)] || {};
  var phraseBucket = model.counts.onsetPhrasePositions[buildPhraseContextKey(slice, parsedTune)] || {};
  var signatureBucket = model.counts.onsetSignatures[buildSignatureKey(slice, parsedTune)] || {};
  var measureSignatureBucket = model.counts.onsetMeasureSignatures[buildMeasureSignatureKey(slice, parsedTune)] || {};

  var changeScore = (
    (0.35 * logDecisionProbability(styleBucket, "change", 1.1)) +
    (0.45 * logDecisionProbability(typeMeterBucket, "change", 1.1)) +
    (0.36 * logDecisionProbability(styleBeatBucket, "change", 1.1)) +
    (0.55 * logDecisionProbability(typeMeterBeatBucket, "change", 1.1)) +
    (0.32 * logDecisionProbability(roleBeatBucket, "change", 1.1)) +
    (decoderProfile.phraseOnsetWeight * logDecisionProbability(phraseBucket, "change", 1.1)) +
    (0.42 * logDecisionProbability(roleBucket, "change", 1.1)) +
    (0.70 * logDecisionProbability(positionBucket, "change", 1.1)) +
    (0.85 * logDecisionProbability(partBucket, "change", 1.1)) +
    (1.10 * logDecisionProbability(signatureBucket, "change", 1.1)) +
    (1.30 * logDecisionProbability(measureSignatureBucket, "change", 1.1))
  );

  var stayScore = (
    (0.35 * logDecisionProbability(styleBucket, "stay", 1.1)) +
    (0.45 * logDecisionProbability(typeMeterBucket, "stay", 1.1)) +
    (0.36 * logDecisionProbability(styleBeatBucket, "stay", 1.1)) +
    (0.55 * logDecisionProbability(typeMeterBeatBucket, "stay", 1.1)) +
    (0.32 * logDecisionProbability(roleBeatBucket, "stay", 1.1)) +
    (decoderProfile.phraseOnsetWeight * logDecisionProbability(phraseBucket, "stay", 1.1)) +
    (0.42 * logDecisionProbability(roleBucket, "stay", 1.1)) +
    (0.70 * logDecisionProbability(positionBucket, "stay", 1.1)) +
    (0.85 * logDecisionProbability(partBucket, "stay", 1.1)) +
    (1.10 * logDecisionProbability(signatureBucket, "stay", 1.1)) +
    (1.30 * logDecisionProbability(measureSignatureBucket, "stay", 1.1))
  );

  return clamp(
    changeScore - stayScore +
    ((beatStrength(slice, parsedTune.meterInfo) - 1) * decoderProfile.beatStrengthBiasWeight) +
    (decoderProfile.placementRhythmWeight * scoreRhythmChangePrior(parsedTune, slice)),
    -2.8,
    2.8
  );
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

function buildPulsePartPatternHints(model, parsedTune, pulseBars) {
  var output = {};
  var barsByPart = {};

  (pulseBars || []).forEach(function (pulseBar) {
    if (!barsByPart[pulseBar.partIndex]) {
      barsByPart[pulseBar.partIndex] = [];
    }
    barsByPart[pulseBar.partIndex].push(pulseBar);
  });

  getPartFingerprints(parsedTune).forEach(function (partFingerprint) {
    var targetBars = barsByPart[partFingerprint.partIndex] || [];
    var sampleBar = targetBars[0];
    var bucket;

    if (!sampleBar) {
      return;
    }

    bucket = model.counts.pulsePartPatterns[buildPulsePartPatternKey(parsedTune, sampleBar)] || {};
    sortedBucketEntries(bucket).slice(0, 4).forEach(function (entry) {
      var templates = parsePulsePatternString(entry.key);
      targetBars.forEach(function (pulseBar) {
        var template = templates[String(pulseBar.measureInPart)];
        if (!template) {
          return;
        }

        incrementCount(ensureNestedMap(output, pulseBar.rawBarIndex), template, entry.count);
      });
    });
  });

  return output;
}

function buildFuzzyPulsePartTemplateHints(model, parsedTune, pulseBars) {
  var entries = model.counts.fuzzyPulsePartLibrary || [];
  var output = {};
  var targetStructuralKey = buildPlacementStructuralKey(parsedTune);
  var barsByPart = {};
  var rankedMatches = [];

  if (!entries.length || !getPartFingerprints(parsedTune).length) {
    return output;
  }

  (pulseBars || []).forEach(function (pulseBar) {
    if (!barsByPart[pulseBar.partIndex]) {
      barsByPart[pulseBar.partIndex] = [];
    }
    barsByPart[pulseBar.partIndex].push(pulseBar);
  });

  getPartFingerprints(parsedTune).forEach(function (targetPart) {
    var targetBars = barsByPart[targetPart.partIndex] || [];
    var targetRole = buildEndingRole(parsedTune, targetPart.partIndex);

    if (!targetBars.length) {
      return;
    }

    entries.forEach(function (entry) {
      var similarity;
      if (String(entry.familyKey || "").indexOf(targetStructuralKey + "|") !== 0) {
        return;
      }

      if (entry.endingRole !== targetRole) {
        return;
      }

      if (Math.abs((entry.partLength || 0) - ((targetPart.measureSignatures || []).length || 0)) > 2) {
        return;
      }

      similarity = scorePartFingerprintSimilarity(targetPart.measureSignatures, entry.measureSignatures);
      if (!isFinite(similarity) || similarity <= 1.15) {
        return;
      }

      if (entry.modeFamily === parsedTune.modeInfo.modeFamily) {
        similarity += 0.75;
      }

      if ((entry.partLength || 0) === ((targetPart.measureSignatures || []).length || 0)) {
        similarity += 0.35;
      }

      rankedMatches.push({
        partIndex: targetPart.partIndex,
        similarity: similarity,
        modeMatch: entry.modeFamily === parsedTune.modeInfo.modeFamily,
        templates: entry.templates || {},
        weight: entry.weight || 1
      });
    });
  });

  rankedMatches.sort(function (left, right) {
    return right.similarity - left.similarity;
  });

  selectModeAwareMatches(rankedMatches, true, 10).forEach(function (match) {
    var targetBars = barsByPart[match.partIndex] || [];
    targetBars.forEach(function (pulseBar) {
      var template = match.templates[String(pulseBar.measureInPart)];
      if (!template) {
        return;
      }

      incrementCount(
        ensureNestedMap(output, pulseBar.rawBarIndex),
        template,
        match.similarity * (match.weight || 1)
      );
    });
  });

  return output;
}

function buildFuzzyPulseTuneTemplateHints(model, parsedTune, pulseBars) {
  var entries = model.counts.fuzzyPulseTuneLibrary || [];
  var output = {};
  var targetSignatures = buildTuneMeasureSignatures(parsedTune);
  var targetStructuralKey = buildPlacementStructuralKey(parsedTune);
  var barsBySlot = {};
  var rankedMatches = [];

  if (!entries.length || !targetSignatures.length) {
    return output;
  }

  (pulseBars || []).forEach(function (pulseBar) {
    barsBySlot[buildPartSlotKey(pulseBar.partIndex, pulseBar.measureInPart, 0)] = pulseBar;
  });

  entries.forEach(function (entry) {
    var similarity;
    if (String(entry.familyKey || "").indexOf(targetStructuralKey + "|") !== 0) {
      return;
    }

    if (entry.measureSignatures.length < Math.max(2, targetSignatures.length - 4) ||
        entry.measureSignatures.length > targetSignatures.length + 4) {
      return;
    }

    similarity = scoreTuneFingerprintSimilarity(targetSignatures, entry.measureSignatures);
    if (!isFinite(similarity) || similarity <= 3.8) {
      return;
    }

    if (entry.modeFamily === parsedTune.modeInfo.modeFamily) {
      similarity += 0.90;
    }

    if ((entry.partCount || 0) === (getPartFingerprints(parsedTune).length || 0)) {
      similarity += 0.45;
    }

    rankedMatches.push({
      similarity: similarity,
      modeMatch: entry.modeFamily === parsedTune.modeInfo.modeFamily,
      templates: entry.templates || {},
      weight: entry.weight || 1
    });
  });

  rankedMatches.sort(function (left, right) {
    return right.similarity - left.similarity;
  });

  selectModeAwareMatches(rankedMatches, true, 8).forEach(function (match) {
    Object.keys(match.templates).forEach(function (slotKey) {
      var pulseBar = barsBySlot[slotKey];
      if (!pulseBar) {
        return;
      }

      incrementCount(
        ensureNestedMap(output, pulseBar.rawBarIndex),
        match.templates[slotKey],
        match.similarity * (match.weight || 1)
      );
    });
  });

  return output;
}

function buildPulsePredictionHintSources(model, parsedTune) {
  var pulseBars = buildPulseBars(parsedTune);

  return {
    pulseBars: pulseBars,
    partPatternHints: buildPulsePartPatternHints(model, parsedTune, pulseBars),
    fuzzyPartHints: buildFuzzyPulsePartTemplateHints(model, parsedTune, pulseBars),
    fuzzyTuneHints: buildFuzzyPulseTuneTemplateHints(model, parsedTune, pulseBars)
  };
}

function buildPulseOnsetHints(model, parsedTune) {
  var pulseSources = buildPulsePredictionHintSources(model, parsedTune);
  var output = {};
  var placementFamily = placementFamilyForTune(parsedTune);

  if (["duple-strong2", "simple-duple"].indexOf(placementFamily) !== -1) {
    return output;
  }

  (pulseSources.pulseBars || []).forEach(function (pulseBar) {
    var aggregated = {};
    var leader;
    var expanded;

    function absorb(bucket, weight) {
      Object.keys(bucket || {}).forEach(function (template) {
        incrementCount(aggregated, template, (bucket[template] || 0) * weight);
      });
    }

    absorb(model.counts.pulseRolePositionTemplates[buildPulseRolePositionKey(parsedTune, pulseBar)] || {}, 0.90);
    absorb(model.counts.pulseMeasureSignatureTemplates[buildPulseMeasureSignatureKey(parsedTune, pulseBar)] || {}, 1.10);
    absorb((pulseSources.partPatternHints || {})[pulseBar.rawBarIndex] || {}, 1.15);
    absorb((pulseSources.fuzzyPartHints || {})[pulseBar.rawBarIndex] || {}, 0.90);
    absorb((pulseSources.fuzzyTuneHints || {})[pulseBar.rawBarIndex] || {}, 0.75);

    leader = describeBucketLeader(aggregated);
    if (!leader || !leader.decisive || leader.confidence < 0.56) {
      return;
    }

    expanded = expandPulseTemplateToOnsets(pulseBar, leader.token);
    Object.keys(expanded).forEach(function (indexKey) {
      output[indexKey] = {
        label: expanded[indexKey],
        confidence: leader.confidence
      };
    });
  });

  return output;
}

function buildPredictionHintSources(model, parsedTune) {
  return {
    measurePatternHints: buildMeasurePatternHints(model, parsedTune),
    onsetMeasurePatternHints: buildOnsetMeasurePatternHints(model, parsedTune),
    partOnsetHints: buildPartPatternHints(model, parsedTune, "partOnsetPatterns"),
    endingTokenHints: buildEndingPatternHints(model, parsedTune, "endingTokenPatterns"),
    endingOnsetHints: buildEndingPatternHints(model, parsedTune, "endingOnsetPatterns"),
    exactMelodyPathHints: buildExactMelodyPathHints(model, parsedTune),
    canonicalMelodyHints: buildCanonicalMelodyHints(model, parsedTune),
    fuzzyPartHints: buildFuzzyPartHints(model, parsedTune),
    fuzzyPartFamilyHints: buildFuzzyPartFamilyHints(model, parsedTune),
    fuzzyTuneHints: buildFuzzyTuneHints(model, parsedTune),
    pulseOnsetHints: buildPulseOnsetHints(model, parsedTune)
  };
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

function buildPartPatternHints(model, parsedTune, bucketName) {
  var output = {};

  getPartFingerprints(parsedTune).forEach(function (partFingerprint) {
    var bucket = model.counts[bucketName][buildPartPatternKey(parsedTune, partFingerprint.partIndex, (partFingerprint.measureSignatures || []).length)] || {};
    var topPattern = selectTopKey(bucket);
    if (!topPattern) {
      return;
    }

    topPattern.split("/").forEach(function (piece) {
      var equalIndex = piece.indexOf("=");
      var slotKey;
      var value;
      var slotParts;

      if (equalIndex === -1) {
        return;
      }

      slotKey = piece.slice(0, equalIndex);
      value = piece.slice(equalIndex + 1);
      slotParts = slotKey.split("|");

      output[buildPartSlotKey(partFingerprint.partIndex, parseInt(slotParts[0], 10), parseInt(slotParts[1], 10))] = value;
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

function buildIdentityEventSlice(parsedTune, onsetIndex, nextOnsetIndex) {
  var onsetSlice = parsedTune.beatSlices[onsetIndex];
  var eventSlice = Object.assign({}, onsetSlice, {
    noteWeights: copyMap(onsetSlice.noteWeights || {}),
    spanEndIndex: nextOnsetIndex - 1,
    spanLength: Math.max(1, nextOnsetIndex - onsetIndex)
  });
  var index;

  for (index = onsetIndex + 1; index < nextOnsetIndex; index += 1) {
    Object.keys(parsedTune.beatSlices[index].noteWeights || {}).forEach(function (pcKey) {
      eventSlice.noteWeights[pcKey] = (eventSlice.noteWeights[pcKey] || 0) + parsedTune.beatSlices[index].noteWeights[pcKey];
    });
  }

  return eventSlice;
}

function buildPlacementFirstIdentityPath(model, parsedTune, decoderProfile, hintSources, predictedOnsetPath, globalCandidates) {
  var onsetIndexes = [];
  var onsetTokenByIndex = {};
  var layers = [];
  var styleKey = buildStyleKey(parsedTune);
  var eventIndex;
  var i;

  for (i = 0; i < parsedTune.beatSlices.length; i += 1) {
    if (i === 0 || predictedOnsetPath[i] === "change") {
      onsetIndexes.push(i);
    }
  }

  if (!onsetIndexes.length && parsedTune.beatSlices.length) {
    onsetIndexes.push(0);
  }

  for (eventIndex = 0; eventIndex < onsetIndexes.length; eventIndex += 1) {
    var onsetIndex = onsetIndexes[eventIndex];
    var nextOnsetIndex = eventIndex + 1 < onsetIndexes.length ? onsetIndexes[eventIndex + 1] : parsedTune.beatSlices.length;
    var slice = buildIdentityEventSlice(parsedTune, onsetIndex, nextOnsetIndex);
    var candidates = getCandidateTokensForSlice(model, parsedTune, slice);
    var fuzzySlotKey = buildPartSlotKey(slice.partIndex, slice.measureInPart, slice.beatInBar);
    var measureHintToken = (hintSources.measurePatternHints[slice.rawBarIndex] || {})[String(slice.beatInBar)] || null;
    var exactHintToken = hintSources.exactMelodyPathHints[onsetIndex] || null;
    var canonicalHintBucket = hintSources.canonicalMelodyHints.tokens[fuzzySlotKey] || {};
    var canonicalHintLeader = describeBucketLeader(canonicalHintBucket);
    var canonicalHintToken = canonicalHintLeader ? canonicalHintLeader.token : null;
    var fuzzyHintBucket = hintSources.fuzzyPartHints[fuzzySlotKey] || {};
    var fuzzyHintToken = selectTopKey(fuzzyHintBucket);
    var endingTokenHint = hintSources.endingTokenHints[fuzzySlotKey] || null;
    var currentLayer = {};
    var previousLayer;
    var j;

    globalCandidates.slice(0, 10).forEach(function (token) {
      if (candidates.indexOf(token) === -1) {
        candidates.push(token);
      }
    });
    mergeCandidateBucket(candidates, model.counts.typeModeOnsetChordTotals[buildTypeModeIdentityKey(slice, parsedTune)], 10);

    [measureHintToken, exactHintToken, canonicalHintToken, fuzzyHintToken, endingTokenHint].forEach(function (token) {
      if (token && candidates.indexOf(token) === -1) {
        candidates.unshift(token);
      }
    });

    if (candidates.length === 0) {
      candidates = globalCandidates.slice();
    }

    previousLayer = eventIndex > 0 ? layers[eventIndex - 1] : null;

    for (j = 0; j < candidates.length; j += 1) {
      var token = candidates[j];
      var emissionScore = scoreEmission(model, token, slice, parsedTune.modeInfo, parsedTune, decoderProfile);
      var sliceContextScore = scoreSliceContext(model, token, parsedTune, slice);
      var endingFinalOnsetScore = scoreEndingFinalOnset(model, token, parsedTune, slice);
      var typeModeIdentityScore = scoreTypeModeIdentity(model, token, parsedTune, slice, "change", decoderProfile);
      var harmonicFunctionScore = scoreHarmonicFunction(model, token, parsedTune, slice, "change", "__START__", decoderProfile);
      var cadenceResolutionScore = scoreCadenceResolution(model, token, parsedTune, slice, "change", "__START__", decoderProfile);
      var cadenceTokenTransitionScore = scoreCadenceTokenTransition(model, token, parsedTune, slice, "change", "__START__", decoderProfile);
      var minorPenultimateScore = scoreMinorPenultimateRerank(token, parsedTune, slice, "change", decoderProfile);
      var measurePatternBonus = measureHintToken && measureHintToken === token ? decoderProfile.measurePatternBonus : 0;
      var exactMelodyBonus = exactHintToken && exactHintToken === token ? decoderProfile.exactHintBonus : 0;
      var canonicalMelodyBonus = canonicalHintToken && canonicalHintToken === token ? Math.min(
        1.85,
        0.70 + (0.95 * (canonicalHintLeader ? canonicalHintLeader.confidence : 1))
      ) : 0;
      var fuzzyPartBonus = fuzzyHintToken && fuzzyHintToken === token ? Math.min(
        2.0,
        decoderProfile.fuzzyHintWeight * (fuzzyHintBucket[token] || 0)
      ) : 0;
      var endingTokenBonus = endingTokenHint && endingTokenHint === token ? (slice.measuresFromPartEnd === 0 ? 1.05 : 0.72) : 0;

      if (!previousLayer) {
        var startTransition = logProbability(getTransitionBucket(model, styleKey, "__START__"), token, 0.8, model.counts.chordTotals);
        currentLayer[token] = {
          score: (decoderProfile.emissionWeight * emissionScore) +
            (decoderProfile.contextWeight * sliceContextScore) +
            endingFinalOnsetScore +
            typeModeIdentityScore +
            harmonicFunctionScore +
            cadenceResolutionScore +
            cadenceTokenTransitionScore +
            minorPenultimateScore +
            (decoderProfile.startTransitionWeight * startTransition) +
            measurePatternBonus +
            exactMelodyBonus +
            canonicalMelodyBonus +
            fuzzyPartBonus +
            endingTokenBonus,
          previous: null
        };
        continue;
      }

      var bestPrevious = null;
      var bestScore = -Infinity;
      var previousTokens = Object.keys(previousLayer);
      var k;

      for (k = 0; k < previousTokens.length; k += 1) {
        var previousToken = previousTokens[k];
        if (previousToken === token) {
          continue;
        }
        var transitionScore = logProbability(getTransitionBucket(model, styleKey, previousToken), token, 0.8, model.counts.chordTotals);
        var candidateScore = previousLayer[previousToken].score +
          (decoderProfile.emissionWeight * emissionScore) +
          (decoderProfile.contextWeight * sliceContextScore) +
          endingFinalOnsetScore +
          typeModeIdentityScore +
          scoreHarmonicFunction(model, token, parsedTune, slice, "change", previousToken, decoderProfile) +
          scoreCadenceResolution(model, token, parsedTune, slice, "change", previousToken, decoderProfile) +
          scoreCadenceTokenTransition(model, token, parsedTune, slice, "change", previousToken, decoderProfile) +
          minorPenultimateScore +
          (decoderProfile.transitionWeight * transitionScore) +
          measurePatternBonus +
          exactMelodyBonus +
          canonicalMelodyBonus +
          fuzzyPartBonus +
          endingTokenBonus;

        if (eventIndex === onsetIndexes.length - 1 && token.indexOf("1:") === 0) {
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

    applyCadenceTonicRerank(model, currentLayer, slice, parsedTune, "change", decoderProfile);
    layers.push(currentLayer);
  }

  if (!layers.length) {
    return globalCandidates.length ? parsedTune.beatSlices.map(function () { return globalCandidates[0]; }) : [];
  }

  var onsetPath = [];
  var lastLayer = layers[layers.length - 1];
  var bestEndingToken = null;
  var bestEndingScore = -Infinity;

  Object.keys(lastLayer).forEach(function (token) {
    if (lastLayer[token].score > bestEndingScore) {
      bestEndingScore = lastLayer[token].score;
      bestEndingToken = token;
    }
  });

  for (eventIndex = layers.length - 1; eventIndex >= 0; eventIndex -= 1) {
    onsetPath.unshift(bestEndingToken);
    bestEndingToken = layers[eventIndex][bestEndingToken].previous;
  }

  for (eventIndex = 0; eventIndex < onsetIndexes.length; eventIndex += 1) {
    onsetTokenByIndex[onsetIndexes[eventIndex]] = onsetPath[eventIndex];
  }

  var expandedPath = [];
  var activeToken = onsetPath[0] || globalCandidates[0] || null;

  for (i = 0; i < parsedTune.beatSlices.length; i += 1) {
    if (Object.prototype.hasOwnProperty.call(onsetTokenByIndex, i)) {
      activeToken = onsetTokenByIndex[i];
    }

    expandedPath.push(activeToken);
  }

  return expandedPath;
}

function buildCanonicalMelodyHints(model, parsedTune) {
  return {
    tokens: model.counts.canonicalMelodyTokens[parsedTune.canonicalMelodyFingerprint] || {},
    onsets: model.counts.canonicalMelodyOnsets[parsedTune.canonicalMelodyFingerprint] || {}
  };
}

function buildFuzzyPartHints(model, parsedTune) {
  var output = {};
  var entries = model.counts.fuzzyPartLibrary || [];
  var topMatches = [];

  if (!getPartFingerprints(parsedTune).length || !entries.length) {
    return output;
  }

  getPartFingerprints(parsedTune).forEach(function (targetPart) {
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
        modeMatch: entry.modeFamily === parsedTune.modeInfo.modeFamily,
        slots: entry.slots,
        weight: entry.weight || 1
      });
    });
  });

  topMatches.sort(function (left, right) {
    return right.similarity - left.similarity;
  });

  selectModeAwareMatches(topMatches, true, 8).forEach(function (match) {
    Object.keys(match.slots || {}).forEach(function (slotKey) {
      var parts = slotKey.split("|");
      var targetSlotKey = buildPartSlotKey(match.partIndex, parseInt(parts[0], 10), parseInt(parts[1], 10));

      if (!output[targetSlotKey]) {
        output[targetSlotKey] = {};
      }

      incrementCount(output[targetSlotKey], match.slots[slotKey], match.similarity * (match.weight || 1));
    });
  });

  return output;
}

function buildFuzzyPartFamilyHints(model, parsedTune) {
  var entries = model.counts.fuzzyPartFamilyLibrary || [];
  var output = {
    tokens: {},
    onsets: {}
  };
  var rankedMatches = [];

  if (!getPartFingerprints(parsedTune).length || !entries.length) {
    return output;
  }

  getPartFingerprints(parsedTune).forEach(function (targetPart) {
    entries.forEach(function (entry) {
      var similarity;

      if (entry.typeMeterKey !== buildTypeMeterKey(parsedTune)) {
        return;
      }

      if (entry.endingRole !== buildEndingRole(parsedTune, targetPart.partIndex)) {
        return;
      }

      if (Math.abs((entry.partLength || 0) - ((targetPart.measureSignatures || []).length || 0)) > 2) {
        return;
      }

      similarity = scorePartFingerprintSimilarity(targetPart.measureSignatures, entry.measureSignatures);
      if (!isFinite(similarity) || similarity <= 1.25) {
        return;
      }

      if (entry.modeFamily === parsedTune.modeInfo.modeFamily) {
        similarity += 0.75;
      }

      if ((entry.partLength || 0) === ((targetPart.measureSignatures || []).length || 0)) {
        similarity += 0.35;
      }

      rankedMatches.push({
        partIndex: targetPart.partIndex,
        similarity: similarity,
        modeMatch: entry.modeFamily === parsedTune.modeInfo.modeFamily,
        slots: entry.slots || {},
        onsets: entry.onsets || {},
        weight: entry.weight || 1
      });
    });
  });

  rankedMatches.sort(function (left, right) {
    return right.similarity - left.similarity;
  });

  selectModeAwareMatches(rankedMatches, true, 10).forEach(function (match) {
    Object.keys(match.slots).forEach(function (slotKey) {
      var parts = slotKey.split("|");
      var targetSlotKey = buildPartSlotKey(match.partIndex, parseInt(parts[0], 10), parseInt(parts[1], 10));

      if (!output.tokens[targetSlotKey]) {
        output.tokens[targetSlotKey] = {};
      }

      incrementCount(output.tokens[targetSlotKey], match.slots[slotKey], match.similarity * match.weight);
    });
  });

  selectModeAwareMatches(rankedMatches, false, 10).forEach(function (match) {
    Object.keys(match.onsets).forEach(function (slotKey) {
      var parts = slotKey.split("|");
      var targetSlotKey = buildPartSlotKey(match.partIndex, parseInt(parts[0], 10), parseInt(parts[1], 10));

      if (!output.onsets[targetSlotKey]) {
        output.onsets[targetSlotKey] = {};
      }

      incrementCount(output.onsets[targetSlotKey], match.onsets[slotKey], match.similarity * match.weight);
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

    if ((entry.partCount || 0) === (getPartFingerprints(parsedTune).length || 0)) {
      similarity += 0.45;
    }

    rankedMatches.push({
      similarity: similarity,
      modeMatch: entry.modeFamily === parsedTune.modeInfo.modeFamily,
      slots: entry.slots || {},
      onsets: entry.onsets || {},
      weight: entry.weight || 1
    });
  });

  rankedMatches.sort(function (left, right) {
    return right.similarity - left.similarity;
  });

  selectModeAwareMatches(rankedMatches, true, 6).forEach(function (match) {
    Object.keys(match.slots).forEach(function (slotKey) {
      if (!output.tokens[slotKey]) {
        output.tokens[slotKey] = {};
      }

      incrementCount(output.tokens[slotKey], match.slots[slotKey], match.similarity * match.weight);
    });
  });

  selectModeAwareMatches(rankedMatches, false, 6).forEach(function (match) {
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

function getOnsetTransitionBucket(model, styleKey, previousLabel) {
  var styleParts = String(styleKey).split("|");
  var typeMeterKey = styleParts.slice(0, 2).join("|");
  var styleTransitions = model.counts.styleOnsetTransitions[styleKey] || {};
  var typeMeterTransitions = model.counts.typeMeterOnsetTransitions[typeMeterKey] || {};
  return styleTransitions[previousLabel] || typeMeterTransitions[previousLabel] || model.counts.onsetTransitions[previousLabel];
}

function buildPredictedOnsetPath(model, parsedTune, decoderProfile, hintSources, predictionOptions) {
  predictionOptions = predictionOptions || {};
  var layers = [];
  var styleKey = buildStyleKey(parsedTune);
  var useOnsetLearner = predictionOptions.useOnsetLearner;
  if (useOnsetLearner === undefined) {
    useOnsetLearner = false;
  }
  var onsetLearnerWeights = predictionOptions.onsetLearnerWeights || (useOnsetLearner ? ((model.learned && model.learned.onsetWeights) || null) : null);
  var includeObservations = !!predictionOptions.includeObservations;
  var observations = [];
  var i;
  var labels = ["change", "stay"];

  for (i = 0; i < parsedTune.beatSlices.length; i += 1) {
    var slice = parsedTune.beatSlices[i];
    var fuzzySlotKey = buildPartSlotKey(slice.partIndex, slice.measureInPart, slice.beatInBar);
    var cadenceOnsetBucket = model.counts.cadenceOnsetPositions[buildCadenceOnsetKey(slice, parsedTune)] || {};
    var measureHintToken = (hintSources.measurePatternHints[slice.rawBarIndex] || {})[String(slice.beatInBar)] || null;
    var onsetMeasureHint = (hintSources.onsetMeasurePatternHints[slice.rawBarIndex] || {})[String(slice.beatInBar)] || null;
    var partPatternOnsetHint = hintSources.partOnsetHints[fuzzySlotKey] || null;
    var canonicalOnsetBucket = hintSources.canonicalMelodyHints.onsets[fuzzySlotKey] || {};
    var canonicalOnsetLeader = describeBucketLeader(canonicalOnsetBucket);
    var canonicalOnsetHint = canonicalOnsetLeader ? canonicalOnsetLeader.token : null;
    var partFamilyOnsetBucket = hintSources.fuzzyPartFamilyHints.onsets[fuzzySlotKey] || {};
    var partFamilyOnsetLeader = describeBucketLeader(partFamilyOnsetBucket);
    var partFamilyOnsetHint = partFamilyOnsetLeader ? partFamilyOnsetLeader.token : null;
    var fuzzyTuneOnsetBucket = hintSources.fuzzyTuneHints.onsets[fuzzySlotKey] || {};
    var fuzzyTuneOnsetHint = selectTopKey(fuzzyTuneOnsetBucket);
    var pulseOnsetHintInfo = predictionOptions.usePulseTemplates && hintSources.pulseOnsetHints ? (hintSources.pulseOnsetHints[i] || null) : null;
    var pulseOnsetHint = pulseOnsetHintInfo ? pulseOnsetHintInfo.label : null;
    var endingOnsetHint = hintSources.endingOnsetHints[fuzzySlotKey] || null;
    var exactHintToken = hintSources.exactMelodyPathHints[i] || null;
    var previousExactHintToken = i > 0 ? (hintSources.exactMelodyPathHints[i - 1] || null) : null;
    var previousMeasureHintToken = null;
    var measureOnsetHint = null;
    var exactOnsetHint = null;
    var onsetHintConsensus = 0;
    var localBias = i === 0 ? (2.4 * decoderProfile.changeWeight) : (decoderProfile.changeWeight * scoreChangePreference(model, parsedTune, slice, decoderProfile));
    var currentLayer = {};
    var previousLayer;

    function addOnsetConsensus(label, weight) {
      if (label === "change") {
        onsetHintConsensus += weight;
      } else if (label === "stay") {
        onsetHintConsensus -= weight;
      }
    }

    if (i > 0) {
      var previousSlice = parsedTune.beatSlices[i - 1];
      previousMeasureHintToken = (hintSources.measurePatternHints[previousSlice.rawBarIndex] || {})[String(previousSlice.beatInBar)] || null;
    }

    if (measureHintToken && previousMeasureHintToken) {
      measureOnsetHint = measureHintToken === previousMeasureHintToken ? "stay" : "change";
    } else if (i === 0 && measureHintToken) {
      measureOnsetHint = "change";
    }

    if (exactHintToken && previousExactHintToken) {
      exactOnsetHint = exactHintToken === previousExactHintToken ? "stay" : "change";
    } else if (i === 0 && exactHintToken) {
      exactOnsetHint = "change";
    }

    if (onsetMeasureHint === "change") {
      localBias += 0.70;
    } else if (onsetMeasureHint === "stay") {
      localBias -= 0.70;
    }
    addOnsetConsensus(onsetMeasureHint, 1.35);

    if (partPatternOnsetHint === "change") {
      localBias += decoderProfile.partPatternOnsetWeight;
    } else if (partPatternOnsetHint === "stay") {
      localBias -= decoderProfile.partPatternOnsetWeight;
    }
    addOnsetConsensus(partPatternOnsetHint, 1.0);

    if (exactOnsetHint === "change") {
      localBias += 0.95;
    } else if (exactOnsetHint === "stay") {
      localBias -= 0.95;
    }
    addOnsetConsensus(exactOnsetHint, 1.55);

    if (canonicalOnsetHint === "change") {
      localBias += 0.78 * (canonicalOnsetLeader ? canonicalOnsetLeader.confidence : 1);
    } else if (canonicalOnsetHint === "stay") {
      localBias -= 0.78 * (canonicalOnsetLeader ? canonicalOnsetLeader.confidence : 1);
    }
    addOnsetConsensus(canonicalOnsetHint, 1.15 * (canonicalOnsetLeader ? canonicalOnsetLeader.confidence : 1));

    if (partFamilyOnsetHint === "change") {
      localBias += decoderProfile.partFamilyOnsetWeight * (partFamilyOnsetLeader ? partFamilyOnsetLeader.confidence : 1);
    } else if (partFamilyOnsetHint === "stay") {
      localBias -= decoderProfile.partFamilyOnsetWeight * (partFamilyOnsetLeader ? partFamilyOnsetLeader.confidence : 1);
    }
    addOnsetConsensus(partFamilyOnsetHint, 1.05 * (partFamilyOnsetLeader ? partFamilyOnsetLeader.confidence : 1));

    if (fuzzyTuneOnsetHint === "change") {
      localBias += 0.44;
    } else if (fuzzyTuneOnsetHint === "stay") {
      localBias -= 0.44;
    }
    addOnsetConsensus(fuzzyTuneOnsetHint, 0.70);

    if (pulseOnsetHint === "change") {
      localBias += 0.36 * (pulseOnsetHintInfo ? pulseOnsetHintInfo.confidence : 1);
    } else if (pulseOnsetHint === "stay") {
      localBias -= 0.36 * (pulseOnsetHintInfo ? pulseOnsetHintInfo.confidence : 1);
    }
    addOnsetConsensus(pulseOnsetHint, 0.90 * (pulseOnsetHintInfo ? pulseOnsetHintInfo.confidence : 1));

    if (endingOnsetHint === "change") {
      localBias += 0.46;
    } else if (endingOnsetHint === "stay") {
      localBias -= 0.46;
    }
    addOnsetConsensus(endingOnsetHint, 0.85);

    if (measureOnsetHint === "change") {
      localBias += 0.24;
    } else if (measureOnsetHint === "stay") {
      localBias -= 0.24;
    }
    addOnsetConsensus(measureOnsetHint, 0.55);

    if (decoderProfile.onsetConsensusWeight) {
      localBias += decoderProfile.onsetConsensusWeight * onsetHintConsensus;
    }

    if (!slice.isPickup && slice.measuresFromPartEnd !== null && slice.measuresFromPartEnd <= 2) {
      localBias += decoderProfile.cadenceOnsetWeight * (
        logDecisionProbability(cadenceOnsetBucket, "change", 1.0) -
        logDecisionProbability(cadenceOnsetBucket, "stay", 1.0)
      );
    }

    if (decoderProfile.onsetConsensusLockMargin && Math.abs(onsetHintConsensus) >= decoderProfile.onsetConsensusLockMargin) {
      localBias += onsetHintConsensus > 0 ? 1.1 : -1.1;
    }

    localBias = clamp(localBias, -3.1, 3.1);

    var observation = {
      localBias: localBias,
      changePreference: i === 0 ? (2.4 * decoderProfile.changeWeight) : (decoderProfile.changeWeight * scoreChangePreference(model, parsedTune, slice, decoderProfile)),
      onsetMeasureHint: onsetMeasureHint,
      partPatternOnsetHint: partPatternOnsetHint,
      measureOnsetHint: measureOnsetHint,
      endingOnsetHint: endingOnsetHint,
      pulseOnsetHint: pulseOnsetHint
    };
    observation.features = buildOnsetLearnerFeatures(parsedTune, slice, observation);
    observations[i] = observation;
    var onsetLearnerScale = decoderProfile.onsetLearnerWeight * clamp((2.4 - Math.abs(localBias)) / 2.4, 0, 1);

    if (i === 0) {
      labels.forEach(function (label) {
        currentLayer[label] = {
          score: (label === "change" ? localBias : -1 * localBias) +
            (onsetLearnerScale * scoreOnsetLearnerState(onsetLearnerWeights || {}, label, observation.features)) +
            (decoderProfile.onsetPathTransitionWeight * logDecisionProbability(getOnsetTransitionBucket(model, styleKey, "__START__"), label, 1.0)) +
            (onsetLearnerScale * scoreOnsetLearnerTransition(onsetLearnerWeights || {}, "__START__", label)),
          previous: null
        };
      });
      layers.push(currentLayer);
      continue;
    }

    previousLayer = layers[i - 1];
    labels.forEach(function (label) {
      var labelScore = label === "change" ? localBias : -1 * localBias;
      labelScore += onsetLearnerScale * scoreOnsetLearnerState(onsetLearnerWeights || {}, label, observation.features);
      var bestPrevious = null;
      var bestScore = -Infinity;

      labels.forEach(function (previousLabel) {
        var transitionScore = decoderProfile.onsetPathTransitionWeight * logDecisionProbability(getOnsetTransitionBucket(model, styleKey, previousLabel), label, 1.0);
        transitionScore += onsetLearnerScale * scoreOnsetLearnerTransition(onsetLearnerWeights || {}, previousLabel, label);
        var candidateScore = previousLayer[previousLabel].score + labelScore + transitionScore;

        if (candidateScore > bestScore) {
          bestScore = candidateScore;
          bestPrevious = previousLabel;
        }
      });

      currentLayer[label] = {
        score: bestScore,
        previous: bestPrevious
      };
    });

    layers.push(currentLayer);
  }

  if (!layers.length) {
    return {};
  }

  var path = {};
  var bestLabel = "change";
  var bestScore = -Infinity;

  labels.forEach(function (label) {
    if (layers[layers.length - 1][label].score > bestScore) {
      bestScore = layers[layers.length - 1][label].score;
      bestLabel = label;
    }
  });

  for (i = layers.length - 1; i >= 0; i -= 1) {
    path[i] = bestLabel;
    bestLabel = layers[i][bestLabel].previous;
  }

  if (Object.prototype.hasOwnProperty.call(path, 0)) {
    path[0] = "change";
  }

  if (decoderProfile.measureConsensusMinMargin) {
    path = applyMeasureConsensusToOnsetPath(parsedTune, path, decoderProfile);
  }

  if (includeObservations) {
    return {
      path: path,
      observations: observations
    };
  }

  return path;
}

function applyMeasureConsensusToOnsetPath(parsedTune, onsetPath, decoderProfile) {
  var groupedSlots = {};
  var output = copyMap(onsetPath);

  parsedTune.beatSlices.forEach(function (slice, index) {
    var slotKey;
    if (slice.isPickup || slice.beatInBar === null || !slice.measureSignature) {
      return;
    }

    slotKey = [slice.measureSignature, slice.beatInBar].join("|");
    if (!groupedSlots[slotKey]) {
      groupedSlots[slotKey] = [];
    }
    groupedSlots[slotKey].push(index);
  });

  Object.keys(groupedSlots).forEach(function (slotKey) {
    var indices = groupedSlots[slotKey];
    var counts = {};
    var orderedLabels;
    var topLabel;
    var runnerUpCount = 0;

    if (indices.length < 2) {
      return;
    }

    indices.forEach(function (index) {
      var label = onsetPath[index] || (index === 0 ? "change" : "stay");
      counts[label] = (counts[label] || 0) + 1;
    });

    orderedLabels = Object.keys(counts).sort(function (left, right) {
      return counts[right] - counts[left];
    });

    topLabel = orderedLabels[0];
    if (!topLabel) {
      return;
    }

    if (orderedLabels[1]) {
      runnerUpCount = counts[orderedLabels[1]];
    }

    if ((counts[topLabel] - runnerUpCount) < decoderProfile.measureConsensusMinMargin) {
      return;
    }

    indices.forEach(function (index) {
      output[index] = topLabel;
    });
  });

  output[0] = "change";
  return output;
}

function enumeratePulseTemplates(pulseBar) {
  var templates = [""];

  (pulseBar.pulses || []).forEach(function (pulse) {
    var symbols = pulse.sliceIndexes.length <= 1 ? ["0", "1"] : ["0", "1", "2", "3"];
    var nextTemplates = [];

    templates.forEach(function (prefix) {
      symbols.forEach(function (symbol) {
        nextTemplates.push(prefix + symbol);
      });
    });

    templates = nextTemplates;
  });

  return templates;
}

function scorePulseTemplateEvidence(pulseBar, template, basePath, observations) {
  var expanded = expandPulseTemplateToOnsets(pulseBar, template);
  var score = 0;

  Object.keys(expanded).forEach(function (indexKey) {
    var index = parseInt(indexKey, 10);
    var label = expanded[index];
    var observation = observations[index] || {};
    var localBias = observation.localBias || 0;

    score += label === "change" ? localBias : -1 * localBias;

    if ((basePath[index] || (index === 0 ? "change" : "stay")) === label) {
      score += 0.26;
    } else {
      score -= 0.14;
    }
  });

  if (template.indexOf("1") === -1 && template.indexOf("2") === -1 && template.indexOf("3") === -1) {
    score -= 0.08;
  }

  return score;
}

function scorePulseRepeatTemplatePreference(repeatHistory, repeatKey, template) {
  var bucket = repeatHistory[repeatKey] || {};
  var total = mapSum(bucket);

  if (!total) {
    return 0;
  }

  return ((bucket[template] || 0) / total) - 0.5;
}

function applyPulseRepeatConsensus(pulseBars, templatePath, decoderProfile) {
  var groups = {};
  var output = copyMap(templatePath);

  (pulseBars || []).forEach(function (pulseBar) {
    var repeatKey = buildPulseRepeatKey(pulseBar);
    if (!groups[repeatKey]) {
      groups[repeatKey] = [];
    }
    groups[repeatKey].push(pulseBar.rawBarIndex);
  });

  Object.keys(groups).forEach(function (repeatKey) {
    var rawBarIndexes = groups[repeatKey];
    var counts = {};
    var ordered;
    var topTemplate;
    var runnerUp = 0;

    if (rawBarIndexes.length < 2) {
      return;
    }

    rawBarIndexes.forEach(function (rawBarIndex) {
      var template = output[rawBarIndex];
      if (!template) {
        return;
      }
      counts[template] = (counts[template] || 0) + 1;
    });

    ordered = Object.keys(counts).sort(function (left, right) {
      return counts[right] - counts[left];
    });
    topTemplate = ordered[0];

    if (!topTemplate) {
      return;
    }

    if (ordered[1]) {
      runnerUp = counts[ordered[1]];
    }

    if ((counts[topTemplate] - runnerUp) < (decoderProfile.pulseRepeatConsensusMinMargin || 2)) {
      return;
    }

    rawBarIndexes.forEach(function (rawBarIndex) {
      output[rawBarIndex] = topTemplate;
    });
  });

  return output;
}

function buildPulseTemplateOnsetPath(model, parsedTune, decoderProfile, pulseHintSources, basePath, observations) {
  var pulseBars = (pulseHintSources && pulseHintSources.pulseBars) || [];
  var familyKey = buildPlacementFamilyKey(parsedTune);
  var familyBucket = model.counts.pulseFamilyTemplates[familyKey] || {};
  var layers = [];
  var i;
  var repeatHistory = {};

  if (!pulseBars.length) {
    return basePath;
  }

  for (i = 0; i < pulseBars.length; i += 1) {
    var pulseBar = pulseBars[i];
    var roleBucket = model.counts.pulseRolePositionTemplates[buildPulseRolePositionKey(parsedTune, pulseBar)] || {};
    var signatureBucket = model.counts.pulseMeasureSignatureTemplates[buildPulseMeasureSignatureKey(parsedTune, pulseBar)] || {};
    var partPatternBucket = (pulseHintSources.partPatternHints || {})[pulseBar.rawBarIndex] || {};
    var fuzzyPartBucket = (pulseHintSources.fuzzyPartHints || {})[pulseBar.rawBarIndex] || {};
    var fuzzyTuneBucket = (pulseHintSources.fuzzyTuneHints || {})[pulseBar.rawBarIndex] || {};
    var baseTemplate = buildPulseTemplateFromOnsetLabels(pulseBar, basePath);
    var candidateTemplates = [];
    var currentLayer = {};
    var previousLayer = i > 0 ? layers[i - 1] : null;
    var repeatKey = buildPulseRepeatKey(pulseBar);
    var roleLeader = describeBucketLeader(roleBucket);
    var signatureLeader = describeBucketLeader(signatureBucket);
    var hasExternalHint = mapSum(partPatternBucket) > 0 || mapSum(fuzzyPartBucket) > 0 || mapSum(fuzzyTuneBucket) > 0;
    var hasStrongStructuralHint =
      (roleLeader && roleLeader.decisive && roleLeader.confidence >= 0.62) ||
      (signatureLeader && signatureLeader.decisive && signatureLeader.confidence >= 0.62);

    if (hasExternalHint || hasStrongStructuralHint) {
      mergeCandidateBucket(candidateTemplates, roleBucket, 5);
      mergeCandidateBucket(candidateTemplates, signatureBucket, 5);
      mergeCandidateBucket(candidateTemplates, partPatternBucket, 4);
      mergeCandidateBucket(candidateTemplates, fuzzyPartBucket, 4);
      mergeCandidateBucket(candidateTemplates, fuzzyTuneBucket, 4);
      mergeCandidateBucket(candidateTemplates, familyBucket, 4);
    }

    if (candidateTemplates.indexOf(baseTemplate) === -1) {
      candidateTemplates.unshift(baseTemplate);
    }

    if (hasExternalHint) {
      enumeratePulseTemplates(pulseBar).forEach(function (template) {
        if (candidateTemplates.indexOf(template) === -1) {
          candidateTemplates.push(template);
        }
      });
    }

    candidateTemplates.forEach(function (template) {
      var localScore =
        (decoderProfile.pulseFamilyTemplateWeight * logProbability(familyBucket, template, 0.9, familyBucket)) +
        (decoderProfile.pulseRoleTemplateWeight * logProbability(roleBucket, template, 0.9, familyBucket)) +
        (decoderProfile.pulseMeasureTemplateWeight * logProbability(signatureBucket, template, 0.9, roleBucket)) +
        (decoderProfile.pulseEvidenceWeight * scorePulseTemplateEvidence(pulseBar, template, basePath, observations)) +
        (decoderProfile.pulsePartPatternWeight * logProbability(partPatternBucket, template, 0.8, roleBucket)) +
        (decoderProfile.pulseFuzzyPartWeight * logProbability(fuzzyPartBucket, template, 0.8, roleBucket)) +
        (decoderProfile.pulseFuzzyTuneWeight * logProbability(fuzzyTuneBucket, template, 0.8, familyBucket)) +
        (decoderProfile.pulseRepeatWeight * scorePulseRepeatTemplatePreference(repeatHistory, repeatKey, template));

      if (template === baseTemplate) {
        localScore += decoderProfile.pulseBaseTemplateBonus;
      }

      if (!previousLayer) {
        currentLayer[template] = {
          score: localScore +
            (decoderProfile.pulseTransitionWeight * logProbability(
              ((model.counts.pulseTemplateTransitions[familyKey] || {})["__START__"] || {}),
              template,
              0.9,
              familyBucket
            )),
          previous: null
        };
        return;
      }

      var bestPrevious = null;
      var bestScore = -Infinity;

      Object.keys(previousLayer).forEach(function (previousTemplate) {
        var transitionBucket = ((model.counts.pulseTemplateTransitions[familyKey] || {})[previousTemplate] || {});
        var candidateScore = previousLayer[previousTemplate].score + localScore +
          (decoderProfile.pulseTransitionWeight * logProbability(transitionBucket, template, 0.9, familyBucket));

        if (candidateScore > bestScore) {
          bestScore = candidateScore;
          bestPrevious = previousTemplate;
        }
      });

      currentLayer[template] = {
        score: bestScore,
        previous: bestPrevious
      };
    });

    layers.push(currentLayer);
    repeatHistory[repeatKey] = repeatHistory[repeatKey] || {};
    incrementCount(repeatHistory[repeatKey], baseTemplate, 1);
  }

  if (!layers.length) {
    return basePath;
  }

  var templatePath = {};
  var bestTemplate = null;
  var bestScore = -Infinity;

  Object.keys(layers[layers.length - 1]).forEach(function (template) {
    if (layers[layers.length - 1][template].score > bestScore) {
      bestScore = layers[layers.length - 1][template].score;
      bestTemplate = template;
    }
  });

  for (i = layers.length - 1; i >= 0; i -= 1) {
    templatePath[pulseBars[i].rawBarIndex] = bestTemplate;
    bestTemplate = layers[i][bestTemplate].previous;
  }

  templatePath = applyPulseRepeatConsensus(pulseBars, templatePath, decoderProfile);

  var output = copyMap(basePath);
  pulseBars.forEach(function (pulseBar) {
    var template = templatePath[pulseBar.rawBarIndex];
    var baseTemplate = buildPulseTemplateFromOnsetLabels(pulseBar, basePath);
    var chosenScore;
    var baseScore;
    var expanded;

    if (!template) {
      return;
    }

    chosenScore = scorePulseTemplateEvidence(pulseBar, template, basePath, observations);
    baseScore = scorePulseTemplateEvidence(pulseBar, baseTemplate, basePath, observations);

    if (template !== baseTemplate && (chosenScore - baseScore) < decoderProfile.pulseSwitchMargin) {
      template = baseTemplate;
    }

    expanded = expandPulseTemplateToOnsets(pulseBar, template);
    Object.keys(expanded).forEach(function (indexKey) {
      output[indexKey] = expanded[indexKey];
    });
  });

  output[0] = "change";
  return output;
}

function buildStructuredOnsetPath(model, parsedTune, decoderProfile, hintSources, predictionOptions) {
  var baseResult = buildPredictedOnsetPath(model, parsedTune, decoderProfile, hintSources, {
    useOnsetLearner: predictionOptions.useOnsetLearner,
    onsetLearnerWeights: predictionOptions.onsetLearnerWeights,
    includeObservations: true
  });
  var structuredPath = buildPulseTemplateOnsetPath(
    model,
    parsedTune,
    decoderProfile,
    buildPulsePredictionHintSources(model, parsedTune),
    baseResult.path || {},
    baseResult.observations || []
  );

  if (predictionOptions.includeObservations) {
    return {
      path: structuredPath,
      observations: baseResult.observations || [],
      basePath: baseResult.path || {}
    };
  }

  return structuredPath;
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

function predictChordPath(model, parsedTune, predictionOptions) {
  predictionOptions = predictionOptions || {};
  var decoderProfile = buildDecoderProfile(parsedTune, predictionOptions);
  var placementFirst = !!predictionOptions.placementFirst;
  var onsetContextIdentity = !!predictionOptions.onsetContextIdentity;
  var globalCandidates = getCandidateTokens(model, parsedTune);
  var layers = [];
  var styleKey = buildStyleKey(parsedTune);
  var hintSources = buildPredictionHintSources(model, parsedTune);
  var predictedOnsetPath = (placementFirst && predictionOptions.usePulseTemplates) ? buildStructuredOnsetPath(model, parsedTune, decoderProfile, {
    measurePatternHints: hintSources.measurePatternHints,
    onsetMeasurePatternHints: hintSources.onsetMeasurePatternHints,
    partOnsetHints: hintSources.partOnsetHints,
    endingOnsetHints: hintSources.endingOnsetHints,
    exactMelodyPathHints: hintSources.exactMelodyPathHints,
    canonicalMelodyHints: hintSources.canonicalMelodyHints,
    fuzzyPartFamilyHints: hintSources.fuzzyPartFamilyHints,
    fuzzyTuneHints: hintSources.fuzzyTuneHints
  }, predictionOptions) : buildPredictedOnsetPath(model, parsedTune, decoderProfile, {
    measurePatternHints: hintSources.measurePatternHints,
    onsetMeasurePatternHints: hintSources.onsetMeasurePatternHints,
    partOnsetHints: hintSources.partOnsetHints,
    endingOnsetHints: hintSources.endingOnsetHints,
    exactMelodyPathHints: hintSources.exactMelodyPathHints,
    canonicalMelodyHints: hintSources.canonicalMelodyHints,
    fuzzyPartFamilyHints: hintSources.fuzzyPartFamilyHints,
    fuzzyTuneHints: hintSources.fuzzyTuneHints
  }, predictionOptions);
  var i;
  var j;

  if (placementFirst && onsetContextIdentity) {
    return {
      tokens: buildPlacementFirstIdentityPath(model, parsedTune, decoderProfile, hintSources, predictedOnsetPath, globalCandidates),
      onsetPath: predictedOnsetPath
    };
  }

  for (i = 0; i < parsedTune.beatSlices.length; i += 1) {
    var slice = parsedTune.beatSlices[i];
    var candidates = getCandidateTokensForSlice(model, parsedTune, slice);
    var predictedOnsetLabel = predictedOnsetPath[i] || null;
    var lockPredictedStay = i > 0 && predictedOnsetLabel === "stay" && (placementFirst || decoderProfile.lockPredictedStays);
    var measureHintToken = (hintSources.measurePatternHints[slice.rawBarIndex] || {})[String(slice.beatInBar)];
    var previousMeasureHintToken = null;
    var fuzzySlotKey = buildPartSlotKey(slice.partIndex, slice.measureInPart, slice.beatInBar);
    var partPatternOnsetHint = hintSources.partOnsetHints[fuzzySlotKey] || null;
    var exactHintToken = hintSources.exactMelodyPathHints[i] || null;
    var canonicalHintBucket = hintSources.canonicalMelodyHints.tokens[fuzzySlotKey] || {};
    var canonicalHintLeader = describeBucketLeader(canonicalHintBucket);
    var canonicalHintToken = canonicalHintLeader ? canonicalHintLeader.token : null;
    var canonicalOnsetBucket = hintSources.canonicalMelodyHints.onsets[fuzzySlotKey] || {};
    var canonicalOnsetLeader = describeBucketLeader(canonicalOnsetBucket);
    var canonicalOnsetHint = canonicalOnsetLeader ? canonicalOnsetLeader.token : null;
    var fuzzyHintBucket = hintSources.fuzzyPartHints[fuzzySlotKey] || {};
    var fuzzyHintToken = selectTopKey(fuzzyHintBucket);
    var partFamilyOnsetBucket = hintSources.fuzzyPartFamilyHints.onsets[fuzzySlotKey] || {};
    var partFamilyOnsetLeader = describeBucketLeader(partFamilyOnsetBucket);
    var partFamilyOnsetHint = partFamilyOnsetLeader ? partFamilyOnsetLeader.token : null;
    var fuzzyTuneOnsetBucket = hintSources.fuzzyTuneHints.onsets[fuzzySlotKey] || {};
    var fuzzyTuneOnsetHint = selectTopKey(fuzzyTuneOnsetBucket);
    var endingTokenHint = hintSources.endingTokenHints[fuzzySlotKey] || null;
    var endingOnsetHint = hintSources.endingOnsetHints[fuzzySlotKey] || null;
    var previousFuzzyHintToken = null;
    var onsetMeasureHint = (hintSources.onsetMeasurePatternHints[slice.rawBarIndex] || {})[String(slice.beatInBar)] || null;
    var previousExactHintToken = i > 0 ? (hintSources.exactMelodyPathHints[i - 1] || null) : null;
    var exactOnsetHint = null;
    var fuzzyOnsetHint = null;
    var measureOnsetHint = null;
    var changePreference = i === 0 ? (2.4 * decoderProfile.changeWeight) : (decoderProfile.changeWeight * scoreChangePreference(model, parsedTune, slice, decoderProfile));

    if (i > 0) {
      var previousSlice = parsedTune.beatSlices[i - 1];
      previousMeasureHintToken = (hintSources.measurePatternHints[previousSlice.rawBarIndex] || {})[String(previousSlice.beatInBar)] || null;
      var previousFuzzySlotKey = buildPartSlotKey(previousSlice.partIndex, previousSlice.measureInPart, previousSlice.beatInBar);
      previousFuzzyHintToken = selectTopKey(hintSources.fuzzyPartHints[previousFuzzySlotKey] || {});
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

    if (partPatternOnsetHint === "change") {
      changePreference += decoderProfile.partPatternOnsetWeight;
    } else if (partPatternOnsetHint === "stay") {
      changePreference -= decoderProfile.partPatternOnsetWeight;
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

    if (canonicalOnsetHint === "change") {
      changePreference += 0.78 * (canonicalOnsetLeader ? canonicalOnsetLeader.confidence : 1);
    } else if (canonicalOnsetHint === "stay") {
      changePreference -= 0.78 * (canonicalOnsetLeader ? canonicalOnsetLeader.confidence : 1);
    }

    if (partFamilyOnsetHint === "change") {
      changePreference += decoderProfile.partFamilyOnsetWeight * (partFamilyOnsetLeader ? partFamilyOnsetLeader.confidence : 1);
    } else if (partFamilyOnsetHint === "stay") {
      changePreference -= decoderProfile.partFamilyOnsetWeight * (partFamilyOnsetLeader ? partFamilyOnsetLeader.confidence : 1);
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

    if (predictedOnsetLabel === "change") {
      changePreference += decoderProfile.onsetPathWeight;
    } else if (predictedOnsetLabel === "stay") {
      changePreference -= decoderProfile.onsetPathWeight;
    }

    changePreference = clamp(changePreference, -3.1, 3.1);

    if (measureHintToken && candidates.indexOf(measureHintToken) === -1) {
      candidates.unshift(measureHintToken);
    }

    if (exactHintToken && candidates.indexOf(exactHintToken) === -1) {
      candidates.unshift(exactHintToken);
    }

    if (canonicalHintToken && candidates.indexOf(canonicalHintToken) === -1) {
      candidates.unshift(canonicalHintToken);
    }

    if (fuzzyHintToken && candidates.indexOf(fuzzyHintToken) === -1) {
      candidates.unshift(fuzzyHintToken);
    }

    if (endingTokenHint && candidates.indexOf(endingTokenHint) === -1) {
      candidates.unshift(endingTokenHint);
    }

    if (predictedOnsetLabel === "change" && decoderProfile.typeModeIdentityWeight) {
      mergeCandidateBucket(candidates, model.counts.typeModeOnsetChordTotals[buildTypeModeIdentityKey(slice, parsedTune)], 10);
    }

    if (placementFirst && i > 0 && predictedOnsetLabel === "change") {
      globalCandidates.slice(0, 10).forEach(function (token) {
        if (candidates.indexOf(token) === -1) {
          candidates.push(token);
        }
      });
    }

    if (lockPredictedStay) {
      candidates = Object.keys(layers[i - 1] || {});
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
      var typeModeIdentityScore = scoreTypeModeIdentity(model, token, parsedTune, slice, predictedOnsetLabel, decoderProfile);
      var harmonicFunctionScore = scoreHarmonicFunction(model, token, parsedTune, slice, predictedOnsetLabel, "__START__", decoderProfile);
      var cadenceResolutionScore = scoreCadenceResolution(model, token, parsedTune, slice, predictedOnsetLabel, "__START__", decoderProfile);
      var cadenceTokenTransitionScore = scoreCadenceTokenTransition(model, token, parsedTune, slice, predictedOnsetLabel, "__START__", decoderProfile);
      var minorPenultimateScore = scoreMinorPenultimateRerank(token, parsedTune, slice, predictedOnsetLabel, decoderProfile);
      var measurePatternBonus = 0;
      var exactMelodyBonus = 0;
      var canonicalMelodyBonus = 0;
      var fuzzyPartBonus = 0;
      var endingTokenBonus = 0;
      var hintedToken = measureHintToken;

      if (hintedToken && hintedToken === token) {
        measurePatternBonus = decoderProfile.measurePatternBonus;
      }

      if (exactHintToken && exactHintToken === token) {
        exactMelodyBonus = decoderProfile.exactHintBonus;
      }

      if (canonicalHintToken && canonicalHintToken === token) {
        canonicalMelodyBonus = Math.min(
          1.85,
          (0.70 + (0.95 * (canonicalHintLeader ? canonicalHintLeader.confidence : 1)))
        );
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
          score: (decoderProfile.emissionWeight * emissionScore) + (decoderProfile.contextWeight * sliceContextScore) + endingFinalOnsetScore + typeModeIdentityScore + harmonicFunctionScore + cadenceResolutionScore + cadenceTokenTransitionScore + minorPenultimateScore + (decoderProfile.startTransitionWeight * startTransition) + measurePatternBonus + exactMelodyBonus + canonicalMelodyBonus + fuzzyPartBonus + endingTokenBonus,
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
        if (lockPredictedStay && previousToken !== token) {
          continue;
        }
        if (placementFirst && predictedOnsetLabel === "change" && previousToken === token) {
          continue;
        }
        var transitionScore = logProbability(getTransitionBucket(model, styleKey, previousToken), token, 0.8, model.counts.chordTotals);
        var stayBonus = previousToken === token ? decoderProfile.stayBonus : 0;
        var changeBonus = previousToken === token ? (-1 * changePreference) : changePreference;
        var candidateScore = previousLayer[previousToken].score + (decoderProfile.emissionWeight * emissionScore) + (decoderProfile.contextWeight * sliceContextScore) + endingFinalOnsetScore + typeModeIdentityScore + scoreHarmonicFunction(model, token, parsedTune, slice, predictedOnsetLabel, previousToken, decoderProfile) + scoreCadenceResolution(model, token, parsedTune, slice, predictedOnsetLabel, previousToken, decoderProfile) + scoreCadenceTokenTransition(model, token, parsedTune, slice, predictedOnsetLabel, previousToken, decoderProfile) + minorPenultimateScore + (decoderProfile.transitionWeight * transitionScore) + stayBonus + changeBonus + measurePatternBonus + exactMelodyBonus + canonicalMelodyBonus + fuzzyPartBonus + endingTokenBonus;

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

    applyCadenceTonicRerank(model, currentLayer, slice, parsedTune, predictedOnsetLabel, decoderProfile);

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

  return {
    tokens: path,
    onsetPath: predictedOnsetPath
  };
}

function predictForTune(model, options) {
  ensureModelShape(model);
  var parsedTune = abcParser.parseAbcTune(options);
  var decodedPath = predictChordPath(model, parsedTune, options || {});
  var path = decodedPath.tokens;
  var onsetPath = decodedPath.onsetPath || {};

  return path.map(function (token, index) {
    return {
      beatNumber: index,
      barIndex: parsedTune.beatSlices[index].barIndex,
      measureNumber: parsedTune.beatSlices[index].measureNumber,
      beatInBar: parsedTune.beatSlices[index].beatInBar,
      isPickup: parsedTune.beatSlices[index].isPickup,
      token: token,
      displayChord: theory.chordTokenToDisplayName(token, parsedTune.modeInfo),
      anchorIndex: parsedTune.beatSlices[index].anchorIndex,
      onsetLabel: onsetPath[index] || (index === 0 ? "change" : "stay")
    };
  });
}

module.exports = {
  createEmptyModel: createEmptyModel,
  predictForTune: predictForTune,
  trainOnRow: trainOnRow,
  trainOnRows: trainOnRows
};
