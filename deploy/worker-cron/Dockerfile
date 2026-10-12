FROM node:24-alpine
WORKDIR /app
COPY gates.mjs worker-cron.mjs ./
USER node
CMD ["node", "worker-cron.mjs"]
