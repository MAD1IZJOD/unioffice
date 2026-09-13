import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Globals are off, so Testing Library cannot register its own cleanup.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
