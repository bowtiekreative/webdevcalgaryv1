# Production image for the Astro front end.
#
# Important: the site is prerendered, so `astro build` **queries WordPress**.
# WordPress must already be deployed and reachable at WP_GRAPHQL_ENDPOINT when
# this image is built, and the build args below have to be present at build
# time, not just at runtime. That is why WordPress deploys first and the front
# end is a separate resource — see BUILDING.md.

# ---- build ----------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Build-time configuration. Astro reads these while prerendering, so they are
# ARGs promoted to ENV rather than runtime-only variables.
ARG WP_GRAPHQL_ENDPOINT
ARG WP_SHARED_SECRET
ARG SITE_URL
ARG SITE_NAME
ARG SITE_TAGLINE
ARG WP_FAIL_ON_ERROR=1

ENV WP_GRAPHQL_ENDPOINT=$WP_GRAPHQL_ENDPOINT \
    WP_SHARED_SECRET=$WP_SHARED_SECRET \
    SITE_URL=$SITE_URL \
    SITE_NAME=$SITE_NAME \
    SITE_TAGLINE=$SITE_TAGLINE \
    WP_FAIL_ON_ERROR=$WP_FAIL_ON_ERROR

# Dependencies first, so a content-only change reuses this layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime --------------------------------------------------------------
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321

# Production dependencies only — the build output already has everything else
# bundled, and this keeps the image small.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Sessions are written to node_modules/.astro by the Node adapter's default
# driver, so the runtime user needs to own the tree.
RUN chown -R node:node /app
USER node

EXPOSE 4321

# Coolify's health check hits the first exposed port; a 200 here means the
# server is up and the prerendered output is being served.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4321/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "./dist/server/entry.mjs"]
