// Visual pipeline timeline for a single guest — suite/day-pass segmented.
import {
  buildGuestJourneyFromFlags,
  getGuestPipelineLabel,
  mergeQueueIntoJourney,
} from "../utils/guestJourneyStages";
import { resolveGuestPipelineSegment } from "../utils/pipelineSegment";

function StepRow({ step, compact }) {
  const color =
    step.status === "sent" ? "#15803D"
    : step.status === "due" ? "var(--gold-dark, #A8843A)"
    : step.status === "blocked" ? "#DC2626"
    : "var(--text-muted)";
  const icon =
    step.status === "sent" ? "✓"
    : step.status === "due" ? "⚡"
    : step.status === "blocked" ? "⛔"
    : "○";
  return (
    <div
      title={step.skipLabel || step.label}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        fontSize: compact ? 11 : 12,
        lineHeight: 1.4,
      }}
    >
      <span style={{ flexShrink: 0, width: 20, textAlign: "center", fontWeight: 800, color }}>
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: step.status === "due" ? 800 : 600, color: "var(--black)" }}>
          {step.label}
        </div>
        {step.skipLabel && (
          <div style={{ fontSize: 11, color: "#DC2626", marginTop: 2 }}>{step.skipLabel}</div>
        )}
        {step.scheduledFor && step.status !== "sent" && (
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
            מתוכנן: {new Date(step.scheduledFor).toLocaleString("he-IL", {
              day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function GuestJourneyTimeline({
  guest,
  queueRows,
  compact = false,
  onSuppressStage,
  onUnsuppressStage,
  suppressBusyKey,
}) {
  const steps = mergeQueueIntoJourney(buildGuestJourneyFromFlags(guest), queueRows, guest);
  const segment = resolveGuestPipelineSegment(guest);
  const pipelineLabel = getGuestPipelineLabel(guest);

  if (!guest) {
    return (
      <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
        אין פרופיל אורח במערכת
      </p>
    );
  }

  const sharedSteps = steps.filter((s) => s.pipelineSegment === "shared");
  const pipelineSteps = steps.filter((s) => s.pipelineSegment === segment);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 10 : 14 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, padding: "6px 10px", borderRadius: 8,
        background: segment === "suite" ? "rgba(3,105,161,0.08)" : "rgba(124,58,237,0.08)",
        color: segment === "suite" ? "#0369A1" : "#7C3AED",
        border: `1px solid ${segment === "suite" ? "#7DD3FC" : "#C4B5FD"}`,
      }}>
        צינור פעיל: {pipelineLabel}
      </div>

      {sharedSteps.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6 }}>
            🔗 שלבים משותפים
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: compact ? 6 : 8 }}>
            {sharedSteps.map((step) => <StepRow key={step.key} step={step} compact={compact} />)}
          </div>
        </div>
      )}

      {pipelineSteps.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6 }}>
            {pipelineLabel}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: compact ? 6 : 8 }}>
            {pipelineSteps.map((step) => {
              const busy = suppressBusyKey === `${guest.id}::${step.key}`;
              return (
                <div key={step.key}>
                  <StepRow step={step} compact={compact} />
                  {onSuppressStage && step.status !== "sent" && (
                    <div style={{ marginTop: 4, marginRight: 28 }}>
                      {step.skipReason === "stage_suppressed" || step.suppressed ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => onUnsuppressStage?.(guest.id, step.key)}
                          style={{ fontSize: 10, padding: "2px 8px" }}
                        >
                          {busy ? "⏳" : "↩ החזר שלב"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => onSuppressStage?.(guest.id, step.key, step.label)}
                          style={{ fontSize: 10, padding: "2px 8px", color: "#C0392B" }}
                        >
                          {busy ? "⏳" : "✕ בטל שלב"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
