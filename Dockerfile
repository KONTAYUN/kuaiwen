FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
LABEL org.opencontainers.image.source="https://github.com/KONTAYUN/kuaiwen"
LABEL org.opencontainers.image.description="快问，一个自部署的粘贴即问 AI 工具。"
LABEL org.opencontainers.image.licenses="MIT"
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
EXPOSE 3000
CMD ["npm", "start"]
