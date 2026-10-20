# DermaScan backend — Node/Express API.
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Uploaded analysis images live here (mount a volume in compose).
RUN mkdir -p uploads

EXPOSE 5000
CMD ["node", "server.js"]
