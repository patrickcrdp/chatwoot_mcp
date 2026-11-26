FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json tsconfig.stdio.json wrangler.jsonc ./
COPY src ./src
COPY static ./static

RUN npm run build

EXPOSE 8787

CMD ["npm", "run", "start"]
