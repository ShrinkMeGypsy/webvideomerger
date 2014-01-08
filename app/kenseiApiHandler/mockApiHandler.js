/*jslint sloppy:true, indent:2*/
// deal with events such as uploadProgress
var handlers = {}, runSpeed = 10;

exports.on = function (eventName, handler) {
  handlers[eventName] = handler;
};

function dispatch(eventName) {
  var handler = handlers[eventName],
    args = Array.prototype.slice.call(arguments);
  args.shift();// remove the first element as that is the event name
  if (handler) {
    handler.apply(null, args);
  }
}

// this method only exists in the mock api handler and is used to
// set the mockApiHandler to simulate a slow upload (so progress can be viewed)
exports.setSpeed = function (speed) {
  runSpeed = speed;
};

function createFileUploader(newFile) {
  var filename = newFile;
  return {
    start: function () {
      dispatch("uploadProgress", { name: filename, uploadProgressPercent: 0 });
      setTimeout(function () {
        dispatch("uploadProgress", { name: filename, uploadProgressPercent: 20});
      }, runSpeed);
      setTimeout(function () {
        dispatch("uploadProgress", { name: filename, uploadProgressPercent: 40});
      }, runSpeed * 2);
      setTimeout(function () {
        dispatch("uploadProgress", { name: filename, uploadProgressPercent: 60});
      }, runSpeed * 3);
      setTimeout(function () {
        dispatch("uploadProgress", { name: filename, uploadProgressPercent: 80});
      }, runSpeed * 4);
      setTimeout(function () {
        dispatch("uploadProgress", { name: filename, uploadProgressPercent: 100});
        dispatch("uploadComplete", { name: filename});
      }, runSpeed * 5);
      setTimeout(function () {
        dispatch("processingComplete", {name: filename}, "exampleMediaItemId423534");
      }, runSpeed * 8);
    }
  };
}

exports.postFile = function (filePath) {
  createFileUploader(filePath).start();
};
