/*
 * Qualtrics question JavaScript for embedding the study.
 *
 * Setup (Qualtrics survey editor):
 *   1. Survey flow: add Embedded Data fields, *before* the block containing
 *      this question:
 *        study_eligible, study_eligible_topics, study_topic_id,
 *        study_completion_code, study_duration_ms
 *      (Simple layout surveys: prefix each with `__js_`.)
 *   2. The 19 pre-task opinion questions must be on an EARLIER page than this
 *      question (piped text only resolves for answers already submitted).
 *   3. Add a "Text / Graphic" question to its own block, then
 *      Question behavior -> JavaScript -> paste this whole file.
 *   4. Set STUDY_ORIGIN below, and fill in TOPICS (see below).
 *   5. Survey flow: after this block, branch on study_eligible = 0 if
 *      screened-out participants should skip the post-task questions, and use
 *      study_topic_id in display logic to ask about the assigned topic.
 *
 * Eligibility: a topic is eligible when the participant's "What's your view
 * on this issue?" rating is between MIN_VIEW and MAX_VIEW (inclusive). Only
 * the eligible topic IDs are sent to the study (not the ratings); the study
 * server draws one at random and records the eligible set. If nothing is
 * eligible, the study is not loaded: study_eligible=0 and the survey moves on.
 *
 * participant_id is the Qualtrics ResponseID, so study rows join 1:1 to survey
 * responses without carrying any direct identifier.
 */
Qualtrics.SurveyEngine.addOnload(function () {
  var STUDY_ORIGIN = "https://REPLACE-WITH-STUDY-HOST";
  var AUTO_ADVANCE = true;
  var MIN_VIEW = 25;
  var MAX_VIEW = 75;

  // One row per topic. `id` must match a topic_id in the study corpus.
  // `view` is the piped-text code for that topic's "What's your view on this
  // issue?" slider. Get it from any text field's Piped Text menu ->
  // Survey Question -> <the question> -> <the view statement>, and paste it
  // here. It looks like "${q://QID12/ChoiceNumericEntryValue/1}".
  var TOPICS = [
    { id: "topic_01", view: "${q://QID_TOPIC_01_VIEW/ChoiceNumericEntryValue/1}" },
    { id: "topic_02", view: "${q://QID_TOPIC_02_VIEW/ChoiceNumericEntryValue/1}" },
    { id: "topic_03", view: "${q://QID_TOPIC_03_VIEW/ChoiceNumericEntryValue/1}" },
    { id: "topic_04", view: "${q://QID_TOPIC_04_VIEW/ChoiceNumericEntryValue/1}" },
    { id: "topic_05", view: "${q://QID_TOPIC_05_VIEW/ChoiceNumericEntryValue/1}" },
    { id: "topic_06", view: "${q://QID_TOPIC_06_VIEW/ChoiceNumericEntryValue/1}" },
    { id: "topic_07", view: "${q://QID_TOPIC_07_VIEW/ChoiceNumericEntryValue/1}" },
    { id: "topic_08", view: "${q://QID_TOPIC_08_VIEW/ChoiceNumericEntryValue/1}" },
    { id: "topic_09", view: "${q://QID_TOPIC_09_VIEW/ChoiceNumericEntryValue/1}" },
    { id: "topic_10", view: "${q://QID_TOPIC_10_VIEW/ChoiceNumericEntryValue/1}" },
    { id: "topic_11", view: "${q://QID_TOPIC_11_VIEW/ChoiceNumericEntryValue/1}" },
    { id: "topic_12", view: "${q://QID_TOPIC_12_VIEW/ChoiceNumericEntryValue/1}" },
    { id: "topic_13", view: "${q://QID_TOPIC_13_VIEW/ChoiceNumericEntryValue/1}" },
    { id: "topic_14", view: "${q://QID_TOPIC_14_VIEW/ChoiceNumericEntryValue/1}" },
    { id: "topic_15", view: "${q://QID_TOPIC_15_VIEW/ChoiceNumericEntryValue/1}" },
    { id: "topic_16", view: "${q://QID_TOPIC_16_VIEW/ChoiceNumericEntryValue/1}" },
    { id: "topic_17", view: "${q://QID_TOPIC_17_VIEW/ChoiceNumericEntryValue/1}" },
    { id: "topic_18", view: "${q://QID_TOPIC_18_VIEW/ChoiceNumericEntryValue/1}" },
    { id: "topic_19", view: "${q://QID_TOPIC_19_VIEW/ChoiceNumericEntryValue/1}" }
  ];

  var q = this; // eslint-disable-line @typescript-eslint/no-this-alias -- Qualtrics runs plain ES5
  q.hideNextButton();

  function setEmbedded(name, value) {
    var api = Qualtrics.SurveyEngine;
    // Simple layout exposes setJSEmbeddedData; legacy layouts setEmbeddedData.
    if (typeof api.setJSEmbeddedData === "function") api.setJSEmbeddedData(name, value);
    if (typeof api.setEmbeddedData === "function") api.setEmbeddedData(name, value);
  }

  function advance() {
    q.showNextButton();
    if (AUTO_ADVANCE) q.clickNextButton();
  }

  var eligible = [];
  for (var i = 0; i < TOPICS.length; i++) {
    var raw = String(TOPICS[i].view).trim();
    // Unanswered (or unresolved piped text) is not eligible.
    if (raw === "" || raw.indexOf("${") === 0) continue;
    var v = Number(raw);
    if (!isNaN(v) && v >= MIN_VIEW && v <= MAX_VIEW) eligible.push(TOPICS[i].id);
  }
  setEmbedded("study_eligible_topics", eligible.join(","));

  if (eligible.length === 0) {
    setEmbedded("study_eligible", "0");
    q.getQuestionContainer().appendChild(
      document.createTextNode("Thanks! Please continue to the next part of the survey."),
    );
    advance();
    return;
  }
  setEmbedded("study_eligible", "1");

  var participantId = "${e://Field/ResponseID}";
  var src =
    STUDY_ORIGIN +
    "/study?participant_id=" + encodeURIComponent(participantId) +
    "&eligible=" + encodeURIComponent(eligible.join(",")) +
    "&parent_origin=" + encodeURIComponent(window.location.origin);

  var iframe = document.createElement("iframe");
  iframe.src = src;
  iframe.title = "Research task";
  iframe.style.width = "100%";
  iframe.style.height = "900px";
  iframe.style.border = "0";
  q.getQuestionContainer().appendChild(iframe);

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
      setEmbedded("study_topic_id", String(d.topic_id || ""));
      setEmbedded("study_completion_code", String(d.completion_code));
      setEmbedded("study_duration_ms", String(d.duration_ms));
      advance();
    } else if (d.type === "study_ineligible" && !done) {
      // Server-side backstop (e.g. an empty list slipped through).
      done = true;
      setEmbedded("study_eligible", "0");
      advance();
    }
  }
  window.addEventListener("message", onMessage);

  Qualtrics.SurveyEngine.addOnUnload(function () {
    window.removeEventListener("message", onMessage);
  });
});
