# Build multi-stage: compila TypeScript, roda só o output em produção —
# better-sqlite3 tem binding nativo, então npm ci precisa dos devDependencies
# no stage de build (node-gyp) mas não no stage final.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/app.js"]
