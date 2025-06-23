FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

COPY .env.dev .env

EXPOSE 3034

CMD ["node", "server.js"]
