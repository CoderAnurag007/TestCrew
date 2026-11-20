export { BrowserManager } from './manager.js';
export { LiveStreamer, type LiveAction, type LiveFrame } from './live.js';
export { ensurePlaywrightBrowsersPath, resolveChromiumExecutable } from './browsers-path.js';
export { PageObserver, type PageObservation } from './observer.js';
export { DOMExtractor, AccessibilityExtractor } from './extractors.js';
export { NetworkMonitor } from './network-monitor.js';
export { ConsoleMonitor } from './console-monitor.js';
export { ScreenshotManager } from './screenshot.js';
export { SemanticExtractor } from './semantic-extractor.js';
export { UsernamePasswordAuthenticator, installNavigationGuard } from './auth.js';
export { waitForPageSettle, waitForSpaSettle, withNavigationRetry, isNavigationDestroyedError } from './stable-page.js';
export { executeCandidateAction, locatorFromSelectors } from './execute.js';
export { classifyActionRisk } from './risk.js';
export {
  SafetyGuard,
  installSafetyGuard,
  isTelemetryRequest,
  globToRegExp,
  DEFAULT_BLOCKED_PATH_PATTERNS,
  type SafetyMode,
  type SafetyPhase,
  type SafetyPolicy,
  type BlockedRequest,
} from './safety.js';
export { botCheckReason, detectBotCheck } from './bot-check.js';
export { verifyDomainOwnership, verificationRecordName, type VerificationResult } from '@auditor/shared/verification';
export { buildSelectorMeta } from './selectors.js';
export {
  DEVICE_PROFILES,
  BrowserNotInstalledError,
  currentDevice,
  currentDeviceProfile,
  deviceContextOptions,
  runWithDevice,
  type AuditDevice,
} from './device.js';
