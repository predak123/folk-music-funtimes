var fs = require("fs");

function processChunk(state, chunk, onRow) {
  var text = chunk;
  var i;

  if (state.pendingCR) {
    if (text.charAt(0) === "\n") {
      text = text.slice(1);
    }
    state.pendingCR = false;
  }

  if (state.pendingQuote) {
    if (text.length === 0) {
      return;
    }

    if (text.charAt(0) === "\"") {
      state.field += "\"";
      text = text.slice(1);
      state.pendingQuote = false;
    } else {
      state.inQuotes = false;
      state.afterQuote = true;
      state.pendingQuote = false;
    }
  }

  for (i = 0; i < text.length; i += 1) {
    var ch = text.charAt(i);

    if (state.inQuotes) {
      if (ch === "\"") {
        if (i === text.length - 1) {
          state.pendingQuote = true;
          break;
        }

        if (text.charAt(i + 1) === "\"") {
          state.field += "\"";
          i += 1;
        } else {
          state.inQuotes = false;
          state.afterQuote = true;
        }
      } else {
        state.field += ch;
      }
      continue;
    }

    if (state.afterQuote) {
      if (ch === " " || ch === "\t") {
        continue;
      }

      if (ch === ",") {
        state.row.push(state.field);
        state.field = "";
        state.afterQuote = false;
        continue;
      }

      if (ch === "\n") {
        state.row.push(state.field);
        onRow(state.row);
        state.row = [];
        state.field = "";
        state.afterQuote = false;
        continue;
      }

      if (ch === "\r") {
        state.row.push(state.field);
        onRow(state.row);
        state.row = [];
        state.field = "";
        state.afterQuote = false;
        state.pendingCR = true;
        continue;
      }

      throw new Error("Malformed CSV near character after closing quote.");
    }

    if (ch === "\"") {
      if (state.field.length === 0) {
        state.inQuotes = true;
      } else {
        state.field += ch;
      }
      continue;
    }

    if (ch === ",") {
      state.row.push(state.field);
      state.field = "";
      continue;
    }

    if (ch === "\n") {
      state.row.push(state.field);
      onRow(state.row);
      state.row = [];
      state.field = "";
      continue;
    }

    if (ch === "\r") {
      state.row.push(state.field);
      onRow(state.row);
      state.row = [];
      state.field = "";
      state.pendingCR = true;
      continue;
    }

    state.field += ch;
  }
}

function finishParser(state, onRow) {
  if (state.pendingQuote) {
    state.pendingQuote = false;
    state.inQuotes = false;
    state.afterQuote = true;
  }

  if (state.inQuotes) {
    throw new Error("Unterminated CSV quoted field.");
  }

  if (state.field.length > 0 || state.afterQuote || state.row.length > 0) {
    state.row.push(state.field);
    onRow(state.row);
  }
}

function parseCsvFile(filePath, onRow) {
  return new Promise(function (resolve, reject) {
    var state = {
      row: [],
      field: "",
      inQuotes: false,
      afterQuote: false,
      pendingQuote: false,
      pendingCR: false
    };

    var stream = fs.createReadStream(filePath, {
      encoding: "utf8"
    });

    stream.on("data", function (chunk) {
      try {
        processChunk(state, chunk, onRow);
      } catch (error) {
        stream.destroy(error);
      }
    });

    stream.on("end", function () {
      try {
        finishParser(state, onRow);
        resolve();
      } catch (error) {
        reject(error);
      }
    });

    stream.on("error", reject);
  });
}

module.exports = {
  parseCsvFile: parseCsvFile
};

