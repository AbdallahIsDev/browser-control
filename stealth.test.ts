import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import type { Browser, BrowserContext } from "playwright";

import {
  buildStealthInitScript,
  createStealthContext,
  resolveStealthConfig,
} from "./stealth";

test("resolveStealthConfig reads env defaults and normalizes booleans", () => {
  const config = resolveStealthConfig({
    ENABLE_STEALTH: "true",
    STEALTH_LOCALE: "en-GB",
    STEALTH_TIMEZONE_ID: "Europe/London",
    BROWSER_USER_AGENT: "CustomAgent/1.0",
    STEALTH_FINGERPRINT_SEED: "seed-123",
    STEALTH_WEBGL_VENDOR: "Vendor X",
    STEALTH_WEBGL_RENDERER: "Renderer Y",
    STEALTH_PLATFORM: "Win32",
    STEALTH_HARDWARE_CONCURRENCY: "12",
    STEALTH_DEVICE_MEMORY: "16",
  });

  assert.equal(config.enabled, true);
  assert.equal(config.locale, "en-GB");
  assert.equal(config.timezoneId, "Europe/London");
  assert.equal(config.userAgent, "CustomAgent/1.0");
  assert.equal(config.fingerprintSeed, "seed-123");
  assert.equal(config.webglVendor, "Vendor X");
  assert.equal(config.webglRenderer, "Renderer Y");
  assert.equal(config.platform, "Win32");
  assert.equal(config.hardwareConcurrency, 12);
  assert.equal(config.deviceMemory, 16);
});

test("resolveStealthConfig lets explicit overrides win", () => {
  const config = resolveStealthConfig(
    {
      ENABLE_STEALTH: "false",
      BROWSER_LOCALE: "fr-FR",
      BROWSER_TIMEZONE: "Europe/Paris",
      STEALTH_FINGERPRINT_SEED: "env-seed",
    },
    {
      enabled: true,
      locale: "en-US",
      timezoneId: "America/New_York",
      fingerprintSeed: "override-seed",
    },
  );

  assert.equal(config.enabled, true);
  assert.equal(config.locale, "en-US");
  assert.equal(config.timezoneId, "America/New_York");
  assert.equal(config.fingerprintSeed, "override-seed");
});

test("buildStealthInitScript applies navigator, canvas, webgl, chrome runtime, plugins, and permissions evasions", async () => {
  class FakeCanvas {
    width = 10;
    height = 10;
    _data: Uint8ClampedArray;
    constructor() {
      this._data = new Uint8ClampedArray(10 * 10 * 4);
      for (let i = 0; i < this._data.length; i++) this._data[i] = 128;
    }
    toDataURL(): string {
      return "data:image/png;base64,original";
    }
    toBlob(cb?: BlobCallback | null): void {
      if (cb) cb(new Blob());
    }
    getContext(_type?: string) {
      const canvas = this;
      return {
        getImageData(_x: number, _y: number, w: number, h: number) {
          return { data: new Uint8ClampedArray(canvas._data), width: w, height: h };
        },
        putImageData(imageData: { data: Uint8ClampedArray }, _x: number, _y: number, _dirtyX?: number, _dirtyY?: number, _dirtyW?: number, _dirtyH?: number) {
          canvas._data = new Uint8ClampedArray(imageData.data);
        },
      };
    }
  }

  class FakeWebGLRenderingContext {
    getParameter(parameter: number): string {
      return `base-${parameter}`;
    }
  }

  class FakeDateTimeFormat {
    resolvedOptions(): { locale: string; timeZone: string } {
      return {
        locale: "fr-FR",
        timeZone: "Europe/Paris",
      };
    }
  }

  const navigatorObject = {
    webdriver: true,
    language: "fr-FR",
    languages: ["fr-FR"],
    platform: "Linux x86_64",
    hardwareConcurrency: 4,
    deviceMemory: 8,
    userAgent: "BaseAgent/0.1",
    permissions: {
      query: (_descriptor: { name: string }) =>
        Promise.resolve({ state: "prompt" }),
    },
    mediaDevices: {
      enumerateDevices: () =>
        Promise.resolve([{ deviceId: "real", kind: "videoinput" }]),
    },
    __proto__: { ducktype: true },
  };

  const sandbox: Record<string, unknown> = {
    window: {} as Record<string, unknown>,
    navigator: navigatorObject,
    HTMLCanvasElement: FakeCanvas,
    WebGLRenderingContext: FakeWebGLRenderingContext,
    WebGL2RenderingContext: FakeWebGLRenderingContext,
    Intl: {
      DateTimeFormat: FakeDateTimeFormat,
    },
    RTCPeerConnection: function (config: unknown) {
      return { config, addEventListener: () => {} };
    },
    document: { cdc_test_prop: true, normalProp: true },
    console,
  };

  const script = buildStealthInitScript(resolveStealthConfig({}, {
    enabled: true,
    locale: "en-US",
    timezoneId: "America/New_York",
    userAgent: "StealthAgent/2.0",
    fingerprintSeed: "seed-abc",
    webglVendor: "Stealth Vendor",
    webglRenderer: "Stealth Renderer",
    platform: "Win32",
    hardwareConcurrency: 16,
    deviceMemory: 32,
  }));

  vm.runInNewContext(script, sandbox);

  // Navigator overrides
  assert.equal(navigatorObject.webdriver, undefined);
  assert.equal(navigatorObject.language, "en-US");
  assert.deepEqual(Array.from(navigatorObject.languages), ["en-US", "en"]);
  assert.equal(navigatorObject.platform, "Win32");
  assert.equal(navigatorObject.hardwareConcurrency, 16);
  assert.equal(navigatorObject.deviceMemory, 32);
  assert.equal(navigatorObject.userAgent, "StealthAgent/2.0");

  // Chrome runtime
  assert.ok("chrome" in (sandbox.window as any));
  assert.deepEqual(
    JSON.parse(JSON.stringify((sandbox.window as any).chrome)),
    { runtime: {} },
  );

  // Canvas toDataURL should NOT contain "#stealth-" suffix
  const canvas = new (sandbox.HTMLCanvasElement as typeof FakeCanvas)();
  const dataUrl1 = canvas.toDataURL();
  assert.ok(!dataUrl1.includes("#stealth-"), "toDataURL should not append stealth suffix");

  // toDataURL returns original (our FakeCanvas doesn't produce real base64)
  assert.equal(dataUrl1, "data:image/png;base64,original");

  // WebGL parameters
  const webgl = new (sandbox.WebGLRenderingContext as typeof FakeWebGLRenderingContext)();
  assert.equal(webgl.getParameter(37445), "Stealth Vendor");
  assert.equal(webgl.getParameter(37446), "Stealth Renderer");
  assert.equal(webgl.getParameter(1), "base-1");

  // DateTimeFormat
  const dateTimeFormat = new (sandbox.Intl as any).DateTimeFormat() as InstanceType<typeof FakeDateTimeFormat>;
  assert.deepEqual(
    JSON.parse(JSON.stringify(dateTimeFormat.resolvedOptions())),
    {
      locale: "en-US",
      timeZone: "America/New_York",
    },
  );

  // Navigator plugins
  const navPlugins = (navigatorObject as any).plugins;
  assert.equal(navPlugins.length, 5, "should have 5 plugins");
  const plugin0 = navPlugins.item(0);
  assert.equal(plugin0.name, "Chrome PDF Plugin");
  assert.equal(plugin0.description, "Portable Document Format");
  assert.equal(plugin0.filename, "internal-pdf-viewer");
  assert.equal(plugin0.length, 1);
  assert.notEqual(plugin0.item(0), null);
  assert.equal(plugin0.namedItem("application/pdf"), plugin0.item(0));
  assert.equal(navPlugins.namedItem("Chrome PDF Viewer"), navPlugins.item(1));

  // Navigator mimeTypes
  const navMimeTypes = (navigatorObject as any).mimeTypes;
  assert.equal(navMimeTypes.length, 2);
  const mt0 = navMimeTypes.item(0);
  assert.equal(mt0.type, "application/pdf");
  assert.equal(mt0.suffixes, "pdf");
  assert.equal(navMimeTypes.namedItem("text/pdf"), navMimeTypes.item(1));

  // RTCPeerConnection overridden
  assert.notEqual(sandbox.RTCPeerConnection, undefined);

  // Permissions query returns consistent results
  const permsQuery = (navigatorObject as any).permissions.query as (d: { name: string }) => Promise<{ state: string }>;
  await permsQuery({ name: "notifications" }).then((result) => {
    assert.equal(result.state, "granted");
  });
  await permsQuery({ name: "camera" }).then((result) => {
    assert.equal(result.state, "denied");
  });
  await permsQuery({ name: "microphone" }).then((result) => {
    assert.equal(result.state, "denied");
  });
});

test("createStealthContext creates a new automation-owned context with init script", async () => {
  const calls: {
    newContextOptions: Record<string, unknown> | undefined;
    initScript: string | undefined;
  } = {
    newContextOptions: undefined,
    initScript: undefined,
  };

  const context = {
    addInitScript: async (script: string) => {
      calls.initScript = script;
    },
  } as unknown as BrowserContext;

  const browser = {
    newContext: async (options?: Record<string, unknown>) => {
      calls.newContextOptions = options;
      return context;
    },
  } as unknown as Browser;

  const createdContext = await createStealthContext(browser, {
    env: {
      STEALTH_WEBGL_VENDOR: "Env Vendor",
      STEALTH_WEBGL_RENDERER: "Env Renderer",
    },
    locale: "en-US",
    timezoneId: "America/New_York",
    userAgent: "StealthAgent/2.0",
    fingerprintSeed: "seed-abc",
    proxy: {
      server: "http://proxy.example.com:8080",
      username: "proxy-user",
      password: "proxy-pass",
    },
  });

  assert.equal(createdContext, context);
  assert.deepEqual(calls.newContextOptions, {
    locale: "en-US",
    timezoneId: "America/New_York",
    userAgent: "StealthAgent/2.0",
    extraHTTPHeaders: {
      "Accept-Language": "en-US",
    },
    proxy: {
      server: "http://proxy.example.com:8080",
      username: "proxy-user",
      password: "proxy-pass",
    },
  });
  assert.match(calls.initScript ?? "", /Env Vendor/);
  assert.match(calls.initScript ?? "", /seed-abc/);
});
