import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#F97316",
          50: "#FFF7ED",
          100: "#FFEDD5",
          500: "#F97316",
          600: "#EA6C0A",
          700: "#C2570A",
        },
        block: "#EF4444",
        pass: "#22C55E",
      },
    },
  },
  plugins: [],
};

export default config;
