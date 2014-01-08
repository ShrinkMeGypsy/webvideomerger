/*jslint sloppy:true, indent:2*/
var handlers = {},
  http = require("http"),
  runSpeed = 10,
  rest = require("restler"),
  kenseiConfig = null;

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

exports.setConfig = function (config) {
  kenseiConfig = config;
};

function createLinkMediaToSessionPoster(mId, sId) {
  var mediaId = mId, sessionId = sId;

  if (!kenseiConfig) {
    throw new Error("config must be set using setConfig before use");
  }

  return {
    post: function () {
      // HTTP post will be made here to a public bsl api
      // on success dispatch the event "mediaItemBoundToSession"
      // http://localhost:1055/Tutors/Dashboard/LinkMediaToSession?sessionid=123&mediaId=12345678-1234-1234-1234-123456789012
      var username = kenseiConfig.apiKey,
        password = kenseiConfig.secretKey,
        auth = 'Basic ' + new Buffer(username + ':' + password).toString('base64'),
        options = null,
        request = null;
      // http request options
      options = {
        host: kenseiConfig.bslApiUrl,
        port: 80,
        path: '/Tutors/Dashboard/LinkMediaToSession?sessionId=' + sessionId  + '&mediaId=' + mediaId,
        method: 'POST',
        headers: {
          'Authorization': auth,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      };
      console.log("bind request: url =" + options.host + options.path);
      request = http.request(options, function (res) {
        console.log('STATUS: ' + res.statusCode);
        console.log('HEADERS: ' + JSON.stringify(res.headers));
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
          if (JSON.parse(chunk) === "success") {
            dispatch("mediaItemBoundToSession", mediaId, sessionId);
          } else {
            console.log("unexpected response: " + chunk);
          }
        });
      });
      request.on('error', function (e) {
        console.log('problem with request: ' + e.message);
      });
      request.end();
    }
  };
}

function createUpdateLinkedMediaStatusPoster(seId, mId, stId) {
  var mediaId = mId,
    statusId = stId,
    sessionId = seId;

  if (!kenseiConfig) {
    throw new Error("config must be set using setConfig before use");
  }

  return {
    post: function () {
      var username = kenseiConfig.apiKey,
        password = kenseiConfig.secretKey,
        auth = 'Basic ' + new Buffer(username + ':' + password).toString('base64'),
        options = null,
        request = null;
      // http request options
      options = {
        host: kenseiConfig.bslApiUrl,
        port: 80,
        path: '/Tutors/Dashboard/UpdateLinkedMediaStatus?sessionId=' + sessionId + '&mediaId=' + mediaId  + '&statusId=' + statusId,
        method: 'POST',
        headers: {
          'Authorization': auth,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      };
      console.log("status update request: url =" + options.host + options.path);
      request = http.request(options, function (res) {
        console.log('STATUS: ' + res.statusCode);
        console.log('HEADERS: ' + JSON.stringify(res.headers));
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
          if (JSON.parse(chunk) === "success") {
            dispatch("mediaItemStatusUpdated", mediaId, statusId);
          } else {
            console.log("unexpected response: " + chunk);
          }
        });
      });
      request.on('error', function (e) {
        console.log('problem with request: ' + e.message);
      });
      request.end();
    }
  };
}

// res is the Express response object, passed into here so it can persist into
// the event handler for getAndRenderSessionInfo
exports.getAndRenderSessionInfo = function (sessionId, res) {
  var url = null;

  if (!sessionId) {
    throw new Error("Session Id must be specified");
  }
  if (!kenseiConfig) {
    throw new Error("config must be set using setConfig before use");
  }
  console.log("getting info for session " + sessionId + " ...");

  url = "http://" + kenseiConfig.bslApiUrl + "/Tutors/Dashboard/GetSessionForMerger/" + sessionId;

  rest.get(url).on("complete", function (result) {
    dispatch("sessionInfoReceived", result, res);
  });

}

exports.bindMediaItemToSession = function (mediaItemId, sessionId) {
  if (!mediaItemId) {
    throw new Error("Media Item Id must be specified");
  }
  if (!sessionId) {
    throw new Error("Session Id must be specified");
  }
  createLinkMediaToSessionPoster(mediaItemId, sessionId).post();
};

exports.markMediaItemAsDeleted = function (sessionId, mediaItemId) {
  var statusId = 5; // 5 = "deleted"
  if (!mediaItemId) {
    throw new Error("Media Item Id must be specified");
  }
  createUpdateLinkedMediaStatusPoster(sessionId, mediaItemId, statusId).post();
};
