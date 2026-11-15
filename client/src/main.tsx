import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SavedProvider } from './components/SavedEvents';
import './style.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><SavedProvider><App /></SavedProvider></React.StrictMode>);
