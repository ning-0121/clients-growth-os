import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Growth OS",
  description: "客户获客与销售执行系统 — 线索、触达与转化",
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

