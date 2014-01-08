/*jslint indent:2, node:true*/
"use strict";
var apiHandler = null,
  assert = require("assert"),
  runSlow = false,
  useMock = false;

if (useMock) {
  apiHandler = require("../app/kenseiApiHandler/mockApiHandler.js");
} else {
  apiHandler = require("../app/kenseiApiHandler/apiHandler.js");
}

// if slow is specified then set the mock api handler to run slowly
if (runSlow) {
  apiHandler.setSpeed(1000);
}

exports["test Handler has method postFile"] = function (test) {
  test.expect(1);
  test.ok(apiHandler.postFile, "had postFile method");
  test.done();
};
exports["Handler dispatches correct events"] = function (test) {
  var filePath = "testFile.mov",
    progress0 = false,
    progressMiddle = false,
    progress100 = false;

  test.expect(5);
  apiHandler.on("uploadProgress", function (fileName, taskId, percent) {
    assert.equal(fileName, filePath, "file path matches");
    if (percent === 0) {
      progress0 = true;
    } else if (percent === 100) {
      progress100 = true;
    } else if (percent > 0 && percent < 100) {
      progressMiddle = true;
    } else {
      throw new Error("Unrecognsed upload progress :" + percent);
    }
  });
  apiHandler.on("uploadComplete", function (fileName, taskId, mediaItemId) {
    test.ok(fileName === filePath, "upload complete event dispatched with file");
  });
  // processingComplete must also fire
  apiHandler.on("processingComplete", function (file, mediaItemId) {
    test.ok(mediaItemId, "media item id returned");
    test.ok(progress0, "progress 0 dispatched");
    test.ok(progressMiddle, "progress between 0 and 100 dispatched");
    test.ok(progress100, "progress 100 dispatched");
    test.done();
  });
  apiHandler.postFile(filePath);
};
