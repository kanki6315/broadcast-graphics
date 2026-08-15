# Repository guidance

## Windows telemetry client releases

- Whenever a change affects `client/TelemetryClient` or its shipped behavior, increment the `<Version>` in `client/TelemetryClient/TelemetryClient.csproj` in the same change.
- Use a version greater than the currently deployed client version. The production build regenerates the executable SHA-256 manifest, but existing clients only install it when the manifest version is newer than their installed version.
