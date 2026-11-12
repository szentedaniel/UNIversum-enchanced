import { afterEach, describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "../src/pwa/register.ts";

// Dev must never keep a worker around: it would hide the next change behind the
// old cache. Production registers `/sw.js` after `load`, and only where the
// browser allows a worker (a secure context; `localhost` counts as one).

type Listener = () => void;
type AddListener = (type: "load", listener: Listener, options?: { once?: boolean }) => void;
type Register = (
  script: string,
  options?: { scope?: string; type?: "classic" | "module" },
) => Promise<void>;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubPage({ secure = true } = {}) {
  const register = vi.fn<Register>(() => Promise.resolve());
  const addEventListener = vi.fn<AddListener>();
  vi.stubGlobal("navigator", { serviceWorker: { register } });
  vi.stubGlobal("window", { addEventListener, isSecureContext: secure });
  const fireLoad = () => {
    const handler = addEventListener.mock.calls[0]?.[1];
    expect(handler).toBeTypeOf("function");
    handler?.();
  };
  return { register, addEventListener, fireLoad };
}

function production(): void {
  vi.stubEnv("PROD", true);
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
    const { register, addEventListener, fireLoad } = stubPage();

    registerServiceWorker();
    expect(addEventListener).toHaveBeenCalledTimes(1);
    expect(addEventListener).toHaveBeenCalledWith("load", expect.any(Function), { once: true });
    expect(register).not.toHaveBeenCalled();

    fireLoad();
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
    const addEventListener = vi.fn<AddListener>();
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", { addEventListener, isSecureContext: true });

    registerServiceWorker();

    expect(addEventListener).not.toHaveBeenCalled();
  });
});
