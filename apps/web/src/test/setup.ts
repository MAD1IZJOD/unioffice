import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

import { setActiveOrganization } from "../lib/api";

/** The organization a signed-in test acts in, as the session gate would set it. */
export const TEST_ORGANIZATION_ID = "2f6b579a-f0f8-45a5-868a-21c08bde1314";

beforeEach(() => {
  setActiveOrganization(TEST_ORGANIZATION_ID);
});

// Globals are off, so Testing Library cannot register its own cleanup.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    window.localStorage.clear();
  } catch {
    // Not every environment has storage.
  }
});
