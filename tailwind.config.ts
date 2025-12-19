import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

// Configuração Tailwind CSS 4.x - Enterprise Alice Platform
// Autor: Fillipe Guerra
// Data: 19 de Dezembro de 2025
export default {
  darkMode: ["class"],
  content: [
    "./apps/frontend-service/src/**/*.{js,jsx,ts,tsx}",
    "./apps/frontend-service/index.html",
  ],
  theme: {
    extend: {
      borderRadius: {
        lg: ".5625rem", /* 9px */
        md: ".375rem", /* 6px */
        sm: ".1875rem", /* 3px */
      },
      fontSize: {
        "hero": ["3rem", { lineHeight: "3.5rem", fontWeight: "700" }],
        "h1": ["2.5rem", { lineHeight: "3rem", fontWeight: "700" }],
        "h2": ["2rem", { lineHeight: "2.5rem", fontWeight: "600" }],
        "h3": ["1.5rem", { lineHeight: "2rem", fontWeight: "600" }],
        "body-lg": ["1.125rem", { lineHeight: "1.75rem" }],
        "body": ["1rem", { lineHeight: "1.5rem" }],
        "small": ["0.875rem", { lineHeight: "1.25rem" }],
        "xs": ["0.75rem", { lineHeight: "1rem" }],
      },
      colors: {
        // Tailwind CSS 4.x - cores usando oklch para melhor compatibilidade
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
          border: "hsl(var(--card-border))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
          border: "hsl(var(--popover-border))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          border: "var(--primary-border)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
          border: "var(--secondary-border)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
          border: "var(--muted-border)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
          border: "var(--accent-border)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          border: "var(--destructive-border)",
        },
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
        sidebar: {
          ring: "hsl(var(--sidebar-ring))",
          DEFAULT: "hsl(var(--sidebar))",
          foreground: "hsl(var(--sidebar-foreground))",
          border: "hsl(var(--sidebar-border))",
        },
        "sidebar-primary": {
          DEFAULT: "hsl(var(--sidebar-primary))",
          foreground: "hsl(var(--sidebar-primary-foreground))",
          border: "var(--sidebar-primary-border)",
        },
        "sidebar-accent": {
          DEFAULT: "hsl(var(--sidebar-accent))",
          foreground: "hsl(var(--sidebar-accent-foreground))",
          border: "var(--sidebar-accent-border)"
        },
        status: {
          online: "rgb(34 197 94)",
          away: "rgb(245 158 11)",
          busy: "rgb(239 68 68)",
          offline: "rgb(156 163 175)",
        },
      },
      fontFamily: {
        sans: ["Inter", "IBM Plex Sans", "system-ui", "sans-serif"],
        serif: ["Georgia", "serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      maxWidth: {
        "dashboard": "80rem",
        "form": "56rem",
        "chat": "48rem",
      },
      spacing: {
        "18": "4.5rem",
        "22": "5.5rem",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  // Tailwind CSS 4.x usa ESM imports ao invés de require()
  // tw-animate-css é importado via @import no CSS
  plugins: [typography],
} satisfies Config;
