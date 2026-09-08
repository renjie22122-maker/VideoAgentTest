import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title:'FRAME · AI 导演工作台',description:'从自然语言创意到剧本、分镜、运镜与连续视频的本地导演工作台。' };
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){ return <html lang="zh-CN" className="dark"><body>{children}</body></html>; }
