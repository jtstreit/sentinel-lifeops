import { describe, expect, it } from "vitest";
import { isExcludedTelemetryLog, isMicrosoftAppTelemetryLog, isMicrosoftPackageName } from "./microsoftTelemetryFilter";

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

  it("keeps personal Microsoft activity but blocks Microsoft activity tied to Monarch", () => {
    expect(isExcludedTelemetryLog({
      source: "screen_text",
      title: "Foreground screen text: com.android.chrome",
      content: "https://outlook.office.com/mail/inbox | Inbox | New mail",
      packageName: "com.android.chrome",
    })).toBe(false);
    expect(isExcludedTelemetryLog({
      source: "screen_text",
      title: "Foreground screen text: com.brave.browser",
      content: "https://teams.microsoft.com/ | Microsoft Teams | Chat | jackson@monarchnc.org",
      packageName: "com.brave.browser",
    })).toBe(true);
    expect(isExcludedTelemetryLog({
      source: "notification",
      title: "Synthetic web notification",
      content: "New item",
      packageName: "org.chromium.webapk.synthetic",
      metadata: { origin: "https://tenant.sharepoint.com/sites/monarch-iih" },
    })).toBe(true);
  });

  it("blocks Credible surfaces without treating the ordinary adjective as an EHR marker", () => {
    expect(isExcludedTelemetryLog({
      source: "screen_text",
      title: "Foreground screen text: com.android.chrome",
      content: "https://login.cbh3.crediblebh.com/ | Credible Behavioral Health",
      packageName: "com.android.chrome",
    })).toBe(true);
    expect(isExcludedTelemetryLog({
      source: "notification",
      title: "Synthetic portal alert",
      content: "https://secure.credibleinc.com/",
      packageName: "com.android.chrome",
    })).toBe(true);
    expect(isExcludedTelemetryLog({
      source: "sms",
      title: "Synthetic message",
      content: "That sounds like a credible plan.",
      packageName: "com.google.android.apps.messaging",
    })).toBe(false);
  });

  it("requires a real protected host boundary and browser context for Microsoft web filtering", () => {
    expect(isExcludedTelemetryLog({
      source: "screen_text",
      title: "Synthetic article",
      content: "https://outlook.office.com.example.invalid/ is not a Microsoft host",
      packageName: "com.android.chrome",
    })).toBe(false);
    expect(isExcludedTelemetryLog({
      source: "sms",
      title: "Synthetic message",
      content: "Open https://outlook.office.com/ later.",
      packageName: "com.google.android.apps.messaging",
    })).toBe(false);
    expect(isExcludedTelemetryLog({
      source: "screen_text",
      title: "Synthetic note",
      content: "The outlook for the team is credible.",
      packageName: "com.example.notes",
    })).toBe(false);
    expect(isExcludedTelemetryLog({
      source: "screen_text",
      title: "Synthetic page",
      content: "https://crediblebh.com.example.invalid/",
      packageName: "com.android.chrome",
    })).toBe(false);
  });
});
