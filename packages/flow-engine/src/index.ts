export { fingerprintState, canonicalizeRoute, canonicalizeUrl, nameForState } from './fingerprint.js';
export {
  StateGraph,
  GraphBuilder,
  CoverageCalculator,
  type GraphState,
  type GraphAction,
  type GraphEdge,
  type CoverageReport,
} from './graph.js';
export {
  ActionExtractor,
  StateDetector,
  prioritizeActions,
  priorityForAction,
  isChromeControl,
  isPlaceholderHref,
  isMenuExpander,
  isGenericLabel,
  describeAction,
} from './extractor.js';
export { shouldStopExploration, type ExplorationProgress } from './limits.js';
