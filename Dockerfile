FROM mcr.microsoft.com/dotnet/sdk:10.0 AS client-build

WORKDIR /source

COPY global.json ./
COPY client client
RUN dotnet restore client/TelemetryClient.Tests/TelemetryClient.Tests.csproj \
    && dotnet test client/TelemetryClient.Tests/TelemetryClient.Tests.csproj --configuration Release --no-restore \
    && dotnet restore client/TelemetryClient/TelemetryClient.csproj --runtime win-x64 \
    && dotnet publish client/TelemetryClient/TelemetryClient.csproj \
        --configuration Release \
        --runtime win-x64 \
        --self-contained true \
        -p:PublishProfile=win-x64 \
        --no-restore \
        --output /client-release \
    && bash client/generate-release-manifest.sh client/TelemetryClient/TelemetryClient.csproj /client-release

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY apps/server apps/server
COPY apps/web apps/web
COPY packages/protocol packages/protocol
COPY graphic-packages graphic-packages
RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN npm ci --omit=dev

COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=build /app/packages/protocol/dist packages/protocol/dist
COPY --from=build /app/graphic-packages graphic-packages
COPY --from=client-build /client-release/BroadcastGraphicsClient.exe client-release/BroadcastGraphicsClient.exe
COPY --from=client-build /client-release/BroadcastGraphicsClient.exe.sha256 client-release/BroadcastGraphicsClient.exe.sha256
COPY --from=client-build /client-release/latest.json client-release/latest.json

USER node
EXPOSE 8787

CMD ["node", "apps/server/dist/index.js"]
