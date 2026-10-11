FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
COPY server ./server
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
ARG BUILD_VERSION=0.3.1
ARG BUILD_ARCH=amd64
LABEL io.hass.version="$BUILD_VERSION" io.hass.type="app" io.hass.arch="$BUILD_ARCH"
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8099 HA_CONFIG_DIR=/homeassistant
EXPOSE 8099
STOPSIGNAL SIGTERM
CMD ["node", "server/index.js"]
