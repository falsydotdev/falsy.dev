# Built by wrangler from the clouds/ directory (image_build_context), for linux/amd64.
FROM node:24-slim
WORKDIR /app
COPY container/package.json container/package-lock.json container/
RUN cd container && npm ci --omit=dev --no-audit --no-fund
COPY shared/ shared/
COPY container/*.js container/
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
USER node
CMD ["node", "container/server.js"]
