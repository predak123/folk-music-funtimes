var fs = require("fs");
var path = require("path");
var https = require("https");

function ensureParentDir(filePath) {
  var dir = path.dirname(filePath);
  fs.mkdirSync(dir, {
    recursive: true
  });
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, content) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath, value) {
  writeText(filePath, JSON.stringify(value, null, 2));
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function downloadFile(url, outPath) {
  ensureParentDir(outPath);

  return new Promise(function (resolve, reject) {
    var file = fs.createWriteStream(outPath);

    https.get(url, function (response) {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(outPath);
        downloadFile(response.headers.location, outPath).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(outPath);
        reject(new Error("Download failed with status code " + response.statusCode));
        return;
      }

      response.pipe(file);

      file.on("finish", function () {
        file.close(resolve);
      });
    }).on("error", function (error) {
      file.close();
      if (fs.existsSync(outPath)) {
        fs.unlinkSync(outPath);
      }
      reject(error);
    });
  });
}

module.exports = {
  readJson: readJson,
  readText: readText,
  writeJson: writeJson,
  writeText: writeText,
  ensureParentDir: ensureParentDir,
  downloadFile: downloadFile
};

