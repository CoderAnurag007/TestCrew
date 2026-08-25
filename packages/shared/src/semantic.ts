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
