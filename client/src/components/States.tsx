import React from 'react';
import { ApiError, errorMessage } from '../lib/api';

export function LoadingState({ message = 'Loading…' }: { message?: string }) {
  return <p className="state-message" role="status"><span className="loading-dot" aria-hidden="true" />{message}</p>;
}

export function EmptyState({ title, children, headingLevel = 3 }: { title: string; children: React.ReactNode; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return <div className="empty-state"><Heading>{title}</Heading><p>{children}</p></div>;
}

export function ErrorState({ error, onRetry, headingLevel = 3 }: { error: unknown; onRetry: () => void; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return <div className="error-state"><div role="alert"><Heading>Something needs another try</Heading>
    <p>{errorMessage(error)}</p>
    {error instanceof ApiError && error.missing.length > 0 && <ul aria-label="Missing fields">{error.missing.map((field, index) => <li key={`${index}-${field}`}>{field}</li>)}</ul>}
  </div><button className="button" onClick={onRetry}>Try again</button></div>;
}

export function FieldDisplay({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="field"><dt>{label}</dt><dd>{value === null || value === undefined || value === '' ? 'Unknown' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value}</dd></div>;
}
