FROM node:24-slim
RUN npm i -g pnpm@12.14.0
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY pkg ./pkg
COPY ext ./ext
RUN npm ci --ignore-scripts

WORKDIR /app/docs
COPY docs/package.json docs/pnpm-lock.yaml docs/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY docs ./
RUN pnpm run gen

ENV NODE_ENV=production
EXPOSE 8000
CMD ["sh", "-c", "node server.ts & exec ./node_modules/.bin/webpatcher --target http://127.0.0.1:3000 --patches ./patches --public ./public --port 8000"]