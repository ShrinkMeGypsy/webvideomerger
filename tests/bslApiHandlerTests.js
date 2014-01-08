/*jslint indent:2, node:true*/
"use strict";
var apiHandler = null,
  assert = require("assert"),
  runSlow = false,
  mock = false;

if (mock) {
  apiHandler = require("../app/bslApiHandler/mockApiHandler.js");
} else {
  apiHandler = require("../app/bslApiHandler/apiHandler.js");
  apiHandler.setConfig(require('../app/config.js'));
}

// if slow is specified then set the mock api handler to run slowly
if (runSlow) {
  apiHandler.setSpeed(1000);
}

exports["test Handler has ithe correct method"] = function (test) {
  test.expect(1);
  test.ok(apiHandler.bindMediaItemToSession, "bindMediaItemToSession exists");
  test.done();
};
exports["Handler dispatches correct events"] = function (test) {
  var mediaItemId = "klsajf0",
    sessionId = 324;
  test.expect(1);
  apiHandler.on("mediaItemBoundToSession", function (mId, sId) {
    assert.equal(mediaItemId, mId, "media ids do not match :" + mediaItemId + " : " + mId);
    assert.equal(sessionId, sId, "session id matches :" + sessionId + " : " + sId);
    test.ok(true, "event fired");
    test.done();
  });
  apiHandler.bindMediaItemToSession(mediaItemId, sessionId);
};
