import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchResponse } from '../../../shared/api';
import { EventCard } from '../components/EventCard';
import { ErrorState, LoadingState } from '../components/States';
import { createSearchController, searchEvents, starterPrompts, type SearchState } from '../lib/search';

export function SearchResults({ response, query }: { response: SearchResponse; query: string }) {
  return <section className="search-results" aria-labelledby="answer-heading">
    <div className="panel search-answer"><h2 id="answer-heading">{response.noMatch ? 'No matching events' : 'Here’s what matches'}</h2>
      <p className="submitted-query">Results for “{query}”</p><p className="answer-text">{response.answer}</p>
      {response.constraintSummary.length > 0 && <ul className="constraint-chips" aria-label="How your question was understood">{response.constraintSummary.map((summary, index) => <li key={index}>{summary}</li>)}</ul>}
    </div>
    {!response.noMatch && <section aria-labelledby="matching-events-heading"><h3 id="matching-events-heading">Matching events</h3>
      <div className="event-grid search-grid">{response.results.map(({ event, reason }) => <div className="search-result" key={event.id}><EventCard event={event} /><p className="match-reason"><strong>Why it matches:</strong> {reason}</p></div>)}</div>
    </section>}
    {response.excluded.length > 0 && <section className="panel" aria-labelledby="excluded-heading"><h3 id="excluded-heading">Why other events were left out</h3><ul className="exclusion-notes">{response.excluded.map((note, index) => <li key={index}><strong>{note.count}</strong> — {note.reason}</li>)}</ul></section>}
  </section>;
}

export function Ask({ revision = 0 }: { revision?: number }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const input = useRef<HTMLTextAreaElement>(null);
  const controller = useMemo(() => createSearchController(searchEvents, setState), []);
  const previousRevision = useRef(revision);
  const [listingsChanged, setListingsChanged] = useState(false);
  useEffect(() => () => controller.cancel(), [controller]);
  useEffect(() => {
    if (revision !== previousRevision.current) {
      previousRevision.current = revision;
      controller.reset(); setListingsChanged(true);
    }
  }, [controller, revision]);
  function submit(value: string) {
    setListingsChanged(false);
    if (!controller.submit(value)) input.current?.focus();
  }
  return <>
    <section className="panel ask-panel" aria-labelledby="ask-heading"><h2 id="ask-heading">Ask about campus events</h2>
      <form onSubmit={event => { event.preventDefault(); submit(query); }} noValidate>
        <label htmlFor="event-question">What would you like to do?</label>
        <textarea id="event-question" ref={input} className="question-input" rows={3} maxLength={500} value={query} onChange={event => setQuery(event.target.value)}
          placeholder="Find a free event with food tomorrow" aria-invalid={state.status === 'invalid' || undefined} aria-describedby={`question-help${state.status === 'invalid' ? ' question-error' : ''}`} />
        <div className="question-meta"><p id="question-help">Up to 500 characters. Dates and times use Los Angeles time.</p><span>{query.length}/500</span></div>
        {state.status === 'invalid' && <p id="question-error" className="field-error" role="alert">{state.message}</p>}
        <button className="button" type="submit">{state.status === 'loading' ? 'Search again' : 'Find events'}</button>
      </form>
      <div className="starter-prompts" role="group" aria-label="Try a question">{starterPrompts.map(prompt => <button className="button button-secondary" key={prompt} onClick={() => { setQuery(prompt); submit(prompt); }}>{prompt}</button>)}</div>
    </section>
    <div className="sr-only" role="status">{state.status === 'success' ? state.response.noMatch ? 'No matching events found.' : `${state.response.results.length} matching ${state.response.results.length === 1 ? 'event' : 'events'} shown.` : ''}</div>
    {listingsChanged && <p className="notice" role="status">Event listings changed. Submit your question again for current results.</p>}
    {state.status === 'idle' && !listingsChanged && <p className="filter-note">Ask a question or choose a starter prompt to see matching published events and their sources.</p>}
    {state.status === 'loading' && <LoadingState message={`Finding events for “${state.query}”…`} />}
    {state.status === 'error' && <div className="panel"><p>Search for “{state.query}” could not be completed.</p><ErrorState error={state.error} onRetry={() => submit(state.query)} /></div>}
    {state.status === 'success' && <SearchResults response={state.response} query={state.query} />}
  </>;
}
