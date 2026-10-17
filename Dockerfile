FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash nano coreutils procps util-linux ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build
RUN mkdir -p /data/projects && chown -R node:node /app /data

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
