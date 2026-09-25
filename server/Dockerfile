# Build from the repository root (the server shares business rules with the app in ../src):
#   docker build -f server/Dockerfile -t mycarrepair-api .
FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server ./server
COPY src/constants ./src/constants
COPY src/utils ./src/utils
COPY src/models ./src/models
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
WORKDIR /app/server
CMD ["npm", "start"]
