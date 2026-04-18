var NATURAL_NOTE_PCS = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
};

var LETTERS = ["C", "D", "E", "F", "G", "A", "B"];

var SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
var FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

var MODE_PATTERNS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10]
};

function mod12(value) {
  var out = value % 12;
  return out < 0 ? out + 12 : out;
}

function normalizeModeFamily(modeText) {
  var normalized = String(modeText || "major").toLowerCase();

  if (normalized === "maj") {
    return "major";
  }

  if (normalized === "min") {
    return "minor";
  }

  return MODE_PATTERNS[normalized] ? normalized : "major";
}

function accidentalOffset(accidentalText) {
  if (!accidentalText) {
    return 0;
  }

  if (accidentalText === "#" || accidentalText === "sharp") {
    return 1;
  }

  if (accidentalText === "b" || accidentalText === "flat") {
    return -1;
  }

  return 0;
}

function parseMode(modeString) {
  var text = String(modeString || "Cmajor").replace(/\s+/g, "");
  var match = /^([A-Ga-g])((?:b|#|flat|sharp)?)([A-Za-z]*)$/.exec(text);

  if (!match) {
    throw new Error("Unsupported mode string: " + modeString);
  }

  var tonicLetter = match[1].toUpperCase();
  var tonicAccidentalText = match[2];
  var modeFamily = normalizeModeFamily(match[3] || "major");
  var tonicPc = mod12(NATURAL_NOTE_PCS[tonicLetter] + accidentalOffset(tonicAccidentalText));
  var tonicName = tonicLetter;

  if (tonicAccidentalText === "#" || tonicAccidentalText === "sharp") {
    tonicName += "#";
  } else if (tonicAccidentalText === "b" || tonicAccidentalText === "flat") {
    tonicName += "b";
  }

  return {
    raw: modeString,
    tonicLetter: tonicLetter,
    tonicPc: tonicPc,
    tonicName: tonicName,
    tonicAccidentalOffset: accidentalOffset(tonicAccidentalText),
    tonicLetterIndex: LETTERS.indexOf(tonicLetter),
    modeFamily: modeFamily,
    scaleSemitones: MODE_PATTERNS[modeFamily]
  };
}

function parseMeter(meterString) {
  var text = String(meterString || "4/4").trim();

  if (text === "C") {
    text = "4/4";
  }

  var match = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (!match) {
    throw new Error("Unsupported meter string: " + meterString);
  }

  var numerator = parseInt(match[1], 10);
  var denominator = parseInt(match[2], 10);
  var barLength = numerator / denominator;
  var beatsPerBar;
  var beatLength;

  if (denominator === 8 && numerator > 3 && numerator % 3 === 0) {
    beatsPerBar = numerator / 3;
    beatLength = 3 / denominator;
  } else {
    beatsPerBar = numerator;
    beatLength = 1 / denominator;
  }

  return {
    raw: meterString,
    numerator: numerator,
    denominator: denominator,
    beatsPerBar: beatsPerBar,
    beatLength: beatLength,
    barLength: barLength,
    defaultUnitLength: 1 / 8
  };
}

function naturalDiffFromTonic(modeInfo, noteLetter) {
  var tonicPc = modeInfo.tonicPc;
  var notePc = NATURAL_NOTE_PCS[noteLetter];
  return mod12(notePc - tonicPc);
}

function scaleDiffFromTonic(modeInfo, noteLetter) {
  var degreeIndex = (LETTERS.indexOf(noteLetter) - modeInfo.tonicLetterIndex + 7) % 7;
  return modeInfo.scaleSemitones[degreeIndex];
}

function explicitAccidentalValue(text) {
  if (!text) {
    return null;
  }

  if (text === "=") {
    return 0;
  }

  if (text === "^") {
    return 1;
  }

  if (text === "^^") {
    return 2;
  }

  if (text === "_") {
    return -1;
  }

  if (text === "__") {
    return -2;
  }

  return null;
}

function relativePitchClassForNote(modeInfo, noteLetter, accidentalText, accidentalMemory) {
  var naturalDiff = naturalDiffFromTonic(modeInfo, noteLetter);
  var defaultDiff = scaleDiffFromTonic(modeInfo, noteLetter);
  var explicit = explicitAccidentalValue(accidentalText);

  if (explicit !== null) {
    accidentalMemory[noteLetter] = explicit;
    return mod12(naturalDiff + explicit);
  }

  if (Object.prototype.hasOwnProperty.call(accidentalMemory, noteLetter)) {
    return mod12(naturalDiff + accidentalMemory[noteLetter]);
  }

  return defaultDiff;
}

function noteNameToPc(name) {
  var text = String(name || "").trim();
  var match = /^([A-Ga-g])([b#]?)$/.exec(text);
  if (!match) {
    return null;
  }

  return mod12(NATURAL_NOTE_PCS[match[1].toUpperCase()] + accidentalOffset(match[2]));
}

function accidentalPrefix(value) {
  if (value <= -2) {
    return "bb";
  }

  if (value === -1) {
    return "b";
  }

  if (value === 1) {
    return "#";
  }

  if (value >= 2) {
    return "##";
  }

  return "";
}

function accidentalPrefixValue(prefix) {
  if (prefix === "bb") {
    return -2;
  }

  if (prefix === "b") {
    return -1;
  }

  if (prefix === "#") {
    return 1;
  }

  if (prefix === "##" || prefix === "x") {
    return 2;
  }

  return 0;
}

function degreeLabelForRelativeRoot(modeInfo, relativeRoot) {
  var best = null;
  var degreeIndex;
  var accidental;

  for (degreeIndex = 0; degreeIndex < modeInfo.scaleSemitones.length; degreeIndex += 1) {
    for (accidental = -2; accidental <= 2; accidental += 1) {
      if (mod12(modeInfo.scaleSemitones[degreeIndex] + accidental) !== mod12(relativeRoot)) {
        continue;
      }

      if (!best ||
          Math.abs(accidental) < Math.abs(best.accidental) ||
          (Math.abs(accidental) === Math.abs(best.accidental) && accidental < best.accidental)) {
        best = {
          accidental: accidental,
          degree: degreeIndex + 1
        };
      }
    }
  }

  if (!best) {
    return String(relativeRoot);
  }

  return accidentalPrefix(best.accidental) + String(best.degree);
}

function relativeRootForDegreeLabel(modeInfo, degreeLabel) {
  var match = /^(bb|b|##|#|x)?([1-7])$/.exec(String(degreeLabel || ""));
  if (!match) {
    return parseInt(degreeLabel, 10);
  }

  var accidental = accidentalPrefixValue(match[1] || "");
  var degree = parseInt(match[2], 10) - 1;
  return mod12(modeInfo.scaleSemitones[degree] + accidental);
}

function parseChordToken(token, modeInfo) {
  var parts = String(token).split(":");
  var degreeLabel = parts[0];
  var quality = parts[1] || "maj";

  return {
    degreeLabel: degreeLabel,
    quality: quality,
    relativeRoot: relativeRootForDegreeLabel(modeInfo, degreeLabel)
  };
}

function extractQualityFragment(text) {
  var lower = String(text || "").toLowerCase();
  var stopIndex = lower.search(/[\s(\[{]/);

  if (stopIndex !== -1) {
    lower = lower.slice(0, stopIndex);
  }

  return lower.trim();
}

function normalizeChord(rawChord, modeInfo) {
  var raw = String(rawChord || "").trim();
  if (!raw) {
    return null;
  }

  if (raw.charAt(0) === "/") {
    return null;
  }

  var main = raw.split("/")[0];
  var match = /^([A-Ga-g])([b#]?)(.*)$/.exec(main);
  if (!match) {
    return null;
  }

  var rootName = match[1].toUpperCase() + (match[2] || "");
  var rootPc = noteNameToPc(rootName);
  if (rootPc === null) {
    return null;
  }

  var qualityText = extractQualityFragment(match[3] || "");
  var quality = "maj";

  if (qualityText.indexOf("dim") !== -1 || qualityText.indexOf("o") !== -1) {
    quality = "dim";
  } else if (qualityText.indexOf("m") !== -1 && qualityText.indexOf("maj") === -1) {
    quality = "min";
  }

  var relativeRoot = mod12(rootPc - modeInfo.tonicPc);
  var degreeLabel = degreeLabelForRelativeRoot(modeInfo, relativeRoot);

  return {
    raw: raw,
    rootName: rootName,
    rootPc: rootPc,
    relativeRoot: relativeRoot,
    degreeLabel: degreeLabel,
    quality: quality,
    token: degreeLabel + ":" + quality
  };
}

function chordTonesForToken(token, modeInfo) {
  var parsed = parseChordToken(token, modeInfo);
  var root = parsed.relativeRoot;
  var quality = parsed.quality;

  if (quality === "min") {
    return [mod12(root), mod12(root + 3), mod12(root + 7)];
  }

  if (quality === "dom") {
    return [mod12(root), mod12(root + 4), mod12(root + 7), mod12(root + 10)];
  }

  if (quality === "dim") {
    return [mod12(root), mod12(root + 3), mod12(root + 6)];
  }

  if (quality === "sus") {
    return [mod12(root), mod12(root + 5), mod12(root + 7)];
  }

  return [mod12(root), mod12(root + 4), mod12(root + 7)];
}

function preferFlats(modeInfo) {
  if (modeInfo.tonicName.indexOf("b") !== -1) {
    return true;
  }

  return ["F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"].indexOf(modeInfo.tonicName) !== -1;
}

function chordTokenToDisplayName(token, modeInfo) {
  var parsed = parseChordToken(token, modeInfo);
  var absoluteRoot = mod12(modeInfo.tonicPc + parsed.relativeRoot);
  var useFlats = preferFlats(modeInfo) || String(parsed.degreeLabel).indexOf("b") === 0;
  var rootName = useFlats ? FLAT_NAMES[absoluteRoot] : SHARP_NAMES[absoluteRoot];

  if (parsed.quality === "min") {
    return rootName + "m";
  }

  if (parsed.quality === "dom") {
    return rootName + "7";
  }

  if (parsed.quality === "dim") {
    return rootName + "dim";
  }

  if (parsed.quality === "sus") {
    return rootName + "sus";
  }

  return rootName;
}

function buildDiatonicChordTokens(modeInfo) {
  var extended = modeInfo.scaleSemitones.concat(
    modeInfo.scaleSemitones.map(function (value) {
      return value + 12;
    })
  );
  var output = [];
  var degree;

  for (degree = 0; degree < 7; degree += 1) {
    var root = extended[degree];
    var third = extended[degree + 2] - root;
    var fifth = extended[degree + 4] - root;
    var quality = "maj";

    if (third === 3 && fifth === 7) {
      quality = "min";
    } else if (third === 3 && fifth === 6) {
      quality = "dim";
    }

    output.push(degreeLabelForRelativeRoot(modeInfo, mod12(root)) + ":" + quality);
  }

  return output;
}

module.exports = {
  buildDiatonicChordTokens: buildDiatonicChordTokens,
  chordTokenToDisplayName: chordTokenToDisplayName,
  chordTonesForToken: chordTonesForToken,
  degreeLabelForRelativeRoot: degreeLabelForRelativeRoot,
  mod12: mod12,
  normalizeChord: normalizeChord,
  noteNameToPc: noteNameToPc,
  parseChordToken: parseChordToken,
  parseMeter: parseMeter,
  parseMode: parseMode,
  relativePitchClassForNote: relativePitchClassForNote,
  relativeRootForDegreeLabel: relativeRootForDegreeLabel
};
