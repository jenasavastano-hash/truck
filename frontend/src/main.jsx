import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found!');
}

try {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (error) {
  console.error('Error rendering app:', error);
  if (rootElement) {
    rootElement.innerHTML = `
      <div style="padding: 20px; font-family: Arial; color: red; background: white; min-height: 100vh;">
        <h1>Ошибка загрузки приложения</h1>
        <p><strong>${error.message}</strong></p>
        <p>Проверьте консоль браузера (F12) для подробностей.</p>
        <pre style="background: #f5f5f5; padding: 10px; margin-top: 10px; overflow: auto;">${error.stack || ''}</pre>
      </div>
    `;
  }
}
