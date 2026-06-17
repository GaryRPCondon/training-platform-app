import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { AppDirectionProvider } from "@/lib/providers/direction-provider";
import "./globals.css";
import QueryProvider from "@/lib/providers/query-provider";
import { ThemeProvider } from "@/lib/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { getLocaleDir } from "@/i18n/config";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Run TrAIner",
  description: "AI-powered training platform for endurance athletes",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = getLocaleDir(locale);

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <NextIntlClientProvider messages={messages}>
            {/* Feeds direction to all Radix primitives (Select, Slider, Switch,
                RadioGroup, Dialog…) so they flip under RTL without per-component props. */}
            <AppDirectionProvider dir={dir}>
              <QueryProvider>
                {children}
                <Toaster dir={dir} position={dir === "rtl" ? "bottom-left" : "bottom-right"} />
              </QueryProvider>
            </AppDirectionProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
