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

  var ornamented = abc.parseAbcTune({
    abc: "uD2|:{F}v[G,2G2]uB>ud c>A B>G|1 E>A F<D {F}G2 uG>uD:|2 E>A F<D {F}G2 (G>E)||",
    meter: "4/4",
    mode: "Gmajor",
    type: "strathspey"
  });

  assert.ok(ornamented.noteGroups.length > 0);
  assert.ok(ornamented.beatSlices.length > 0);
}

module.exports = {
  name: "parser.test",
  run: run
};
