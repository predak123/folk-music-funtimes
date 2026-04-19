var theory = require("./theory");

var EPSILON = 1e-9;

function assertSupportedAbc(abcText) {
  if (/(^|\n)\s*V:/.test(abcText)) {
    throw new Error("Multivoice ABC is not supported in the first prototype.");
  }

  if (/(^|\n)\s*K:/.test(abcText)) {
    throw new Error("Inline key changes are not supported in the first prototype.");
  }
}

function quantize(value) {
  return Math.round(value * 64);
}

function parseDurationFactor(text, index) {
  var start = index;

  while (index < text.length && /[0-9/]/.test(text.charAt(index))) {
    index += 1;
  }

  var raw = text.slice(start, index);
  if (!raw) {
    return {
      factor: 1,
      endIndex: index
    };
  }

  if (/^\d+$/.test(raw)) {
    return {
      factor: parseInt(raw, 10),
      endIndex: index
    };
  }

  if (/^\/+$/.test(raw)) {
    return {
      factor: 1 / Math.pow(2, raw.length),
      endIndex: index
    };
  }

  if (/^\d+\/$/.test(raw)) {
    return {
      factor: parseInt(raw.slice(0, -1), 10) / 2,
      endIndex: index
    };
  }

  var match = /^(\d+)?\/(\d+)?$/.exec(raw);
  if (match) {
    var numerator = match[1] ? parseInt(match[1], 10) : 1;
    var denominator = match[2] ? parseInt(match[2], 10) : 2;
    return {
      factor: numerator / denominator,
      endIndex: index
    };
  }

  return {
    factor: 1,
    endIndex: index
  };
}

function defaultTupletFactor(count) {
  if (count === 2) {
    return 3 / 2;
  }

  if (count === 3) {
    return 2 / 3;
  }

  if (count === 4) {
    return 3 / 4;
  }

  if (count >= 5) {
    return (count - 1) / count;
  }

  return 1;
}

function brokenRhythmPair(direction, count) {
  var previous = 1;
  var next = 1;

  if (count === 1) {
    previous = 3 / 2;
    next = 1 / 2;
  } else if (count === 2) {
    previous = 7 / 4;
    next = 1 / 4;
  } else {
    previous = 15 / 8;
    next = 1 / 8;
  }

  if (direction === "<") {
    return {
      previous: next,
      next: previous
    };
  }

  return {
    previous: previous,
    next: next
  };
}

function parseBracketNotes(groupText, modeInfo, accidentalMemory) {
  var relativePcs = [];
  var i = 0;

  while (i < groupText.length) {
    var accidental = "";

    while (i < groupText.length && "^_=".indexOf(groupText.charAt(i)) !== -1) {
      accidental += groupText.charAt(i);
      i += 1;
    }

    if (i >= groupText.length) {
      break;
    }

    var ch = groupText.charAt(i);
    if (!/[A-Ga-gzZxX]/.test(ch)) {
      i += 1;
      continue;
    }

    i += 1;
    while (i < groupText.length && /[',0-9/]/.test(groupText.charAt(i))) {
      i += 1;
    }

    if (/[A-Ga-g]/.test(ch)) {
      relativePcs.push(theory.relativePitchClassForNote(modeInfo, ch.toUpperCase(), accidental, accidentalMemory));
    }
  }

  return relativePcs;
}

function parseEndingMarker(text, index) {
  var start = index;
  var digits = "";

  if (text.charAt(index) === "[") {
    index += 1;
  }

  while (index < text.length && /\d/.test(text.charAt(index))) {
    digits += text.charAt(index);
    index += 1;
  }

  if (!digits) {
    return null;
  }

  return {
    endingNumber: parseInt(digits, 10),
    endIndex: index,
    raw: text.slice(start, index)
  };
}

function consumeBarline(text, index) {
  var originalIndex = index;
  var sawBarline = false;

  if (text.slice(index, index + 2) === "[|") {
    index += 2;
    sawBarline = true;
  } else {
    while (index < text.length && "|:]".indexOf(text.charAt(index)) !== -1) {
      sawBarline = true;
      index += 1;
    }
  }

  if (!sawBarline) {
    return null;
  }

  var endingInfo = null;
  if (text.charAt(index) === "[" && /\d/.test(text.charAt(index + 1))) {
    endingInfo = parseEndingMarker(text, index);
    index = endingInfo.endIndex;
  } else if (/\d/.test(text.charAt(index))) {
    endingInfo = parseEndingMarker(text, index);
    index = endingInfo.endIndex;
  }

  return {
    endIndex: index,
    endingNumber: endingInfo ? endingInfo.endingNumber : null,
    raw: text.slice(originalIndex, index)
  };
}

function pushUniqueBoundary(boundaries, offset, endingNumber) {
  var last = boundaries.length ? boundaries[boundaries.length - 1] : null;

  if (last && Math.abs(last.offset - offset) <= EPSILON) {
    if (endingNumber !== null && endingNumber !== undefined) {
      last.endingNumber = endingNumber;
    }
    return;
  }

  boundaries.push({
    offset: offset,
    endingNumber: endingNumber === undefined ? null : endingNumber
  });
}

function buildMeasureSignature(noteGroups, start, end) {
  var fragments = [];
  var i;

  for (i = 0; i < noteGroups.length; i += 1) {
    var group = noteGroups[i];
    var overlapStart = Math.max(group.start, start);
    var overlapEnd = Math.min(group.start + group.duration, end);
    var overlap = overlapEnd - overlapStart;

    if (overlap <= EPSILON) {
      continue;
    }

    fragments.push([
      quantize(overlapStart - start),
      quantize(overlap),
      group.relativePcs.slice().sort(function (left, right) {
        return left - right;
      }).join(".") || "rest"
    ].join(":"));
  }

  return fragments.join("|");
}

function choosePartLength(fullMeasureCount) {
  if (fullMeasureCount >= 16) {
    return 8;
  }

  if (fullMeasureCount >= 8) {
    return 8;
  }

  if (fullMeasureCount >= 4) {
    return 4;
  }

  return Math.max(1, fullMeasureCount || 1);
}

function blocksAreVariants(leftBlock, rightBlock) {
  var compareCount = Math.min(leftBlock.length, rightBlock.length);
  if (compareCount < 4) {
    return false;
  }

  var totalMatches = 0;
  var prefixMatches = 0;
  var i;

  for (i = 0; i < compareCount; i += 1) {
    if (leftBlock[i].signature === rightBlock[i].signature) {
      totalMatches += 1;
      if (i < compareCount - 1) {
        prefixMatches += 1;
      }
    }
  }

  if (compareCount > 1 && prefixMatches >= Math.max(3, compareCount - 2)) {
    return true;
  }

  return totalMatches >= compareCount - 1;
}

function assignPartStructure(measures, pickupCount) {
  var fullMeasures = measures.slice(pickupCount);
  var partLength = choosePartLength(fullMeasures.length);
  var blocks = [];
  var clusterRepresentatives = [];
  var clusterPassCounts = {};
  var i;

  if (fullMeasures.length === 0) {
    return {
      partLength: partLength
    };
  }

  for (i = 0; i < fullMeasures.length; i += partLength) {
    blocks.push(fullMeasures.slice(i, i + partLength));
  }

  blocks.forEach(function (block) {
    var matchedCluster = -1;
    var clusterIndex;

    for (clusterIndex = 0; clusterIndex < clusterRepresentatives.length; clusterIndex += 1) {
      if (blocksAreVariants(clusterRepresentatives[clusterIndex], block)) {
        matchedCluster = clusterIndex;
        break;
      }
    }

    if (matchedCluster === -1) {
      matchedCluster = clusterRepresentatives.length;
      clusterRepresentatives.push(block);
    }

    clusterPassCounts[matchedCluster] = (clusterPassCounts[matchedCluster] || 0) + 1;

    block.forEach(function (measure, indexInBlock) {
      measure.partIndex = matchedCluster;
      measure.partPass = clusterPassCounts[matchedCluster];
      measure.measureInPart = indexInBlock;
    });
  });

  var firstEndingMeasure = null;
  measures.forEach(function (measure) {
    if (measure.isPickup) {
      measure.partIndex = 0;
      measure.partPass = 0;
      measure.measureInPart = -1;
      return;
    }

    if (measure.endingNumber === 1) {
      firstEndingMeasure = measure;
      return;
    }

    if (measure.endingNumber && measure.endingNumber > 1 && firstEndingMeasure) {
      measure.partIndex = firstEndingMeasure.partIndex;
      measure.measureInPart = firstEndingMeasure.measureInPart;
      measure.partPass = firstEndingMeasure.partPass + (measure.endingNumber - 1);
    }
  });

  return {
    partLength: partLength
  };
}

function assignPartTailMetadata(measures) {
  var partLengths = {};

  measures.forEach(function (measure) {
    if (measure.isPickup) {
      return;
    }

    partLengths[measure.partIndex] = Math.max(partLengths[measure.partIndex] || 0, (measure.measureInPart || 0) + 1);
  });

  measures.forEach(function (measure) {
    if (measure.isPickup) {
      measure.partLength = 0;
      measure.measuresFromPartEnd = null;
      measure.isCadenceMeasure = false;
      return;
    }

    measure.partLength = partLengths[measure.partIndex] || 0;
    measure.measuresFromPartEnd = Math.max(0, (measure.partLength - 1) - measure.measureInPart);
    measure.isCadenceMeasure = measure.measuresFromPartEnd <= 1;
  });
}

function buildMeasures(parsedTune, barEvents) {
  var boundaries = [0];
  var endingByStart = {};
  var i;

  for (i = 0; i < barEvents.length; i += 1) {
    var barEvent = barEvents[i];
    if (barEvent.offset > EPSILON && barEvent.offset < parsedTune.totalDuration - EPSILON) {
      boundaries.push(barEvent.offset);
    }

    if (barEvent.endingNumber !== null && barEvent.endingNumber !== undefined) {
      endingByStart[quantize(barEvent.offset)] = barEvent.endingNumber;
    }
  }

  boundaries.push(parsedTune.totalDuration);
  boundaries.sort(function (left, right) {
    return left - right;
  });

  var uniqueBoundaries = [];
  for (i = 0; i < boundaries.length; i += 1) {
    if (uniqueBoundaries.length === 0 || Math.abs(uniqueBoundaries[uniqueBoundaries.length - 1] - boundaries[i]) > EPSILON) {
      uniqueBoundaries.push(boundaries[i]);
    }
  }

  var measures = [];
  for (i = 0; i < uniqueBoundaries.length - 1; i += 1) {
    var start = uniqueBoundaries[i];
    var end = uniqueBoundaries[i + 1];
    if (end - start <= EPSILON) {
      continue;
    }

    measures.push({
      rawIndex: measures.length,
      start: start,
      end: end,
      duration: end - start,
      endingNumber: endingByStart[quantize(start)] || null,
      signature: buildMeasureSignature(parsedTune.noteGroups, start, end)
    });
  }

  var pickupDuration = 0;
  if (measures.length && measures[0].duration < parsedTune.meterInfo.barLength - EPSILON) {
    pickupDuration = measures[0].duration;
  }

  measures.forEach(function (measure, index) {
    if (pickupDuration > EPSILON && index === 0) {
      measure.isPickup = true;
      measure.measureNumber = 0;
      measure.normalizedMeasureIndex = -1;
      return;
    }

    measure.isPickup = false;
    measure.measureNumber = pickupDuration > EPSILON ? index : index + 1;
    measure.normalizedMeasureIndex = measure.measureNumber - 1;
  });

  assignPartStructure(measures, pickupDuration > EPSILON ? 1 : 0);
  assignPartTailMetadata(measures);

  return {
    pickupDuration: pickupDuration,
    measures: measures
  };
}

function buildBeatWindows(parsedTune) {
  var beatLength = parsedTune.meterInfo.beatLength;
  var totalDuration = parsedTune.totalDuration;
  var pickupDuration = parsedTune.pickupDuration;
  var windows = [];
  var cursor;

  if (pickupDuration > EPSILON) {
    var pickupBoundaries = [pickupDuration];
    cursor = pickupDuration;

    while (cursor > EPSILON) {
      cursor = Math.max(0, cursor - beatLength);
      pickupBoundaries.unshift(cursor);
    }

    for (cursor = 0; cursor < pickupBoundaries.length - 1; cursor += 1) {
      windows.push({
        start: pickupBoundaries[cursor],
        end: pickupBoundaries[cursor + 1],
        isPickup: true
      });
    }
  }

  cursor = pickupDuration;
  while (cursor < totalDuration - EPSILON) {
    windows.push({
      start: cursor,
      end: Math.min(totalDuration, cursor + beatLength),
      isPickup: false
    });
    cursor += beatLength;
  }

  return windows;
}

function uniqueSortedPcs(map) {
  return Object.keys(map).map(function (key) {
    return parseInt(key, 10);
  }).sort(function (left, right) {
    return left - right;
  });
}

function collectStartingPcs(noteGroups, start, end) {
  var found = {};
  var i;

  for (i = 0; i < noteGroups.length; i += 1) {
    var group = noteGroups[i];

    if (group.start < start - EPSILON || group.start >= end - EPSILON) {
      continue;
    }

    group.relativePcs.forEach(function (relativePc) {
      found[relativePc] = true;
    });
  }

  return uniqueSortedPcs(found);
}

function collectActivePcs(noteGroups, position) {
  var found = {};
  var i;

  for (i = 0; i < noteGroups.length; i += 1) {
    var group = noteGroups[i];

    if (group.start - EPSILON > position || (group.start + group.duration) <= position + EPSILON) {
      continue;
    }

    group.relativePcs.forEach(function (relativePc) {
      found[relativePc] = true;
    });
  }

  return uniqueSortedPcs(found);
}

function collectWindowNoteWeights(noteGroups, start, end) {
  var noteWeights = {};
  var i;

  for (i = 0; i < noteGroups.length; i += 1) {
    var group = noteGroups[i];
    var overlapStart = Math.max(group.start, start);
    var overlapEnd = Math.min(group.start + group.duration, end);
    var overlap = overlapEnd - overlapStart;
    var j;

    if (overlap <= EPSILON) {
      continue;
    }

    for (j = 0; j < group.relativePcs.length; j += 1) {
      var relativePc = group.relativePcs[j];
      noteWeights[relativePc] = (noteWeights[relativePc] || 0) + overlap;
    }
  }

  return noteWeights;
}

function buildSlotLabel(slotCount, slotIndex) {
  if (slotCount === 3) {
    return ["onset", "middle", "late"][slotIndex] || ("slot" + slotIndex);
  }

  if (slotCount === 2) {
    return slotIndex === 0 ? "onset" : "off";
  }

  return slotIndex === 0 ? "onset" : ("slot" + slotIndex);
}

function buildSlotProfiles(parsedTune, window) {
  var isCompoundMeter = parsedTune.meterInfo.denominator === 8 &&
    parsedTune.meterInfo.numerator % 3 === 0 &&
    parsedTune.meterInfo.numerator > 3;
  var slotCount = isCompoundMeter ? 3 : 2;
  var beatSpan = window.end - window.start;
  var slots = [];
  var i;

  for (i = 0; i < slotCount; i += 1) {
    var slotStart = window.start + ((beatSpan * i) / slotCount);
    var slotEnd = window.start + ((beatSpan * (i + 1)) / slotCount);
    var startingPcs = collectStartingPcs(parsedTune.noteGroups, slotStart, slotEnd);

    if (!startingPcs.length) {
      startingPcs = collectActivePcs(parsedTune.noteGroups, slotStart + EPSILON);
    }

    slots.push({
      index: i,
      label: buildSlotLabel(slotCount, i),
      start: slotStart,
      end: slotEnd,
      startingPcs: startingPcs,
      noteWeights: collectWindowNoteWeights(parsedTune.noteGroups, slotStart, slotEnd)
    });
  }

  return slots;
}

function buildSubPulseProfile(parsedTune, window, slots) {
  var slotProfiles = slots || buildSlotProfiles(parsedTune, window);
  var onsetPcs = slotProfiles[0] ? slotProfiles[0].startingPcs : [];
  var middlePcs = slotProfiles[1] ? slotProfiles[1].startingPcs : [];
  var latePcs = slotProfiles[2] ? slotProfiles[2].startingPcs : middlePcs;

  return {
    onset: onsetPcs,
    middle: middlePcs,
    third: latePcs
  };
}

function buildBeatSlices(parsedTune) {
  var beatLength = parsedTune.meterInfo.beatLength;
  var windows = buildBeatWindows(parsedTune);
  var slices = [];
  var chordIndex = 0;
  var measureIndex = 0;
  var i;

  for (i = 0; i < windows.length; i += 1) {
    var window = windows[i];
    var noteWeights = {};
    var anchorIndex = null;
    var slotProfiles = buildSlotProfiles(parsedTune, window);
    var subPulseProfile = buildSubPulseProfile(parsedTune, window, slotProfiles);
    var j;

    while (chordIndex + 1 < parsedTune.chordChanges.length && parsedTune.chordChanges[chordIndex + 1].offset <= window.start + EPSILON) {
      chordIndex += 1;
    }

    while (measureIndex + 1 < parsedTune.measures.length && parsedTune.measures[measureIndex + 1].start <= window.start + EPSILON) {
      measureIndex += 1;
    }

    var measure = parsedTune.measures[measureIndex] || null;

    for (j = 0; j < parsedTune.noteGroups.length; j += 1) {
      var group = parsedTune.noteGroups[j];
      var overlapStart = Math.max(group.start, window.start);
      var overlapEnd = Math.min(group.start + group.duration, window.end);
      var overlap = overlapEnd - overlapStart;
      var k;

      if (overlap <= EPSILON) {
        continue;
      }

      if (anchorIndex === null && group.anchorIndex !== null && group.start >= window.start - EPSILON && group.start < window.end - EPSILON) {
        anchorIndex = group.anchorIndex;
      }

      for (k = 0; k < group.relativePcs.length; k += 1) {
        var relativePc = group.relativePcs[k];
        noteWeights[relativePc] = (noteWeights[relativePc] || 0) + overlap;
      }
    }

    var beatInBar = null;
    if (measure && !measure.isPickup) {
      beatInBar = Math.max(0, Math.floor(((window.start - measure.start) / beatLength) + EPSILON));
    }

    slices.push({
      beatNumber: i,
      rawBarIndex: measure ? measure.rawIndex : 0,
      barIndex: measure ? measure.normalizedMeasureIndex : 0,
      measureNumber: measure ? measure.measureNumber : 1,
      measureInPart: measure ? measure.measureInPart : 0,
      partIndex: measure ? measure.partIndex : 0,
      partPass: measure ? measure.partPass : 1,
      partLength: measure ? measure.partLength : 0,
      measuresFromPartEnd: measure ? measure.measuresFromPartEnd : null,
      isCadenceMeasure: !!(measure && measure.isCadenceMeasure),
      endingNumber: measure ? measure.endingNumber : null,
      measureSignature: measure ? measure.signature : "",
      isPickup: !!(measure && measure.isPickup),
      beatInBar: beatInBar,
      start: window.start,
      end: window.end,
      noteWeights: noteWeights,
      slotProfiles: slotProfiles,
      subPulsePcs: subPulseProfile,
      chord: parsedTune.chordChanges.length ? parsedTune.chordChanges[chordIndex] : null,
      anchorIndex: anchorIndex
    });
  }

  return slices;
}

function buildMelodyFingerprint(parsedTune) {
  return parsedTune.measures.filter(function (measure) {
    return !measure.isPickup;
  }).map(function (measure) {
    return [
      "P" + measure.partIndex,
      "M" + measure.measureInPart,
      "S" + measure.signature
    ].join("=");
  }).join("||");
}

function buildPartFingerprints(parsedTune) {
  var grouped = {};

  parsedTune.measures.forEach(function (measure) {
    if (measure.isPickup) {
      return;
    }

    if (!grouped[measure.partIndex]) {
      grouped[measure.partIndex] = {};
    }

    if (!grouped[measure.partIndex][measure.measureInPart]) {
      grouped[measure.partIndex][measure.measureInPart] = measure.signature;
    }
  });

  return Object.keys(grouped).sort(function (left, right) {
    return parseInt(left, 10) - parseInt(right, 10);
  }).map(function (partIndex) {
    var measures = grouped[partIndex];
    var orderedKeys = Object.keys(measures).sort(function (left, right) {
      return parseInt(left, 10) - parseInt(right, 10);
    });
    var ordered = orderedKeys.map(function (measureIndex) {
      return "M" + measureIndex + "=" + measures[measureIndex];
    }).join("||");

    return {
      partIndex: parseInt(partIndex, 10),
      measureSignatures: orderedKeys.map(function (measureIndex) {
        return measures[measureIndex];
      }),
      fingerprint: ordered
    };
  });
}

function parseAbcTune(options) {
  var abc = String(options.abc || "").replace(/\u00A0/g, " ").replace(/\r/g, "");
  var modeInfo = theory.parseMode(options.mode);
  var meterInfo = theory.parseMeter(options.meter);
  var noteGroups = [];
  var chordChanges = [];
  var barEvents = [];
  var accidentalMemory = {};
  var offset = 0;
  var previousGroup = null;
  var pendingNextDurationMultiplier = null;
  var tupletRemaining = 0;
  var tupletFactor = 1;
  var pendingEndingNumber = null;
  var index = 0;

  assertSupportedAbc(abc);

  function applyTuplet(duration) {
    if (tupletRemaining > 0) {
      duration *= tupletFactor;
      tupletRemaining -= 1;
      if (tupletRemaining === 0) {
        tupletFactor = 1;
      }
    }
    return duration;
  }

  function pushGroup(relativePcs, rawDuration, anchorIndex) {
    var duration = applyTuplet(rawDuration);

    if (pendingNextDurationMultiplier) {
      duration *= pendingNextDurationMultiplier;
      pendingNextDurationMultiplier = null;
    }

    var group = {
      start: offset,
      duration: duration,
      relativePcs: relativePcs,
      anchorIndex: anchorIndex
    };

    noteGroups.push(group);
    previousGroup = group;
    offset += duration;
  }

  while (index < abc.length) {
    var ch = abc.charAt(index);

    if (/\s/.test(ch)) {
      index += 1;
      continue;
    }

    if (ch === "%") {
      while (index < abc.length && abc.charAt(index) !== "\n") {
        index += 1;
      }
      continue;
    }

    if (ch === "\"") {
      var chordEnd = abc.indexOf("\"", index + 1);
      if (chordEnd === -1) {
        break;
      }
      chordChanges.push({
        offset: offset,
        raw: abc.slice(index + 1, chordEnd)
      });
      index = chordEnd + 1;
      continue;
    }

    if (ch === "!" || ch === "+") {
      var decorationEnd = abc.indexOf(ch, index + 1);
      index = decorationEnd === -1 ? abc.length : decorationEnd + 1;
      continue;
    }

    if (ch === "{") {
      var graceEnd = abc.indexOf("}", index + 1);
      index = graceEnd === -1 ? abc.length : graceEnd + 1;
      continue;
    }

    if ("~uvHLMOPST".indexOf(ch) !== -1) {
      index += 1;
      continue;
    }

    if (ch === "(" && /\d/.test(abc.charAt(index + 1))) {
      var digits = "";
      index += 1;
      while (index < abc.length && /\d/.test(abc.charAt(index))) {
        digits += abc.charAt(index);
        index += 1;
      }
      tupletRemaining = parseInt(digits || "0", 10);
      tupletFactor = defaultTupletFactor(tupletRemaining);
      while (index < abc.length && abc.charAt(index) === ":") {
        index += 1;
        while (index < abc.length && /\d/.test(abc.charAt(index))) {
          index += 1;
        }
      }
      continue;
    }

    if (ch === "[" && /\d/.test(abc.charAt(index + 1))) {
      var endingInfo = parseEndingMarker(abc, index);
      pendingEndingNumber = endingInfo.endingNumber;
      index = endingInfo.endIndex;
      continue;
    }

    var barlineInfo = null;
    if (ch === "[" && abc.charAt(index + 1) === "|") {
      barlineInfo = consumeBarline(abc, index);
    } else if ("|:]".indexOf(ch) !== -1) {
      barlineInfo = consumeBarline(abc, index);
    }

    if (barlineInfo) {
      accidentalMemory = {};
      pushUniqueBoundary(barEvents, offset, barlineInfo.endingNumber !== null ? barlineInfo.endingNumber : pendingEndingNumber);
      pendingEndingNumber = null;
      index = barlineInfo.endIndex;
      continue;
    }

    if (ch === "[") {
      var closeBracket = abc.indexOf("]", index + 1);
      if (closeBracket === -1) {
        break;
      }

      var notesInBracket = parseBracketNotes(abc.slice(index + 1, closeBracket), modeInfo, accidentalMemory);
      var durationInfoAfterBracket = parseDurationFactor(abc, closeBracket + 1);
      pushGroup(notesInBracket, meterInfo.defaultUnitLength * durationInfoAfterBracket.factor, index);
      index = durationInfoAfterBracket.endIndex;
      continue;
    }

    if (ch === ">" || ch === "<") {
      var brokenCount = 1;
      while (index + brokenCount < abc.length && abc.charAt(index + brokenCount) === ch) {
        brokenCount += 1;
      }

      if (previousGroup) {
        var pair = brokenRhythmPair(ch, brokenCount);
        var updatedDuration = previousGroup.duration * pair.previous;
        var delta = updatedDuration - previousGroup.duration;
        previousGroup.duration = updatedDuration;
        offset += delta;
        pendingNextDurationMultiplier = pair.next;
      }

      index += brokenCount;
      continue;
    }

    if (/[A-Ga-gzZxX]/.test(ch) || "^_=".indexOf(ch) !== -1) {
      var accidental = "";
      var anchorIndex = index;

      while (index < abc.length && "^_=".indexOf(abc.charAt(index)) !== -1) {
        accidental += abc.charAt(index);
        index += 1;
      }

      if (index >= abc.length) {
        break;
      }

      var noteLetter = abc.charAt(index);
      if (!/[A-Ga-gzZxX]/.test(noteLetter)) {
        index += 1;
        continue;
      }

      index += 1;

      while (index < abc.length && /[',]/.test(abc.charAt(index))) {
        index += 1;
      }

      var durationInfo = parseDurationFactor(abc, index);
      var relativePcs = [];

      if (/[A-Ga-g]/.test(noteLetter)) {
        relativePcs.push(theory.relativePitchClassForNote(modeInfo, noteLetter.toUpperCase(), accidental, accidentalMemory));
      }

      pushGroup(relativePcs, meterInfo.defaultUnitLength * durationInfo.factor, anchorIndex);
      index = durationInfo.endIndex;
      continue;
    }

    index += 1;
  }

  var parsed = {
    abc: abc,
    modeInfo: modeInfo,
    meterInfo: meterInfo,
    type: options.type || "unknown",
    noteGroups: noteGroups,
    chordChanges: chordChanges,
    totalDuration: offset
  };

  var measureData = buildMeasures(parsed, barEvents);
  parsed.measures = measureData.measures;
  parsed.pickupDuration = measureData.pickupDuration;
  parsed.beatSlices = buildBeatSlices(parsed);
  parsed.melodyFingerprint = buildMelodyFingerprint(parsed);
  parsed.partFingerprints = buildPartFingerprints(parsed);

  return parsed;
}

function stripChordAnnotations(abcText) {
  return String(abcText || "").replace(/"[^"\n]*"/g, "");
}

function injectPredictedChords(abcText, predictions) {
  var insertions = [];
  var lastWritten = null;
  var i;

  for (i = 0; i < predictions.length; i += 1) {
    var prediction = predictions[i];
    if (prediction.anchorIndex === null || prediction.displayChord === lastWritten) {
      continue;
    }

    insertions.push({
      index: prediction.anchorIndex,
      text: "\"" + prediction.displayChord + "\""
    });
    lastWritten = prediction.displayChord;
  }

  insertions.sort(function (left, right) {
    return right.index - left.index;
  });

  var output = abcText;
  for (i = 0; i < insertions.length; i += 1) {
    var insertion = insertions[i];
    output = output.slice(0, insertion.index) + insertion.text + output.slice(insertion.index);
  }

  return output;
}

module.exports = {
  buildMelodyFingerprint: buildMelodyFingerprint,
  injectPredictedChords: injectPredictedChords,
  parseAbcTune: parseAbcTune,
  stripChordAnnotations: stripChordAnnotations
};
