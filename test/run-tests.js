var tests = [
  require("./parser.test"),
  require("./model.test"),
  require("./theory.test")
];

var failures = 0;
var i;

for (i = 0; i < tests.length; i += 1) {
  try {
    tests[i].run();
    console.log("PASS " + tests[i].name);
  } catch (error) {
    failures += 1;
    console.error("FAIL " + tests[i].name);
    console.error(error && error.stack ? error.stack : error);
  }
}

if (failures > 0) {
  process.exitCode = 1;
}
