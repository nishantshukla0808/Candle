'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Lessons are now part of the dashboard path view
export default function LessonsPage() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);
  
  return null;
}
