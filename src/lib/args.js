function parseArgs(argv) {
  var result = {
    _: []
  };

  var i;
  for (i = 0; i < argv.length; i += 1) {
    var current = argv[i];

    if (current.indexOf("--") !== 0) {
      result._.push(current);
      continue;
    }

    var trimmed = current.slice(2);
    var eqIndex = trimmed.indexOf("=");

    if (eqIndex !== -1) {
      result[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1);
      continue;
    }

    var next = argv[i + 1];
    if (!next || next.indexOf("--") === 0) {
      result[trimmed] = true;
      continue;
    }

    result[trimmed] = next;
    i += 1;
  }

  return result;
}

module.exports = {
  parseArgs: parseArgs
};

