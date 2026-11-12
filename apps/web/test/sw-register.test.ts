import { afterEach, describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "../src/pwa/register.ts";

// Dev must never keep a worker around: it would hide the next change behind the
// old cache. Production registers `/sw.js` after `load`, and only where the
// browser allows a worker (a secure context; `localhost` counts as one).

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubPage({ secure = true } = {}) {
  const register = vi.fn(() => Promise.resolve({} as ServiceWorkerRegistration));
  const addEventListener = vi.fn();
  vi.stubGlobal("navigator", { serviceWorker: { register } });
  vi.stubGlobal("window", { addEventListener, isSecureContext: secure });
  return { register, addEventListener };
}

function production(): void {
  vi.stubEnv("PROD", true);
}

function onLoad(listener: unknown): () => void {
  expect(listener).toBeTypeOf("function");
  return listener as () => void;
}

describe("registerServiceWorker", () => {
  it("does nothing in a development build", () => {
    const { register, addEventListener } = stubPage();

    registerServiceWorker();

    expect(addEventListener).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it("registers /sw.js at the root after load in a production build", () => {
    production();
    const { register, addEventListener } = stubPage();

    registerServiceWorker();
    expect(addEventListener).toHaveBeenCalledTimes(1);
    expect(addEventListener).toHaveBeenCalledWith("load", expect.any(Function), { once: true });
    expect(register).not.toHaveBeenCalled();

    onLoad(addEventListener.mock.calls[0]?.[1])();
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/", type: "module" });
  });

  it("does nothing outside a secure context", () => {
    production();
    const { register, addEventListener } = stubPage({ secure: false });

    registerServiceWorker();

    expect(addEventListener).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it("does nothing in a browser without service workers", () => {
    production();
    const addEventListener = vi.fn();
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", { addEventListener, isSecureContext: true });

    registerServiceWorker();

    expect(addEventListener).not.toHaveBeenCalled();
  });
});
