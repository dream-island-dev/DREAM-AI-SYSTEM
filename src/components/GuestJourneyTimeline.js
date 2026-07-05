// Visual pipeline timeline for a single guest — used in GuestContextDrawer + command palette preview.
import { buildGuestJourneyFromFlags, mergeQueueIntoJourney } from "../utils/guestJourneyStages";

export default function GuestJourneyTimeline({ guest, queueRows, compact = false }) {
  const steps = mergeQueueIntoJourney(buildGuestJourneyFromFlags(guest), queueRows);

  if (!guest) {
    return (
      <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
        אין פרופיל אורח במערכת
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 6 : 8 }}>
      {steps.map((step) => {
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
            key={step.key}
            title={step.skipLabel || step.label}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: compact ? 11 : 12,
              lineHeight: 1.4,
            }}
          >
            <span style={{
              flexShrink: 0, width: 20, textAlign: "center", fontWeight: 800, color,
            }}>
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
      })}
    </div>
  );
}
