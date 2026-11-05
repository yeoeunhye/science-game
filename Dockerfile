FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY client ./client
COPY shared ./shared
COPY server ./server
USER node
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD node -e "fetch('http://127.0.0.1:8000/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/server.js"]
