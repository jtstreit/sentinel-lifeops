type TelemetryLike = {
  source?: unknown;
  title?: unknown;
  content?: unknown;
  packageName?: unknown;
  metadata?: unknown;
};

const MICROSOFT_APP_NAMES = new Set([
  "microsoft outlook",
  "outlook",
  "microsoft teams",
  "teams",
  "microsoft edge",
  "edge",
  "microsoft onedrive",
  "onedrive",
  "one drive",
  "microsoft sharepoint",
  "sharepoint",
  "microsoft office",
  "office",
  "microsoft 365",
  "office 365",
  "microsoft copilot",
  "copilot",
  "microsoft word",
  "word",
  "microsoft excel",
  "excel",
  "microsoft powerpoint",
  "powerpoint",
  "power point",
  "microsoft onenote",
  "onenote",
  "one note",
  "microsoft authenticator",
  "company portal",
  "intune company portal",
]);

const APP_CONTEXT_KEYS = /(package|process|app|application|label|source|origin|provider|title)/i;
const WEB_CONTEXT_KEYS = /(url|uri|host|domain|web|site|origin|provider|title)/i;

const MICROSOFT_WEB_HOST = new RegExp(
  String.raw`(?:^|[^a-z0-9.-])(?:[a-z0-9-]+\.)*(?:office\.com|office365\.com|microsoft365\.com|microsoftonline\.com|cloud\.microsoft|sharepoint\.com|teams\.microsoft\.com|copilot\.microsoft\.com|outlook\.live\.com|onedrive\.live\.com|office\.live\.com|login\.live\.com|powerapps\.com|powerautomate\.com|dynamics\.com|dynamics\.microsoft\.com)(?=$|[^a-z0-9.-])`,
  "i",
);
const CREDIBLE_WEB_HOST = new RegExp(
  String.raw`(?:^|[^a-z0-9.-])(?:[a-z0-9-]+\.)*(?:credibleinc\.com|crediblebh\.com)(?=$|[^a-z0-9.-])`,
  "i",
);
const MICROSOFT_WEB_BRAND = /\b(?:microsoft\s+(?:365|outlook|teams|sharepoint|one\s*drive|copilot|word|excel|power\s*point|powerpoint)|office\s*365)\b/i;
const MICROSOFT_WEB_PRODUCT = /\b(?:outlook|teams|sharepoint|one\s*drive|power\s*apps|power\s*automate|dynamics\s*365)\b/i;
const MICROSOFT_WEB_UI = /\b(?:sign\s*in|inbox|new\s+mail|focused|calendar|files|sites|channels|chat|apps)\b/i;
const CREDIBLE_STRONG_MARKER = /\b(?:credible\s+behavioral\s+health|cbh3)\b/i;
const CREDIBLE_BRAND = /\bcredible\b/i;
const CREDIBLE_UI = /\b(?:client\s+profile|employee\s+profile|service\s+note|sign\s+and\s+submit|clients|schedule|clinical|treatment\s+plan)\b/i;
const MONARCH_WORK_CONTEXT = /(?:@|\b)monarchnc\.org\b|\b(?:monarch(?:\s+nc)?|iihs?|bh[-\s]?davidson|nc[-\s]?topps|nctracks|providerconnect|proauth|tru\s?care)\b|\b(?:client|service|progress|clinical)\s+note\b|\bsign\s+and\s+submit\b/i;

function asCleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isMicrosoftPackageName(value: unknown): boolean {
  const clean = asCleanString(value).toLowerCase();
  return (
    clean === "com.microsoft" ||
    clean.startsWith("com.microsoft.") ||
    clean === "com.azure.authenticator" ||
    clean.startsWith("com.azure.authenticator.")
  );
}

function isCrediblePackageName(value: unknown): boolean {
  const clean = asCleanString(value).toLowerCase();
  return (
    clean === "com.credible" ||
    clean.startsWith("com.credible.") ||
    clean.includes(".crediblebh.") ||
    clean.includes(".cbh3.")
  );
}

function isBrowserPackageName(value: unknown): boolean {
  const clean = asCleanString(value).toLowerCase();
  return (
    clean === "com.android.chrome" ||
    clean.startsWith("com.chrome.") ||
    clean === "com.brave.browser" ||
    clean.startsWith("com.brave.browser_") ||
    clean === "com.sec.android.app.sbrowser" ||
    clean.startsWith("com.sec.android.app.sbrowser.") ||
    clean === "org.mozilla.firefox" ||
    clean === "org.mozilla.fenix" ||
    clean.startsWith("org.mozilla.firefox_") ||
    clean === "com.opera.browser" ||
    clean.startsWith("com.opera.") ||
    clean === "org.chromium.chrome" ||
    clean.startsWith("org.chromium.webapk.")
  );
}

function normalizeAppName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMicrosoftAppName(value: unknown): boolean {
  const clean = normalizeAppName(asCleanString(value));
  if (!clean) return false;
  if (isMicrosoftPackageName(clean)) return true;
  if (/\bmicrosoft\s+(outlook|teams|edge|onedrive|sharepoint|office|365|copilot|word|excel|power\s*point|powerpoint|onenote|authenticator)\b/i.test(clean)) {
    return true;
  }
  return MICROSOFT_APP_NAMES.has(clean);
}

function appNameFromTelemetryTitle(value: unknown): string {
  const title = asCleanString(value);
  const match = title.match(/^(?:app usage|foreground screen text|notification from|active notification from)\s*:?\s*(.+)$/i);
  return match ? match[1].trim() : "";
}

function packagePrefixFromContent(value: unknown): string {
  const content = asCleanString(value);
  const match = content.match(/^\s*([a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,})\s*:/i);
  return match ? match[1] : "";
}

function collectMetadataContextStrings(value: unknown, parentKey = ""): string[] {
  if (!value || typeof value !== "object") return [];
  const out: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const keyLooksLikeAppContext = APP_CONTEXT_KEYS.test(key) || APP_CONTEXT_KEYS.test(parentKey);
    if (typeof child === "string" && keyLooksLikeAppContext) {
      out.push(child);
    } else if (child && typeof child === "object" && !Array.isArray(child)) {
      out.push(...collectMetadataContextStrings(child, keyLooksLikeAppContext ? key : parentKey));
    }
  }
  return out;
}

function collectWebContextStrings(value: unknown, parentKey = ""): string[] {
  if (!value || typeof value !== "object") return [];
  const out: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const keyLooksLikeWebContext = WEB_CONTEXT_KEYS.test(key) || WEB_CONTEXT_KEYS.test(parentKey);
    if (typeof child === "string" && keyLooksLikeWebContext) {
      out.push(child);
    } else if (child && typeof child === "object" && !Array.isArray(child)) {
      out.push(...collectWebContextStrings(child, keyLooksLikeWebContext ? key : parentKey));
    }
  }
  return out;
}

function sourceName(value: unknown): string {
  return asCleanString(value).toLowerCase();
}

function telemetryContext(log: TelemetryLike): string {
  return [
    asCleanString(log.title),
    asCleanString(log.content),
    ...collectWebContextStrings(log.metadata),
  ].filter(Boolean).join(" ");
}

function collectAllStringValues(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const out: string[] = [];
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (typeof child === "string") out.push(child);
    else if (child && typeof child === "object") out.push(...collectAllStringValues(child));
  }
  return out;
}

function isMonarchWorkTelemetryLog(log: TelemetryLike): boolean {
  const context = [
    asCleanString(log.title),
    asCleanString(log.content),
    ...collectAllStringValues(log.metadata),
  ].filter(Boolean).join(" ");
  return MONARCH_WORK_CONTEXT.test(context);
}

function hasBrowserContext(log: TelemetryLike): boolean {
  if (isBrowserPackageName(log.packageName)) return true;
  const titlePackage = appNameFromTelemetryTitle(log.title);
  if (isBrowserPackageName(titlePackage)) return true;
  return collectMetadataContextStrings(log.metadata).some(isBrowserPackageName);
}

function isMicrosoftWebAppTelemetryLog(log: TelemetryLike): boolean {
  const source = sourceName(log.source);
  if (source !== "screen_text" && source !== "notification") return false;
  if (!hasBrowserContext(log)) return false;

  const context = telemetryContext(log);
  return (
    MICROSOFT_WEB_HOST.test(context) ||
    MICROSOFT_WEB_BRAND.test(context) ||
    (MICROSOFT_WEB_PRODUCT.test(context) && MICROSOFT_WEB_UI.test(context))
  );
}

function isCredibleTelemetryLog(log: TelemetryLike): boolean {
  if (isCrediblePackageName(log.packageName)) return true;
  if (collectMetadataContextStrings(log.metadata).some(isCrediblePackageName)) return true;

  const context = telemetryContext(log);
  return (
    CREDIBLE_WEB_HOST.test(context) ||
    CREDIBLE_STRONG_MARKER.test(context) ||
    (sourceName(log.source) === "screen_text" && hasBrowserContext(log) && CREDIBLE_BRAND.test(context) && CREDIBLE_UI.test(context))
  );
}

export function isMicrosoftAppTelemetryLog(log: TelemetryLike): boolean {
  if (isMicrosoftPackageName(log.packageName)) return true;
  if (isMicrosoftPackageName(packagePrefixFromContent(log.content))) return true;

  const titleAppName = appNameFromTelemetryTitle(log.title);
  if (titleAppName && isMicrosoftAppName(titleAppName)) return true;

  const rawTitle = asCleanString(log.title);
  if (/^microsoft\s+/i.test(rawTitle) && isMicrosoftAppName(rawTitle)) return true;

  for (const contextValue of collectMetadataContextStrings(log.metadata)) {
    if (isMicrosoftPackageName(contextValue) || isMicrosoftAppName(contextValue)) {
      return true;
    }
  }

  return false;
}

export function isExcludedTelemetryLog(log: TelemetryLike): boolean {
  return isCredibleTelemetryLog(log) || isMonarchWorkTelemetryLog(log);
}
