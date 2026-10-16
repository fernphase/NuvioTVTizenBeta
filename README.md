# Nuvio TV for TizenBrew

Self-contained TizenBrew module for the latest Nuvio TV release.

Add this repository in TizenBrew:

```text
tonioriol/NuvioTVTizenBeta
```

Nuvio TV left beta with 0.3.42 and now publishes only stable releases in
[NuvioMedia/NuvioTVSmart](https://github.com/NuvioMedia/NuvioTVSmart/releases). The GitHub Actions
workflow checks the latest release every six hours, downloads its official Tizen `.wgt`, verifies the
release digest, unpacks the app into `app/`, and commits the result.

## Notes

- The module keeps its TizenBrew shape: `packageType: "app"` and `appPath: "app/index.html"`.
- The updater adapts the official entry page for TizenBrew: it drops the widget-only `$WEBAPIS` and
  `wrt:service` imports and disables the packaged native services (EngineFS torrent playback and
  plugin execution), which only run in an installed `.wgt`. Use the official `.wgt` installer if you
  need those features.
- The repository name is kept so existing TizenBrew installs continue to update.
