"use client";

import { useRef, useState } from "react";
import {
  postComplete,
  useHeartbeat,
  useResizeObserver,
} from "./_hooks/useIframeBridge";
import { useEventLogger } from "./_hooks/useEventLogger";
import { VanillaSearch } from "./_conditions/VanillaSearch";
import { InjectedSearch } from "./_conditions/InjectedSearch";
import { VanillaAgent } from "./_conditions/VanillaAgent";
import { InjectedAgent } from "./_conditions/InjectedAgent";

type Condition =
  | "vanilla_search"
  | "injected_search"
  | "vanilla_agent"
  | "injected_agent";

type Stage =
  | { stage: "consent" }
  | { stage: "loading" }
  | { stage: "error"; message: string }
  | {
      stage: "active";
      session_id: string;
      condition: Condition;
      topic_id: string;
      topic_text: string;
    }
  | { stage: "complete"; completion_code: string; duration_ms: number };

export function StudyClient(props: {
  initialParticipantId: string;
  initialTopicId?: string;
}) {
  const { initialParticipantId, initialTopicId } = props;
  const [participantId] = useState<string>(initialParticipantId);
  const [state, setState] = useState<Stage>({ stage: "consent" });

  const rootRef = useRef<HTMLDivElement>(null);
  useResizeObserver(rootRef);
  useHeartbeat(state.stage === "active");

  const sessionId =
    state.stage === "active" ? state.session_id : null;
  const logger = useEventLogger(sessionId);

  async function handleConsent() {
    if (!participantId) {
      setState({
        stage: "error",
        message:
          "Missing participant_id. This page is intended to be launched with ?participant_id=... from the parent survey.",
      });
      return;
    }
    setState({ stage: "loading" });
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participant_id: participantId,
          topic_id: initialTopicId,
          user_agent:
            typeof navigator !== "undefined" ? navigator.userAgent : undefined,
          referrer:
            typeof document !== "undefined" ? document.referrer : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || `session create failed (${res.status})`);
      }
      setState({
        stage: "active",
        session_id: body.session_id,
        condition: body.condition,
        topic_id: body.topic_id,
        topic_text: body.topic_text,
      });
    } catch (err) {
      setState({
        stage: "error",
        message: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  async function handleComplete() {
    if (state.stage !== "active") return;
    try {
      await logger.flush();
      const res = await fetch("/api/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: state.session_id }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || `complete failed (${res.status})`);
      }
      postComplete({
        participant_id: participantId,
        completion_code: body.completion_code,
        duration_ms: body.duration_ms,
      });
      setState({
        stage: "complete",
        completion_code: body.completion_code,
        duration_ms: body.duration_ms,
      });
    } catch (err) {
      setState({
        stage: "error",
        message: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  return (
    <main
      ref={rootRef}
      className="mx-auto min-h-screen max-w-3xl space-y-6 p-6 font-sans"
      data-testid="study-root"
    >
      {state.stage === "consent" && (
        <ConsentForm
          participantId={participantId}
          onAccept={handleConsent}
        />
      )}

      {state.stage === "loading" && (
        <p data-testid="study-loading">Preparing your session…</p>
      )}

      {state.stage === "error" && (
        <ErrorPanel message={state.message} />
      )}

      {state.stage === "active" && (
        <ActiveCondition
          condition={state.condition}
          sessionId={state.session_id}
          topicId={state.topic_id}
          topicText={state.topic_text}
          logger={logger}
          onComplete={handleComplete}
        />
      )}

      {state.stage === "complete" && (
        <CompletionScreen
          code={state.completion_code}
          durationMs={state.duration_ms}
        />
      )}
    </main>
  );
}

function ConsentForm(props: {
  participantId: string;
  onAccept: () => void;
}) {
  return (
    <section className="space-y-4" data-testid="consent-form">
      <h1 className="text-2xl font-semibold">Research study</h1>
      <p>
        You&apos;re about to take part in a short task about searching for
        information online. The session will take roughly 5 minutes.
      </p>
      <p className="text-sm text-gray-600">
        Your interactions (searches, clicks, messages) are logged to study how
        people evaluate information. No personal identifiers are collected.
      </p>
      <p className="text-sm">
        Participant ID:{" "}
        <code className="font-mono">
          {props.participantId || "(missing)"}
        </code>
      </p>
      <button
        type="button"
        className="rounded bg-black px-4 py-2 text-white hover:bg-gray-800 disabled:bg-gray-400"
        disabled={!props.participantId}
        onClick={props.onAccept}
        data-testid="consent-accept"
      >
        I consent and want to start
      </button>
    </section>
  );
}

function ActiveCondition(
  props: {
    condition: Condition;
  } & {
    sessionId: string;
    topicId: string;
    topicText: string;
    logger: ReturnType<typeof useEventLogger>;
    onComplete: () => void | Promise<void>;
  },
) {
  const common = {
    sessionId: props.sessionId,
    topicId: props.topicId,
    topicText: props.topicText,
    logger: props.logger,
    onComplete: props.onComplete,
  };
  switch (props.condition) {
    case "vanilla_search":
      return <VanillaSearch {...common} />;
    case "injected_search":
      return <InjectedSearch {...common} />;
    case "vanilla_agent":
      return <VanillaAgent {...common} />;
    case "injected_agent":
      return <InjectedAgent {...common} />;
  }
}

function CompletionScreen(props: { code: string; durationMs: number }) {
  return (
    <section className="space-y-4" data-testid="completion-screen">
      <h2 className="text-2xl font-semibold">Thanks — you&apos;re done!</h2>
      <p>Your completion code is:</p>
      <p
        className="rounded bg-gray-100 px-4 py-3 font-mono text-2xl tracking-wider"
        data-testid="completion-code"
      >
        {props.code}
      </p>
      <p className="text-sm text-gray-600">
        If this page is embedded in a survey, the code has been sent to the
        parent page automatically. You may close this tab or return to the
        survey to paste it manually.
      </p>
      <p className="text-xs text-gray-500">
        Session duration: {(props.durationMs / 1000).toFixed(1)}s
      </p>
    </section>
  );
}

function ErrorPanel(props: { message: string }) {
  return (
    <section className="space-y-2 rounded border border-red-300 bg-red-50 p-4" data-testid="error-panel">
      <h2 className="font-semibold text-red-800">Something went wrong</h2>
      <p className="text-sm text-red-700">{props.message}</p>
    </section>
  );
}
