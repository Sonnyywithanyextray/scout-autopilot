import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Scout Autopilot',
  description: 'Scout learns how you search for housing, then takes over the repetitive work.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
