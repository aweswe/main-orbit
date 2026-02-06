export const getPackageJson = (projectName: string) => {
  return JSON.stringify({
    "name": projectName.toLowerCase().replace(/\s+/g, '-'),
    "private": true,
    "version": "0.0.0",
    "type": "module",
    "scripts": {
      "dev": "vite",
      "build": "vite build",
      "lint": "eslint .",
      "preview": "vite preview"
    },
    "dependencies": {
      "react": "^18.3.1",
      "react-dom": "^18.3.1",
      "lucide-react": "^0.462.0",
      "framer-motion": "^12.0.0",
      "clsx": "^2.1.1",
      "tailwind-merge": "^2.6.0",
      "tailwindcss-animate": "^1.0.7",
      "recharts": "^2.15.0",
      "uuid": "^9.0.1",
      "@radix-ui/react-slot": "^1.0.2",
      "class-variance-authority": "^0.7.0"
    },
    "devDependencies": {
      "@types/react": "^18.3.12",
      "@types/react-dom": "^18.3.1",
      "@vitejs/plugin-react": "^4.3.4",
      "autoprefixer": "^10.4.20",
      "postcss": "^8.4.49",
      "tailwindcss": "^3.4.15",
      "typescript": "^5.6.3",
      "vite": "^6.0.1"
    }
  }, null, 2);
};

export const getViteConfig = () => {
  return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});`;
};

export const getTailwindConfig = () => {
  return `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};`;
};

export const getPostcssConfig = () => {
  return `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};`;
};

export const getTsConfig = () => {
  return JSON.stringify({
    "compilerOptions": {
      "target": "ESNext",
      "useDefineForClassFields": true,
      "lib": ["DOM", "DOM.Iterable", "ESNext"],
      "allowJs": false,
      "skipLibCheck": true,
      "esModuleInterop": false,
      "allowSyntheticDefaultImports": true,
      "strict": true,
      "forceConsistentCasingInFileNames": true,
      "module": "ESNext",
      "moduleResolution": "Node",
      "resolveJsonModule": true,
      "isolatedModules": true,
      "noEmit": true,
      "jsx": "react-jsx",
      "baseUrl": ".",
      "paths": {
        "@/*": ["./src/*"]
      }
    },
    "include": ["src"],
    "references": []
  }, null, 2);
};

export const getIndexHtml = (projectName: string) => {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;
};

export const getMainTsx = () => {
  return `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`;
};

export const getIndexCss = () => {
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;

  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}

#root {
  width: 100%;
}`;
};
