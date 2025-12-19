/**
 * PostCSS Configuration - Alice Frontend Service
 * 
 * Configuração para processamento de CSS com Tailwind CSS 4.x.
 * 
 * NOTA: Tailwind CSS 4.x moveu o plugin PostCSS para @tailwindcss/postcss
 * Documentação: https://tailwindcss.com/docs/upgrade-guide
 * 
 * Autor: Fillipe Guerra
 * Data: 19 de Dezembro de 2025
 * @module @alice/frontend-service
 */

export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};

