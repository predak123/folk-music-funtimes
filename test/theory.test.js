var assert = require("assert");
var theory = require("../src/music/theory");

function run() {
  var dorian = theory.parseMode("Adorian");
  var major = theory.parseMode("Cmajor");

  assert.strictEqual(theory.normalizeChord("Am", dorian).token, "1:min");
  assert.strictEqual(theory.normalizeChord("G", dorian).token, "7:maj");
  assert.strictEqual(theory.normalizeChord("E7", dorian).token, "5:dom");
  assert.strictEqual(theory.normalizeChord("Bb", major).token, "b7:maj");
  assert.strictEqual(theory.normalizeChord("D(Bm on repeat)", theory.parseMode("Dmajor")).token, "1:maj");
  assert.strictEqual(theory.chordTokenToDisplayName("b7:maj", major), "Bb");
}

module.exports = {
  name: "theory.test",
  run: run
};
