import Link from 'next/link';

export const metadata = { title: 'Verify your email' };

export default async function Check({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { token } = await searchParams;
  return (
    <div style={{ maxWidth: 600 }}>
      <h1>Verify your email</h1>
      <p>An email provider has not been approved for this prototype, so no message was sent.</p>
      {token ? (
        <div className="notice info"><strong>Development verification link:</strong> <Link href={`/verify?token=${encodeURIComponent(token)}`}>Verify my email address</Link></div>
      ) : <p>Contact your pilot coordinator to complete verification.</p>}
    </div>
  );
}
