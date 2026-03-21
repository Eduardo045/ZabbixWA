FROM node:22-alpine
WORKDIR /app

# Dependências de build necessárias para compilar better-sqlite3 (módulo nativo)
RUN apk add --no-cache python3 make g++

# Copia manifesto e instala dependências de produção
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copia o restante do código
COPY . .

RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "server.js"]
