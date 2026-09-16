import { describe, expect, it } from "vitest";

import { callbackMessage, isAuthorizationUrl } from "./connections";

describe("connections", () => {
  it("only sends people to a provider's own https consent page", () => {
    expect(isAuthorizationUrl("https://github.com/login/oauth/authorize?client_id=x")).toBe(true);
    expect(isAuthorizationUrl("https://accounts.google.com/o/oauth2/v2/auth?client_id=x")).toBe(true);

    expect(isAuthorizationUrl("http://github.com/login/oauth/authorize")).toBe(false);
    expect(isAuthorizationUrl("https://github.com.evil.test/login")).toBe(false);
    expect(isAuthorizationUrl("javascript:alert(1)")).toBe(false);
    expect(isAuthorizationUrl("/settings/connections")).toBe(false);
  });

  it("turns a callback code into a fixed sentence and never repeats the code's text", () => {
    expect(callbackMessage(null)).toBeUndefined();
    expect(callbackMessage("oauth_denied")).toMatch(/declined/);
    expect(callbackMessage("<img src=x onerror=alert(1)>")).toBe("The connection was not completed.");
  });
});
