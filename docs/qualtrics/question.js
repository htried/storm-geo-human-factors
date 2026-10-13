/*
 * Qualtrics question JavaScript for embedding the study.
 *
 * Setup (Qualtrics survey editor):
 *   1. Survey flow: add Embedded Data fields `study_completion_code` and
 *      `study_duration_ms` *before* the block containing this question.
 *      (Simple layout surveys: name them `__js_study_completion_code` and
 *      `__js_study_duration_ms` instead; Qualtrics strips the `__js_` prefix.)
 *   2. Add a "Text / Graphic" question to its own block.
 *   3. Question settings -> JavaScript -> paste this whole file.
 *   4. Set STUDY_ORIGIN below to the deployed study origin (no trailing slash).
 *
 * The Next button stays hidden until the study posts `study_complete`, then
 * the completion code is saved to embedded data and the participant advances.
 *
 * participant_id is the Qualtrics ResponseID, so study rows join 1:1 to survey
 * responses without carrying any direct identifier. If you recruit via
 * Prolific, swap in "${e://Field/PROLIFIC_PID}" (and capture it in the survey
 * flow) only if your IRB protocol allows storing that ID in the study DB.
 */
Qualtrics.SurveyEngine.addOnload(function () {
  var STUDY_ORIGIN = "https://REPLACE-WITH-STUDY-HOST";
  var AUTO_ADVANCE = true;

  var q = this; // eslint-disable-line @typescript-eslint/no-this-alias -- Qualtrics runs plain ES5
  q.hideNextButton();

  var participantId = "${e://Field/ResponseID}";
  var src =
    STUDY_ORIGIN +
    "/study?participant_id=" + encodeURIComponent(participantId) +
    "&parent_origin=" + encodeURIComponent(window.location.origin);

  var iframe = document.createElement("iframe");
  iframe.src = src;
  iframe.title = "Research task";
  iframe.style.width = "100%";
  iframe.style.height = "900px";
  iframe.style.border = "0";
  q.getQuestionContainer().appendChild(iframe);

  function setEmbedded(name, value) {
    var api = Qualtrics.SurveyEngine;
    // Simple layout exposes setJSEmbeddedData; legacy layouts setEmbeddedData.
    if (typeof api.setJSEmbeddedData === "function") api.setJSEmbeddedData(name, value);
    if (typeof api.setEmbeddedData === "function") api.setEmbeddedData(name, value);
  }

  var done = false;
  function onMessage(e) {
    if (e.origin !== STUDY_ORIGIN) return;
    if (e.source !== iframe.contentWindow) return;
    var d = e.data;
    if (!d || d.source !== "storm-study") return;

    if (d.type === "resize" && typeof d.height === "number") {
      iframe.style.height = Math.max(600, Math.ceil(d.height) + 48) + "px";
    } else if (d.type === "study_complete" && !done) {
      done = true;
      setEmbedded("study_completion_code", String(d.completion_code));
      setEmbedded("study_duration_ms", String(d.duration_ms));
      q.showNextButton();
      if (AUTO_ADVANCE) q.clickNextButton();
    }
  }
  window.addEventListener("message", onMessage);

  Qualtrics.SurveyEngine.addOnUnload(function () {
    window.removeEventListener("message", onMessage);
  });
});
