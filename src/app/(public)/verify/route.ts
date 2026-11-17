import { NextResponse, type NextRequest } from 'next/server';
import { verifyEmail } from '@/lib/accounts';
import { DomainError } from '@/lib/errors';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const url = req.nextUrl.clone();
  url.search = '';
  url.pathname = '/signin';
  try {
    await verifyEmail(token);
    url.searchParams.set('ok', 'Email verified. Sign in to set up your workspace.');
    url.searchParams.set('next', '/onboarding');
  } catch (e) {
    url.searchParams.set('error', e instanceof DomainError ? e.message : 'Verification failed.');
  }
  return NextResponse.redirect(url);
}
