import { Analytics } from '@vercel/analytics/next'
import Script from 'next/script'
import type { Metadata, Viewport } from 'next'
import { TelegramRuntime } from '@/components/cybernode/telegram-runtime'
import { PwaRegistration } from '@/components/cybernode/pwa-registration'
import { TonConnectProvider } from '@/components/cybernode/ton-connect-provider'
import './globals.css'

export const metadata: Metadata = {
  title: 'CyberNode | Executive Green Compute Console',
  description: 'CyberNode executive console with opt-in activity telemetry, verified TON records, a protected operator dashboard, and a Telegram Mini App experience.',
  generator: 'v0.app',
  applicationName: 'CyberNode',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'CyberNode' },
  icons: { icon: '/cybernode-icon.svg', apple: '/apple-icon.png' },
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  userScalable: true,
  colorScheme: 'dark',
  themeColor: '#090d16',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <TelegramRuntime />
        <PwaRegistration />
        <TonConnectProvider>{children}</TonConnectProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
