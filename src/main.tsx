import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './library.css';
import App from './App';
import ErrorBoundary from './ErrorBoundary';

createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
