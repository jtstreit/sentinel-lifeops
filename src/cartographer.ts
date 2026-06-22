import type { ReverseStep, ExecutiveStep } from "./types";

/**
 * Utility to parse HH:MM string to absolute minutes of the day (0 to 1439)
 */
export function timeStringToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.trim().split(":").map(Number);
  if (isNaN(hours) || isNaN(minutes)) return 0;
  return hours * 60 + minutes;
}

/**
 * Utility to convert minutes of the day to HH:MM format (24 hour)
 */
export function minutesToTimeString(minutes: number): string {
  const normMin = (minutes + 1440) % 1440;
  const hr = Math.floor(normMin / 60);
  const min = normMin % 60;
  return `${String(hr).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * Convert 24-hour time "16:00" to 12-hour string with AM/PM "04:00 PM"
 */
export function formatTo12Hour(timeStr: string | null): string {
  if (!timeStr) return "N/A";
  const [hours, minutes] = timeStr.split(":").map(Number);
  if (isNaN(hours) || isNaN(minutes)) return timeStr;
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(displayHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${ampm}`;
}

/**
 * Generates the reverse time cartography steps based on a target appointment time and listed prep steps.
 * By going backwards, we calculate the absolute limit when they MUST stand up, dress, leave, etc.
 */
export function generateReverseTimeline(
  targetTimeStr: string, // e.g., "16:00"
  steps: ExecutiveStep[],
  travelDurationMinutes: number = 20,
  bufferDurationMinutes: number = 10
): {
  reverseSteps: ReverseStep[];
  hardLeaveMinutes: number;
  prepStartMinutes: number;
} {
  const targetMin = timeStringToMinutes(targetTimeStr);
  
  // Backwards calculation sequence:
  // 1. Target Time (Anchor Event) minutes: targetMin
  // 2. Buffer step (at location): targetMin - bufferDurationMinutes
  // 3. Travel step: targetMin - bufferDurationMinutes - travelDurationMinutes
  // 4. Prep steps backwards from the travel start.
  
  const reverseSteps: ReverseStep[] = [];
  
  // 1. Target Event Anchor
  reverseSteps.push({
    id: "anchor",
    label: "Anchor Event (Target Start Time)",
    durationMinutes: 0,
    absoluteTime: minutesToTimeString(targetMin),
    isActionable: false,
    type: "anchor",
    isCompleted: false,
  });

  // 2. Transition & Parking Buffer
  if (bufferDurationMinutes > 0) {
    const bufferMin = targetMin - bufferDurationMinutes;
    reverseSteps.push({
      id: "buffer",
      label: `Mental Cool-down & Transition Buffer`,
      durationMinutes: bufferDurationMinutes,
      absoluteTime: minutesToTimeString(bufferMin),
      isActionable: false,
      type: "buffer",
      isCompleted: false,
    });
  }

  // 3. Travel Time
  const leaveMin = targetMin - bufferDurationMinutes - travelDurationMinutes;
  reverseSteps.push({
    id: "leave",
    label: `HARD LEAVE TIME (Start Traveling)`,
    durationMinutes: travelDurationMinutes,
    absoluteTime: minutesToTimeString(leaveMin),
    isActionable: true,
    type: "travel",
    isCompleted: false,
  });

  // 4. Preparation Steps (calculated backwards from Hard Leave Time)
  let currentAccumulatedMin = leaveMin;
  
  // Go backwards through the checklist
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    currentAccumulatedMin -= step.durationMinutes;
    reverseSteps.push({
      id: `prep-step-${step.id}`,
      label: step.title,
      durationMinutes: step.durationMinutes,
      absoluteTime: minutesToTimeString(currentAccumulatedMin),
      isActionable: step.state === "current",
      type: "prep",
      isCompleted: step.state === "done",
    });
  }

  // Keep the backwards calculation order instead of sorting by clock face.
  // Sorting 23:50 and 00:10 by minute-of-day breaks timelines that cross midnight.
  const sortedSteps = [...reverseSteps].reverse();

  return {
    reverseSteps: sortedSteps,
    hardLeaveMinutes: leaveMin,
    prepStartMinutes: currentAccumulatedMin,
  };
}
