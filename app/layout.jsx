import './globals.css';

export const metadata = {
  title: 'Core · KVI · Promo · Ecom Availability Tracker',
  description: 'Dynamic Required DOS availability tracker for Core, KVI, Promo and Ecom assortments.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body data-theme="light">{children}</body>
    </html>
  );
}
