import React from 'react';
import LiveSession from './components/LiveSession';

const App: React.FC = () => {
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4 text-center">
        <h1 className="text-3xl font-bold mb-4 text-red-500">Configuration Error</h1>
        <p className="text-neutral-400 max-w-md">
          API Key not found. Please ensure <code>process.env.API_KEY</code> is configured in your environment.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 font-sans">
        
      <header className="w-full max-w-7xl flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/30">
             <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
             </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">LiveVision AI</h1>
            <p className="text-xs text-neutral-400">Powered by Gemini 2.5</p>
          </div>
        </div>
        
        <a 
          href="https://ai.google.dev" 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-xs font-medium text-neutral-500 hover:text-white transition-colors"
        >
          Documentation &rarr;
        </a>
      </header>

      {/* Main Container - Adjusted aspect ratio logic for responsive layout */}
      <main className="w-full max-w-7xl flex-1 min-h-[600px] h-[80vh] shadow-2xl shadow-black/50 rounded-2xl overflow-hidden ring-1 ring-white/10">
        <LiveSession apiKey={apiKey} />
      </main>

      <footer className="mt-8 text-neutral-600 text-sm text-center">
        <p>Show objects to the camera and ask questions naturally.</p>
      </footer>
    </div>
  );
};

export default App;
