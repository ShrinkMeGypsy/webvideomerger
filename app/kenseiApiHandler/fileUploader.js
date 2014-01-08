/*jslint sloppy:true, indent:2, node:true*/
var handlers = {},
  queue = [],
  kenseiConfig,
  http = require('http'),
  fs = require('fs'),
  querystring = require("querystring"),
  rest = require('restler');

exports.setConfig = function (config) {
  kenseiConfig = config;
};

exports.on = function (eventName, handler) {
  handlers[eventName] = handler;
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

function createFileUploader(newFile, id) {
  var filename = newFile,
    taskId = id;
  function pollForProcessing(mediaItemId, apiKey) {
    var url = "http://" + kenseiConfig.kenseiApiUrl + "/v1.0/" + apiKey + "/Media/Status/" + mediaItemId + '.json',
      options = null,
      request = null;
    // http request options
    console.log("rest get url, url =" + url);
    rest.get(url).on('complete', function (result) {
      // processed = 1, uploading = 3, processing = 4, failed = 5, queued = 8,
      result = JSON.parse(result);
      console.log("status = " + result);
      if (result === "failed") {
        dispatch("processingFailed", taskId, mediaItemId);
      } else if (result === "processed") {
        dispatch("processingComplete", taskId, mediaItemId);
      } else {
        setTimeout(function () {
          pollForProcessing(mediaItemId, apiKey);
        }, 2000);
      }
    });
  }

  function uploadFile(mediaItemId, filePath, apiKey) {
    var options = null,
      request = null,
      fileSize = 0;
    if (!mediaItemId) {
      throw new Error("mediaItemId required");
    }
    if (!filePath) {
      throw new Error("filePath required");
    }
    if (!apiKey) {
      throw new Error("apiKey required");
    }
    options = {
      host: kenseiConfig.kenseiUploadUrl,
      port: 80,
      path: '/upload/?filename=' + mediaItemId + '&apikey=' + apiKey,
      method: 'POST'
    };
    fs.stat(filePath, function (err, stat) {
      fileSize = stat.size;
      console.log("uploading to kensei: name:" + filePath + ", size:" + fileSize);
      rest.post('http://' + options.host + options.path, {
        multipart: true,
        data: {
          file: rest.file(filePath, null, fileSize, null, 'text')
        }
      }).on('complete', function (data) {
        if (data instanceof Error) {
          console.log("file upload to kensei error: " + data.message);
          queue.push(queue.shift()); // move failed item to end of queue
          queue[0].start();
          return;
        }
        dispatch("uploadComplete", filename, taskId, mediaItemId);
        pollForProcessing(mediaItemId, apiKey);
        console.log("file upload to kensei complete: " + data);
        queue.shift();
        if (queue.length > 0) {
          console.log("queue length now: " + queue.length);
          queue[0].start();
        }
      });
    });
  }

  return {
    start: function () {
      // Post to kensei using basic auth
      // If you POST to api.km.com/v1.0/{apikey}/media with the following properties
      // userId (guid)
      // filename (string)
      // you should recieve a media id in return (guid)
      var username = kenseiConfig.apiKey,
        password = kenseiConfig.secretKey,
        postData = querystring.stringify({userId: kenseiConfig.userId, filename: "node_upload.non"}),
        auth = 'Basic ' + new Buffer(username + ':' + password).toString('base64'),
        options = null,
        request = null;
      // http request options
      options = {
        host: kenseiConfig.kenseiApiUrl,
        port: 80,
        path: '/v1.0/' + kenseiConfig.apiKey + '/media',
        method: 'POST',
        headers: {
          'Authorization': auth,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': postData.length
        }
      };
      request = http.request(options, function (res) {
        console.log('STATUS: ' + res.statusCode);
        console.log('HEADERS: ' + JSON.stringify(res.headers));
        res.setEncoding('utf8');
        res.on('data', function (data) {
          var mediaItemId = JSON.parse(data);
          if (!mediaItemId) {
            throw new Error("mediaItem not found in " + data);
          }
          dispatch("uploadProgress", filename, taskId, 50);
          uploadFile(mediaItemId, filename, kenseiConfig.apiKey);
        });
      });
      request.on('error', function (e) {
        console.log('problem with request: ' + e.message);
      });
      // write data to request body
      request.write(postData);
      request.end();
      dispatch("uploadProgress", filename, taskId, 0);

    }
  };
}

exports.upload = function (filePath, taskId) {
  queue.push(createFileUploader(filePath, taskId));
  if (queue.length === 1) {
    queue[0].start();
  }
  else {
    console.log("added item to queue, queue length is: ", queue.length);
  }
};
