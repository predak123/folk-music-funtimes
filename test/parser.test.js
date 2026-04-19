var assert = require("assert");
var abc = require("../src/music/abc");

function run() {
  var parsed = abc.parseAbcTune({
    abc: "|:e|f2fe dBAB|dded B2A2|f2fe dBAB|1 dBAB d2d:|2 dBAB d2d||",
    meter: "4/4",
    mode: "Dmajor",
    type: "reel"
  });

  assert.ok(parsed.pickupDuration > 0);
  assert.strictEqual(parsed.measures[0].measureNumber, 0);
  assert.strictEqual(parsed.beatSlices[0].isPickup, true);
  assert.strictEqual(parsed.beatSlices[1].measureNumber, 1);

  var firstEnding = parsed.measures.filter(function (measure) {
    return measure.endingNumber === 1;
  })[0];
  var secondEnding = parsed.measures.filter(function (measure) {
    return measure.endingNumber === 2;
  })[0];

  assert.ok(firstEnding);
  assert.ok(secondEnding);
  assert.strictEqual(firstEnding.measureInPart, secondEnding.measureInPart);
  assert.strictEqual(firstEnding.partIndex, secondEnding.partIndex);
  assert.strictEqual(firstEnding.measuresFromPartEnd, 0);
  assert.strictEqual(secondEnding.measuresFromPartEnd, 0);

  var ornamented = abc.parseAbcTune({
    abc: "uD2|:{F}v[G,2G2]uB>ud c>A B>G|1 E>A F<D {F}G2 uG>uD:|2 E>A F<D {F}G2 (G>E)||",
    meter: "4/4",
    mode: "Gmajor",
    type: "strathspey"
  });

  assert.ok(ornamented.noteGroups.length > 0);
  assert.ok(ornamented.beatSlices.length > 0);

  var withChords = abc.parseAbcTune({
    abc: "\"Am\"EA AB|\"G\"G2 B2|\"Am\"EA AB|\"G\"G2 dB|\"Am\"A2 A2|",
    meter: "2/4",
    mode: "Adorian",
    type: "polka"
  });

  var withoutChords = abc.parseAbcTune({
    abc: "EA AB|G2 B2|EA AB|G2 dB|A2 A2|",
    meter: "2/4",
    mode: "Adorian",
    type: "polka"
  });

  assert.strictEqual(withChords.melodyFingerprint, withoutChords.melodyFingerprint);

  var jig = abc.parseAbcTune({
    abc: "G2G GAB|A2A ABd|edd gdd|edB dBA|",
    meter: "6/8",
    mode: "Gmajor",
    type: "jig"
  });

  assert.strictEqual(withChords.beatSlices[0].slotProfiles.length, 2);
  assert.ok(withChords.beatSlices[0].slotProfiles[0].noteWeights);
  assert.ok(jig.beatSlices[0].subPulsePcs.onset.length > 0);
  assert.ok(jig.beatSlices[0].subPulsePcs.third.length > 0);
  assert.strictEqual(jig.beatSlices[0].slotProfiles.length, 3);
  assert.strictEqual(jig.beatSlices[0].slotProfiles[2].label, "late");
}

module.exports = {
  name: "parser.test",
  run: run
};
