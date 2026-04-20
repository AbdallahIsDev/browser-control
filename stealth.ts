import type { Browser, BrowserContext, BrowserContextOptions } from "playwright";
import { logger } from "./logger";

const log = logger.withComponent("stealth");

export interface StealthConfig {
  enabled: boolean;
  locale: string;
  timezoneId: string;
  userAgent?: string;
  fingerprintSeed: string;
  webglVendor: string;
  webglRenderer: string;
  platform: string;
  hardwareConcurrency: number;
  deviceMemory: number;
}

export type StealthConfigOverrides = Partial<StealthConfig>;

export interface StealthContextOptions {
  env?: NodeJS.ProcessEnv;
  locale?: string;
  timezoneId?: string;
  userAgent?: string;
  seed?: string;
  fingerprintSeed?: string;
  webglVendor?: string;
  webglRenderer?: string;
  platform?: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  proxy?: BrowserContextOptions["proxy"];
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeLocale(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const withoutEncoding = trimmed.split(".")[0] ?? trimmed;
  return withoutEncoding.replace(/_/g, "-");
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildDeterministicSeed(
  locale: string,
  timezoneId: string,
  platform: string,
  userAgent?: string,
): string {
  const input = `${locale}|${timezoneId}|${platform}|${userAgent ?? "default"}`;
  let hash = 0;

  for (const character of input) {
    hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

function buildLanguageList(locale: string): string[] {
  const baseLanguage = locale.split("-")[0] ?? locale;
  return Array.from(new Set([locale, baseLanguage].filter(Boolean)));
}

export function resolveStealthConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: StealthConfigOverrides = {},
): StealthConfig {
  const locale = overrides.locale
    ?? normalizeLocale(env.STEALTH_LOCALE)
    ?? normalizeLocale(env.BROWSER_LOCALE)
    ?? normalizeLocale(env.LANG)
    ?? "en-US";
  const timezoneId = overrides.timezoneId
    ?? normalizeOptionalString(env.STEALTH_TIMEZONE_ID)
    ?? normalizeOptionalString(env.BROWSER_TIMEZONE_ID)
    ?? normalizeOptionalString(env.BROWSER_TIMEZONE)
    ?? normalizeOptionalString(env.TZ)
    ?? "UTC";
  const userAgent = overrides.userAgent ?? normalizeOptionalString(env.BROWSER_USER_AGENT);
  const platform = overrides.platform ?? normalizeOptionalString(env.STEALTH_PLATFORM) ?? "Win32";

  return {
    enabled: overrides.enabled ?? parseBoolean(env.ENABLE_STEALTH, false),
    locale,
    timezoneId,
    userAgent,
    fingerprintSeed: overrides.fingerprintSeed
      ?? normalizeOptionalString(env.STEALTH_FINGERPRINT_SEED)
      ?? buildDeterministicSeed(locale, timezoneId, platform, userAgent),
    webglVendor: overrides.webglVendor ?? normalizeOptionalString(env.STEALTH_WEBGL_VENDOR) ?? "Intel Inc.",
    webglRenderer: overrides.webglRenderer
      ?? normalizeOptionalString(env.STEALTH_WEBGL_RENDERER)
      ?? "Intel Iris OpenGL Engine",
    platform,
    hardwareConcurrency: overrides.hardwareConcurrency
      ?? parsePositiveInteger(env.STEALTH_HARDWARE_CONCURRENCY, 8),
    deviceMemory: overrides.deviceMemory
      ?? parsePositiveInteger(env.STEALTH_DEVICE_MEMORY, 8),
  };
}

export function buildStealthInitScript(config: StealthConfig): string {
  const serializedConfig = JSON.stringify({
    ...config,
    languages: buildLanguageList(config.locale),
  });

  return `
(() => {
  const config = ${serializedConfig};

  // --- Seeded PRNG (mulberry32) ---
  function mulberry32(a) {
    return function() {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Convert seed string to 32-bit integer
  function seedToInt(seed) {
    var hash = 0;
    for (var i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash) + seed.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  var rng = mulberry32(seedToInt(config.fingerprintSeed));

  const defineValue = (target, key, value) => {
    if (!target) {
      return;
    }

    try {
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: false,
        get: () => value,
      });
      return;
    } catch {}

    try {
      target[key] = value;
    } catch {}
  };

  const globalTarget = typeof window !== "undefined" ? window : globalThis;
  const navigatorTarget = typeof navigator !== "undefined" ? navigator : undefined;

  // --- CDC Property Removal ---
  if (navigatorTarget) {
    // Remove cdc_ properties on document
    if (typeof document !== "undefined") {
      var docKeys = Object.getOwnPropertyNames(document);
      for (var i = 0; i < docKeys.length; i++) {
        if (docKeys[i].indexOf("cdc_") === 0) {
          try { delete document[docKeys[i]]; } catch {}
        }
      }
    }
    // Remove ducktype from navigator prototype
    try {
      var navProto = Object.getPrototypeOf(navigatorTarget);
      if (navProto && "ducktype" in navProto) {
        delete navProto.ducktype;
      }
    } catch {}
  }

  // --- Navigator overrides ---
  if (navigatorTarget) {
    defineValue(navigatorTarget, "webdriver", undefined);
    defineValue(navigatorTarget, "language", config.locale);
    defineValue(navigatorTarget, "languages", config.languages);
    defineValue(navigatorTarget, "platform", config.platform);
    defineValue(navigatorTarget, "hardwareConcurrency", config.hardwareConcurrency);
    defineValue(navigatorTarget, "deviceMemory", config.deviceMemory);
    if (config.userAgent) {
      defineValue(navigatorTarget, "userAgent", config.userAgent);
    }
  }

  // --- Chrome runtime ---
  if (globalTarget) {
    if (!globalTarget.chrome || typeof globalTarget.chrome !== "object") {
      defineValue(globalTarget, "chrome", { runtime: {} });
    } else if (!("runtime" in globalTarget.chrome)) {
      globalTarget.chrome.runtime = {};
    }
  }

  // --- Canvas rewrite with seeded PRNG noise (no suffix appending) ---
  var patchCanvas = (CanvasConstructor) => {
    var prototype = CanvasConstructor?.prototype;
    var originalToDataURL = prototype?.toDataURL;
    var originalToBlob = prototype?.toBlob;
    if (typeof originalToDataURL !== "function" || originalToDataURL.__stealthPatched) {
      return;
    }

    var patchedToDataURL = function() {
      try {
        var width = this.width || 0;
        var height = this.height || 0;
        if (width > 0 && height > 0) {
          var ctx = this.getContext("2d");
          if (ctx) {
            var imageData = ctx.getImageData(0, 0, width, height);
            var data = imageData.data;
            // Shift 1-2 pixels by +/-1 on R/G/B channels
            var pixelsToShift = Math.floor(rng() * 2) + 1;
            for (var p = 0; p < pixelsToShift; p++) {
              var px = Math.floor(rng() * width);
              var py = Math.floor(rng() * height);
              var idx = (py * width + px) * 4;
              if (idx + 2 < data.length) {
                data[idx] = Math.max(0, Math.min(255, data[idx] + (rng() > 0.5 ? 1 : -1)));
                data[idx + 1] = Math.max(0, Math.min(255, data[idx + 1] + (rng() > 0.5 ? 1 : -1)));
                data[idx + 2] = Math.max(0, Math.min(255, data[idx + 2] + (rng() > 0.5 ? 1 : -1)));
              }
            }
            ctx.putImageData(imageData, 0, 0);
          }
        }
      } catch {}
      return originalToDataURL.apply(this, arguments);
    };

    Object.defineProperty(patchedToDataURL, "__stealthPatched", {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    });

    prototype.toDataURL = patchedToDataURL;

    if (typeof originalToBlob === "function") {
      var patchedToBlob = function() {
        try {
          var width = this.width || 0;
          var height = this.height || 0;
          if (width > 0 && height > 0) {
            var ctx = this.getContext("2d");
            if (ctx) {
              var imageData = ctx.getImageData(0, 0, width, height);
              var data = imageData.data;
              var pixelsToShift = Math.floor(rng() * 2) + 1;
              for (var p = 0; p < pixelsToShift; p++) {
                var px = Math.floor(rng() * width);
                var py = Math.floor(rng() * height);
                var idx = (py * width + px) * 4;
                if (idx + 2 < data.length) {
                  data[idx] = Math.max(0, Math.min(255, data[idx] + (rng() > 0.5 ? 1 : -1)));
                  data[idx + 1] = Math.max(0, Math.min(255, data[idx + 1] + (rng() > 0.5 ? 1 : -1)));
                  data[idx + 2] = Math.max(0, Math.min(255, data[idx + 2] + (rng() > 0.5 ? 1 : -1)));
                }
              }
              ctx.putImageData(imageData, 0, 0);
            }
          }
        } catch {}
        return originalToBlob.apply(this, arguments);
      };

      Object.defineProperty(patchedToBlob, "__stealthPatched", {
        configurable: false,
        enumerable: false,
        value: true,
        writable: false,
      });

      prototype.toBlob = patchedToBlob;
    }
  };

  // --- WebGL parameter override ---
  var patchWebGL = (WebGLConstructor) => {
    var prototype = WebGLConstructor?.prototype;
    var originalGetParameter = prototype?.getParameter;
    if (typeof originalGetParameter !== "function" || originalGetParameter.__stealthPatched) {
      return;
    }

    var patchedGetParameter = function(parameter) {
      if (parameter === 37445) {
        return config.webglVendor;
      }
      if (parameter === 37446) {
        return config.webglRenderer;
      }
      return originalGetParameter.call(this, parameter);
    };

    Object.defineProperty(patchedGetParameter, "__stealthPatched", {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    });

    prototype.getParameter = patchedGetParameter;
  };

  patchCanvas(typeof HTMLCanvasElement !== "undefined" ? HTMLCanvasElement : undefined);
  patchWebGL(typeof WebGLRenderingContext !== "undefined" ? WebGLRenderingContext : undefined);
  patchWebGL(typeof WebGL2RenderingContext !== "undefined" ? WebGL2RenderingContext : undefined);

  // --- Intl.DateTimeFormat override ---
  var dateTimeFormatPrototype = globalThis.Intl?.DateTimeFormat?.prototype;
  var originalResolvedOptions = dateTimeFormatPrototype?.resolvedOptions;
  if (typeof originalResolvedOptions === "function" && !originalResolvedOptions.__stealthPatched) {
    var patchedResolvedOptions = function(...args) {
      var resolved = originalResolvedOptions.apply(this, args) ?? {};
      return {
        ...resolved,
        locale: config.locale,
        timeZone: config.timezoneId,
      };
    };

    Object.defineProperty(patchedResolvedOptions, "__stealthPatched", {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    });

    dateTimeFormatPrototype.resolvedOptions = patchedResolvedOptions;
  }

  // --- Navigator plugins and mimeTypes ---
  if (navigatorTarget) {
    var pluginEntries = [
      { name: "Chrome PDF Plugin", description: "Portable Document Format", filename: "internal-pdf-viewer" },
      { name: "Chrome PDF Viewer", description: "", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai" },
      { name: "Native Client", description: "", filename: "internal-nacl-plugin" },
      { name: "Chromium PDF Viewer", description: "Portable Document Format", filename: "internal-pdf-viewer" },
      { name: "Microsoft Edge PDF Viewer", description: "Portable Document Format", filename: "internal-pdf-viewer" },
    ];

    var mimeTypeEntries = [
      { type: "application/pdf", suffixes: "pdf", description: "Portable Document Format" },
      { type: "text/pdf", suffixes: "pdf", description: "Portable Document Format" },
    ];

    // Build plugin-like objects
    function makeMimeType(info) {
      var mt = {};
      Object.defineProperty(mt, "type", { value: info.type, enumerable: true });
      Object.defineProperty(mt, "suffixes", { value: info.suffixes, enumerable: true });
      Object.defineProperty(mt, "description", { value: info.description, enumerable: true });
      Object.defineProperty(mt, "enabledPlugin", { value: null, enumerable: true });
      return mt;
    }

    function makePlugin(info, mimes) {
      var plugin = {};
      Object.defineProperty(plugin, "name", { value: info.name, enumerable: true });
      Object.defineProperty(plugin, "description", { value: info.description, enumerable: true });
      Object.defineProperty(plugin, "filename", { value: info.filename, enumerable: true });
      Object.defineProperty(plugin, "length", { value: mimes.length, enumerable: true });
      plugin.item = function(index) { return mimes[index] || null; };
      plugin.namedItem = function(name) {
        for (var j = 0; j < mimes.length; j++) {
          if (mimes[j].type === name) return mimes[j];
        }
        return null;
      };
      // Make iterable
      mimes.forEach(function(m, idx) { plugin[idx] = m; });
      return plugin;
    }

    var mimeObjects = mimeTypeEntries.map(function(e) { return makeMimeType(e); });
    // Link enabledPlugin back: first mime types map to first plugin
    if (mimeObjects.length > 0) {
      var pdfPluginMimes = [mimeObjects[0]];
      if (mimeObjects.length > 1) pdfPluginMimes.push(mimeObjects[1]);
      // We'll just set enabledPlugin below after building plugins
    }

    var pluginObjects = [];
    // First plugin (Chrome PDF Plugin) gets the PDF mimeTypes
    pluginObjects.push(makePlugin(pluginEntries[0], [mimeObjects[0]]));
    mimeObjects[0].enabledPlugin = pluginObjects[0];
    // Chrome PDF Viewer
    pluginObjects.push(makePlugin(pluginEntries[1], [mimeObjects[0]]));
    // Native Client - no mime types
    pluginObjects.push(makePlugin(pluginEntries[2], []));
    // Chromium PDF Viewer
    pluginObjects.push(makePlugin(pluginEntries[3], [mimeObjects[0]]));
    // Microsoft Edge PDF Viewer
    pluginObjects.push(makePlugin(pluginEntries[4], [mimeObjects[0]]));

    if (mimeObjects.length > 1) {
      mimeObjects[1].enabledPlugin = pluginObjects[0];
    }

    // Define plugins with length and indexed access
    var pluginsObj = {};
    Object.defineProperty(pluginsObj, "length", { value: pluginObjects.length, enumerable: true });
    pluginsObj.item = function(index) { return pluginObjects[index] || null; };
    pluginsObj.namedItem = function(name) {
      for (var j = 0; j < pluginObjects.length; j++) {
        if (pluginObjects[j].name === name) return pluginObjects[j];
      }
      return null;
    };
    pluginsObj.refresh = function() {};
    for (var pi = 0; pi < pluginObjects.length; pi++) {
      pluginsObj[pi] = pluginObjects[pi];
      // Also accessible by name
      (function(plugin) {
        Object.defineProperty(pluginsObj, plugin.name, {
          get: function() { return plugin; },
          configurable: true,
          enumerable: false,
        });
      })(pluginObjects[pi]);
    }

    // Define mimeTypes with length and indexed access
    var mimeTypesObj = {};
    Object.defineProperty(mimeTypesObj, "length", { value: mimeObjects.length, enumerable: true });
    mimeTypesObj.item = function(index) { return mimeObjects[index] || null; };
    mimeTypesObj.namedItem = function(name) {
      for (var j = 0; j < mimeObjects.length; j++) {
        if (mimeObjects[j].type === name) return mimeObjects[j];
      }
      return null;
    };
    for (var mi = 0; mi < mimeObjects.length; mi++) {
      mimeTypesObj[mi] = mimeObjects[mi];
      (function(mt) {
        Object.defineProperty(mimeTypesObj, mt.type, {
          get: function() { return mt; },
          configurable: true,
          enumerable: false,
        });
      })(mimeObjects[mi]);
    }

    defineValue(navigatorTarget, "plugins", pluginsObj);
    defineValue(navigatorTarget, "mimeTypes", mimeTypesObj);
  }

  // --- Permissions override ---
  if (navigatorTarget && navigatorTarget.permissions && navigatorTarget.permissions.query) {
    var originalPermsQuery = navigatorTarget.permissions.query.bind(navigatorTarget.permissions);
    var patchedPermsQuery = function(descriptor) {
      return originalPermsQuery(descriptor).then(function(result) {
        var name = descriptor.name;
        if (name === "notifications") {
          Object.defineProperty(result, "state", { value: "granted", writable: true, configurable: true });
        } else if (name === "camera" || name === "microphone") {
          Object.defineProperty(result, "state", { value: "denied", writable: true, configurable: true });
        }
        return result;
      }).catch(function() {
        // Return a synthetic PermissionStatus on failure
        var synthetic = {};
        var state = name === "notifications" ? "granted" : "denied";
        Object.defineProperty(synthetic, "state", { value: state, writable: true, configurable: true });
        return synthetic;
      });
    };
    navigatorTarget.permissions.query = patchedPermsQuery;
  }

  // --- WebRTC leak prevention ---
  if (globalTarget && globalTarget.RTCPeerConnection) {
    var OrigRTC = globalTarget.RTCPeerConnection;
    var StealthRTC = function(configuration, constraints) {
      var instance = new OrigRTC(configuration, constraints);
      // Override addEventListener and onicecandidate to filter candidates
      var origAddEventListener = instance.addEventListener.bind(instance);
      instance.addEventListener = function(type, listener, options) {
        if (type === "icecandidate") {
          var wrappedListener = function(event) {
            if (event.candidate && event.candidate.candidate) {
              var cand = event.candidate.candidate;
              // Only pass host/local candidates, filter out srflx/relay/prflx
              if (cand.indexOf("typ host") === -1 && cand.indexOf("typ local") === -1) {
                return;
              }
            }
            if (typeof listener === "function") {
              listener.call(this, event);
            }
          };
          return origAddEventListener(type, wrappedListener, options);
        }
        return origAddEventListener(type, listener, options);
      };

      var _onicecandidate = null;
      Object.defineProperty(instance, "onicecandidate", {
        get: function() { return _onicecandidate; },
        set: function(handler) {
          _onicecandidate = handler;
          origAddEventListener("icecandidate", function(event) {
            if (event.candidate && event.candidate.candidate) {
              var cand = event.candidate.candidate;
              if (cand.indexOf("typ host") === -1 && cand.indexOf("typ local") === -1) {
                return;
              }
            }
            if (typeof _onicecandidate === "function") {
              _onicecandidate.call(this, event);
            }
          });
        },
        configurable: true,
      });

      return instance;
    };
    StealthRTC.prototype = OrigRTC.prototype;
    globalTarget.RTCPeerConnection = StealthRTC;
  }

  // Override navigator.mediaDevices.enumerateDevices to return synthetic local devices
  if (navigatorTarget && navigatorTarget.mediaDevices && navigatorTarget.mediaDevices.enumerateDevices) {
    navigatorTarget.mediaDevices.enumerateDevices = function() {
      return Promise.resolve([
        { deviceId: "default", groupId: "group-a", kind: "audioinput", label: "", toJSON: function() { return this; } },
        { deviceId: "communications", groupId: "group-a", kind: "audioinput", label: "", toJSON: function() { return this; } },
        { deviceId: "default", groupId: "group-b", kind: "audiooutput", label: "", toJSON: function() { return this; } },
        { deviceId: "communications", groupId: "group-b", kind: "audiooutput", label: "", toJSON: function() { return this; } },
      ]);
    };
  }

  // --- Iframe contentWindow patch ---
  try {
    var iframeProto = typeof HTMLIFrameElement !== "undefined" ? HTMLIFrameElement.prototype : null;
    if (iframeProto) {
      var originalContentWindow = Object.getOwnPropertyDescriptor(iframeProto, "contentWindow");
      if (originalContentWindow && originalContentWindow.get && !originalContentWindow.get.__stealthPatched) {
        var patchedGetter = function() {
          var win = originalContentWindow.get.call(this);
          try {
            if (win && win.navigator) {
              defineValue(win.navigator, "webdriver", undefined);
              defineValue(win.navigator, "language", config.locale);
              defineValue(win.navigator, "languages", config.languages);
              defineValue(win.navigator, "platform", config.platform);
              defineValue(win.navigator, "hardwareConcurrency", config.hardwareConcurrency);
              defineValue(win.navigator, "deviceMemory", config.deviceMemory);
              if (config.userAgent) {
                defineValue(win.navigator, "userAgent", config.userAgent);
              }
            }
          } catch {}
          return win;
        };
        Object.defineProperty(patchedGetter, "__stealthPatched", {
          configurable: false,
          enumerable: false,
          value: true,
          writable: false,
        });
        Object.defineProperty(iframeProto, "contentWindow", {
          get: patchedGetter,
          configurable: true,
          enumerable: true,
        });
      }
    }
  } catch {}

  // --- Console.debug suppression for DevTools detection strings ---
  if (typeof console !== "undefined" && typeof console.debug === "function") {
    var originalConsoleDebug = console.debug;
    if (!originalConsoleDebug.__stealthPatched) {
      var patchedConsoleDebug = function() {
        var msg = Array.prototype.join.call(arguments, " ");
        if (msg.indexOf("DevTools") !== -1 || msg.indexOf("devtools") !== -1 || msg.indexOf("cdc_") !== -1) {
          return;
        }
        return originalConsoleDebug.apply(this, arguments);
      };
      Object.defineProperty(patchedConsoleDebug, "__stealthPatched", {
        configurable: false,
        enumerable: false,
        value: true,
        writable: false,
      });
      console.debug = patchedConsoleDebug;
    }
  }
})();
`.trim();
}

export async function createStealthContext(
  browser: Browser,
  options: StealthContextOptions = {},
): Promise<BrowserContext> {
  const config = resolveStealthConfig(options.env ?? process.env, {
    enabled: true,
    locale: options.locale,
    timezoneId: options.timezoneId,
    userAgent: options.userAgent,
    fingerprintSeed: options.fingerprintSeed ?? options.seed,
    webglVendor: options.webglVendor,
    webglRenderer: options.webglRenderer,
    platform: options.platform,
    hardwareConcurrency: options.hardwareConcurrency,
    deviceMemory: options.deviceMemory,
  });

  const contextOptions: Parameters<Browser["newContext"]>[0] = {
    locale: config.locale,
    timezoneId: config.timezoneId,
    extraHTTPHeaders: {
      "Accept-Language": config.locale,
    },
  };

  if (config.userAgent) {
    contextOptions.userAgent = config.userAgent;
  }
  if (options.proxy) {
    contextOptions.proxy = options.proxy;
  }

  const context = await browser.newContext(contextOptions);

  try {
    await context.addInitScript(buildStealthInitScript(config));
    return context;
  } catch (error: unknown) {
    log.error(`Failed to initialize stealth context: ${error instanceof Error ? error.message : String(error)}`);
    await context.close().catch(() => undefined);
    throw error;
  }
}
