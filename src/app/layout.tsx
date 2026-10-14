import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { ThemeInitScript } from "@/components/theme-init-script"
import "./globals.css"

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
})

export const metadata: Metadata = {
  title: "Визуализатор треков",
  description: "GPX на карте, скорость по записи и профиль высоты",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <ThemeInitScript />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
