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
 *   4. STUDY_ORIGIN and TOPICS below are already set for this survey and the
 *      production deployment; paste as-is.
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
  var STUDY_ORIGIN = "https://storm-geo-human-factors.vercel.app";
  var AUTO_ADVANCE = true;
  var MIN_VIEW = 25;
  var MAX_VIEW = 75;

  // One row per topic shown in the survey. `id` must match a topic_id in the
  // study corpus (it's the topic's Qualtrics block name, except
  // historical_statue_removal, whose block is "historical_statue_re").
  // Not in the survey yet: artificial_intelligence_ai (a candidate to swap in
  // for one of rows 16-19). To swap, change that row's id and view code.
  // `view` is the piped-text code for that topic's "What's your view on this
  // issue?" slider (Piped Text menu -> Survey Question -> <the question> ->
  // <the view statement>). QIDs are from this survey; the trailing /1 assumes
  // the view item is the question's first statement.
  var TOPICS = [
    { id: "saturday_halloween", view: "${q://QID36/ChoiceNumericEntryValue/1}" },
    { id: "historical_statue_removal", view: "${q://QID38/ChoiceNumericEntryValue/1}" },
    { id: "golf", view: "${q://QID39/ChoiceNumericEntryValue/1}" },
    { id: "cheerleading", view: "${q://QID40/ChoiceNumericEntryValue/1}" },
    { id: "churches_and_taxes", view: "${q://QID41/ChoiceNumericEntryValue/1}" },
    { id: "ride_sharing", view: "${q://QID42/ChoiceNumericEntryValue/1}" },
    { id: "space_colonization", view: "${q://QID43/ChoiceNumericEntryValue/1}" },
    { id: "olympics", view: "${q://QID44/ChoiceNumericEntryValue/1}" },
    { id: "election_day", view: "${q://QID45/ChoiceNumericEntryValue/1}" },
    { id: "us_pledge_of_allegiance", view: "${q://QID46/ChoiceNumericEntryValue/1}" },
    { id: "fighting_in_hockey", view: "${q://QID47/ChoiceNumericEntryValue/1}" },
    { id: "tablets_vs_textbooks", view: "${q://QID48/ChoiceNumericEntryValue/1}" },
    { id: "reparations_for_slavery", view: "${q://QID49/ChoiceNumericEntryValue/1}" },
    { id: "zoos", view: "${q://QID50/ChoiceNumericEntryValue/1}" },
    { id: "video_games", view: "${q://QID51/ChoiceNumericEntryValue/1}" },
    { id: "net_neutrality", view: "${q://QID52/ChoiceNumericEntryValue/1}" },
    { id: "mandatory_national_service", view: "${q://QID53/ChoiceNumericEntryValue/1}" },
    { id: "cancel_culture", view: "${q://QID54/ChoiceNumericEntryValue/1}" },
    { id: "book_bans", view: "${q://QID55/ChoiceNumericEntryValue/1}" }
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
