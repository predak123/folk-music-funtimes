var assert = require("assert");
var modelApi = require("../src/model/chord_interpolator");

function run() {
  var model = modelApi.createEmptyModel();

  modelApi.trainOnRow(model, {
    abc: "\"Am\"EA AB|\"G\"G2 B2|\"Am\"EA AB|\"G\"G2 dB|\"Am\"A2 A2|",
    meter: "2/4",
    mode: "Adorian",
    type: "polka"
  });

  modelApi.trainOnRow(model, {
    abc: "\"Am\"ea ab|\"G\"ag ef|\"Em\"ge dB|\"Am\"A2 A2|",
    meter: "2/4",
    mode: "Adorian",
    type: "polka"
  });

  var predictions = modelApi.predictForTune(model, {
    abc: "EA AB|G2 B2|EA AB|G2 dB|A2 A2|",
    meter: "2/4",
    mode: "Adorian",
    type: "polka"
  });

  assert.ok(predictions.length > 0);
  assert.strictEqual(predictions[0].displayChord, "Am");
  assert.strictEqual(predictions[2].displayChord, "G");
  assert.strictEqual(predictions[predictions.length - 1].displayChord, "Am");
}

module.exports = {
  name: "model.test",
  run: run
};
