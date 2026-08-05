// Vitest global setup. Runs before each test file.
// - `@testing-library/jest-dom` adds DOM matchers (toBeInTheDocument, etc.).
// - Register a `@` path alias and any DOM polyfills needed by components.
//
// NOTE: This setup runs for ALL test files, including pure node-logic tests,
// so keep it dependency-light. jest-dom is a no-op in node env (no document).
import "@testing-library/jest-dom/vitest";

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount React components after each test to avoid leaked DOM between tests.
afterEach(() => {
  cleanup();
});
