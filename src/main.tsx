import React from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import './styles.css';
import './library.css';
import './design-tokens.css';
import './legacy-webview.css';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import { applyWebViewCompatibilityClass } from './webview-compat';

applyWebViewCompatibilityClass(document.documentElement);

if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(new URL('./sw.js', window.location.href));
  });
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
