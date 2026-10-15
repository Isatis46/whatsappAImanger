import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/500.css";
import "@fontsource/vazirmatn/600.css";
import "@fontsource/vazirmatn/700.css";
import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "هم‌صحبت | مدیریت هوشمند واتساپ",
  description: "پنل یکپارچه حساب‌های واتساپ، گفتگوها و دستیارهای هوش مصنوعی",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
