/*jslint browser:true, indent:2*/
/*globals $, alert, confirm, maxFileSize*/
$(function () {
  "use strict";
  var mergingTasks = [],
    iframe = '<iframe id="upload_target" name="upload_target" src="" style="width:0;height:0;border:0px solid #fff;"></iframe>',
    template = null,
    allowedFormats = ["mp4", "m4v", "mpg", "mov", "avi", "wmv", "flv"];

  /*
  Tasks have different statuses:

  pending_files - when a task is first created, before the user has uploaded files
  uploading - while the files from the user are being uploaded to app
  merging - while the files are being merged with ffmpeg
  merged - after the files have finished being merged
  posting - the file (merged result) is being uploaded to kenseimedia
  encoding - file is being encoded on kenseimedia
  updating_bslcourses - updating bslcourses app to bind the mediaitem to the session
  complete - bslcourses result success!
  failed - if processing fails (at the moment); the user probably has to delete this task and start again
  */

  function getQueryString() {
    return (/[?]([a-zA-Z =0-9]*)/g).exec(window.location.search)[0];
  }

  function getDateStringForTask(task) {
    var date = null,
      dateString = null;

    date = new Date(parseInt((/(?:\d+_)(\d+)/).exec(task.id)[1], 10));
    dateString = date.getDate() + "/" + (date.getMonth() + 1) + "/" + date.getFullYear();

    return dateString;
  }

  function htmlForTask(task) {
    if (task.thumbnailPath === undefined || task.thumbnailPath === null) {
      task.thumbnailPath = "";
    }
    if (task.leftOriginal === undefined || task.leftOriginal === null) {
      task.leftOriginal = "";
    }
    if (task.rightOriginal === undefined || task.rightOriginal === null) {
      task.rightOriginal = "";
    }
    if (task.errorDescription === undefined || task.errorDescription === null) {
      task.errorDescription = "";
    }

    task.dateString = getDateStringForTask(task);

    var html = ejs.render(template, task);
    return html;
  }

  function renderTasks(tasks) {
    var i = 0,
      html = '';
    for (i = 0; i < tasks.length; i += 1) {
      html += htmlForTask(tasks[i]);
    }
    $('#items').html(html);
  }

  function validateFile(userType) {
    var isValid = true,
      inputId = "input#file" + userType,
      extensionGetter = /(?:\.([^.]+))?$/,
      vidFilename = $(inputId).val(),
      vidFileSize,
      vidFileExtension;

    if ($(inputId)[0].files[0] !== undefined) {
      vidFileSize = $(inputId)[0].files[0].size;
      if (vidFileSize > maxFileSize) {
        isValid = false;
      }
    }

    if (vidFilename === "") {
      $(inputId).parent().removeClass("success").addClass("error");
      isValid = false;
    } else {
      vidFileExtension = extensionGetter.exec(vidFilename)[1];
      if ($.inArray(vidFileExtension, allowedFormats) === -1) {
        isValid = false;
      }
    }

    if (isValid) {
      $(inputId).parent().removeClass("error").addClass("success");
    }
    else {
      $(inputId).parent().removeClass("success").addClass("error");
    }

    return isValid;
  }

  function addMergingTask() {
    var numFiles,
      request = $.ajax({
        type: "POST",
        dataType: 'json',
        url: "/tasks" + getQueryString()
      });
    request.done(function (data) {
      numFiles = $("#numFilesSelect").val();
      $("input#fileTutor,input#fileStudent").val("").parent().removeClass("success");
      $("input#fileTutor,input#fileStudent,input#uploadFiles").removeAttr("disabled");
      $('#newTaskId').attr("value", data.id);
      $('#file_upload_form').attr("action", "/file-upload/" + data.id + "/" + numFiles + getQueryString());
      $('#fileTutor').attr("name", "left_" + data.id + ".mpg");
      $('#fileStudent').attr("name", "right_" + data.id + ".mpg");
    });
    request.fail(function (jqXHR, textStatus) {
      alert("Request failed : " + textStatus);
    });
  }

  function addFormEvents() {
    var oldAction,
      newAction,
      value;
    $("#numFilesSelect").change(function (e) {
      value = $(this).val();
      oldAction = $("#file_upload_form").attr("action");
      newAction = oldAction.replace(/(\d+_\d+\/)(\d+)(?=\?sessionId)/, function (match, p1, p2) {
        return (p1 + value);
      });
      $("#file_upload_form").attr("action", newAction);
      if (value === "1") {
        $("#columnStudent").hide(300);
      } else if (value === "2") {
        $("#columnStudent").show(300);
      }
    });
    $('#file_upload_form').submit(function (e) {
      var isTutorFileValid,
        isStudentFileValid;

      isTutorFileValid = validateFile("Tutor");

      // one file; bypass validation
      if ($("#numFilesSelect").val() === "1") {
        $("#fileStudent").val("");
        isStudentFileValid = true;
      } else {
        isStudentFileValid = validateFile("Student");
      }

      if (isTutorFileValid && isStudentFileValid) {
    
        // dirty trick to force the list to re-render
        mergingTasks.push({});

        $(this)[0].target = 'upload_target';
        $("#upload_target").load(function () {
          addMergingTask();
        });
        setTimeout(function () {
          $("input#fileTutor,input#fileStudent,input#uploadFiles").attr("disabled", "disabled");
        }, 100);
      } else {
        return false;
      }
    });
  }

  function tasksAreDifferent(task1, task2) {
    var prop1, prop2;
    for (prop1 in task1) {
      if (task1.hasOwnProperty(prop1)) {
        if (task2[prop1] !== task1[prop1]) {
          return true;
        }
      }
    }
    for (prop2 in task2) {
      if (task2.hasOwnProperty(prop2)) {
        if (task2[prop2] !== task1[prop2]) {
          return true;
        }
      }
    }
    return false;
  }

  function getTasks() {
    $.getJSON('/tasks' + getQueryString(), function (tasks) {
      var i = 0;

      tasks.reverse();

      if (tasks.length !== mergingTasks.length) {
        renderTasks(tasks);
      } else {
        //console.log("tasks = ", tasks);
        for (i = 0; i < tasks.length; i += 1) {
          if (tasksAreDifferent(tasks[i], mergingTasks[i])) {
            $("#" + tasks[i].id).replaceWith(htmlForTask(tasks[i]));
          }
        }
      }
      mergingTasks = tasks;
      setTimeout(function () {
        getTasks();
      }, 1000);
    });
  }

  function deleteTask(id) {
    var request = $.ajax({
      type: "POST",
      dataType: 'json',
      url: "/deletetask/" + id + getQueryString()
    });
    request.done(function (r) {
    });
    request.fail(function (jqXHR, textStatus) {
      alert("Request failed" + textStatus);
    });
  }

  $.get("/javascripts/template.ejs", function (data) {
    template = data;
    getTasks();
  });

  $('body').append(iframe);

  addMergingTask();
  addFormEvents();

  $("input#fileTutor,input#fileStudent").change(function () {
    validateFile("Tutor");
    if ($("#numFilesSelect").val() === "2") {
      validateFile("Student");
    }
  });

  $("#items").on("click", ".deleteItemBtn", function (e) {
    var taskId = $(e.target).parent().parent().attr('id');
    if (confirm("Are you sure you want to delete this video?")) {
      deleteTask(taskId);
    }
  });
});
