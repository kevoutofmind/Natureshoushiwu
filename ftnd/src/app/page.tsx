import AuthPage from '@/components/AuthPage';
import { redirect } from 'next/navigation';

export default function Home() {
  if (process.env.NEXT_PUBLIC_ROADSHOW_MODE === 'true') {
    redirect('/popular');
  }

  return <AuthPage />;
}
