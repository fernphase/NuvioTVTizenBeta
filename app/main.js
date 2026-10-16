window.__NUVIO_PLATFORM__ = "tizen";
window.__NUVIO_TIZEN_ENGINEFS_SERVICE_ENABLED__ = false;
window.__NUVIO_TIZEN_ENGINEFS_SERVICE_ID__ = "NuvioTV001.EngineFsService";
window.__NUVIO_TIZEN_PLUGIN_SERVICE_ENABLED__ = false;
window.__NUVIO_TIZEN_PLUGIN_SERVICE_ID__ = "NuvioTV001.PluginService";

var tvInput = window.tizen && window.tizen.tvinputdevice;
if (tvInput && typeof tvInput.registerKey === "function") {
  [
    "Back",
    "Return",
    "MediaPlay",
    "MediaPause",
    "MediaPlayPause",
    "MediaStop",
    "MediaFastForward",
    "MediaRewind",
    "MediaTrackPrevious",
    "MediaTrackNext"
  ].forEach(function registerKey(keyName) {
    try {
      tvInput.registerKey(keyName);
    } catch (_) {}
  });
}

function loadScript(src) {
  var script = document.createElement("script");
  script.async = false;
  script.src = src;
  script.defer = false;
  script.onerror = function handleStartupScriptError() {
    if (window.NuvioBootGuard) {
      window.NuvioBootGuard.scriptFailed(src);
    }
  };
  if (window.NuvioBootGuard) {
    window.NuvioBootGuard.stage("Loading " + src);
  }
  document.body.appendChild(script);
}

function startNuvioApp() {
  loadScript("nuvio.env.js");
  loadScript("assets/libs/qrcode-generator.js");
  loadScript("app.bundle.js");
}

if (window.NuvioBootGuard && typeof window.NuvioBootGuard.runCompatibilityGate === "function") {
  window.NuvioBootGuard.runCompatibilityGate({"platform":"tizen","minVersion":4,"minChrome":56,"requiredLabel":"Samsung Tizen 4.0+ · Chromium 56+ (2018+)"}, startNuvioApp);
} else {
  startNuvioApp();
}
