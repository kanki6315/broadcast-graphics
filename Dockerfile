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

USER node
EXPOSE 8787

CMD ["node", "apps/server/dist/index.js"]
