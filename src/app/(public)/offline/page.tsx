export const metadata = { title: 'Offline' };

export default function Offline() {
  return (
    <div style={{ maxWidth: 640 }}>
      <h1>You are offline</h1>
      <p>Confidential matter data requires an online connection. LEXIA does not store client records, drafts or Lawyer DNA samples on this device.</p>
      <p>Reconnect and reload to continue.</p>
    </div>
  );
}
