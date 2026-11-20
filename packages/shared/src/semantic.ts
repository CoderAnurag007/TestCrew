import { z } from 'zod';
import { actionRiskSchema } from './enums.js';

export const boundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type BoundingBox = z.infer<typeof boundingBoxSchema>;

export const selectorMetaSchema = z.object({
  testId: z.string().nullable(),
  id: z.string().nullable(),
  role: z.string().nullable(),
  accessibleName: z.string().nullable(),
  label: z.string().nullable(),
  name: z.string().nullable(),
  text: z.string().nullable(),
  css: z.string().nullable(),
  primary: z.string().min(1),
});
export type SelectorMeta = z.infer<typeof selectorMetaSchema>;

export const fieldConstraintsSchema = z.object({
  required: z.boolean().nullable().optional(),
  min: z.string().nullable().optional(),
  max: z.string().nullable().optional(),
  minLength: z.number().int().nullable().optional(),
  maxLength: z.number().int().nullable().optional(),
  pattern: z.string().nullable().optional(),
  autocomplete: z.string().nullable().optional(),
  formId: z.string().nullable().optional(),
  formMethod: z.string().nullable().optional(),
  /** Path the form submits to, e.g. /users for a search form that shows results on /users. */
  formAction: z.string().nullable().optional(),
  value: z.string().nullable().optional(),
});
export type FieldConstraints = z.infer<typeof fieldConstraintsSchema>;

export const semanticElementSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  role: z.string().nullable(),
  text: z.string().nullable(),
  label: z.string().nullable(),
  placeholder: z.string().nullable(),
  name: z.string().nullable(),
  href: z.string().nullable(),
  inputType: z.string().nullable(),
  visible: z.boolean(),
  enabled: z.boolean(),
  boundingBox: boundingBoxSchema.nullable(),
  selectors: selectorMetaSchema,
  expanded: z.boolean().nullable().optional(),
  hasPopup: z.boolean().nullable().optional(),
  inNavigation: z.boolean().optional(),
  riskLevel: actionRiskSchema,
  constraints: fieldConstraintsSchema.optional(),
});
export type SemanticElement = z.infer<typeof semanticElementSchema>;

export const semanticPageSchema = z.object({
  url: z.string().min(1),
  title: z.string(),
  route: z.string(),
  modalOpen: z.boolean(),
  importantText: z.array(z.string()),
  contentSignature: z.string().optional(),
  elements: z.array(semanticElementSchema),
  /** Images on the page that failed to load (naturalWidth 0 after load). */
  brokenImages: z.array(z.string()).optional(),
  /** Short visible texts from list/table rows, used for search consistency checks. */
  listItems: z.array(z.string()).optional(),
});
export type SemanticPage = z.infer<typeof semanticPageSchema>;

export const candidateActionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['click', 'fill', 'select', 'press', 'goto', 'dismiss']),
  target: z.string().min(1),
  input: z.string().nullable(),
  label: z.string(),
  category: z.string(),
  riskLevel: actionRiskSchema,
  elementId: z.string().nullable(),
  href: z.string().nullable(),
  selectors: selectorMetaSchema,
  stableKey: z.string().min(1),
});
export type CandidateAction = z.infer<typeof candidateActionSchema>;

export const explorerDecisionSchema = z.object({
  chosenActionId: z.string().nullable(),
  reason: z.string().min(1),
  priority: z.number().int(),
  riskLevel: actionRiskSchema,
});
export type ExplorerDecision = z.infer<typeof explorerDecisionSchema>;

export const explorationLimitsSchema = z.object({
  maxPages: z.number().int().positive().max(500).default(40),
  maxActions: z.number().int().positive().max(2000).default(80),
  maxDepth: z.number().int().positive().max(50).default(8),
  maxDurationMs: z.number().int().positive().max(3_600_000).default(300_000),
  allowDestructive: z.boolean().default(false),
});
export type ExplorationLimits = z.infer<typeof explorationLimitsSchema>;
