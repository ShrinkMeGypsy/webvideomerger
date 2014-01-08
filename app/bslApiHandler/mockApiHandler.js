/*jslint sloppy:true, indent:2*/
// deal with events such as uploadProgress
var handlers = {}, runSpeed = 10;

exports.on = function (eventName, handler) {
  handlers[eventName] = handler;
};

function dispatch(eventName) {
  var handler = handlers[eventName],
    args = Array.prototype.slice.call(arguments);
  args.shift(); // remove the first argiument as this is the event name
  if (handler) {
    handler.apply(null, args);
  }
}

// this method only exists in the mock api handler and is used to
// set the mockApiHandler to simulate a slow upload (so progress can be viewed)
exports.setSpeed = function (speed) {
  runSpeed = speed;
};


function createPoster(mId, sId) {
  var mediaId = mId, sessionId = sId;
  return {
    post: function () {
      // HTTP post will be made here to a public bsl api
      // on success dispatch the event "mediaItemBoundToSession"
      setTimeout(function () {
        dispatch("mediaItemBoundToSession", mediaId, sessionId);
      }, runSpeed);
    }
  };
}

exports.bindMediaItemToSession = function (mediaItemId, sessionId) {
  if (!mediaItemId) {
    throw new Error("Media Item Id must be specified");
  }
  if (!sessionId) {
    throw new Error("Session Id must be specified");
  }
  createPoster(mediaItemId, sessionId).post();
};
