# TODO(maintainer): pin to a digest, e.g.
#   docker pull node:22-alpine && docker inspect --format='{{index .RepoDigests 0}}' node:22-alpine
# then replace the line below with node:22-alpine@sha256:<digest>.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.mjs ./
COPY src ./src
COPY public ./public
COPY featurescript ./featurescript
COPY docs ./docs
RUN mkdir -p /app/backups
ENV HOST=0.0.0.0 PORT=8787 NODE_ENV=production \
    BACKUP_DIR=/app/backups \
    ONSHAPE_REFERENCE_ALIGN_CONFIG=/app/.env
EXPOSE 8787
CMD ["node", "server.mjs"]
