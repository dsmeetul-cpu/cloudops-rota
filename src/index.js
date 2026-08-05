import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App /></React.StrictMode>);

// Register the PWA service worker — required for the "Install App" button to appear.
// Works in production only (Chrome/Edge/Brave on HTTPS). Safe to leave in; ignored by
// unsupported browsers and during local dev.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(console.error);
  });
}
