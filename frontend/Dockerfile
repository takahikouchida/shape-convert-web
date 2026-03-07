FROM node:20-bookworm

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY vite.config.ts ./
COPY postcss.config.cjs ./
COPY tailwind.config.cjs ./
COPY index.html ./
COPY src ./src
COPY public ./public

EXPOSE 5173

CMD ["npm", "run", "dev"]
