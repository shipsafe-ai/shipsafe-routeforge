import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        brand: {
          DEFAULT: "#F97316",
          50: "#FFF7ED",
          100: "#FFEDD5",
          500: "#F97316",
          600: "#EA6C0A",
          700: "#C2570A",
        },
        block: "#F87171",
        pass: "#4ADE80",
        // Surface hierarchy
        surface: {
          DEFAULT: "#111215",
          raised: "#16161b",
          overlay: "#1b1b22",
        },
      },
      borderColor: {
        DEFAULT: "#1e1e26",
      },
    },
  },
  plugins: [],
};

export default config;
