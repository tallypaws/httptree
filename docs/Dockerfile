FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/* \
  && npm i -g pnpm@12.14.0
WORKDIR /app

ARG GIT_REMOTE=https://github.com/tallypaws/httptree.git
ARG GIT_REV=main

COPY package.json package-lock.json tsconfig.json .gitignore ./
COPY pkg ./pkg
COPY ext ./ext
RUN npm ci --ignore-scripts
RUN npm run build -w pkg

WORKDIR /app/docs
COPY docs/package.json docs/pnpm-lock.yaml docs/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY docs ./

WORKDIR /app
RUN git init -q && git remote add origin "$GIT_REMOTE" \
  && git add -A >/dev/null 2>&1 \
  && git -c user.email=docs@localhost -c user.name=docs commit -q -m docs

WORKDIR /app/docs
RUN pnpm run gen --gitRevision "$GIT_REV"

ENV NODE_ENV=production
EXPOSE 8000
CMD ["sh", "-c", "node server.ts & exec ./node_modules/.bin/webpatcher --target http://127.0.0.1:3000 --patches ./patches --public ./public --port 8000"]