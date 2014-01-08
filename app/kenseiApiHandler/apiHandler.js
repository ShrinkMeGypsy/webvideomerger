/*jslint sloppy:true, indent:2, node:true*/
// deal with events such as uploadProgress
var handlers = {},
  runSpeed = 10,
  http = require('http'),
  fs = require('fs'),
  querystring = require("querystring"),
  rest = require('restler'),
  uploader = require('./fileUploader.js'),
  kenseiConfig;

exports.on = function (eventName, handler) {
  handlers[eventName] = handler;
};

exports.setConfig = function (config) {
  kenseiConfig = config;
  uploader.setConfig(config);
};

function dispatch(eventName) {
  var handler = handlers[eventName],
    args = Array.prototype.slice.call(arguments);
  console.log("dispatch +"  + args);
  args.shift();// remove the first element as that is the event name
  if (handler) {
    handler.apply(null, args);
  }
}

function getMediaThumbnail(taskId, mediaItemId) {
  var url = "http://" + kenseiConfig.kenseiApiUrl + "/v1.0/" + kenseiConfig.apiKey + "/Media/" + mediaItemId + ".json",
    username = kenseiConfig.apiKey,
    password = kenseiConfig.secretKey,
    options = null;

  options = {
    username: username,
    password: password
  };
  console.log("getting thumbnail for media item, request url: " + url);

  rest.get(url, options).on("complete", function (result) {
    var data = JSON.parse(result);
    dispatch("thumbnailReceived", taskId, data.thumbnail);
  });
}

exports.getMediaThumbnail = getMediaThumbnail;

uploader.on("uploadComplete", function (filename, taskId, mediaItemId) {
  dispatch("uploadComplete", filename, taskId, mediaItemId);
});

uploader.on("processingFailed", function (taskId, mediaItemId) {
  dispatch("processingFailed", taskId, mediaItemId);
});

uploader.on("processingComplete", function (taskId, mediaItemId) {
  getMediaThumbnail(taskId, mediaItemId);
  dispatch("processingComplete", taskId, mediaItemId);
});

exports.postFile = function (filePath, taskId) {
  if (!kenseiConfig) {
    throw new Error("config required");
  }
  if (!kenseiConfig.apiKey) {
    throw new Error("api key required");
  }
  uploader.upload(filePath, taskId);
};
