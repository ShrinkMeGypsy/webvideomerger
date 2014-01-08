/*jslint indent:2, node:true, sloppy:true, stupid:true, nomen:true*/
"use strict";
var express = require('express'),
  formidable = require('formidable'),
  fs = require("fs"),
  merger = require('./videomerger/nvmerger'),
  path = require('path'),
  tasks = [],
  kenseiApiHandler = null,
  bslApiHandler = null,
  kenseiConfig = require('./config.js').config,
  app = {};

/*
Tasks have different statuses:

pending_files - when a task is first created, before the user has uploaded files
uploading - while the files from the user are being uploaded to app
merging - while the files are being merged with ffmpeg
posting - the file (merged result) is being uploaded to kenseimedia
encoding - file is being encoded on kenseimedia
updating_bslcourses - updating bslcourses app to bind the mediaitem to the session
complete - bslcourses result success!
failed - if processing fails (at the moment); the user probably has to delete this task and start again
*/

// detect if the mock kenseiApiHandler or the real kenseiApiHandler should be used
if (process.argv[2] === "mock") {
  kenseiApiHandler = require("./kenseiApiHandler/mockApiHandler.js");
  bslApiHandler = require("./bslApiHandler/mockApiHandler.js");
  kenseiApiHandler.setSpeed(2000);
  bslApiHandler.setSpeed(2000);
} else if (process.argv[2] === "real") {
  kenseiApiHandler = require("./kenseiApiHandler/apiHandler.js");
  bslApiHandler = require("./bslApiHandler/apiHandler.js");
  kenseiApiHandler.setConfig(kenseiConfig);
  bslApiHandler.setConfig(kenseiConfig);
} else {
  throw new Error("apiHandler command line argument 'mock' or 'real' must be specified");
}

// http version
app = module.exports = express.createServer();

// https version
//app = module.exports = express.createServer({
//  key: fs.readFileSync('keys/privatekey.pem'),
//  cert: fs.readFileSync('keys/certificate.pem')
//});

// Configuration
app.configure(function () {
  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});
app.configure('development', function () {
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});
app.configure('production', function () {
  app.use(express.errorHandler());
});
// Routes are at the bottom

function deleteTaskFiles(task) {
  console.log("deleting task files, task = " + JSON.stringify(task));
  // task could have files left, right and merged
  if (task.left) {
    // delete the left file
    fs.unlinkSync('public/' + task.left);
  }
  if (task.right) {
    // delete the right file
    fs.unlinkSync('public/' + task.right);
  }
  if (task.merged) {
    // delete the merged file
    fs.unlinkSync('public/' + task.merged);
  }
}

function deleteTask(id) {
  var i = 0,
    sessionId;
  for (i = 0; i < tasks.length; i += 1) {
    if (tasks[i].id === id) {
      if (tasks[i].mergeProcess) {
        console.log("calling cancel on the merge process");
        tasks[i].mergeProcess.cancel();
        fs.unlinkSync(tasks[i].mergeProcess.options.mergedVideo);
      }
      if (tasks[i].mediaItemId) {
        console.log("calling media item delete through the bsl api...");
        sessionId = tasks[i].id.split('_')[0];
        bslApiHandler.markMediaItemAsDeleted(sessionId, tasks[i].mediaItemId);
      }
      deleteTaskFiles(tasks[i]);
      tasks.splice(i, 1);
      return;
    }
  }
}

function getSide(fName) {
  var side = null;
  if (fName.substring(0, "left".length) === "left") {
    side = "left";
  } else if (fName.substring(0, "right".length) === "right") {
    side = "right";
  } else if (fName.substring(0, "merged".length) === "merged") {
    side = "merged";
  }
  return side;
}

function getId(fName) {
  var side = getSide(fName),
    id = null,
    match = null;

  if (side === "left") {
    id = fName.substring("left_".length, fName.length - ".mpg".length);
  } else if (side === "right") {
    id = fName.substring("right_".length, fName.length - ".mpg".length);
  } else if (side === "merged") {
    // matches the session id and the timestamp, with the underscore in between
    // that is, the Xs (where X is any length of a sequence of digits) in the following:
    // merged_XXXX_XXXXXXXX_media-item-id-1325-34.mpg
    // merged_XXXX_XXXXXXXX.mpg
    match = /(?:merged_)(\d+_\d+)(?=(_\S+)|(\.mpg))/.exec(fName);
    id = match[1];
  } else {
    throw new Error("Could not getId for " + fName);
  }
  return id;
}

function getMediaItemId(fName) {
  var mediaItemId,
    match;

  // matches the media item id
  // that is, the Xs (where X is any non-whitespace character) in the following:
  // merged_1234_123245355_XXXXXXXXXXXX.mpg
  match = /(?:_\d+_\d+_)(\S+)(?=\.mpg)/.exec(fName);
  mediaItemId = match[1];
  return mediaItemId;
}

function getTaskWithId(id) {
  var i = 0;
  for (i = 0; i < tasks.length; i += 1) {
    if (tasks[i].id === id) {
      return tasks[i];
    }
  }
}

function getTask(fName) {
  var i = 0,
    id = getId(fName);
  return getTaskWithId(id);
}

function updateTask(fName, path) {
  var task = getTask(fName);
  if (!task) {
    throw new Error("Could not find task with name " + fName);
  }
  // set the test.left or task.right to video/videoName
  task[getSide(fName)] = path;
}
function getFileEnding(fileName) {
  var fileEnding = "";
  if (fileName.substring(0, "left".length) === "left") {
    fileEnding = fileName.substring("left".length, fileName.length);
  }
  if (fileName.substring(0, "right".length) === "right") {
    fileEnding = fileName.substring("right".length, fileName.length);
  }
  return fileEnding;
}

function filesMatch(fileA, fileB) {
  var fileAEnding = getFileEnding(fileA),
    fileBEnding = getFileEnding(fileB),
    endingsMatch = (fileAEnding === fileBEnding),
    fullNamesMatch = (fileA === fileB);
  if (!fullNamesMatch && endingsMatch) {
    return true;
  }
}

function matchingFileFor(fileA, allFiles) {
  var i = 0;
  for (i = 0; i < allFiles.length; i += 1) {
    if (filesMatch(fileA, allFiles[i])) {
      return allFiles[i];
    }
  }
}

function uploadToKensei(task) {
  var size;
  //Start posting the merged file for the task using the mock kenseiApiHandler
  if (!task) {
    throw new Error("Task must be defined to upload file");
  }


  path = __dirname + '/public/' + task.merged;

  size = fs.statSync(path).size;

  task.progress = 0;

  if (size > kenseiConfig.maxFileSize) {
	task.status = "failed";
	task.errorDescription = "Maximum file size reached. Please make sure uploaded file is smaller than " + Math.round(kenseiConfig.maxFileSize / 1024 / 1024) + "MB";
  } else {
    console.log("post file, id =" + task.id);
    task.status = "posting";
    kenseiApiHandler.postFile(path, task.id);
  }
}

function ffmpegMerge(leftVid, rightVid, outputVid, task) {
  var mergeProcess = merger.merge({
    leftVideo: leftVid,
    rightVideo: rightVid,
    mergedVideo: outputVid
  });
  mergeProcess.on("progress", function (percent) {
    console.log("merge progress = " + percent);
    task.progress = Math.round(percent, 3);
  });
  mergeProcess.on("complete", function (message) {
    var newMergedPath, newLeftPath, newRightPath;
    console.log("complete: " + message);
    task.mergeProcess = null;  // set the merge process to null we dont try to cancel it
    // move the merged file to the posting folder
    newMergedPath = outputVid.replace('merge_in_progress', 'posting_to_kensei');
    fs.renameSync(outputVid, newMergedPath);

    // delete left and right files
    fs.unlinkSync(leftVid);
    fs.unlinkSync(rightVid);

    // update the task with the new locations
    // (remove the public part as its not needed for the links)
    task.merged = newMergedPath.substring('public/'.length, newMergedPath.length);
    task.left = null;
    task.right = null;
    uploadToKensei(task);
  });
  mergeProcess.on("error", function (message) {
    console.log("error: " + message);
    task.status = "failed";
	task.errorDescription = "Error merging the videos: " + message;
    task.mergeProcess = null;  // set the merge process to null we dont try to cancel it
    task.progress = 0;
  });
  task.status = "merging";
  task.progress = 0;
  task.mergeProcess = mergeProcess;
}

function mergeVideos(vid1, vid2, task) {
  var leftVideo = null,
    rightVideo = null,
    leftPath = null,
    rightPath = null,
    mergedPath = null;
  // if it is the left video
  if ((vid1.substring(0, "left".length) === "left")) {
    leftVideo = vid1;
    rightVideo = vid2;
  } else {
    leftVideo = vid2;
    rightVideo = vid1;
  }
  mergedPath = 'public/merge_in_progress/merged' + leftVideo.substring("left".length, leftVideo.length);
  console.log("merge videos, left= " + leftVideo + ": right=" + rightVideo);
  // move the videos to the merge_in_progress folder
  leftPath =  'public/merge_in_progress/' + leftVideo;
  rightPath =  'public/merge_in_progress/' + rightVideo;
  fs.renameSync('public/videos/' + leftVideo, leftPath);
  fs.renameSync('public/videos/' + rightVideo, rightPath);
  task.left = 'merge_in_progress/' + leftVideo;
  task.right = 'merge_in_progress/' + rightVideo;
  ffmpegMerge(leftPath, rightPath, mergedPath, task);
}

function uploadSingleFile(file) {
  var task = getTask(file),
    newPath = null;

  // rename left file to merged - cheekily
  newPath = "posting_to_kensei/" + file.replace("left", "merged");

  task.status = "posting";
  fs.renameSync("public/videos/" + file, "public/" + newPath);

  task.left = null;
  task.merged = newPath;
  uploadToKensei(task);
}

function checkForMatchingVideos(dir) {
  // get the names of the files in the to_merge folder
  var files = fs.readdirSync(dir),
    file = null,
    matchingFile = null,
    i = 0;
  // for each file check for a matching file
  for (i = 0; i < files.length; i += 1) {
    matchingFile = matchingFileFor(files[i], files);
    // if a matching file is found
    if (matchingFile) {
      // then merge the videos
      mergeVideos(files[i], matchingFile, getTask(matchingFile));
      // and break out of the loop
      break;
    }
  }
}



function addOrUpdateTaskForFile(fileName, fullPath, status) {
  var id = getId(fileName),
    side = getSide(fileName),
    task = getTask(fileName);
  if (!task) {
    task = {left: null, right: null, merged: null, progress: 0, id: id, status: status};
    tasks.push(task);
  }
  // if it's at the bsl stage, we need to retrieve media item as well
  if (status === "updating_bsl") {
    task.mediaItemId = getMediaItemId(fileName);
  }
  task[side] = fullPath;
}

function removeHiddenFiles(files) {
  var i = 0, len = files.length;
  for (i = 0; i < files.length; i += 1) {
    if (files[i] === '.gitignore') {
      files.splice(i, 1);
      i = 0;
    }
  }
}

function restoreTasksFromFiles() {
  // get the files in the videos folder
  var f1s = fs.readdirSync('public/videos'),
    f2s = fs.readdirSync('public/merge_in_progress'),
    f3s = fs.readdirSync('public/posting_to_kensei'),
    f4s = fs.readdirSync('public/updating_bsl'),
    i = 0;
  removeHiddenFiles(f1s);
  removeHiddenFiles(f2s);
  removeHiddenFiles(f3s);
  removeHiddenFiles(f4s);
  for (i = 0; i < f1s.length; i += 1) {
    addOrUpdateTaskForFile(f1s[i], 'videos/' + f1s[i], 'pending_files');
  }
  for (i = 0; i < f2s.length; i += 1) {
    addOrUpdateTaskForFile(f2s[i], 'merge_in_progress/' + f2s[i], 'merging');
  }
  for (i = 0; i < f3s.length; i += 1) {
    addOrUpdateTaskForFile(f3s[i], 'posting_to_kensei/' + f3s[i], 'posting');
  }
  for (i = 0; i < f4s.length; i += 1) {
    addOrUpdateTaskForFile(f4s[i], 'updating_bsl/' + f4s[i], 'updating_bsl');
  }
}

function deletePartiallyMergedFiles() {
  var i = 0,
    files = fs.readdirSync('public/merge_in_progress');

  // delete any merged output files that were in progress.
  for (i = 0; i < files.length; i += 1) {
    if (files[i].substring(0, "merged".length) === "merged") {
      if (files[i] !== '.gitignore') {
        fs.unlinkSync('public/merge_in_progress/' + files[i]);
      }
    }
  }
}

function restartPartiallyMergedFiles() {
  var i = 0,
    files = fs.readdirSync('public/merge_in_progress');
  for (i = 0; i < files.length; i += 1) {
    if (files[i].substring(0, "merged".length) !== "merged") {
      if (files[i] !== ".gitignore") {
        // move the left or right files back to the video folder
        fs.renameSync('public/merge_in_progress/' + files[i], 'public/videos/' + files[i]);
        // restart merging if theres a pair
        checkForMatchingVideos('public/videos');
      }
    }
  }
}

function makeSureFoldersExist() {
  var folders = [
    'public/merge_in_progress',
    'uploads',
    'public/posting_to_kensei',
    'public/updating_bsl'
  ],
    i = 0;
  for (i = 0; i < folders.length; i += 1) {
    if (!path.existsSync(folders[i])) {
      fs.mkdirSync(folders[i]);
    }
  }
}

function getTasksForSessionId(sessionId) {
  var matchingTasks = [],
    i = 0,
    currentDisplayId = 1;
  for (i = 0; i < tasks.length; i += 1) {
    if (tasks[i].id.split('_')[0] === sessionId) {
      tasks[i].displayId = currentDisplayId;
      matchingTasks.push(tasks[i]);
      currentDisplayId = currentDisplayId + 1;
    }
  }
  return matchingTasks;
}

function taskWithMediaItemId(id) {
  var i = 0,
    task = null;
  for (i = 0; i < tasks.length; i += 1) {
    if (tasks[i].mediaItemId === id) {
      task = tasks[i];
    }
  }
  return task;
}

function addBslApiHandlerEvents() {
  bslApiHandler.on("mediaItemBoundToSession", function (mediaItemId, sessionId) {
    var task = taskWithMediaItemId(mediaItemId),
      filePath;

    if (!task) {
      console.log("tried to handle mediaItemBoundToSession but task with media item id " + mediaItemId + " missing, presumed deleted");
      return;
    }
    console.log("media item bound to session");

    filePath = __dirname + '/public/' + task.merged;
    fs.unlinkSync(filePath);

    task.merged = null;
    task.status = "complete";
  });
  bslApiHandler.on("sessionInfoReceived", function (sessionInfo, res) {
    var sessionType,
      video,
      videoDate,
      found = false,
      i,
      j;

    switch (sessionInfo.sessionType) {
    case "Evidence":
      sessionType = "student";
      break;
    case "Assessment":
    case "Tutorial":
      sessionType = "tutor";
      break;
    default:
      throw new Error("Received unexpected session type: " + sessionInfo.sessionType);
    }

    for (i = 0; i < sessionInfo.videos.length; i += 1) {
      video = sessionInfo.videos[i];
      // if this video is in tasks already, move to the next one
      for (j = 0; j < tasks.length; j += 1) {
        if (tasks[j].mediaItemId === video.id) {
          found = true;
          break;
        }
      }

      if (!found) {
        console.log("adding video with id " + video.id + " to task list...");
        videoDate = new Date(video.dateCreated);

        tasks.push({
          id: sessionInfo.id + "_" + videoDate.getTime(),
          leftOriginal: null,
          rightOriginal: null,
          progress: 0,
          mediaItemId: video.id,
          status: "complete",
          thumbnailPath: video.thumbnail
        });
      }
      // reset found flag
      found = false;
    }

    res.render('index', {type: sessionType, maxFileSize: kenseiConfig.maxFileSize});
  });
}

function addKenseiApiHandlerEvents() {
  kenseiApiHandler.on("uploadProgress", function (filePath, taskId, percent) {
    var task = getTaskWithId(taskId);
    if (!task) {
      console.log("tried to handle uploadProgress but task with id " + taskId + " missing, presumed deleted");
      return;
    }
    task.progress = percent;
  });
  kenseiApiHandler.on("uploadComplete", function (filePath, taskId, mediaItemId) {
    var task = getTaskWithId(taskId);
    if (!task) {
      console.log("tried to handle uploadComplete but task with id " + taskId + " missing, presumed deleted");
      return;
    }
    task.status = "encoding";
    task.mediaItemId = mediaItemId;
    task.progress = 0;
  });
  kenseiApiHandler.on("processingComplete", function (taskId, mediaItemId) {
    var task = getTaskWithId(taskId),
      sessionId = taskId.split('_')[0],
      oldPath,
      newPath;

    if (!task) {
      console.log("tried to handle processingComplete but task with id " + taskId + " missing, presumed deleted");
      return;
    }

    oldPath = __dirname + '/public/' + task.merged;

    task.merged = 'updating_bsl/merged_' + task.id + '_' + mediaItemId + '.mpg';
    newPath = __dirname + '/public/' + task.merged;

    fs.renameSync(oldPath, newPath);
    task.status = "updating_bslcourses";
    task.mediaItemId = mediaItemId;
    bslApiHandler.bindMediaItemToSession(mediaItemId, sessionId);
  });
  kenseiApiHandler.on("processingFailed", function (taskId, mediaItemId) {
    var task = taskWithMediaItemId(mediaItemId);
    if (!task) {
      console.log("tried to handle processingComplete but task with id " + taskId + " missing, presumed deleted");
      return;
    }
    task.status = "failed";
  });
  kenseiApiHandler.on("thumbnailReceived", function (taskId, thumbnailPath) {
    var task = getTaskWithId(taskId);
    if (!task) {
      console.log("tried to handle thumbnailReceived but task with id " + taskId + " missing, presumed deleted");
      return;
    }
    task.thumbnailPath = thumbnailPath;
  });
}

function restartPostingToKensei() {
  var i;
  for (i = 0; i < tasks.length; i += 1) {
    if (tasks[i].status === "posting" ||
        tasks[i].status === "encoding") {
      uploadToKensei(tasks[i]);
    }
  }
}

function restartUpdatingBsl() {
  var i,
    sessionId,
    mediaItemId;

  for (i = 0; i < tasks.length; i += 1) {
    if (tasks[i].status === "updating_bsl") {
      sessionId = tasks[i].id.split('_')[0];
      mediaItemId = tasks[i].mediaItemId;

      bslApiHandler.bindMediaItemToSession(mediaItemId, sessionId);
    }
  }
}

function clearPendingTasksForSession(sessionId) {
  var i = null;

  for (i = 0; i < tasks.length; i += 1) {
    if (tasks[i].id.split('_')[0] === sessionId &&
        tasks[i].status === "pending_files") {
      tasks.splice(i, 1);
    }
  }
}

function init() {
  makeSureFoldersExist();
  deletePartiallyMergedFiles();
  restoreTasksFromFiles();
  restartPartiallyMergedFiles();
  restoreTasksFromFiles();
  addKenseiApiHandlerEvents();
  addBslApiHandlerEvents();
  restartPostingToKensei();
  restartUpdatingBsl();
}

// Routes
app.get('/', function (req, res) {
  var sessionId = req.query.sessionId;
  if (!sessionId) {
    res.render('nosession');
  }
  else {
    bslApiHandler.getAndRenderSessionInfo(sessionId, res);
  }
});
app.post('/tasks', function (req, res) {
  var sessionId = req.query.sessionId,
    newId = null;
  if (!sessionId) {
    throw new Error("No session Id was found in the query string");
  }

  newId = sessionId + '_' + Date.now();

  clearPendingTasksForSession(sessionId);

  tasks.push({
    left: null,
    leftOriginal: null,
    right: null,
    rightOriginal: null,
    merged: null,
    progress: null,
    id: newId,
    status: 'pending_files'
  });
  res.send({resultln: "success", id: newId });
});
app.get('/tasks', function (req, res) {
  var sessionId = req.query.sessionId;
  if (!sessionId) {
    throw new Error("No session Id was found in the query string");
  }
  res.json(getTasksForSessionId(sessionId));
});

app.post('/deletetask/:id', function (req, res) {
  var sessionId = req.query.sessionId,
    taskId = req.params.id,
    taskSessionId =  taskId.split('_')[0];
  if (!sessionId) {
    throw new Error("No session Id was found in the query string");
  }
  // if the task id matches the sessions id
  if (taskSessionId === sessionId) {
    deleteTask(req.params.id);
    res.send({result: "success, task deleted id = " + req.params.id});
  } else {
    throw new Error("task id does not match session id. taskSessionId = " + taskSessionId);
  }
});

app.post('/file-upload/:id/:numFiles', function (req, res) {
  var form = new formidable.IncomingForm(),
    task = getTaskWithId(req.params.id),
    numFiles = req.params.numFiles;

  form.uploadDir = "uploads";
  // We can add listeners for several form
  // events such as "progress"
  form.on('progress', function (bytesReceived, bytesExpected) {
    var percent = (bytesReceived / bytesExpected * 100) || 0;
    task.progress = Math.round(percent, 3);
    task.status = "uploading";
  });
  form.on('file', function (field, file) {
    // if they hack the field name dont let them drop the file anywhere
    if (field[0] === '/' || field[0] === '.') {
      throw new Error("Invalid field name, field = " + field);
    }
    if (file.size > 0) {
      updateTask(field, 'videos/' + field);
      fs.renameSync(__dirname + '/' + file.path, './public/videos/' + field);
      task[getSide(field) + "Original"] = file.name;
      if (numFiles > 1) {
        checkForMatchingVideos('public/videos');
      } else {
        uploadSingleFile(field);
      }
    }
  });
  form.parse(req);
  res.send({result: "success"});
});

init();
app.listen(kenseiConfig.appPort, function () {
  console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
});
