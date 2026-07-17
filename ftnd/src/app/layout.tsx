import type { Metadata } from 'next';
import './globals.css';

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
      <body>{children}</body>
    </html>
  );
}
