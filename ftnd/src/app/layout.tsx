import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

const refreshToWelcomeScript = `
  try {
    const navigation = performance.getEntriesByType('navigation')[0];
    if (location.pathname !== '/' && navigation && navigation.type === 'reload') {
      document.documentElement.dataset.refreshRedirect = 'true';
      location.replace('/');
    }
  } catch (_) {}
`;

export const metadata: Metadata = {
  title: 'MOVE / MATCH · AI 手势舞教学',
  description: '抖音黑客松多模态 AI 手势舞教学网页端',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <Script id="refresh-to-welcome" strategy="beforeInteractive">
          {refreshToWelcomeScript}
        </Script>
        {children}
      </body>
    </html>
  );
}
