"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  postComplete,
  postIneligible,
  setParentOrigin,
  useHeartbeat,
  useResizeObserver,
} from "./_hooks/useIframeBridge";
import { useEventLogger } from "./_hooks/useEventLogger";
import { VanillaSearch } from "./_conditions/VanillaSearch";
import { InjectedSearch } from "./_conditions/InjectedSearch";
import { VanillaAgent } from "./_conditions/VanillaAgent";
import { InjectedAgent } from "./_conditions/InjectedAgent";

const ConditionValues = [
  "vanilla_search",
  "injected_search",
  "vanilla_agent",
  "injected_agent",
] as const;
type Condition = (typeof ConditionValues)[number];

const SessionResponseSchema = z.object({
  session_id: z.string().min(1),
  condition: z.enum(ConditionValues),
  topic_id: z.string().min(1),
  topic_text: z.string(),
});
type SessionResponse = z.infer<typeof SessionResponseSchema>;

const IneligibleResponseSchema = z.object({
  eligible: z.literal(false),
  reason: z.string(),
});

const CompleteResponseSchema = z.object({
  session_id: z.string().min(1),
  completion_code: z.string().min(1),
  duration_ms: z.number().nonnegative(),
});

type Stage =
  | { stage: "loading" }
  | { stage: "ineligible" }
  | { stage: "consent"; session: SessionResponse }
  | { stage: "active"; session: SessionResponse }
  | {
      stage: "complete";
      completion_code: string;
      duration_ms: number;
    }
  | { stage: "error"; message: string };

export function StudyClient(props: {
  initialParticipantId: string;
  initialTopicId?: string;
  parentOrigin?: string;
  initialConditionOverride?: Condition;
  previewToken?: string;
  eligibleTopics?: string[];
}) {
  // Stable primitive for the effect deps (arrays from props are new objects).
  const eligibleKey = props.eligibleTopics?.join(",");
  const {
    initialParticipantId,
    initialTopicId,
    parentOrigin,
    initialConditionOverride,
    previewToken,
  } = props;
  const [participantId] = useState<string>(initialParticipantId);
  const [state, setState] = useState<Stage>(
    participantId
      ? { stage: "loading" }
      : {
          stage: "error",
          message:
            "Missing participant_id. This page is intended to be launched with ?participant_id=... from the parent survey.",
        },
  );
  const [inFlight, setInFlight] = useState<boolean>(false);
  const completeGuard = useRef<boolean>(false);

  const rootRef = useRef<HTMLDivElement>(null);
  useResizeObserver(rootRef);
  useHeartbeat(state.stage === "active");

  // Bind parent origin (if the embedder passed one) before any postMessage
  // can fire. Runs synchronously at mount before resize / heartbeat effects
  // would post.
  useEffect(() => {
    setParentOrigin(parentOrigin ?? null);
  }, [parentOrigin]);

  const sessionId =
    state.stage === "active" || state.stage === "consent"
      ? state.session.session_id
      : null;
  const logger = useEventLogger(sessionId);

  // Fetch session on mount so the consent screen can show topic_text
  // (matches plan Task 16 step 2: "ConsentPanel: topic text and Begin
  // button"). Bouncers leave behind a sessions row with no completion_code,
  // which is expected and benign.
  useEffect(() => {
    if (!participantId) return;
    let cancelled = false;
    (async () => {
      try {
        const sessionUrl =
          previewToken && previewToken.length > 0
            ? `/api/session?token=${encodeURIComponent(previewToken)}`
            : "/api/session";
        const res = await fetch(sessionUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            participant_id: participantId,
            topic_id: initialTopicId,
            condition_override: initialConditionOverride,
            eligible_topics:
              eligibleKey === undefined ? undefined : eligibleKey ? eligibleKey.split(",") : [],
            user_agent:
              typeof navigator !== "undefined"
                ? navigator.userAgent
                : undefined,
            referrer:
              typeof document !== "undefined" ? document.referrer : undefined,
          }),
        });
        const rawBody: unknown = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err = (rawBody as { error?: string }).error;
          throw new Error(err || `session create failed (${res.status})`);
        }
        const ineligible = IneligibleResponseSchema.safeParse(rawBody);
        if (ineligible.success) {
          if (cancelled) return;
          postIneligible({ participant_id: participantId, reason: ineligible.data.reason });
          setState({ stage: "ineligible" });
          return;
        }
        const parsed = SessionResponseSchema.safeParse(rawBody);
        if (!parsed.success) {
          throw new Error(
            `server returned an unexpected session shape: ${parsed.error.issues
              .map((i) => i.path.join("."))
              .join(", ")}`,
          );
        }
        if (cancelled) return;
        setState({ stage: "consent", session: parsed.data });
      } catch (err) {
        if (cancelled) return;
        setState({
          stage: "error",
          message: err instanceof Error ? err.message : "unknown error",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [participantId, initialTopicId, initialConditionOverride, previewToken, eligibleKey]);

  const handleConsent = useCallback(() => {
    if (state.stage !== "consent") return;
    setState({ stage: "active", session: state.session });
  }, [state]);

  const handleComplete = useCallback(async () => {
    if (state.stage !== "active") return;
    // Guard against double-submit: a double-click or a mobile "tap twice"
    // would otherwise hit /api/complete twice, stressing the conditional
    // update there.
    if (completeGuard.current) return;
    completeGuard.current = true;
    setInFlight(true);
    try {
      await logger.flush();
      const res = await fetch("/api/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: state.session.session_id }),
      });
      const rawBody: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = (rawBody as { error?: string }).error;
        throw new Error(err || `complete failed (${res.status})`);
      }
      const parsed = CompleteResponseSchema.safeParse(rawBody);
      if (!parsed.success) {
        throw new Error(
          `server returned an unexpected completion shape: ${parsed.error.issues
            .map((i) => i.path.join("."))
            .join(", ")}`,
        );
      }
      postComplete({
        participant_id: participantId,
        topic_id: state.session.topic_id,
        completion_code: parsed.data.completion_code,
        duration_ms: parsed.data.duration_ms,
      });
      setState({
        stage: "complete",
        completion_code: parsed.data.completion_code,
        duration_ms: parsed.data.duration_ms,
      });
    } catch (err) {
      // Reset the guard so the user can retry after a transient failure.
      completeGuard.current = false;
      setState({
        stage: "error",
        message: err instanceof Error ? err.message : "unknown error",
      });
    } finally {
      setInFlight(false);
    }
  }, [state, participantId, logger]);

  return (
    // No min-h-screen here: inside an iframe 100vh is the iframe's own height,
    // so a viewport-based min-height feeds back through useResizeObserver ->
    // parent resizes iframe -> taller root -> ... and grows without bound.
    <main
      ref={rootRef}
      className="mx-auto max-w-3xl space-y-6 p-6 font-sans"
      data-testid="study-root"
    >
      {state.stage === "loading" && (
        <p data-testid="study-loading">Preparing your session…</p>
      )}

      {state.stage === "consent" && (
        <ConsentForm
          participantId={participantId}
          topicText={state.session.topic_text}
          disabled={inFlight || !participantId}
          onAccept={handleConsent}
        />
      )}

      {state.stage === "error" && <ErrorPanel message={state.message} />}

      {state.stage === "ineligible" && (
        <section className="space-y-2" data-testid="ineligible-panel">
          <p>Thanks! There&apos;s no additional task for you in this part of the survey.</p>
          <p className="text-sm text-gray-600">Please continue with the survey.</p>
        </section>
      )}

      {state.stage === "active" && (
        <ActiveCondition
          condition={state.session.condition}
          sessionId={state.session.session_id}
          topicId={state.session.topic_id}
          topicText={state.session.topic_text}
          logger={logger}
          disabled={inFlight}
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
  topicText: string;
  disabled: boolean;
  onAccept: () => void;
}) {
  return (
    <section className="space-y-4" data-testid="consent-form">
      <h1 className="text-2xl font-semibold">Research study</h1>
      <p>
        You&apos;re about to take part in a short task about searching for
        information online. The session will take roughly 5 minutes.
      </p>
      <section
        className="space-y-2 rounded border border-gray-200 bg-gray-50 p-4"
        data-testid="consent-topic"
      >
        <p className="text-xs uppercase tracking-wide text-gray-500">
          Your topic
        </p>
        <p className="text-base">{props.topicText}</p>
      </section>
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
        disabled={props.disabled}
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
    disabled: boolean;
    onComplete: () => void | Promise<void>;
  },
) {
  const common = {
    sessionId: props.sessionId,
    topicId: props.topicId,
    topicText: props.topicText,
    logger: props.logger,
    disabled: props.disabled,
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
    <section
      className="space-y-2 rounded border border-red-300 bg-red-50 p-4"
      data-testid="error-panel"
    >
      <h2 className="font-semibold text-red-800">Something went wrong</h2>
      <p className="text-sm text-red-700">{props.message}</p>
    </section>
  );
}
