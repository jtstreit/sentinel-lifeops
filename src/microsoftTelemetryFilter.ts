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
