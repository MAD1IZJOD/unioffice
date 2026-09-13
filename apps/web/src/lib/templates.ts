import {
  TEMPLATE_INPUT_LIMITS,
  TEMPLATE_INPUT_MINIMUMS,
  type TemplateComplexity,
} from "./api";

export const COMPLEXITY_LABEL: Record<TemplateComplexity, string> = {
  focused: "Focused",
  cross_functional: "Cross-functional",
  broad: "Broad",
};

export const COMPLEXITY_DETAIL: Record<TemplateComplexity, string> = {
  focused: "Usually one discipline, a few steps",
  cross_functional: "Usually several disciplines working in sequence",
  broad: "Usually many disciplines and parallel work",
};

export type TemplateFieldKey =
  | "name"
  | "objective"
  | "context"
  | "desiredOutcome"
  | "constraints";

/**
 * Early feedback only. The API applies the same rules and its answer is the
 * one that counts; nothing here decides whether a mission may start.
 */
export function validateTemplateInput(
  values: Record<TemplateFieldKey, string>,
): Partial<Record<TemplateFieldKey, string>> {
  const errors: Partial<Record<TemplateFieldKey, string>> = {};

  if (values.objective.trim().length < TEMPLATE_INPUT_MINIMUMS.objective) {
    errors.objective = "Say what the mission is for, in at least a short sentence.";
  }

  if (values.desiredOutcome.trim().length < TEMPLATE_INPUT_MINIMUMS.desiredOutcome) {
    errors.desiredOutcome = "Say what should exist when it is done.";
  }

  for (const key of Object.keys(TEMPLATE_INPUT_LIMITS) as TemplateFieldKey[]) {
    if (values[key].trim().length > TEMPLATE_INPUT_LIMITS[key]) {
      errors[key] = `Keep this to ${TEMPLATE_INPUT_LIMITS[key]} characters or fewer.`;
    }
  }

  return errors;
}
