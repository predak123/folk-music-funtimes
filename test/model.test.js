var assert = require("assert");
var abc = require("../src/music/abc");
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

  var placementFirstPredictions = modelApi.predictForTune(model, {
    abc: "EA AB|G2 B2|EA AB|G2 dB|A2 A2|",
    meter: "2/4",
    mode: "Adorian",
    type: "polka",
    placementFirst: true
  });

  assert.strictEqual(placementFirstPredictions[0].onsetLabel, "change");
  assert.ok(placementFirstPredictions.some(function (prediction, index) {
    return index > 0 && prediction.onsetLabel === "stay";
  }));
  assert.ok(placementFirstPredictions.some(function (prediction, index) {
    return index > 0 && prediction.onsetLabel === "change";
  }));
  placementFirstPredictions.forEach(function (prediction, index) {
    if (index === 0) {
      return;
    }

    if (prediction.onsetLabel === "stay") {
      assert.strictEqual(prediction.token, placementFirstPredictions[index - 1].token);
      return;
    }

    assert.notStrictEqual(prediction.token, placementFirstPredictions[index - 1].token);
  });

  var onsetContextPredictions = modelApi.predictForTune(model, {
    abc: "EA AB|G2 B2|EA AB|G2 dB|A2 A2|",
    meter: "2/4",
    mode: "Adorian",
    type: "polka",
    placementFirst: true,
    onsetContextIdentity: true
  });

  assert.strictEqual(onsetContextPredictions[0].onsetLabel, "change");
  onsetContextPredictions.forEach(function (prediction, index) {
    if (index === 0) {
      return;
    }

    if (prediction.onsetLabel === "stay") {
      assert.strictEqual(prediction.token, onsetContextPredictions[index - 1].token);
      return;
    }

    assert.notStrictEqual(prediction.token, onsetContextPredictions[index - 1].token);
  });

  var consensusModel = modelApi.createEmptyModel();
  modelApi.trainOnRows(consensusModel, [
    {
      tune_id: "shared-1",
      abc: "\"Am\"EA AB|\"G\"G2 B2|\"Am\"A2 A2|",
      meter: "2/4",
      mode: "Adorian",
      type: "polka"
    },
    {
      tune_id: "shared-1",
      abc: "\"Am\"EA AB|\"G\"G2 B2|\"Am\"A2 A2|",
      meter: "2/4",
      mode: "Adorian",
      type: "polka"
    },
    {
      tune_id: "shared-1",
      abc: "\"Am\"EA AB|\"Em\"G2 B2|\"Am\"A2 A2|",
      meter: "2/4",
      mode: "Adorian",
      type: "polka"
    }
  ]);

  var consensusPredictions = modelApi.predictForTune(consensusModel, {
    abc: "EA AB|G2 B2|A2 A2|",
    meter: "2/4",
    mode: "Adorian",
    type: "polka"
  });

  assert.strictEqual(consensusPredictions[2].displayChord, "G");

  var upgradedModel = modelApi.createEmptyModel();
  delete upgradedModel.counts.cadenceFunctionTotals;
  delete upgradedModel.counts.cadenceFunctionTransitions;
  delete upgradedModel.counts.cadenceTokenTransitions;
  var upgradedPredictions = modelApi.predictForTune(upgradedModel, {
    abc: "EA AB|G2 B2|EA AB|G2 dB|A2 A2|",
    meter: "2/4",
    mode: "Adorian",
    type: "polka"
  });
  assert.ok(upgradedPredictions.length > 0);

  var structuralModel = modelApi.createEmptyModel();
  modelApi.trainOnRow(structuralModel, {
    abc: "\"G\"A2B2 c2d2|\"C\"e2f2 g2a2|\"D\"b2a2 g2f2|\"G\"e2d2 c2B2|\"G\"A4 B4|\"C\"c4 d4|\"D\"e4 f4|\"G\"g8|\"G\"A2B2 c2d2|\"C\"e2f2 g2a2|\"D\"b2a2 g2f2|\"G\"e2d2 c2B2|\"G\"A4 B4|\"C\"c4 d4|\"D\"e4 f4|\"G\"g8|",
    meter: "4/4",
    mode: "Gmajor",
    type: "reel"
  });

  var canonicalParsed = abc.parseAbcTune({
    abc: "A2B2 c2d2|e2f2 g2a2|b2a2 g2f2|e2d2 c2B2|A4 B4|c4 d4|e4 f4|g8|",
    meter: "4/4",
    mode: "Gmajor",
    type: "reel"
  });

  assert.ok(structuralModel.counts.canonicalMelodyTokens[canonicalParsed.canonicalMelodyFingerprint]);
  assert.strictEqual(
    structuralModel.counts.canonicalMelodyTokens[canonicalParsed.canonicalMelodyFingerprint]["0|0|0"]["1:maj"],
    1
  );
  assert.ok(Object.keys(structuralModel.counts.typeModeOnsetChordTotals).length > 0);
  assert.ok(Object.keys(structuralModel.counts.typeModeFunctionTotals).length > 0);
  assert.ok(Object.keys(structuralModel.counts.cadenceOnsetPositions).length > 0);
  assert.ok(Object.keys(structuralModel.counts.cadenceOnsetChordTotals).length > 0);
  assert.ok(Object.keys(structuralModel.counts.cadenceFunctionTotals).length > 0);
  assert.ok(Object.keys(structuralModel.counts.cadenceFunctionTransitions).length > 0);
  assert.ok(Object.keys(structuralModel.counts.cadenceTokenTransitions).length > 0);
  assert.ok(Object.keys(structuralModel.counts.styleBeatOnsetStyles).length > 0);
  assert.ok(Object.keys(structuralModel.counts.typeMeterBeatOnsetStyles).length > 0);
  assert.ok(Object.keys(structuralModel.counts.roleBeatOnsetStyles).length > 0);
  assert.ok(Object.keys(structuralModel.counts.rolePositions).length > 0);
  assert.ok(Object.keys(structuralModel.counts.phrasePositions).length > 0);
  assert.ok(Object.keys(structuralModel.counts.onsetRolePositions).length > 0);
  assert.ok(Object.keys(structuralModel.counts.onsetPhrasePositions).length > 0);
  assert.ok(Object.keys(structuralModel.counts.onsetRolePositionChordTotals).length > 0);
  assert.ok(Object.keys(structuralModel.counts.onsetPhraseChordTotals).length > 0);
  assert.ok(Object.keys(structuralModel.counts.partOnsetPatterns).length > 0);
  assert.ok(structuralModel.counts.fuzzyPartFamilyLibrary.length > 0);
}

module.exports = {
  name: "model.test",
  run: run
};
