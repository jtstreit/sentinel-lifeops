import { describe, expect, it } from "vitest";
import { isMicrosoftAppTelemetryLog, isMicrosoftPackageName } from "./microsoftTelemetryFilter";

describe("Microsoft telemetry filter", () => {
  it("matches Microsoft Android package names and known Microsoft package families", () => {
    expect(isMicrosoftPackageName("com.microsoft.teams")).toBe(true);
    expect(isMicrosoftPackageName("com.microsoft.office.outlook")).toBe(true);
    expect(isMicrosoftPackageName("com.azure.authenticator")).toBe(true);
    expect(isMicrosoftPackageName("com.notmicrosoft.teams")).toBe(false);
  });

  it("drops Microsoft app telemetry from package, content prefix, title, and metadata signals", () => {
    expect(isMicrosoftAppTelemetryLog({
      source: "notification",
      title: "Alex",
      content: "Can you review this?",
      packageName: "com.microsoft.teams",
    })).toBe(true);
    expect(isMicrosoftAppTelemetryLog({
      source: "notification",
      title: "New email",
      content: "com.microsoft.office.outlook: agenda changed",
    })).toBe(true);
    expect(isMicrosoftAppTelemetryLog({
      source: "app_usage",
      title: "App usage: Word",
      content: "3 minutes foreground",
    })).toBe(true);
    expect(isMicrosoftAppTelemetryLog({
      source: "screen_text",
      title: "Foreground screen text",
      content: "sign in prompt",
      metadata: { foregroundApp: { packageName: "com.azure.authenticator" } },
    })).toBe(true);
  });

  it("keeps non-Microsoft telemetry even when content mentions Microsoft words", () => {
    expect(isMicrosoftAppTelemetryLog({
      source: "sms",
      title: "SMS from Jordan",
      content: "Can you send me the Microsoft 365 renewal note?",
      packageName: "com.google.android.apps.messaging",
    })).toBe(false);
    expect(isMicrosoftAppTelemetryLog({
      source: "notification",
      title: "Package delivered",
      content: "Office supplies are outside.",
      packageName: "com.amazon.mShop.android.shopping",
    })).toBe(false);
    expect(isMicrosoftAppTelemetryLog({
      source: "screen_text",
      title: "Foreground screen text: Edge case tracker",
      content: "Review the edge case before shipping.",
      packageName: "com.example.notes",
    })).toBe(false);
  });
});
